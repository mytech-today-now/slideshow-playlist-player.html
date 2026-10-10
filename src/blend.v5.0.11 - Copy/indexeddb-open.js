export class IndexedDBOpenError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'IndexedDBOpenError';
    this.code = code;
  }
}

function isVersionError(error) {
  return error?.name === 'VersionError' || error?.cause?.name === 'VersionError';
}

function reportDiagnostic(options, event, details = {}) {
  try {
    options?.onDiagnostic?.({ event, ...details });
  } catch (_) {}
}

export function assertIndexedDBObjectStoreKeyPaths(database, expectedKeyPaths = {}) {
  const entries = Object.entries(expectedKeyPaths);
  const names = Array.from(database?.objectStoreNames || []);
  const hasStore = name => typeof database?.objectStoreNames?.contains === 'function'
    ? database.objectStoreNames.contains(name)
    : names.includes(name);
  const missing = entries.map(([name]) => name).filter(name => !hasStore(name));
  if (missing.length) {
    throw new Error(`Missing required object stores: ${missing.join(', ')}`);
  }

  if (!entries.length) return true;
  const transaction = database.transaction(entries.map(([name]) => name), 'readonly');
  const mismatched = entries
    .filter(([name, keyPath]) => transaction.objectStore(name).keyPath !== keyPath)
    .map(([name]) => name);
  if (mismatched.length) {
    throw new Error(`Unexpected key path for object stores: ${mismatched.join(', ')}`);
  }
  return true;
}

export async function openIndexedDBCompatible(options = {}) {
  let connection;
  let usedVersionlessFallback = false;
  try {
    connection = await openIndexedDB(options);
  } catch (error) {
    if (options.version === undefined || !isVersionError(error)) throw error;

    usedVersionlessFallback = true;
    reportDiagnostic(options, 'version_error_fallback', {
      database: options.name || '',
      requestedVersion: options.version,
      error
    });
    connection = await openIndexedDB({
      ...options,
      version: undefined,
      onUpgrade(event) {
        if (Number(event?.oldVersion || 0) === 0) {
          throw new Error('The saved database changed before a compatible connection could be opened.');
        }
        options.onUpgrade?.(event);
      }
    });
  }

  try {
    const valid = await options.validateConnection?.(connection);
    if (valid === false) throw new Error('The database schema did not pass compatibility validation.');
  } catch (cause) {
    reportDiagnostic(options, 'schema_validation_failed', {
      database: options.name || '',
      requestedVersion: options.version ?? null,
      actualVersion: Number.isFinite(connection.version) ? connection.version : null,
      cause
    });
    try { connection.close(); } catch (_) {}
    throw new IndexedDBOpenError(
      'idb_schema_incompatible',
      'The local Blend database schema is not compatible with this release.',
      { cause }
    );
  }
  if (usedVersionlessFallback) {
    reportDiagnostic(options, 'versionless_fallback_opened', {
      database: options.name || '',
      requestedVersion: options.version,
      actualVersion: Number.isFinite(connection.version) ? connection.version : null
    });
  }
  return connection;
}

export function openIndexedDB({
  indexedDB = globalThis.indexedDB,
  name,
  version,
  onUpgrade,
  onBlocked,
  timeoutMs = 15_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    return Promise.reject(new IndexedDBOpenError(
      'idb_unavailable',
      'IndexedDB is not available in this browser.'
    ));
  }

  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    let wasBlocked = false;
    let timerId;

    const clearDeadline = () => {
      if (timerId !== undefined) clearTimer(timerId);
    };
    const settle = (callback, value) => {
      if (settled) return false;
      settled = true;
      clearDeadline();
      callback(value);
      return true;
    };

    try {
      request = version === undefined
        ? indexedDB.open(name)
        : indexedDB.open(name, version);
    } catch (cause) {
      settle(reject, new IndexedDBOpenError(
        'idb_open_error',
        'The local Blend database could not be opened.',
        { cause }
      ));
      return;
    }

    timerId = setTimer(() => {
      const code = wasBlocked ? 'idb_open_blocked_timeout' : 'idb_open_timeout';
      const message = wasBlocked
        ? 'The local Blend database is still blocked by another open connection.'
        : 'The local Blend database did not finish opening in time.';
      settle(reject, new IndexedDBOpenError(code, message));
    }, timeoutMs);

    request.onupgradeneeded = event => {
      try {
        onUpgrade?.(event);
      } catch (cause) {
        try {
          (event?.target?.transaction || request.transaction)?.abort();
        } catch (_) {}
        settle(reject, new IndexedDBOpenError(
          'idb_upgrade_error',
          'The local Blend database could not be upgraded safely.',
          { cause }
        ));
      }
    };

    request.onblocked = event => {
      wasBlocked = true;
      if (!settled) {
        try {
          onBlocked?.(event);
        } catch (_) {}
      }
    };

    request.onerror = () => {
      const cause = request.error;
      settle(reject, new IndexedDBOpenError(
        'idb_open_error',
        'The local Blend database could not be opened.',
        cause ? { cause } : {}
      ));
    };

    request.onsuccess = () => {
      const connection = request.result;
      if (!settle(resolve, connection)) {
        // Timed-out IDB requests cannot be canceled. Close a connection that
        // arrives later so it cannot keep a future upgrade blocked.
        try {
          connection.close();
        } catch (_) {}
      }
    };
  });
}
