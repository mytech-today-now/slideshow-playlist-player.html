import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDirectoryScanYield,
  DIRECTORY_SCAN_PAUSED_MESSAGE
} from '../../directory-scan-yield.js';

function makeVisibility(initialState = 'visible') {
  let state = initialState;
  const listeners = new Set();
  return {
    get state() { return state; },
    get listenerCount() { return listeners.size; },
    set(nextState) {
      state = nextState;
      for (const listener of Array.from(listeners)) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

test('visible scan yield schedules a task without subscribing to visibility', async () => {
  const visibility = makeVisibility();
  let taskYields = 0;
  const yieldDirectoryScan = createDirectoryScanYield({
    getVisibilityState: () => visibility.state,
    subscribeVisibilityChange: visibility.subscribe,
    yieldToTaskQueue: async () => { taskYields += 1; }
  });

  assert.equal(await yieldDirectoryScan(), true);
  assert.equal(taskYields, 1);
  assert.equal(visibility.listenerCount, 0);
});

test('hidden scan announces pause, resumes on visibility, and removes its listener', async () => {
  const visibility = makeVisibility('hidden');
  const transitions = [];
  const yieldDirectoryScan = createDirectoryScanYield({
    getVisibilityState: () => visibility.state,
    subscribeVisibilityChange: visibility.subscribe,
    yieldToTaskQueue: async () => {}
  });

  let settled = false;
  const pending = yieldDirectoryScan({
    onVisibilityChange: state => transitions.push(state)
  }).then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(transitions, ['hidden']);
  assert.equal(visibility.listenerCount, 1);

  visibility.set('visible');
  assert.equal(await pending, true);
  assert.deepEqual(transitions, ['hidden', 'visible']);
  assert.equal(visibility.listenerCount, 0);
  assert.match(DIRECTORY_SCAN_PAUSED_MESSAGE, /Saved batches remain available\.$/);
});

test('aborting a hidden scan releases its visibility listener without resuming', async () => {
  const visibility = makeVisibility('hidden');
  const controller = new AbortController();
  const transitions = [];
  const yieldDirectoryScan = createDirectoryScanYield({
    getVisibilityState: () => visibility.state,
    subscribeVisibilityChange: visibility.subscribe,
    yieldToTaskQueue: async () => {}
  });

  const pending = yieldDirectoryScan({
    signal: controller.signal,
    onVisibilityChange: state => transitions.push(state)
  });
  await Promise.resolve();
  assert.equal(visibility.listenerCount, 1);

  controller.abort();
  assert.equal(await pending, false);
  assert.deepEqual(transitions, ['hidden']);
  assert.equal(visibility.listenerCount, 0);
});

test('an already-aborted scan does not wait or subscribe', async () => {
  const visibility = makeVisibility('hidden');
  const controller = new AbortController();
  controller.abort();
  const yieldDirectoryScan = createDirectoryScanYield({
    getVisibilityState: () => visibility.state,
    subscribeVisibilityChange: visibility.subscribe,
    yieldToTaskQueue: async () => {}
  });

  assert.equal(await yieldDirectoryScan({ signal: controller.signal }), false);
  assert.equal(visibility.listenerCount, 0);
});
