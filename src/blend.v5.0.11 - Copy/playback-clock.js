// playback-clock.js
// ---------------------------------------------------------------------------
// Pure, DOM-free playback timing + transport-state helpers.
//
// This module never touches `document`/`window`, so it can be imported and
// unit-tested directly by tests/regression/* (unlike app.js). app.js wires it
// into the live player to implement exact-position pause/resume:
//   - PausableTimer  -> image-slide auto-advance that survives a pause
//   - ElapsedClock   -> Ken Burns / progress animations that survive a pause
//   - TRANSPORT      -> the stopped / playing / paused state machine
// ---------------------------------------------------------------------------

/**
 * The three transport modes. Pause must preserve positions (resume exactly
 * where left off); Stop fully tears down (play restarts from the beginning).
 */
export const TRANSPORT = Object.freeze({
  STOPPED: 'stopped',
  PLAYING: 'playing',
  PAUSED: 'paused'
});

const TRANSPORT_VALUES = new Set(Object.values(TRANSPORT));

/** Normalize an arbitrary value into a valid transport mode. */
export function normalizeTransport(mode) {
  return TRANSPORT_VALUES.has(mode) ? mode : TRANSPORT.STOPPED;
}

/**
 * Decide what a single Play/Pause toggle should do for the given mode:
 *   - 'pause'  : currently playing -> pause both layers, banking positions
 *   - 'resume' : currently paused  -> continue from the paused positions
 *   - 'start'  : currently stopped -> fresh start from current indices
 *
 * This is the contract enforced by the requirements:
 *   Playing -> Pause -> Play  === resume where left off   (start? no, resume)
 *   Playing -> Stop  -> Play  === start over (mode becomes STOPPED first)
 */
export function transportToggleAction(mode) {
  switch (normalizeTransport(mode)) {
    case TRANSPORT.PLAYING: return 'pause';
    case TRANSPORT.PAUSED: return 'resume';
    default: return 'start';
  }
}

/** True only while media is actively advancing (PLAYING). */
export function isActivePlayback(mode) {
  return normalizeTransport(mode) === TRANSPORT.PLAYING;
}

/** True when there are banked positions to resume from (PAUSED). */
export function isPaused(mode) {
  return normalizeTransport(mode) === TRANSPORT.PAUSED;
}

function defaultNow() {
  // Prefer the monotonic clock in browsers; fall back to Date in node tests.
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Accumulates *running* time across pause/resume cycles.
 *
 * Used for the Ken Burns animation so a paused-then-resumed slide continues
 * from exactly the same zoom/pan offset rather than restarting or jumping.
 */
export class ElapsedClock {
  constructor(now = defaultNow) {
    this._now = typeof now === 'function' ? now : defaultNow;
    this._accumulated = 0;
    this._startedAt = null;
  }

  /** Begin a fresh measurement (running). */
  start() {
    this._accumulated = 0;
    this._startedAt = this._now();
    return this;
  }

  /** Pause measurement, banking the time run so far. Idempotent. */
  pause() {
    if (this._startedAt != null) {
      this._accumulated += Math.max(0, this._now() - this._startedAt);
      this._startedAt = null;
    }
    return this;
  }

  /** Resume measurement without losing banked time. Idempotent. */
  resume() {
    if (this._startedAt == null) this._startedAt = this._now();
    return this;
  }

  /** Discard all time and stop. */
  reset() {
    this._accumulated = 0;
    this._startedAt = null;
    return this;
  }

  get running() {
    return this._startedAt != null;
  }

  /** Total time the clock has been running (ms), excluding paused gaps. */
  elapsed() {
    const live = this._startedAt != null ? Math.max(0, this._now() - this._startedAt) : 0;
    return this._accumulated + live;
  }
}

/**
 * A `setTimeout` wrapper that can pause (banking the remaining time) and
 * resume so the callback fires after exactly the remaining duration captured
 * at pause. Used for image-slide auto-advance.
 *
 * Timer + clock functions are injectable so the behavior can be tested with a
 * deterministic fake clock.
 */
export class PausableTimer {
  constructor({ setTimer, clearTimer, now = defaultNow } = {}) {
    // Default to wrappers (not bare `setTimeout`/`clearTimeout`): in browsers a
    // stored, later-invoked reference to the global timer functions throws
    // "Illegal invocation" unless called with the global as receiver.
    this._setTimer = typeof setTimer === 'function' ? setTimer : (fn, ms) => setTimeout(fn, ms);
    this._clearTimer = typeof clearTimer === 'function' ? clearTimer : (id) => clearTimeout(id);
    this._now = typeof now === 'function' ? now : defaultNow;
    this._handle = null;
    this._cb = null;
    this._deadline = 0;
    this._remaining = 0;
    this._running = false;
  }

  /** Start a one-shot timer of `durationMs` that invokes `cb` when elapsed. */
  start(cb, durationMs) {
    this.cancel();
    this._cb = typeof cb === 'function' ? cb : null;
    this._remaining = Math.max(0, Number(durationMs) || 0);
    if (this._cb) this._arm(this._remaining);
    return this;
  }

  _arm(ms) {
    const delay = Math.max(0, ms);
    this._deadline = this._now() + delay;
    this._running = true;
    this._handle = this._setTimer(() => {
      this._running = false;
      this._handle = null;
      const cb = this._cb;
      this._cb = null;
      this._remaining = 0;
      if (cb) cb();
    }, delay);
  }

  /** Pause the timer, banking the remaining time. Idempotent / safe if idle. */
  pause() {
    if (!this._running) return this;
    this._remaining = Math.max(0, this._deadline - this._now());
    if (this._handle != null) this._clearTimer(this._handle);
    this._handle = null;
    this._running = false;
    return this;
  }

  /** Resume a paused timer for its banked remaining time. */
  resume() {
    if (this._running || this._cb == null) return this;
    this._arm(this._remaining);
    return this;
  }

  /** Cancel entirely; no callback will fire. */
  cancel() {
    if (this._handle != null) this._clearTimer(this._handle);
    this._handle = null;
    this._cb = null;
    this._running = false;
    this._remaining = 0;
    this._deadline = 0;
    return this;
  }

  get running() {
    return this._running;
  }

  /** Whether a callback is still scheduled (running or paused, not fired). */
  get pending() {
    return this._cb != null;
  }

  /** Remaining time (ms) before the callback fires. */
  get remaining() {
    if (this._running) return Math.max(0, this._deadline - this._now());
    return this._remaining;
  }
}

export default {
  TRANSPORT,
  normalizeTransport,
  transportToggleAction,
  isActivePlayback,
  isPaused,
  ElapsedClock,
  PausableTimer
};
