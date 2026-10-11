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

test('a version error from a concurrent upgrade falls back to the current database', async () => {
  const versionedRequest = makeOpenRequest();
  const latestRequest = makeOpenRequest();
  const calls = [];
  const indexedDB = {
    databases: async () => [{ name: 'player-blend-v1', version: 5 }],
    open(...args) {
      calls.push(args);
      return args.length === 2 ? versionedRequest : latestRequest;
    }
  };
  const timers = makeTimers();
  const keyPaths = { library: 'id', aliases: 'id', aliasMeta: 'key' };
  const database = makeDatabase(keyPaths);
  const diagnostics = [];
  const opened = openIndexedDBCompatible({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    validateConnection: connection => assertIndexedDBObjectStoreKeyPaths(connection, keyPaths),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  await new Promise(resolve => setImmediate(resolve));
  versionedRequest.error = new DOMException('Requested version is older than the database.', 'VersionError');
  versionedRequest.onerror();
  await new Promise(resolve => setImmediate(resolve));
  latestRequest.result = database;
  latestRequest.onsuccess();

  assert.equal(await opened, database);
  assert.deepEqual(calls, [['player-blend-v1', 5], ['player-blend-v1']]);
  assert.deepEqual(diagnostics.map(diagnostic => diagnostic.event), [
    'version_error_fallback',
    'versionless_fallback_opened'
  ]);
  assert.equal(diagnostics[0].error.name, 'IndexedDBOpenError');
  assert.equal(diagnostics[0].error.cause.name, 'VersionError');
  assert.equal(diagnostics[0].requestedVersion, 5);
  assert.equal(diagnostics[1].actualVersion, 6);
  assert.equal(timers.pendingCount, 0);
});

test('a higher schema opens with a versionless probe when database enumeration is unavailable', async () => {
  const request = makeOpenRequest();
  const calls = [];
  const indexedDB = {
    open(...args) {
      calls.push(args);
      return request;
    }
  };
  const keyPaths = { library: 'id', aliases: 'id', aliasMeta: 'key' };
  const database = makeDatabase(keyPaths, 6);
  const diagnostics = [];
  const opened = openIndexedDBCompatible({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    validateConnection: connection => assertIndexedDBObjectStoreKeyPaths(connection, keyPaths)
  });

  await new Promise(resolve => setImmediate(resolve));
  request.result = database;
  request.onsuccess();

  assert.equal(await opened, database);
  assert.deepEqual(calls, [['player-blend-v1']]);
  assert.deepEqual(diagnostics.map(diagnostic => diagnostic.event), [
    'versionless_preflight',
    'versionless_preflight_opened'
  ]);
  assert.equal(diagnostics[1].actualVersion, 6);
});

test('a fresh database is created and upgraded when database enumeration is unavailable', async () => {
  const initialRequest = makeOpenRequest();
  const upgradeRequest = makeOpenRequest();
  const calls = [];
  const indexedDB = {
    open(...args) {
      calls.push(args);
      return args.length === 1 ? initialRequest : upgradeRequest;
    }
  };
  const keyPaths = { library: 'id', aliases: 'id', aliasMeta: 'key' };
  let initialCloseCount = 0;
  const initialDatabase = makeDatabase(keyPaths, 1);
  initialDatabase.close = () => { initialCloseCount += 1; };
  const database = makeDatabase(keyPaths, 5);
  const upgrades = [];
  const opened = openIndexedDBCompatible({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    onUpgrade: event => upgrades.push(event),
    validateConnection: connection => assertIndexedDBObjectStoreKeyPaths(connection, keyPaths)
  });

  await new Promise(resolve => setImmediate(resolve));
  const initialUpgrade = { target: { result: {} } };
  initialRequest.onupgradeneeded(initialUpgrade);
  initialRequest.result = initialDatabase;
  initialRequest.onsuccess();
  await new Promise(resolve => setImmediate(resolve));
  const schemaUpgrade = { target: { result: {} } };
  upgradeRequest.onupgradeneeded(schemaUpgrade);
  upgradeRequest.result = database;
  upgradeRequest.onsuccess();

  assert.equal(await opened, database);
  assert.deepEqual(calls, [['player-blend-v1'], ['player-blend-v1', 5]]);
  assert.deepEqual(upgrades, [initialUpgrade, schemaUpgrade]);
  assert.equal(initialCloseCount, 1);
});

test('a known higher schema opens versionlessly before a lower version is requested', async () => {
  const request = makeOpenRequest();
  const calls = [];
  const indexedDB = {
    databases: async () => [{ name: 'player-blend-v1', version: 6 }],
    open(...args) {
      calls.push(args);
      return request;
    }
  };
  const timers = makeTimers();
  const database = makeDatabase({ library: 'id', aliases: 'id', aliasMeta: 'key' });
  const diagnostics = [];
  const opened = openIndexedDBCompatible({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    validateConnection: connection => assertIndexedDBObjectStoreKeyPaths(connection, {
      library: 'id',
      aliases: 'id',
      aliasMeta: 'key'
    }),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  await new Promise(resolve => setImmediate(resolve));
  request.result = database;
  request.onsuccess();

  assert.equal(await opened, database);
  assert.deepEqual(calls, [['player-blend-v1']]);
  assert.deepEqual(diagnostics.map(diagnostic => diagnostic.event), [
    'versionless_preflight',
    'versionless_preflight_opened'
  ]);
  assert.equal(diagnostics[0].existingVersion, 6);
  assert.equal(diagnostics[1].actualVersion, 6);
  assert.equal(timers.pendingCount, 0);
});

test('a versionless fallback that discovers an older schema is rejected after a version error', async () => {
  const versionedRequest = makeOpenRequest();
  const latestRequest = makeOpenRequest();
  const calls = [];
  const indexedDB = {
    databases: async () => [{ name: 'player-blend-v1', version: 5 }],
    open(_name, version) {
      calls.push(version === undefined ? [_name] : [_name, version]);
      return version === undefined ? latestRequest : versionedRequest;
    }
  };
  const keyPaths = { library: 'id', aliases: 'id', aliasMeta: 'key' };
  let closeCount = 0;
  const diagnostics = [];
  const database = makeDatabase(keyPaths, 4);
  database.close = () => { closeCount += 1; };
  const opened = openIndexedDBCompatible({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    validateConnection: connection => assertIndexedDBObjectStoreKeyPaths(connection, keyPaths)
  });

  await new Promise(resolve => setImmediate(resolve));
  versionedRequest.error = new DOMException('Requested version is older than the database.', 'VersionError');
  versionedRequest.onerror();
  await new Promise(resolve => setImmediate(resolve));
  latestRequest.result = database;
  latestRequest.onsuccess();

  await assert.rejects(opened, error => {
    assert.ok(error instanceof IndexedDBOpenError);
    assert.equal(error.code, 'idb_schema_incompatible');
    return true;
  });
  assert.equal(closeCount, 1);
  assert.equal(diagnostics.at(-1).event, 'schema_validation_failed');
  assert.match(diagnostics.at(-1).cause.message, /older schema/);
  assert.deepEqual(calls, [['player-blend-v1', 5], ['player-blend-v1']]);
});

test('a higher schema version with incompatible stores is rejected and its connection is closed', async () => {
  const versionedRequest = makeOpenRequest();
  const latestRequest = makeOpenRequest();
  const indexedDB = {
    databases: async () => [{ name: 'player-blend-v1', version: 5 }],
    open(_name, version) {
      return version === undefined ? latestRequest : versionedRequest;
    }
  };
  const keyPaths = { library: 'url' };
  let closeCount = 0;
  const diagnostics = [];
  const database = makeDatabase(keyPaths);
  database.close = () => { closeCount += 1; };
  const opened = openIndexedDBCompatible({
    indexedDB,
    name: 'player-blend-v1',
    version: 5,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    validateConnection: connection => assertIndexedDBObjectStoreKeyPaths(connection, { library: 'id' })
  });

  await new Promise(resolve => setImmediate(resolve));
  versionedRequest.error = new DOMException('Requested version is older than the database.', 'VersionError');
  versionedRequest.onerror();
  await new Promise(resolve => setImmediate(resolve));
  latestRequest.result = database;
  latestRequest.onsuccess();

  await assert.rejects(opened, error => {
    assert.ok(error instanceof IndexedDBOpenError);
    assert.equal(error.code, 'idb_schema_incompatible');
    return true;
  });
  assert.equal(closeCount, 1);
  assert.equal(diagnostics.at(-1).event, 'schema_validation_failed');
  assert.equal(diagnostics.at(-1).actualVersion, 6);
  assert.match(diagnostics.at(-1).cause.message, /key path/);
});
