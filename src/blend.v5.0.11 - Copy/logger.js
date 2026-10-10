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

function sanitizeErrorText(value) {
  return String(value ?? '')
    .replace(/\bhttps?:\/\/[^\s"'`<>]+/gi, urlText => {
      try {
        const url = new URL(urlText);
        return `${url.origin}${url.pathname}`;
      } catch (_) {
        return urlText.split(/[?#]/, 1)[0];
      }
    })
    .replace(/\b(Bearer\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/\b((?:access|refresh)[_-]?token|token|api[_-]?key|password|secret|authorization)\s*[:=]\s*([^\s,;]+)/gi, '$1=[redacted]')
    .slice(0, 8000);
}

function serializeValue(value, seen = new WeakSet(), depth = 0) {
  if (value == null) return value;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return value.toString();
  if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (type === 'symbol') return value.toString();
  if (value instanceof Error) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const summary = {
      name: sanitizeErrorText(value.name || 'Error'),
      message: sanitizeErrorText(value.message || value),
      stack: sanitizeErrorText(value.stack || '')
    };
    try {
      if (value.code != null) summary.code = sanitizeErrorText(value.code);
    } catch (_) {
      summary.code = '[Unserializable]';
    }
    try {
      if (value.cause != null) {
        summary.cause = depth < 5
          ? serializeValue(value.cause, seen, depth + 1)
          : '[MaxDepth]';
      }
    } catch (_) {
      summary.cause = '[Unserializable]';
    }
    return summary;
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
  if (depth >= 8) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map(item => serializeValue(item, seen, depth + 1));
  }
  const out = {};
  for (const key of Object.keys(value)) {
    try {
      out[key] = serializeValue(value[key], seen, depth + 1);
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

  function commit() {
    if (!persistenceEnabled) return;
    persistEntries(storageKey, entries.slice(-maxEntries));
  }

  function emit(level, args) {
    const normalizedLevel = levelName(level);
    if ((LEVEL_ORDER[normalizedLevel] ?? LEVEL_ORDER.info) < threshold) return null;
    const ts = nowIso();
    const serializedArgs = summarizeArgs(args);
    const entry = {
      ts,
      level: normalizedLevel,
      namespace: normalizedNamespace,
      message: args.length
        ? (args[0] instanceof Error ? sanitizeErrorText(args[0].message) : String(args[0]))
        : '',
      args: serializedArgs
    };
    entries.push(entry);
    if (entries.length > maxEntries) entries = entries.slice(-maxEntries);
    commit();

    if (mirrorConsole && typeof console !== 'undefined') {
      const prefix = formatConsolePrefix(normalizedNamespace, normalizedLevel, ts);
      const method = typeof console[normalizedLevel] === 'function' ? normalizedLevel : 'log';
      try {
        console[method](prefix, ...serializedArgs);
      } catch (_) {
        try { console.log(prefix, ...serializedArgs); } catch (_) {}
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
    entries() {
      return entries.slice();
    },
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
