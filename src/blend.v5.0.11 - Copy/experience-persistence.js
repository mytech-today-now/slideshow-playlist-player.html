export const EXPERIENCE_SNAPSHOT_STORE_NAMES = Object.freeze([
  'library',
  'dirHandles',
  'experiences',
  'playlist',
  'slideshow',
  'settings'
]);

// A reserved settings row carries the snapshot revision without changing the DB schema.
export const EXPERIENCE_SNAPSHOT_REVISION_KEY = '__blend_experience_snapshot_revision__';

export class ExperienceSnapshotConflictError extends Error {
  constructor(conflicts = []) {
    super('The experience snapshot conflicts with a newer saved version');
    this.name = 'ExperienceSnapshotConflictError';
    this.conflicts = conflicts;
  }
}

function recordKey(record) {
  return record?.id ?? record?.key;
}

function toComparable(value, { ignoreUpdatedAt = false, root = true } = {}) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return { __date: value.toISOString() };
  if (typeof Blob === 'function' && value instanceof Blob) {
    return {
      __blob: true,
      name: typeof value.name === 'string' ? value.name : '',
      size: value.size,
      type: value.type,
      lastModified: Number.isFinite(value.lastModified) ? value.lastModified : null
    };
  }
  if (typeof value.queryPermission === 'function' || typeof value.getFile === 'function') {
    return { __handle: true, kind: value.kind || '', name: value.name || '' };
  }
  if (Array.isArray(value)) {
    return value.map(entry => toComparable(entry, { ignoreUpdatedAt, root: false }));
  }

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (root && ignoreUpdatedAt && key === 'updatedAt') continue;
    normalized[key] = toComparable(value[key], { ignoreUpdatedAt, root: false });
  }
  return normalized;
}

function recordsEqual(left, right, { ignoreUpdatedAt = false } = {}) {
  return JSON.stringify(toComparable(left, { ignoreUpdatedAt })) ===
    JSON.stringify(toComparable(right, { ignoreUpdatedAt }));
}

function optionalRecordsEqual(leftExists, left, rightExists, right, options) {
  return leftExists === rightExists && (!leftExists || recordsEqual(left, right, options));
}

function toRecordMap(records) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const key = recordKey(record);
    if (key != null) map.set(key, record);
  }
  return map;
}

function mergeStore({
  storeName,
  baseRecords,
  localRecords,
  currentRecords,
  deleteMissingLocal = false,
  protectRemoteDeletion = false,
  equalityOptions = {},
  conflicts,
  remoteUpdatedStores
}) {
  const base = toRecordMap(baseRecords);
  const local = toRecordMap(localRecords);
  const current = toRecordMap(currentRecords);
  const keys = new Set([...base.keys(), ...current.keys(), ...local.keys()]);
  const merged = [];

  for (const key of keys) {
    const baseExists = base.has(key);
    const currentExists = current.has(key);
    const localHasRecord = local.has(key);
    const localExists = localHasRecord || (!deleteMissingLocal && baseExists);
    const baseRecord = base.get(key);
    const localRecord = localHasRecord ? local.get(key) : (localExists ? baseRecord : undefined);
    const currentRecord = current.get(key);
    const localChanged = !optionalRecordsEqual(baseExists, baseRecord, localExists, localRecord, equalityOptions);
    const currentChanged = !optionalRecordsEqual(baseExists, baseRecord, currentExists, currentRecord, equalityOptions);

    if (protectRemoteDeletion && !localChanged && baseExists && localExists && !currentExists && currentChanged) {
      conflicts.push({ storeName, key });
    }

    let useLocal = false;
    if (localChanged && currentChanged) {
      const sameResult = optionalRecordsEqual(localExists, localRecord, currentExists, currentRecord, equalityOptions);
      if (!sameResult) conflicts.push({ storeName, key });
      useLocal = sameResult;
    } else {
      useLocal = localChanged;
      if (!localChanged && currentChanged) remoteUpdatedStores.add(storeName);
    }

    const resultExists = useLocal ? localExists : currentExists;
    const resultRecord = useLocal ? localRecord : currentRecord;
    if (resultExists) merged.push(resultRecord);
  }

  return merged;
}

export function mergeExperienceSnapshotRecords({
  baseRecordsByStore = {},
  recordsByStore = {},
  currentRecordsByStore = {},
  keepLibraryKeys
} = {}) {
  const conflicts = [];
  const remoteUpdatedStores = new Set();
  const keepKeys = keepLibraryKeys == null
    ? null
    : new Set(keepLibraryKeys);
  const localLibrary = Array.isArray(recordsByStore.library) ? recordsByStore.library : [];
  const mergedRecordsByStore = {};

  for (const storeName of EXPERIENCE_SNAPSHOT_STORE_NAMES) {
    const localRecords = storeName === 'library' && keepKeys
      ? localLibrary.filter(record => keepKeys.has(recordKey(record)))
      : recordsByStore[storeName];
    mergedRecordsByStore[storeName] = mergeStore({
      storeName,
      baseRecords: baseRecordsByStore[storeName],
      localRecords,
      currentRecords: currentRecordsByStore[storeName],
      deleteMissingLocal: storeName === 'library',
      protectRemoteDeletion: storeName === 'experiences',
      equalityOptions: storeName === 'experiences' ? { ignoreUpdatedAt: true } : {},
      conflicts,
      remoteUpdatedStores
    });
  }

  return {
    recordsByStore: mergedRecordsByStore,
    conflicts,
    remoteUpdatedStores: Array.from(remoteUpdatedStores)
  };
}

function readSnapshot({ db, mode, transactionFactory }) {
  if (!db) return Promise.reject(new TypeError('An IndexedDB connection is required'));

  let transaction;
  try {
    transaction = transactionFactory(db, EXPERIENCE_SNAPSHOT_STORE_NAMES, mode);
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const recordsByStore = {};
    let settled = false;

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    transaction.oncomplete = () => {
      const settings = recordsByStore.settings || [];
      const revisionRecord = settings.find(record => record?.key === EXPERIENCE_SNAPSHOT_REVISION_KEY);
      recordsByStore.settings = settings.filter(record => record?.key !== EXPERIENCE_SNAPSHOT_REVISION_KEY);
      settle(resolve, {
        revision: Number.isSafeInteger(revisionRecord?.revision) && revisionRecord.revision >= 0
          ? revisionRecord.revision
          : 0,
        recordsByStore
      });
    };
    transaction.onerror = () => settle(reject, transaction.error || new Error('Could not read the saved experience snapshot'));
    transaction.onabort = () => settle(reject, transaction.error || new Error('The saved experience snapshot read was aborted'));

    try {
      for (const storeName of EXPERIENCE_SNAPSHOT_STORE_NAMES) {
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => {
          recordsByStore[storeName] = request.result || [];
        };
        request.onerror = () => settle(reject, request.error || new Error('Could not read the saved experience snapshot'));
      }
    } catch (error) {
      settle(reject, error);
      try { transaction.abort(); } catch (_) {}
    }
  });
}

export function readExperienceSnapshotAtomically({
  db,
  transactionFactory = (connection, storeNames, mode) => connection.transaction(storeNames, mode)
} = {}) {
  return readSnapshot({ db, mode: 'readonly', transactionFactory });
}

export function persistExperienceSnapshotAtomically({
  db,
  recordsByStore,
  baseRecordsByStore = {},
  expectedRevision = 0,
  keepLibraryKeys,
  deleteExperienceIds = [],
  transactionFactory = (connection, storeNames, mode) => connection.transaction(storeNames, mode),
  afterWriteQueued
} = {}) {
  if (!db) return Promise.reject(new TypeError('An IndexedDB connection is required'));
  const baseRevision = Number.isSafeInteger(expectedRevision) && expectedRevision >= 0
    ? expectedRevision
    : 0;

  let transaction;
  try {
    // The common store scope serializes app saves; reads and merges stay inside
    // the same transaction as the writes and revision update.
    transaction = transactionFactory(db, EXPERIENCE_SNAPSHOT_STORE_NAMES, 'readwrite');
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let failure = null;
    let settled = false;
    let writeIndex = 0;
    let pendingReads = EXPERIENCE_SNAPSHOT_STORE_NAMES.length;
    const currentRecordsByStore = {};

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    const failTransaction = error => {
      if (!failure) failure = error || new Error('IndexedDB snapshot transaction failed');
      try {
        transaction.abort();
      } catch (_) {
        settle(reject, failure);
      }
    };

    const queueWrite = (storeName, operation, value) => {
      const store = transaction.objectStore(storeName);
      if (operation === 'put') store.put(value);
      else store.delete(value);

      const context = {
        storeName,
        operation,
        index: writeIndex++,
        transaction
      };
      if (typeof afterWriteQueued === 'function') afterWriteQueued(context);
    };

    const commitMergedSnapshot = () => {
      try {
        const settings = currentRecordsByStore.settings || [];
        const revisionRecord = settings.find(record => record?.key === EXPERIENCE_SNAPSHOT_REVISION_KEY);
        const currentRevision = Number.isSafeInteger(revisionRecord?.revision) && revisionRecord.revision >= 0
          ? revisionRecord.revision
          : 0;
        const revisionChanged = currentRevision !== baseRevision;
        currentRecordsByStore.settings = settings.filter(record => record?.key !== EXPERIENCE_SNAPSHOT_REVISION_KEY);

        const merged = mergeExperienceSnapshotRecords({
          baseRecordsByStore,
          recordsByStore,
          currentRecordsByStore,
          keepLibraryKeys
        });
        if (merged.conflicts.length) {
          failTransaction(new ExperienceSnapshotConflictError(merged.conflicts));
          return;
        }

        const currentLibraryKeys = new Set((currentRecordsByStore.library || []).map(recordKey));
        const mergedLibraryKeys = new Set((merged.recordsByStore.library || []).map(recordKey));
        for (const key of currentLibraryKeys) {
          if (!mergedLibraryKeys.has(key)) queueWrite('library', 'delete', key);
        }

        for (const storeName of EXPERIENCE_SNAPSHOT_STORE_NAMES) {
          for (const record of merged.recordsByStore[storeName] || []) {
            queueWrite(storeName, 'put', record);
          }
        }

        const deletedExperienceIds = new Set((deleteExperienceIds || []).map(id => String(id)));
        if (deletedExperienceIds.size) {
          merged.recordsByStore.experiences = (merged.recordsByStore.experiences || [])
            .filter(record => !deletedExperienceIds.has(String(recordKey(record))));
          for (const id of deletedExperienceIds) queueWrite('experiences', 'delete', id);
        }

        const nextRevision = Math.max(currentRevision, baseRevision) + 1;
        queueWrite('settings', 'put', {
          key: EXPERIENCE_SNAPSHOT_REVISION_KEY,
          revision: nextRevision
        });
        transaction.oncomplete = () => settle(resolve, {
          revision: nextRevision,
          previousRevision: currentRevision,
          revisionChanged,
          recordsByStore: merged.recordsByStore,
          remoteUpdatedStores: merged.remoteUpdatedStores
        });
      } catch (error) {
        failTransaction(error);
      }
    };

    transaction.onerror = () => {
      if (!failure) failure = transaction.error || new Error('IndexedDB snapshot transaction failed');
    };
    transaction.onabort = () => settle(
      reject,
      failure || transaction.error || new Error('IndexedDB snapshot transaction was aborted')
    );

    try {
      for (const storeName of EXPERIENCE_SNAPSHOT_STORE_NAMES) {
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => {
          currentRecordsByStore[storeName] = request.result || [];
          pendingReads -= 1;
          if (pendingReads === 0) commitMergedSnapshot();
        };
        request.onerror = () => failTransaction(request.error || new Error('Could not read the saved experience snapshot'));
      }
    } catch (error) {
      failTransaction(error);
    }
  });
}
