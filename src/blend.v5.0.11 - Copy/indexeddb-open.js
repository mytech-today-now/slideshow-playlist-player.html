export class IndexedDBOpenError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'IndexedDBOpenError';
    this.code = code;
  }
}

export const DB_STORE_KEY_PATHS = Object.freeze({
  library: 'id',
  playlist: 'key',
  slideshow: 'key',
  settings: 'key',
  experiences: 'id',
  thumbnails: 'key',
  dirHandles: 'id',
  aliases: 'id',
  aliasMeta: 'key'
});

export function ensureBlendDatabaseStores(database) {
  if (!database?.objectStoreNames || typeof database.createObjectStore !== 'function') {
    throw new Error('The database cannot create the required Blend object stores.');
  }

  const existingStores = new Set(Array.from(database.objectStoreNames));
  for (const [name, keyPath] of Object.entries(DB_STORE_KEY_PATHS)) {
    if (!existingStores.has(name)) {
      database.createObjectStore(name, { keyPath });
      existingStores.add(name);
    }
  }

  return true;
}

const VERSIONLESS_UPGRADE_REQUIRED = 'idb_versionless_upgrade_required';

function versionlessUpgradeRequiredError(message) {
  const error = new Error(message);
  error.code = VERSIONLESS_UPGRADE_REQUIRED;
  return error;
}

function isVersionlessUpgradeRequired(error) {
  return error?.code === 'idb_upgrade_error'
    && error?.cause?.code === VERSIONLESS_UPGRADE_REQUIRED;
}

function isVersionError(error) {
  return error?.name === 'VersionError' || error?.cause?.name === 'VersionError';
}

function reportDiagnostic(options, event, details = {}) {
  try {
    options?.onDiagnostic?.({ event, ...details });
  } catch (_) {}
}

async function findExistingDatabaseVersion(indexedDB, name) {
  if (typeof indexedDB?.databases !== 'function') return { available: false, version: null };
  try {
    const databases = await indexedDB.databases();
    const existing = Array.from(databases || []).find(database => database?.name === name);
    const version = Number(existing?.version);
    return {
      available: true,
      version: Number.isFinite(version) && version > 0 ? version : null
    };
  } catch (_) {
    return { available: false, version: null };
  }
}

function openCurrentDatabaseWithoutVersion(options) {
  return openIndexedDB({
    ...options,
    version: undefined,
    onUpgrade() {
      throw versionlessUpgradeRequiredError(
        'A versionless preflight cannot create or migrate the database.'
      );
    }
  });
}

function openExistingDatabaseWithoutVersion(options) {
  return openIndexedDB({
    ...options,
    version: undefined,
    onUpgrade(event) {
      const message = Number(event?.oldVersion || 0) === 0
        ? 'The saved database changed before a compatible connection could be opened.'
        : 'A versionless compatibility open cannot run database migrations.';
      throw versionlessUpgradeRequiredError(message);
    }
  });
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
  let usedVersionlessPreflight = false;
  const indexedDB = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  if (!Number.isSafeInteger(options.version) || options.version < 1) {
    throw new IndexedDBOpenError(
      'idb_version_invalid',
      'A valid configured database version is required.'
    );
  }
  const requestedVersion = options.version;
  let inventory = { available: false, version: null };
  if (options.version !== undefined && typeof indexedDB?.databases === 'function') {
    inventory = await findExistingDatabaseVersion(indexedDB, options.name);
  }

  const shouldProbeCurrentVersion = options.version !== undefined
    && Number.isFinite(requestedVersion)
    && (!inventory.available || (Number.isFinite(inventory.version) && inventory.version > requestedVersion));

  if (shouldProbeCurrentVersion) {
    reportDiagnostic(options, 'versionless_preflight', {
      database: options.name || '',
      requestedVersion: options.version,
      existingVersion: inventory.version
    });
    let currentConnection;
    try {
      currentConnection = await openCurrentDatabaseWithoutVersion(options);
    } catch (error) {
      if (!isVersionlessUpgradeRequired(error)) throw error;
      if (inventory.available && Number.isFinite(inventory.version) && inventory.version > requestedVersion) {
        throw error;
      }
      reportDiagnostic(options, 'versionless_preflight_upgrade_required', {
        database: options.name || '',
        requestedVersion: options.version,
        actualVersion: null
      });
    }
    if (currentConnection) {
      if (Number.isFinite(currentConnection.version) && currentConnection.version >= requestedVersion) {
        connection = currentConnection;
        usedVersionlessFallback = true;
        usedVersionlessPreflight = true;
      } else {
        try { currentConnection.close(); } catch (_) {}
        reportDiagnostic(options, 'versionless_preflight_upgrade_required', {
          database: options.name || '',
          requestedVersion: options.version,
          actualVersion: Number.isFinite(currentConnection.version) ? currentConnection.version : null
        });
      }
    }
  }

  try {
    if (!connection) connection = await openIndexedDB(options);
  } catch (error) {
    if (options.version === undefined || !isVersionError(error)) throw error;

    usedVersionlessFallback = true;
    reportDiagnostic(options, 'version_error_fallback', {
      database: options.name || '',
      requestedVersion: options.version,
      error
    });
    connection = await openExistingDatabaseWithoutVersion(options);
  }

  try {
    const requiredVersion = Number(options.version);
    if (
      usedVersionlessFallback &&
      Number.isFinite(requiredVersion) &&
      Number.isFinite(connection.version) &&
      connection.version < requiredVersion
    ) {
      throw new Error('The saved database changed to an older schema while a compatible connection was opening.');
    }
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
    reportDiagnostic(options, usedVersionlessPreflight ? 'versionless_preflight_opened' : 'versionless_fallback_opened', {
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
