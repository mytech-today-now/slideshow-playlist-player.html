import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERIENCE_SNAPSHOT_REVISION_KEY,
  EXPERIENCE_SNAPSHOT_STORE_NAMES,
  ExperienceSnapshotConflictError,
  mergeExperienceSnapshotRecords,
  persistExperienceSnapshotAtomically
} from '../../experience-persistence.js';

function createFakeTransaction(currentRecordsByStore = {}) {
  const databaseRecordsByStore = Object.fromEntries(EXPERIENCE_SNAPSHOT_STORE_NAMES.map(name => [
    name,
    (currentRecordsByStore[name] || []).map(record => ({ ...record }))
  ]));
  const operations = [];
  let aborted = false;
  let readsRemaining = EXPERIENCE_SNAPSHOT_STORE_NAMES.length;
  const transaction = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore(storeName) {
      return {
        getAll() {
          const request = { result: null, onsuccess: null, onerror: null };
          queueMicrotask(() => {
            if (aborted) return;
            request.result = databaseRecordsByStore[storeName] || [];
            request.onsuccess?.({ target: request });
            readsRemaining -= 1;
            if (readsRemaining === 0) {
              setTimeout(() => {
                if (aborted) return;
                for (const operation of operations) {
                  const rows = databaseRecordsByStore[operation.storeName] || [];
                  const keyFor = record => record?.id ?? record?.key;
                  if (operation.operation === 'delete') {
                    databaseRecordsByStore[operation.storeName] = rows.filter(record => keyFor(record) !== operation.key);
                  } else {
                    const index = rows.findIndex(record => keyFor(record) === keyFor(operation.record));
                    if (index < 0) rows.push(operation.record);
                    else rows[index] = operation.record;
                    databaseRecordsByStore[operation.storeName] = rows;
                  }
                }
                transaction.oncomplete?.({ target: transaction });
              }, 0);
            }
          });
          return request;
        },
        put(record) { operations.push({ storeName, operation: 'put', record }); },
        delete(key) { operations.push({ storeName, operation: 'delete', key }); }
      };
    },
    abort() {
      if (aborted) return;
      aborted = true;
      queueMicrotask(() => transaction.onabort?.({ target: transaction }));
    }
  };
  return { transaction, operations, databaseRecordsByStore, wasAborted: () => aborted };
}

function emptyRecords() {
  return Object.fromEntries(EXPERIENCE_SNAPSHOT_STORE_NAMES.map(name => [name, []]));
}

function sampleRecords() {
  return {
    library: [{ id: 'keep', name: 'kept.png' }],
    dirHandles: [{ id: 'directory', name: 'Media' }],
    experiences: [{ id: 'active', name: 'Current', updatedAt: '2026-01-01T00:00:00.000Z' }],
    playlist: [{ key: 'default', items: [{ id: 'keep' }] }],
    slideshow: [{ key: 'default', items: [{ id: 'keep' }] }],
    settings: [{ key: 'global', projectName: 'Current' }]
  };
}

test('merges disjoint library additions and reports an overlapping list edit', () => {
  const base = emptyRecords();
  base.library = [{ id: 'existing', name: 'existing.jpg' }];
  base.playlist = [{ key: 'default', items: [{ id: 'existing' }] }];

  const local = emptyRecords();
  local.library = [
    { id: 'existing', name: 'existing.jpg' },
    { id: 'local-addition', name: 'local.jpg' }
  ];
  local.playlist = [{ key: 'default', items: [{ id: 'local-edit' }] }];

  const current = emptyRecords();
  current.library = [
    { id: 'existing', name: 'existing.jpg' },
    { id: 'remote-addition', name: 'remote.jpg' }
  ];
  current.playlist = [{ key: 'default', items: [{ id: 'remote-edit' }] }];

  const result = mergeExperienceSnapshotRecords({
    baseRecordsByStore: base,
    recordsByStore: local,
    currentRecordsByStore: current,
    keepLibraryKeys: ['existing', 'local-addition']
  });

  assert.deepEqual(result.recordsByStore.library.map(record => record.id).sort(), [
    'existing', 'local-addition', 'remote-addition'
  ]);
  assert.deepEqual(result.conflicts, [{ storeName: 'playlist', key: 'default' }]);
});

test('queues writes only for changed rows and the snapshot revision', async () => {
  const baseRecordsByStore = sampleRecords();
  const localRecordsByStore = structuredClone(baseRecordsByStore);
  localRecordsByStore.settings[0].projectName = 'Updated settings';
  const fake = createFakeTransaction(baseRecordsByStore);

  const result = await persistExperienceSnapshotAtomically({
    db: {},
    recordsByStore: localRecordsByStore,
    baseRecordsByStore,
    expectedRevision: 0,
    transactionFactory: () => fake.transaction
  });

  assert.deepEqual(fake.operations, [
    { storeName: 'settings', operation: 'put', record: localRecordsByStore.settings[0] },
    {
      storeName: 'settings',
      operation: 'put',
      record: { key: EXPERIENCE_SNAPSHOT_REVISION_KEY, revision: 1 }
    }
  ]);
  assert.equal(result.revision, 1);
  assert.deepEqual(fake.databaseRecordsByStore.library, baseRecordsByStore.library);
  assert.deepEqual(fake.databaseRecordsByStore.dirHandles, baseRecordsByStore.dirHandles);
  assert.deepEqual(fake.databaseRecordsByStore.experiences, baseRecordsByStore.experiences);
  assert.deepEqual(fake.databaseRecordsByStore.playlist, baseRecordsByStore.playlist);
  assert.deepEqual(fake.databaseRecordsByStore.slideshow, baseRecordsByStore.slideshow);
  assert.deepEqual(fake.databaseRecordsByStore.settings.find(record => record.key === 'global'), localRecordsByStore.settings[0]);
});

test('does not rewrite a row when both tabs made the same edit', async () => {
  const baseRecordsByStore = emptyRecords();
  baseRecordsByStore.settings = [{ key: 'global', opacity: 0.5 }];
  const sameEdit = { key: 'global', opacity: 0.7 };
  const localRecordsByStore = emptyRecords();
  localRecordsByStore.settings = [sameEdit];
  const currentRecordsByStore = emptyRecords();
  currentRecordsByStore.settings = [sameEdit];
  const fake = createFakeTransaction(currentRecordsByStore);

  const result = await persistExperienceSnapshotAtomically({
    db: {},
    recordsByStore: localRecordsByStore,
    baseRecordsByStore,
    expectedRevision: 0,
    transactionFactory: () => fake.transaction
  });

  assert.deepEqual(fake.operations, [{
    storeName: 'settings',
    operation: 'put',
    record: { key: EXPERIENCE_SNAPSHOT_REVISION_KEY, revision: 1 }
  }]);
  assert.deepEqual(result.recordsByStore.settings, [sameEdit]);
});

test('does not rewrite unchanged catalog rows omitted from an ordinary local snapshot', async () => {
  const activeExperience = { id: 'active', name: 'Active', payload: { settings: { opacity: 0.5 } } };
  const savedExperience = { id: 'saved', name: 'Saved', payload: { settings: { opacity: 0.8 } } };
  const baseRecordsByStore = emptyRecords();
  baseRecordsByStore.experiences = [activeExperience, savedExperience];
  const localRecordsByStore = emptyRecords();
  localRecordsByStore.experiences = [activeExperience];
  const fake = createFakeTransaction(baseRecordsByStore);

  const result = await persistExperienceSnapshotAtomically({
    db: {},
    recordsByStore: localRecordsByStore,
    baseRecordsByStore,
    expectedRevision: 0,
    transactionFactory: () => fake.transaction
  });

  assert.deepEqual(fake.operations, [{
    storeName: 'settings',
    operation: 'put',
    record: { key: EXPERIENCE_SNAPSHOT_REVISION_KEY, revision: 1 }
  }]);
  assert.deepEqual(fake.databaseRecordsByStore.experiences, baseRecordsByStore.experiences);
  assert.deepEqual(result.recordsByStore.experiences, baseRecordsByStore.experiences);
});

test('persists a same-result experience row when its ignored updatedAt differs', async () => {
  const baseRecordsByStore = emptyRecords();
  const localRecord = {
    id: 'same-experience',
    name: 'Same Experience',
    updatedAt: '2026-01-02T00:00:00.000Z',
    payload: { settings: { opacity: 0.7 } }
  };
  const currentRecord = { ...localRecord, updatedAt: '2026-01-03T00:00:00.000Z' };
  const localRecordsByStore = emptyRecords();
  localRecordsByStore.experiences = [localRecord];
  const currentRecordsByStore = emptyRecords();
  currentRecordsByStore.experiences = [currentRecord];
  const fake = createFakeTransaction(currentRecordsByStore);

  const result = await persistExperienceSnapshotAtomically({
    db: {},
    recordsByStore: localRecordsByStore,
    baseRecordsByStore,
    expectedRevision: 0,
    transactionFactory: () => fake.transaction
  });

  assert.deepEqual(fake.operations, [
    { storeName: 'experiences', operation: 'put', record: localRecord },
    {
      storeName: 'settings',
      operation: 'put',
      record: { key: EXPERIENCE_SNAPSHOT_REVISION_KEY, revision: 1 }
    }
  ]);
  assert.deepEqual(fake.databaseRecordsByStore.experiences, [localRecord]);
  assert.deepEqual(result.recordsByStore.experiences, [localRecord]);
});

test('does not restore an experience that another tab deleted', () => {
  const active = { id: 'active', name: 'Current', updatedAt: '2026-01-01T00:00:00.000Z' };
  const base = emptyRecords();
  base.experiences = [active];
  const local = emptyRecords();
  local.experiences = [{ ...active, updatedAt: '2026-01-02T00:00:00.000Z' }];
  const result = mergeExperienceSnapshotRecords({
    baseRecordsByStore: base,
    recordsByStore: local,
    currentRecordsByStore: emptyRecords()
  });

  assert.deepEqual(result.recordsByStore.experiences, []);
  assert.deepEqual(result.conflicts, [{ storeName: 'experiences', key: 'active' }]);
});

test('persists all experience stores and prunes a library deletion from the hydrated base atomically', async () => {
  const fakeDb = {};
  const baseRecordsByStore = {
    ...sampleRecords(),
    library: [
      { id: 'keep', name: 'kept.png' },
      { id: 'stale', name: 'removed.png' }
    ]
  };
  const currentRecordsByStore = { ...baseRecordsByStore };
  const fake = createFakeTransaction(currentRecordsByStore);
  const calls = [];
  const queuedWrites = [];

  const result = await persistExperienceSnapshotAtomically({
    db: fakeDb,
    recordsByStore: sampleRecords(),
    baseRecordsByStore,
    expectedRevision: 3,
    keepLibraryKeys: ['keep'],
    transactionFactory(connection, storeNames, mode) {
      calls.push({ connection, storeNames, mode });
      return fake.transaction;
    },
    afterWriteQueued: context => queuedWrites.push({ storeName: context.storeName, operation: context.operation })
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].connection, fakeDb);
  assert.deepEqual(calls[0].storeNames, EXPERIENCE_SNAPSHOT_STORE_NAMES);
  assert.equal(calls[0].mode, 'readwrite');
  assert.deepEqual(result.recordsByStore.library.map(record => record.id), ['keep']);
  assert.equal(result.revision, 4);
  assert.deepEqual(fake.operations, [
    { storeName: 'library', operation: 'delete', key: 'stale' },
    {
      storeName: 'settings',
      operation: 'put',
      record: { key: EXPERIENCE_SNAPSHOT_REVISION_KEY, revision: 4 }
    }
  ]);
  assert.deepEqual(fake.databaseRecordsByStore.library.map(record => record.id), ['keep']);
  assert.equal(queuedWrites[0].storeName, 'library');
  assert.equal(fake.wasAborted(), false);
});

test('atomically merges a stale library addition with the current revision', async () => {
  const baseRecordsByStore = emptyRecords();
  const currentRecordsByStore = emptyRecords();
  currentRecordsByStore.library = [{ id: 'tab-a', name: 'tab-a.jpg' }];
  currentRecordsByStore.settings = [{ key: EXPERIENCE_SNAPSHOT_REVISION_KEY, revision: 1 }];
  const localRecordsByStore = emptyRecords();
  localRecordsByStore.library = [{ id: 'tab-b', name: 'tab-b.jpg' }];
  const fake = createFakeTransaction(currentRecordsByStore);

  const result = await persistExperienceSnapshotAtomically({
    db: {},
    recordsByStore: localRecordsByStore,
    baseRecordsByStore,
    expectedRevision: 0,
    keepLibraryKeys: ['tab-b'],
    transactionFactory: () => fake.transaction
  });

  assert.deepEqual(result.recordsByStore.library.map(record => record.id).sort(), ['tab-a', 'tab-b']);
  assert.deepEqual(result.remoteUpdatedStores, ['library']);
  assert.equal(result.revision, 2);
  assert.equal(result.revisionChanged, true);
  assert.equal(fake.operations.some(item => item.operation === 'delete'), false);
  assert.deepEqual(fake.operations, [
    { storeName: 'library', operation: 'put', record: { id: 'tab-b', name: 'tab-b.jpg' } },
    {
      storeName: 'settings',
      operation: 'put',
      record: { key: EXPERIENCE_SNAPSHOT_REVISION_KEY, revision: 2 }
    }
  ]);
});

test('aborts the transaction on a queued-write failure and keeps the snapshot atomic', async () => {
  const currentRecordsByStore = emptyRecords();
  currentRecordsByStore.library = [{ id: 'previous', name: 'previous.png' }];
  const fake = createFakeTransaction(currentRecordsByStore);
  const injectedFailure = new Error('synthetic sanitized failure');
  const localRecordsByStore = emptyRecords();
  localRecordsByStore.library = [{ id: 'replacement', name: 'replacement.png' }];

  await assert.rejects(
    persistExperienceSnapshotAtomically({
      db: {},
      recordsByStore: localRecordsByStore,
      baseRecordsByStore: currentRecordsByStore,
      keepLibraryKeys: ['replacement'],
      transactionFactory: () => fake.transaction,
      afterWriteQueued: context => {
        if (context.storeName === 'library' && context.operation === 'put') throw injectedFailure;
      }
    }),
    error => error === injectedFailure
  );

  assert.equal(fake.wasAborted(), true);
  assert.deepEqual(fake.operations, [
    { storeName: 'library', operation: 'delete', key: 'previous' },
    { storeName: 'library', operation: 'put', record: { id: 'replacement', name: 'replacement.png' } }
  ]);
  assert.deepEqual(fake.databaseRecordsByStore, currentRecordsByStore);
});

test('faults after writes are queued in every experience store leave the old snapshot intact', async () => {
  const oldRecords = sampleRecords();
  const nextRecords = sampleRecords();
  nextRecords.library = [...oldRecords.library, { id: 'imported-library', name: 'imported.png' }];
  nextRecords.dirHandles = [...oldRecords.dirHandles, { id: 'imported-directory', name: 'Imported Directory' }];
  nextRecords.experiences = [...oldRecords.experiences, { id: 'imported-experience', name: 'Imported' }];
  nextRecords.playlist = [{ key: 'default', items: [{ id: 'imported-library' }] }];
  nextRecords.slideshow = [{ key: 'default', items: [{ id: 'imported-library' }] }];
  nextRecords.settings = [{ key: 'global', projectName: 'Imported' }];

  for (const storeName of EXPERIENCE_SNAPSHOT_STORE_NAMES) {
    const fake = createFakeTransaction(oldRecords);
    const fault = Object.assign(new Error('synthetic transaction fault'), { name: 'QuotaExceededError' });
    await assert.rejects(
      persistExperienceSnapshotAtomically({
        db: {},
        recordsByStore: nextRecords,
        baseRecordsByStore: oldRecords,
        keepLibraryKeys: nextRecords.library.map(record => record.id),
        transactionFactory: () => fake.transaction,
        afterWriteQueued: context => {
          if (context.storeName === storeName && context.operation === 'put') throw fault;
        }
      }),
      error => error === fault,
      `fault in ${storeName} should abort the complete snapshot transaction`
    );
    assert.equal(fake.wasAborted(), true, `${storeName} fault should abort`);
    assert.deepEqual(fake.databaseRecordsByStore, oldRecords, `${storeName} fault should preserve all old stores`);
  }
});

test('rollback can remove the imported catalog record in the same snapshot transaction', async () => {
  const committedRecords = sampleRecords();
  committedRecords.library = [...committedRecords.library, { id: 'imported-library', name: 'imported.png' }];
  committedRecords.experiences = [...committedRecords.experiences, { id: 'imported-experience', name: 'Imported' }];
  committedRecords.playlist = [{ key: 'default', items: [{ id: 'imported-library' }] }];
  committedRecords.slideshow = [{ key: 'default', items: [{ id: 'imported-library' }] }];
  committedRecords.settings = [{ key: 'global', projectName: 'Imported' }];
  const previousRecords = sampleRecords();
  const fake = createFakeTransaction(committedRecords);

  const result = await persistExperienceSnapshotAtomically({
    db: {},
    recordsByStore: previousRecords,
    baseRecordsByStore: committedRecords,
    keepLibraryKeys: previousRecords.library.map(record => record.id),
    deleteExperienceIds: ['imported-experience'],
    transactionFactory: () => fake.transaction
  });

  assert.deepEqual(fake.databaseRecordsByStore.experiences, previousRecords.experiences);
  assert.deepEqual(result.recordsByStore.experiences, previousRecords.experiences);
  assert.deepEqual(fake.databaseRecordsByStore.library, previousRecords.library);
  assert.deepEqual(fake.databaseRecordsByStore.playlist, previousRecords.playlist);
  assert.deepEqual(fake.databaseRecordsByStore.slideshow, previousRecords.slideshow);
  assert.deepEqual(fake.databaseRecordsByStore.settings, [
    ...previousRecords.settings,
    { key: EXPERIENCE_SNAPSHOT_REVISION_KEY, revision: 1 }
  ]);
});

test('rejects conflicting list edits without converting them into a destructive write', async () => {
  const baseRecordsByStore = emptyRecords();
  baseRecordsByStore.playlist = [{ key: 'default', items: [{ id: 'base' }] }];
  const currentRecordsByStore = emptyRecords();
  currentRecordsByStore.playlist = [{ key: 'default', items: [{ id: 'newer' }] }];
  const localRecordsByStore = emptyRecords();
  localRecordsByStore.playlist = [{ key: 'default', items: [{ id: 'stale' }] }];
  const fake = createFakeTransaction(currentRecordsByStore);

  await assert.rejects(
    persistExperienceSnapshotAtomically({
      db: {},
      recordsByStore: localRecordsByStore,
      baseRecordsByStore,
      expectedRevision: 1,
      transactionFactory: () => fake.transaction
    }),
    error => error instanceof ExperienceSnapshotConflictError &&
      error.conflicts.some(conflict => conflict.storeName === 'playlist' && conflict.key === 'default')
  );

  assert.equal(fake.wasAborted(), true);
  assert.deepEqual(fake.operations, []);
  assert.deepEqual(fake.databaseRecordsByStore, currentRecordsByStore);
});
