(function attachBlendAliasRouter(root) {
  'use strict';

  const DEFAULT_SCHEMA = 'blend.aliases.v1';
  const DEFAULT_BASE_URL = 'https://blend.local/';
  const MAX_ALIAS_DEPTH = 5;
  const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
  const ENCODED_TRAVERSAL_PATTERN = /(?:^|%2f|%5c)\.\.(?:%2f|%5c|$)/i;

  class AliasValidationError extends Error {
    constructor(message, code = 'alias_invalid') {
      super(message);
      this.name = 'AliasValidationError';
      this.code = code;
    }
  }

  function asString(value) {
    return value == null ? '' : String(value);
  }

  function makeBaseUrl(baseUrl = DEFAULT_BASE_URL) {
    try {
      return new URL(baseUrl || DEFAULT_BASE_URL);
    } catch (_) {
      return new URL(DEFAULT_BASE_URL);
    }
  }

  function hasTraversal(path) {
    const raw = asString(path);
    if (ENCODED_TRAVERSAL_PATTERN.test(raw)) return true;
    try {
      const decoded = decodeURIComponent(raw.replace(/\+/g, '%20'));
      return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(decoded);
    } catch (_) {
      return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(raw);
    }
  }

  function normalizePath(value, options = {}) {
    const base = makeBaseUrl(options.baseUrl);
    const raw = asString(value).trim();
    if (!raw) throw new AliasValidationError('Alias path is required.', 'alias_path_required');
    if (CONTROL_CHAR_PATTERN.test(raw)) throw new AliasValidationError('Alias path contains control characters.', 'alias_path_unsafe');
    if (hasTraversal(raw)) throw new AliasValidationError('Alias path cannot contain traversal segments.', 'alias_path_traversal');

    let url;
    try {
      url = new URL(raw, base);
    } catch (_) {
      throw new AliasValidationError('Alias path is not a valid URL path.', 'alias_path_invalid');
    }

    if (url.origin !== base.origin) {
      throw new AliasValidationError('Alias path must stay on the current origin.', 'alias_path_cross_origin');
    }

    const normalized = url.pathname.replace(/\/{2,}/g, '/');
    if (hasTraversal(normalized)) throw new AliasValidationError('Alias path cannot contain traversal segments.', 'alias_path_traversal');
    if (options.allowRoot === false && normalized === '/') {
      throw new AliasValidationError('Alias path cannot be the root path.', 'alias_path_root');
    }
    return normalized || '/';
  }

  function normalizeTarget(value, options = {}) {
    const base = makeBaseUrl(options.baseUrl);
    const raw = asString(value).trim();
    if (!raw) throw new AliasValidationError('Alias target is required.', 'alias_target_required');
    if (CONTROL_CHAR_PATTERN.test(raw) || hasTraversal(raw)) {
      throw new AliasValidationError('Alias target is unsafe.', 'alias_target_unsafe');
    }

    let url;
    try {
      url = new URL(raw, base);
    } catch (_) {
      throw new AliasValidationError('Alias target is not a valid URL.', 'alias_target_invalid');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AliasValidationError('Alias target must use http or https.', 'alias_target_scheme');
    }

    const allowedOrigins = new Set([base.origin, ...(options.allowedOrigins || [])]);
    if (!allowedOrigins.has(url.origin)) {
      throw new AliasValidationError('Alias target must stay on an allowed origin.', 'alias_target_cross_origin');
    }

    url.pathname = url.pathname.replace(/\/{2,}/g, '/');
    if (hasTraversal(url.pathname)) {
      throw new AliasValidationError('Alias target cannot contain traversal segments.', 'alias_target_traversal');
    }
    url.username = '';
    url.password = '';
    return url;
  }

  function normalizeMatch(value) {
    const match = asString(value || 'exact').trim().toLowerCase();
    if (match === 'exact' || match === 'prefix') return match;
    throw new AliasValidationError(`Unsupported alias match type: ${match}`, 'alias_match_unsupported');
  }

  function normalizeType(value) {
    const type = asString(value || 'navigation').trim().toLowerCase();
    if (type === 'navigation' || type === 'resource') return type;
    throw new AliasValidationError(`Unsupported alias type: ${type}`, 'alias_type_unsupported');
  }

  function normalizeExpiresAt(value) {
    if (value == null || value === '') return null;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      throw new AliasValidationError('Alias expiresAt must be a valid date.', 'alias_expiry_invalid');
    }
    return new Date(timestamp).toISOString();
  }

  function normalizeAliasEntry(entry, options = {}) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new AliasValidationError('Alias entry must be an object.', 'alias_entry_invalid');
    }

    const from = normalizePath(entry.from, { baseUrl: options.baseUrl, allowRoot: false });
    const toUrl = normalizeTarget(entry.to, options);
    const id = asString(entry.id || `${from}->${toUrl.pathname}`).trim();
    if (!id) throw new AliasValidationError('Alias id is required.', 'alias_id_required');
    if (CONTROL_CHAR_PATTERN.test(id)) throw new AliasValidationError('Alias id is unsafe.', 'alias_id_unsafe');

    return Object.freeze({
      id,
      from,
      to: toUrl.pathname + toUrl.search + toUrl.hash,
      type: normalizeType(entry.type),
      match: normalizeMatch(entry.match),
      status: Number.isInteger(entry.status) ? entry.status : 200,
      preserveQuery: entry.preserveQuery !== false,
      preserveHash: entry.preserveHash !== false,
      mergeQuery: entry.mergeQuery === true,
      enabled: entry.enabled !== false,
      priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 0,
      expiresAt: normalizeExpiresAt(entry.expiresAt)
    });
  }

  function specificityFor(entry) {
    return entry.from.length + (entry.match === 'exact' ? 10000 : 0);
  }

  function sortAliases(aliases) {
    return [...(aliases || [])].sort((a, b) => {
      const priorityDelta = (b.priority || 0) - (a.priority || 0);
      if (priorityDelta) return priorityDelta;
      const specificityDelta = specificityFor(b) - specificityFor(a);
      if (specificityDelta) return specificityDelta;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function isExpired(entry, now = Date.now()) {
    if (!entry.expiresAt) return false;
    const timestamp = Date.parse(entry.expiresAt);
    return Number.isFinite(timestamp) && timestamp <= now;
  }

  function aliasMatches(entry, path) {
    if (entry.match === 'exact') return path === entry.from;
    if (entry.match === 'prefix') {
      if (path === entry.from) return true;
      const prefix = entry.from.endsWith('/') ? entry.from : `${entry.from}/`;
      return path.startsWith(prefix);
    }
    return false;
  }

  function applyAliasTarget(currentUrl, entry, options = {}) {
    const base = makeBaseUrl(options.baseUrl);
    const target = normalizeTarget(entry.to, options);
    const resolved = new URL(target.href);

    if (entry.match === 'prefix' && currentUrl.pathname !== entry.from) {
      const suffix = currentUrl.pathname.slice(entry.from.length);
      const basePath = resolved.pathname.endsWith('/') ? resolved.pathname.slice(0, -1) : resolved.pathname;
      resolved.pathname = `${basePath}${suffix}`.replace(/\/{2,}/g, '/');
    }

    if (entry.mergeQuery && currentUrl.search) {
      const merged = new URLSearchParams(currentUrl.search);
      for (const [key, value] of resolved.searchParams) merged.set(key, value);
      resolved.search = merged.toString();
    } else if (entry.preserveQuery && currentUrl.search && !resolved.search) {
      resolved.search = currentUrl.search;
    }

    if (entry.preserveHash && currentUrl.hash && !resolved.hash) {
      resolved.hash = currentUrl.hash;
    }

    if (resolved.origin !== base.origin) {
      throw new AliasValidationError('Resolved alias target left the current origin.', 'alias_resolved_cross_origin');
    }
    return resolved;
  }

  function resolveAlias(input, aliases, options = {}) {
    const base = makeBaseUrl(options.baseUrl);
    let currentUrl;
    try {
      currentUrl = new URL(input instanceof URL ? input.href : asString(input), base);
    } catch (_) {
      return { matched: false, error: 'alias_request_invalid' };
    }
    if (currentUrl.origin !== base.origin) return { matched: false, url: currentUrl };

    const sorted = sortAliases(aliases);
    const visited = new Set([currentUrl.pathname + currentUrl.search + currentUrl.hash]);
    const hits = [];
    const now = Number.isFinite(options.now) ? options.now : Date.now();

    for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
      const match = sorted.find(entry => (
        entry &&
        entry.enabled !== false &&
        !isExpired(entry, now) &&
        aliasMatches(entry, currentUrl.pathname)
      ));
      if (!match) {
        return {
          matched: hits.length > 0,
          url: currentUrl,
          path: currentUrl.pathname,
          search: currentUrl.search,
          hash: currentUrl.hash,
          aliases: hits
        };
      }

      let nextUrl;
      try {
        nextUrl = applyAliasTarget(currentUrl, match, options);
      } catch (error) {
        return {
          matched: hits.length > 0,
          url: currentUrl,
          aliases: hits,
          error: error?.code || 'alias_target_invalid'
        };
      }

      const nextKey = nextUrl.pathname + nextUrl.search + nextUrl.hash;
      hits.push(match);
      if (visited.has(nextKey)) {
        return {
          matched: false,
          url: currentUrl,
          aliases: hits,
          error: 'alias_loop'
        };
      }
      visited.add(nextKey);
      currentUrl = nextUrl;
    }

    return {
      matched: false,
      url: currentUrl,
      aliases: hits,
      error: 'alias_depth_exceeded'
    };
  }

  function normalizeAliasManifest(input, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new AliasValidationError('Alias manifest must be an object.', 'alias_manifest_invalid');
    }
    const schema = input.schema || DEFAULT_SCHEMA;
    if (schema !== DEFAULT_SCHEMA) {
      throw new AliasValidationError(`Unsupported alias schema: ${schema}`, 'alias_schema_unsupported');
    }
    const version = Number(input.version);
    if (!Number.isInteger(version) || version < 0) {
      throw new AliasValidationError('Alias manifest version must be a non-negative integer.', 'alias_version_invalid');
    }
    if (!Array.isArray(input.aliases)) {
      throw new AliasValidationError('Alias manifest aliases must be an array.', 'alias_entries_invalid');
    }
    const maxAliases = Number.isInteger(options.maxAliases) ? options.maxAliases : 500;
    if (input.aliases.length > maxAliases) {
      throw new AliasValidationError('Alias manifest contains too many aliases.', 'alias_manifest_too_large');
    }

    const aliases = input.aliases.map(entry => normalizeAliasEntry(entry, options));
    const ids = new Set();
    for (const entry of aliases) {
      if (ids.has(entry.id)) {
        throw new AliasValidationError(`Duplicate alias id: ${entry.id}`, 'alias_id_duplicate');
      }
      ids.add(entry.id);
    }

    for (const entry of aliases) {
      const loopCheck = resolveAlias(entry.from, aliases, options);
      if (loopCheck.error === 'alias_loop' || loopCheck.error === 'alias_depth_exceeded') {
        throw new AliasValidationError(`Alias creates a loop: ${entry.id}`, loopCheck.error);
      }
    }

    const generatedAt = input.generatedAt && Number.isFinite(Date.parse(input.generatedAt))
      ? new Date(Date.parse(input.generatedAt)).toISOString()
      : new Date(0).toISOString();

    return Object.freeze({
      schema: DEFAULT_SCHEMA,
      version,
      generatedAt,
      aliases: Object.freeze(aliases)
    });
  }

  root.BlendAliasRouter = Object.freeze({
    AliasValidationError,
    DEFAULT_SCHEMA,
    MAX_ALIAS_DEPTH,
    normalizePath,
    normalizeTarget,
    normalizeAliasEntry,
    normalizeAliasManifest,
    sortAliases,
    resolveAlias,
    isExpired,
    aliasMatches
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
