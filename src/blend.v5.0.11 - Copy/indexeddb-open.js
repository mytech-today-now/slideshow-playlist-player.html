export class IndexedDBOpenError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'IndexedDBOpenError';
    this.code = code;
  }
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
      request = indexedDB.open(name, version);
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
