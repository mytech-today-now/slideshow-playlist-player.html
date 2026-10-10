import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertIndexedDBObjectStoreKeyPaths,
  IndexedDBOpenError,
  openIndexedDB,
  openIndexedDBCompatible
} from '../../indexeddb-open.js';

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

function makeDatabase(keyPaths, version = 6) {
  const storeNames = Object.assign(Object.keys(keyPaths), {
    contains(name) { return this.includes(name); }
  });
  return {
    version,
    objectStoreNames: storeNames,
    transaction() {
      return {
        objectStore(name) { return { keyPath: keyPaths[name] }; }
      };
    },
    close() {}
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

test('a higher schema version opens without requesting a downgrade when its stores are compatible', async () => {
  const versionedRequest = makeOpenRequest();
  const latestRequest = makeOpenRequest();
  const calls = [];
  const indexedDB = {
    open(...args) {
      calls.push(args);
      return args.length === 2 ? versionedRequest : latestRequest;
    }
  };
  const timers = makeTimers();
  const keyPaths = { library: 'id', aliases: 'id', aliasMeta: 'key' };
  const database = makeDatabase(keyPaths);
  const opened = openIndexedDBCompatible({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    validateConnection: connection => assertIndexedDBObjectStoreKeyPaths(connection, keyPaths),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  versionedRequest.error = new DOMException('Requested version is older than the database.', 'VersionError');
  versionedRequest.onerror();
  await Promise.resolve();
  latestRequest.result = database;
  latestRequest.onsuccess();

  assert.equal(await opened, database);
  assert.deepEqual(calls, [['player-blend-v1', 5], ['player-blend-v1']]);
  assert.equal(timers.pendingCount, 0);
});

test('a higher schema version with incompatible stores is rejected and its connection is closed', async () => {
  const versionedRequest = makeOpenRequest();
  const latestRequest = makeOpenRequest();
  const indexedDB = {
    open(_name, version) {
      return version === undefined ? latestRequest : versionedRequest;
    }
  };
  const keyPaths = { library: 'url' };
  let closeCount = 0;
  const database = makeDatabase(keyPaths);
  database.close = () => { closeCount += 1; };
  const opened = openIndexedDBCompatible({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    validateConnection: connection => assertIndexedDBObjectStoreKeyPaths(connection, { library: 'id' })
  });

  versionedRequest.error = new DOMException('Requested version is older than the database.', 'VersionError');
  versionedRequest.onerror();
  await Promise.resolve();
  latestRequest.result = database;
  latestRequest.onsuccess();

  await assert.rejects(opened, error => {
    assert.ok(error instanceof IndexedDBOpenError);
    assert.equal(error.code, 'idb_schema_incompatible');
    return true;
  });
  assert.equal(closeCount, 1);
});
