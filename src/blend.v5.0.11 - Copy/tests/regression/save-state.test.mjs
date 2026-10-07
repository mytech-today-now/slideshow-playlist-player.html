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

test('flush commits the latest dirty revision and clears it only after success', async () => {
  const firstWrite = deferred();
  const writes = [];
  const coordinator = createSaveRevisionCoordinator({
    delayMs: 60_000,
    persist: ({ revision }) => {
      writes.push(revision);
      return writes.length === 1 ? firstWrite.promise : Promise.resolve(true);
    }
  });

  coordinator.markDirty();
  const flush = coordinator.flush();
  assert.equal(coordinator.getStatus().dirty, true);
  assert.equal(coordinator.getStatus().saving, true);

  coordinator.markDirty();
  firstWrite.resolve(true);
  assert.equal(await flush, true);
  assert.deepEqual(writes, [1, 2]);
  assert.deepEqual(coordinator.getStatus(), {
    dirtyRevision: 2,
    savedRevision: 2,
    dirty: false,
    saving: false,
    failed: false
  });
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
