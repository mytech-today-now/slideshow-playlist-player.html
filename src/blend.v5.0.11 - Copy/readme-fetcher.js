// readme-fetcher.js
// Loads this app copy's README by default and makes the mutable online guide
// available only on request. Browser globals are injectable for Node tests.

export const GITHUB_README_URL =
  'https://raw.githubusercontent.com/mytech-today-now/slideshow-playlist-player.html/refs/heads/main/README.md';

export const LOCAL_README_URL = './README.md';

export const README_CACHE_KEY = 'blend-readme-online-cache-v2';
export const LEGACY_README_CACHE_KEY = 'blend-readme-cache-v1';

// Re-fetch online documentation after 1 hour. Expired entries are not shown
// as current documentation when the network is unavailable.
export const README_CACHE_TTL_MS = 60 * 60 * 1000;

// Abort a hung network request after 10 seconds.
export const FETCH_TIMEOUT_MS = 10_000;

function clockNow(clock) {
  return typeof clock?.now === 'function' ? clock.now() : Date.now();
}

/**
 * Read only the explicit runtime-version marker in the README's version
 * section; changelog entries are not a reliable substitute for this marker.
 * @param {string} markdown
 * @returns {string|null}
 */
export function extractReadmeVersion(markdown) {
  const match = String(markdown == null ? '' : markdown).match(
    /Runtime app version string in code\/UI:\*\*\s*`v?([\d]+\.[\d]+\.[\d]+(?:[-+][\w.-]+)?)`/i
  );
  return match ? match[1] : null;
}

/**
 * Build the source/version metadata displayed with a README document.
 * @param {{ markdown: string, source?: string, appVersion?: string, fetchedAt?: number|null, fromCache?: boolean, onlineUnavailable?: boolean }} input
 */
export function createReadmeViewModel({
  markdown,
  source = 'local',
  appVersion = '',
  fetchedAt = null,
  fromCache = false,
  onlineUnavailable = false
} = {}) {
  const normalizedSource = source === 'online' ? 'online' : 'local';
  const runningVersion = String(appVersion || '');
  const documentVersion = extractReadmeVersion(markdown);
  const versionStatus = !documentVersion || !runningVersion
    ? 'unknown'
    : documentVersion === runningVersion ? 'match' : 'mismatch';

  return {
    markdown: String(markdown == null ? '' : markdown),
    source: normalizedSource,
    appVersion: runningVersion,
    documentVersion,
    versionMatchesApp: versionStatus === 'match',
    versionStatus,
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null,
    fromCache: Boolean(fromCache),
    onlineUnavailable: Boolean(onlineUnavailable)
  };
}

/**
 * Return cached README markdown if present and still within TTL, else null.
 * @param {Pick<Storage,'getItem'>} [storage]
 * @returns {string|null}
 */
export function readReadmeCache(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const raw = storage?.getItem(README_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (typeof entry?.markdown !== 'string' || typeof entry?.fetchedAt !== 'number') return null;
    if (entry.source !== 'online') return null;
    if (!Number.isFinite(now) || entry.fetchedAt > now || now - entry.fetchedAt >= README_CACHE_TTL_MS) return null;
    const documentVersion = extractReadmeVersion(entry.markdown);
    if ((entry.version || null) !== documentVersion) return null;
    return {
      markdown: entry.markdown,
      fetchedAt: entry.fetchedAt,
      version: documentVersion
    };
  } catch (_) {
    return null;
  }
}

/**
 * Persist markdown text and a timestamp so future calls can serve from cache.
 * @param {string} markdown
 * @param {Pick<Storage,'setItem'>} [storage]
 */
export function writeReadmeCache(markdown, storage = globalThis.localStorage, fetchedAt = Date.now()) {
  try {
    storage?.setItem(README_CACHE_KEY, JSON.stringify({
      source: 'online',
      markdown: String(markdown == null ? '' : markdown),
      version: extractReadmeVersion(markdown),
      fetchedAt
    }));
  } catch (_) {}
}

/**
 * Remove the cached README (forces a fresh network fetch on next call).
 * @param {Pick<Storage,'removeItem'>} [storage]
 */
export function clearReadmeCache(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(README_CACHE_KEY);
    storage?.removeItem(LEGACY_README_CACHE_KEY);
  } catch (_) {}
}

/**
 * Fetch text from `url`, aborting after `timeoutMs` milliseconds.
 * Throws on non-2xx status or network failure.
 * @param {string} url
 * @param {number} [timeoutMs]
 * @param {typeof fetch} [fetcher]
 * @param {{ setTimeout?: Function, clearTimeout?: Function }} [clock]
 * @returns {Promise<string>}
 */
export async function fetchWithTimeout(
  url,
  timeoutMs = FETCH_TIMEOUT_MS,
  fetcher = globalThis.fetch,
  clock = globalThis
) {
  const controller = new AbortController();
  const schedule = typeof clock?.setTimeout === 'function'
    ? clock.setTimeout.bind(clock)
    : setTimeout;
  const cancel = typeof clock?.clearTimeout === 'function'
    ? clock.clearTimeout.bind(clock)
    : clearTimeout;
  const timer = schedule(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
  } finally {
    cancel(timer);
  }
}

/**
 * Return a source-aware README view model. Local documentation is the
 * default. Online documentation is only fetched when explicitly selected;
 * the installed README is reported first while a cold online request runs.
 *
 * Passing `forceRefresh: true` bypasses the cache so a retry always hits
 * the network (used by the error-state retry button).
 *
 * @param {{ source?: 'local'|'online', forceRefresh?: boolean, fetcher?: typeof fetch, storage?: Storage, appVersion?: string, clock?: { now?: Function, setTimeout?: Function, clearTimeout?: Function }, onLocal?: (viewModel: ReturnType<typeof createReadmeViewModel>) => void }} [opts]
 * @returns {Promise<ReturnType<typeof createReadmeViewModel>>}
 */
export async function fetchReadme({
  source = 'local',
  forceRefresh = false,
  fetcher,
  storage,
  appVersion = '',
  clock = globalThis,
  onLocal
} = {}) {
  if (source !== 'online') {
    const markdown = await fetchWithTimeout(LOCAL_README_URL, FETCH_TIMEOUT_MS, fetcher, clock);
    return createReadmeViewModel({ markdown, source: 'local', appVersion });
  }

  if (!forceRefresh) {
    const cached = readReadmeCache(storage, clockNow(clock));
    if (cached !== null) {
      return createReadmeViewModel({
        markdown: cached.markdown,
        source: 'online',
        appVersion,
        fetchedAt: cached.fetchedAt,
        fromCache: true
      });
    }
  }

  let localModel = null;
  try {
    const markdown = await fetchWithTimeout(LOCAL_README_URL, FETCH_TIMEOUT_MS, fetcher, clock);
    localModel = createReadmeViewModel({ markdown, source: 'local', appVersion });
    onLocal?.(localModel);
  } catch (_) {
    // Online documentation can still succeed when the installed guide is absent.
  }

  let onlineError;
  try {
    const markdown = await fetchWithTimeout(GITHUB_README_URL, FETCH_TIMEOUT_MS, fetcher, clock);
    const fetchedAt = clockNow(clock);
    writeReadmeCache(markdown, storage, fetchedAt);
    const cached = readReadmeCache(storage, fetchedAt);
    return createReadmeViewModel({
      markdown,
      source: 'online',
      appVersion,
      fetchedAt: cached?.fetchedAt ?? fetchedAt
    });
  } catch (err) {
    onlineError = err;
  }

  // Same-origin documentation is reported before the remote attempt and is
  // never written to the online cache.
  if (localModel) return { ...localModel, onlineUnavailable: true };
  throw onlineError;
}
