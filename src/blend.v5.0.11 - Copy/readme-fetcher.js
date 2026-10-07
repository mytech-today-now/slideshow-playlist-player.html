// readme-fetcher.js
// Fetches the project README from GitHub with localStorage caching and a
// local-file fallback. All browser globals (fetch, localStorage) are injected
// as optional parameters so the module can be unit-tested in Node.js without
// any DOM shim.

export const GITHUB_README_URL =
  'https://raw.githubusercontent.com/mytech-today-now/slideshow-playlist-player.html/refs/heads/main/README.md';

export const LOCAL_README_URL = './README.md';

export const README_CACHE_KEY = 'blend-readme-cache-v1';

// Re-fetch from network after 1 hour; serves stale cache while offline.
export const README_CACHE_TTL_MS = 60 * 60 * 1000;

// Abort a hung network request after 10 seconds.
export const FETCH_TIMEOUT_MS = 10_000;

/**
 * Return cached README markdown if present and still within TTL, else null.
 * @param {Pick<Storage,'getItem'>} [storage]
 * @returns {string|null}
 */
export function readReadmeCache(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(README_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (typeof entry?.markdown !== 'string' || typeof entry?.fetchedAt !== 'number') return null;
    if (Date.now() - entry.fetchedAt > README_CACHE_TTL_MS) return null;
    return entry.markdown;
  } catch (_) {
    return null;
  }
}

/**
 * Persist markdown text and a timestamp so future calls can serve from cache.
 * @param {string} markdown
 * @param {Pick<Storage,'setItem'>} [storage]
 */
export function writeReadmeCache(markdown, storage = globalThis.localStorage) {
  try {
    storage?.setItem(README_CACHE_KEY, JSON.stringify({ markdown, fetchedAt: Date.now() }));
  } catch (_) {}
}

/**
 * Remove the cached README (forces a fresh network fetch on next call).
 * @param {Pick<Storage,'removeItem'>} [storage]
 */
export function clearReadmeCache(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(README_CACHE_KEY);
  } catch (_) {}
}

/**
 * Fetch text from `url`, aborting after `timeoutMs` milliseconds.
 * Throws on non-2xx status or network failure.
 * @param {string} url
 * @param {number} [timeoutMs]
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<string>}
 */
export async function fetchWithTimeout(
  url,
  timeoutMs = FETCH_TIMEOUT_MS,
  fetcher = globalThis.fetch
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Return README markdown content using this priority order:
 *   1. Fresh cache entry (< TTL)                   → immediate, no network
 *   2. GitHub raw URL                               → cache result, return
 *   3. Local ./README.md (same-origin fallback)     → return, do not cache
 *   4. Both fail                                    → throw the GitHub error
 *
 * Passing `forceRefresh: true` bypasses the cache so a retry always hits
 * the network (used by the error-state retry button).
 *
 * @param {{ forceRefresh?: boolean, fetcher?: typeof fetch, storage?: Storage }} [opts]
 * @returns {Promise<string>}
 */
export async function fetchReadme({ forceRefresh = false, fetcher, storage } = {}) {
  if (!forceRefresh) {
    const cached = readReadmeCache(storage);
    if (cached !== null) return cached;
  }

  let githubError;
  try {
    const markdown = await fetchWithTimeout(GITHUB_README_URL, FETCH_TIMEOUT_MS, fetcher);
    writeReadmeCache(markdown, storage);
    return markdown;
  } catch (err) {
    githubError = err;
  }

  // Same-origin fallback: works when the app is served locally or GitHub is
  // temporarily unavailable. Not cached so a future open will retry GitHub.
  try {
    return await fetchWithTimeout(LOCAL_README_URL, FETCH_TIMEOUT_MS, fetcher);
  } catch (_) {
    throw githubError;
  }
}
