import test from 'node:test';
import assert from 'node:assert/strict';

import { createSaveRevisionCoordinator } from '../../save-state.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeTimers() {
  let now = 0;
  let nextId = 0;
  const pending = new Map();
  return {
    setTimeoutFn(callback, delay) {
      const id = ++nextId;
      pending.set(id, { callback, dueAt: now + delay });
      return id;
    },
    clearTimeoutFn(id) {
      pending.delete(id);
    },
    advance(ms) {
      now += ms;
      while (true) {
        const next = [...pending.entries()]
          .filter(([, timer]) => timer.dueAt <= now)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
        if (!next) break;
        pending.delete(next[0]);
        next[1].callback();
      }
    },
    get size() {
      return pending.size;
    }
  };
}

test('delayed commits keep a newer revision dirty and overlapping flushes share the write', async () => {
  const timers = fakeTimers();
  const firstWrite = deferred();
  const secondWrite = deferred();
  const secondWriteStarted = deferred();
  const writes = [];
  const coordinator = createSaveRevisionCoordinator({
    delayMs: 850,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    persist: ({ revision }) => {
      writes.push(revision);
      if (revision === 1) return firstWrite.promise;
      if (revision === 2) {
        secondWriteStarted.resolve();
        return secondWrite.promise;
      }
      return Promise.resolve(true);
    }
  });

  coordinator.markDirty();
  assert.equal(timers.size, 1);
  timers.advance(850);
  assert.equal(coordinator.getStatus().dirty, true);
  assert.equal(coordinator.getStatus().saving, true);
  assert.deepEqual(writes, [1]);

  const firstFlush = coordinator.flush();
  const overlappingFlush = coordinator.flush();
  assert.deepEqual(writes, [1]);
  coordinator.markDirty();
  assert.equal(coordinator.getStatus().dirtyRevision, 2);
  assert.equal(timers.size, 1);

  firstWrite.resolve(true);
  await secondWriteStarted.promise;
  assert.deepEqual(writes, [1, 2]);
  assert.deepEqual(coordinator.getStatus(), {
    dirtyRevision: 2,
    savedRevision: 1,
    dirty: true,
    saving: true,
    failed: false
  });

  secondWrite.resolve(true);
  assert.deepEqual(await Promise.all([firstFlush, overlappingFlush]), [true, true]);
  assert.deepEqual(coordinator.getStatus(), {
    dirtyRevision: 2,
    savedRevision: 2,
    dirty: false,
    saving: false,
    failed: false
  });
  coordinator.cancel();
});

test('debounced edits coalesce into one write for the latest revision', async () => {
  const timers = fakeTimers();
  const writes = [];
  const coordinator = createSaveRevisionCoordinator({
    delayMs: 850,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    persist: async ({ revision }) => {
      writes.push(revision);
      return true;
    }
  });

  coordinator.markDirty();
  coordinator.markDirty();
  coordinator.markDirty();
  assert.equal(timers.size, 1);
  timers.advance(849);
  assert.deepEqual(writes, []);
  timers.advance(1);
  assert.equal(await coordinator.flush(), true);
  assert.deepEqual(writes, [3]);
  assert.equal(coordinator.getStatus().dirty, false);
  coordinator.cancel();
});

test('a rejected save leaves the dirty revision available for retry', async () => {
  let attempts = 0;
  const coordinator = createSaveRevisionCoordinator({
    delayMs: 60_000,
    persist: async () => {
      attempts += 1;
      return attempts > 1;
    }
  });

  coordinator.markDirty();
  assert.equal(await coordinator.flush(), false);
  assert.deepEqual(coordinator.getStatus(), {
    dirtyRevision: 1,
    savedRevision: 0,
    dirty: true,
    saving: false,
    failed: true
  });

  assert.equal(await coordinator.flush(), true);
  assert.equal(coordinator.getStatus().dirty, false);
  assert.equal(coordinator.getStatus().savedRevision, 1);
  coordinator.cancel();
});
