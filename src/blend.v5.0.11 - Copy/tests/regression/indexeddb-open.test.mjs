import test from 'node:test';
import assert from 'node:assert/strict';
import { IndexedDBOpenError, openIndexedDB } from '../../indexeddb-open.js';

function makeTimers() {
  let nextId = 0;
  const pending = new Map();
  return {
    setTimer(callback, delay) {
      const id = ++nextId;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    expire(id = pending.keys().next().value) {
      const timer = pending.get(id);
      if (!timer) throw new Error('No pending timer to expire');
      pending.delete(id);
      timer.callback();
    },
    get pendingCount() {
      return pending.size;
    }
  };
}

function makeOpenRequest() {
  return {
    error: null,
    result: null,
    onupgradeneeded: null,
    onblocked: null,
    onerror: null,
    onsuccess: null
  };
}

function makeIndexedDB(request = makeOpenRequest()) {
  const calls = [];
  return {
    calls,
    request,
    indexedDB: {
      open(name, version) {
        calls.push({ name, version });
        return request;
      }
    }
  };
}

test('successful open runs the schema callback and returns the connection', async () => {
  const request = makeOpenRequest();
  const { indexedDB, calls } = makeIndexedDB(request);
  const timers = makeTimers();
  const connection = { close() {} };
  const upgrades = [];
  const opened = openIndexedDB({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    onUpgrade: event => upgrades.push(event),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  const upgradeEvent = { target: { result: {} } };
  request.onupgradeneeded(upgradeEvent);
  request.result = connection;
  request.onsuccess();

  assert.equal(await opened, connection);
  assert.deepEqual(calls, [{ name: 'player-blend-v1', version: 5 }]);
  assert.deepEqual(upgrades, [upgradeEvent]);
  assert.equal(timers.pendingCount, 0);
});

test('open errors reject with a typed error and clear the deadline', async () => {
  const request = makeOpenRequest();
  const { indexedDB } = makeIndexedDB(request);
  const timers = makeTimers();
  const opened = openIndexedDB({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
  const cause = new Error('synthetic open failure');
  request.error = cause;
  request.onerror();

  await assert.rejects(opened, error => {
    assert.ok(error instanceof IndexedDBOpenError);
    assert.equal(error.code, 'idb_open_error');
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(timers.pendingCount, 0);
});

test('blocked opens report immediately and reject when their deadline expires', async () => {
  const request = makeOpenRequest();
  const { indexedDB } = makeIndexedDB(request);
  const timers = makeTimers();
  const blockedEvents = [];
  const opened = openIndexedDB({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    timeoutMs: 15_000,
    onBlocked: event => blockedEvents.push(event),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
  const blockedEvent = { type: 'blocked' };
  request.onblocked(blockedEvent);

  assert.deepEqual(blockedEvents, [blockedEvent]);
  timers.expire();
  await assert.rejects(opened, error => {
    assert.equal(error.code, 'idb_open_blocked_timeout');
    return true;
  });
  assert.equal(timers.pendingCount, 0);
});

test('a late success after timeout closes its connection and cannot resolve startup', async () => {
  const request = makeOpenRequest();
  const { indexedDB } = makeIndexedDB(request);
  const timers = makeTimers();
  let deliveredConnection = null;
  const opened = openIndexedDB({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  }).then(connection => {
    deliveredConnection = connection;
    return connection;
  });

  timers.expire();
  await assert.rejects(opened, error => error.code === 'idb_open_timeout');

  let closeCount = 0;
  const lateConnection = { close() { closeCount += 1; } };
  request.result = lateConnection;
  request.onsuccess();
  await Promise.resolve();

  assert.equal(closeCount, 1);
  assert.equal(deliveredConnection, null);
});
