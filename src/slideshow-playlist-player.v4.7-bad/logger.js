const LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  off: 99
};

function nowIso() {
  return new Date().toISOString();
}

function levelName(level) {
  const normalized = String(level || 'info').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVEL_ORDER, normalized) ? normalized : 'info';
}

function serializeValue(value, seen = new WeakSet()) {
  if (value == null) return value;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return value.toString();
  if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (type === 'symbol') return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || ''
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (value instanceof Blob) {
    return {
      kind: 'Blob',
      type: value.type || '',
      size: value.size || 0
    };
  }
  if (type !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map(item => serializeValue(item, seen));
  }
  const out = {};
  for (const key of Object.keys(value)) {
    try {
      out[key] = serializeValue(value[key], seen);
    } catch (_) {
      out[key] = '[Unserializable]';
    }
  }
  return out;
}

function summarizeArgs(args) {
  return args.map(arg => serializeValue(arg));
}

function formatConsolePrefix(namespace, level, ts) {
  return `[${ts}]${namespace ? ` [${namespace}]` : ''} [${level.toUpperCase()}]`;
}

function readStoredEntries(storageKey, maxEntries) {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.slice(-maxEntries);
  } catch (_) {
    return [];
  }
}

function persistEntries(storageKey, entries) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, entries }));
  } catch (_) {}
}

/**
 * Create a structured console logger with optional local persistence.
 * @param {string} namespace
 * @param {{level?: string, persist?: boolean, storageKey?: string, maxEntries?: number, mirrorConsole?: boolean}} [options]
 */
export function createLogger(namespace = 'app', options = {}) {
  const normalizedNamespace = String(namespace || '').trim();
  const storageKey = options.storageKey || `blend-debug-log-${normalizedNamespace.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'app'}`;
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(25, Math.floor(options.maxEntries)) : 400;
  let threshold = LEVEL_ORDER[levelName(options.level)] ?? LEVEL_ORDER.debug;
  let persistenceEnabled = options.persist !== false;
  const mirrorConsole = options.mirrorConsole !== false;
  let entries = readStoredEntries(storageKey, maxEntries);
  const sessionId = (()=>{ try { return sessionStorage.getItem(storageKey+':session') || (sessionStorage.setItem(storageKey+':session', (crypto?.randomUUID?.()||Math.random().toString(36).slice(2))), sessionStorage.getItem(storageKey+':session')); } catch(_) { return Math.random().toString(36).slice(2); } })();
  let context = { sessionId };
  let nextEventId = (entries.length ? entries.length : 0);

  function commit() {
    if (!persistenceEnabled) return;
    persistEntries(storageKey, entries.slice(-maxEntries));
  }

  function emit(level, args) {
    const normalizedLevel = levelName(level);
    if ((LEVEL_ORDER[normalizedLevel] ?? LEVEL_ORDER.info) < threshold) return null;
    const ts = nowIso();
    const entry = {
      id: ++nextEventId,
      ts,
      level: normalizedLevel,
      namespace: normalizedNamespace,
      context: { ...context },
      message: args.length ? String(args[0] instanceof Error ? args[0].message : args[0]) : '',
      args: summarizeArgs(args)
    };
    entries.push(entry);
    if (entries.length > maxEntries) entries = entries.slice(-maxEntries);
    commit();

    if (mirrorConsole && typeof console !== 'undefined') {
      const prefix = formatConsolePrefix(normalizedNamespace, normalizedLevel, ts);
      const method = typeof console[normalizedLevel] === 'function' ? normalizedLevel : 'log';
      try {
        console[method](prefix, ...args);
      } catch (_) {
        try { console.log(prefix, ...args); } catch (_) {}
      }
    }
    return entry;
  }

  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    log: (...args) => emit('info', args),
    clear() {
      entries = [];
      commit();
    },
    setLevel(nextLevel) {
      threshold = LEVEL_ORDER[levelName(nextLevel)] ?? threshold;
    },
    setPersistence(enabled) {
      persistenceEnabled = !!enabled;
      if (!persistenceEnabled) {
        try { localStorage.removeItem(storageKey); } catch (_) {}
      } else {
        commit();
      }
    },
    entries() { return entries.slice(); },
    setContext(next) { context = { ...context, ...(next||{}) }; },
    getContext() { return { ...context }; },
    exportJson() {
      return JSON.stringify(entries, null, 2);
    },
    exportText() {
      return entries.map(entry => `${entry.ts} [${entry.level.toUpperCase()}]${entry.namespace ? ` [${entry.namespace}]` : ''} ${entry.message}`).join('\n');
    },
    storageKey,
    namespace: normalizedNamespace
  };
}

/**
 * Attach window-level error capture to a logger.
 * @param {ReturnType<typeof createLogger>} logger
 */
export function attachGlobalErrorHandlers(logger) {
  if (typeof window === 'undefined' || !logger) return () => {};

  const onError = event => {
    logger.error(event?.error || event?.message || 'Unhandled window error', event?.error || event);
  };
  const onRejection = event => {
    logger.error(event?.reason || 'Unhandled promise rejection', event?.reason || event);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

