import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRANSPORT,
  normalizeTransport,
  transportToggleAction,
  isActivePlayback,
  isPaused,
  ElapsedClock,
  PausableTimer
} from '../../playback-clock.js';

// A deterministic fake scheduler so timer behavior can be asserted exactly.
function makeFakeTimers() {
  let now = 0;
  let id = 1;
  const tasks = new Map();
  return {
    now: () => now,
    setTimer: (cb, ms) => { const tid = id++; tasks.set(tid, { cb, at: now + Math.max(0, ms) }); return tid; },
    clearTimer: (tid) => { tasks.delete(tid); },
    advance: (ms) => {
      const target = now + ms;
      // Fire due callbacks in chronological order as the clock advances.
      let guard = 0;
      while (true) {
        const dueEntries = [...tasks.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at);
        if (!dueEntries.length || guard++ > 1000) break;
        const [tid, t] = dueEntries[0];
        tasks.delete(tid);
        now = t.at;
        t.cb();
      }
      now = target;
    },
    pending: () => tasks.size
  };
}

// ---- Transport state machine ---------------------------------------------

test('transportToggleAction maps each mode to the correct action', () => {
  assert.equal(transportToggleAction(TRANSPORT.STOPPED), 'start');
  assert.equal(transportToggleAction(TRANSPORT.PLAYING), 'pause');
  assert.equal(transportToggleAction(TRANSPORT.PAUSED), 'resume');
  // Unknown / undefined modes are treated as stopped -> fresh start.
  assert.equal(transportToggleAction('garbage'), 'start');
  assert.equal(transportToggleAction(undefined), 'start');
});

test('the canonical control sequences resolve correctly', () => {
  // Playing -> Pause -> Play === resume where left off.
  let mode = TRANSPORT.PLAYING;
  assert.equal(transportToggleAction(mode), 'pause');
  mode = TRANSPORT.PAUSED;
  assert.equal(transportToggleAction(mode), 'resume');

  // Playing -> Stop -> Play === start over at the very beginning.
  mode = TRANSPORT.STOPPED;
  assert.equal(transportToggleAction(mode), 'start');
});

test('normalizeTransport / predicate helpers', () => {
  assert.equal(normalizeTransport('playing'), 'playing');
  assert.equal(normalizeTransport('weird'), 'stopped');
  assert.equal(isActivePlayback(TRANSPORT.PLAYING), true);
  assert.equal(isActivePlayback(TRANSPORT.PAUSED), false);
  assert.equal(isPaused(TRANSPORT.PAUSED), true);
  assert.equal(isPaused(TRANSPORT.PLAYING), false);
});

// ---- ElapsedClock ---------------------------------------------------------

test('ElapsedClock accumulates only running time across pause/resume', () => {
  let t = 0;
  const clock = new ElapsedClock(() => t);
  clock.start();
  t = 300;
  assert.equal(clock.elapsed(), 300);
  clock.pause();
  t = 1000; // time passes while paused
  assert.equal(clock.elapsed(), 300, 'paused time is not counted');
  clock.resume();
  t = 1200;
  assert.equal(clock.elapsed(), 500, 'resumes from banked elapsed');
  assert.equal(clock.running, true);
  clock.reset();
  assert.equal(clock.elapsed(), 0);
  assert.equal(clock.running, false);
});

test('ElapsedClock pause/resume are idempotent', () => {
  let t = 0;
  const clock = new ElapsedClock(() => t);
  clock.start();
  t = 100;
  clock.pause();
  clock.pause(); // no double-count
  t = 500;
  clock.resume();
  clock.resume(); // no reset of startedAt
  t = 600;
  assert.equal(clock.elapsed(), 200);
});

// ---- PausableTimer --------------------------------------------------------

test('PausableTimer fires after the full duration when never paused', () => {
  const timers = makeFakeTimers();
  const timer = new PausableTimer(timers);
  let fired = 0;
  timer.start(() => { fired++; }, 1000);
  timers.advance(999);
  assert.equal(fired, 0);
  timers.advance(1);
  assert.equal(fired, 1);
  assert.equal(timer.pending, false);
});

test('PausableTimer banks remaining time on pause and resumes exactly', () => {
  const timers = makeFakeTimers();
  const timer = new PausableTimer(timers);
  let fired = 0;
  timer.start(() => { fired++; }, 1000);
  timers.advance(400);
  assert.equal(timer.remaining, 600);
  timer.pause();
  assert.equal(timer.running, false);
  assert.equal(timer.remaining, 600);
  timers.advance(5000); // time passes while paused — must not fire
  assert.equal(fired, 0);
  timer.resume();
  assert.equal(timer.running, true);
  timers.advance(599);
  assert.equal(fired, 0);
  timers.advance(1);
  assert.equal(fired, 1, 'fires after exactly the banked remaining time');
});

test('PausableTimer cancel prevents the callback and clears state', () => {
  const timers = makeFakeTimers();
  const timer = new PausableTimer(timers);
  let fired = 0;
  timer.start(() => { fired++; }, 500);
  timer.cancel();
  assert.equal(timer.pending, false);
  assert.equal(timers.pending(), 0);
  timers.advance(1000);
  assert.equal(fired, 0);
});

test('PausableTimer survives multiple pause/resume cycles', () => {
  const timers = makeFakeTimers();
  const timer = new PausableTimer(timers);
  let fired = 0;
  timer.start(() => { fired++; }, 900);
  timers.advance(300); timer.pause();   // 600 left
  timers.advance(100); timer.resume();
  timers.advance(300); timer.pause();   // 300 left
  timers.advance(100); timer.resume();
  timers.advance(299);
  assert.equal(fired, 0);
  timers.advance(1);
  assert.equal(fired, 1);
});

test('PausableTimer resume on an idle timer is a no-op', () => {
  const timers = makeFakeTimers();
  const timer = new PausableTimer(timers);
  timer.resume(); // nothing scheduled
  assert.equal(timer.pending, false);
  assert.equal(timers.pending(), 0);
});
