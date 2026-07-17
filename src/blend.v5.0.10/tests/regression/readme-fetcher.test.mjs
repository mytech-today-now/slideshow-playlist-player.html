import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readReadmeCache,
  writeReadmeCache,
  clearReadmeCache,
  fetchWithTimeout,
  fetchReadme,
  README_CACHE_KEY,
  README_CACHE_TTL_MS,
  GITHUB_README_URL,
  LOCAL_README_URL,
} from '../../readme-fetcher.js';

// ---------------------------------------------------------------------------
// Minimal localStorage-compatible shim (Map-backed) for Node.js tests.
// ---------------------------------------------------------------------------
function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem:    key       => store.has(key) ? store.get(key) : null,
    setItem:    (key, v)  => store.set(key, String(v)),
    removeItem: key       => store.delete(key),
  };
}

// ---------------------------------------------------------------------------
// readReadmeCache
// ---------------------------------------------------------------------------

test('readReadmeCache returns null when storage is empty', () => {
  assert.equal(readReadmeCache(makeStorage()), null);
});

test('readReadmeCache returns null for an expired entry', () => {
  const storage = makeStorage();
  writeReadmeCache('# Old', storage);
  // Back-date the timestamp past the TTL.
  const entry = JSON.parse(storage.getItem(README_CACHE_KEY));
  entry.fetchedAt = Date.now() - README_CACHE_TTL_MS - 1;
  storage.setItem(README_CACHE_KEY, JSON.stringify(entry));
  assert.equal(readReadmeCache(storage), null);
});

test('readReadmeCache returns markdown for a fresh entry', () => {
  const storage = makeStorage();
  writeReadmeCache('# Fresh', storage);
  assert.equal(readReadmeCache(storage), '# Fresh');
});

test('readReadmeCache returns null for malformed JSON', () => {
  const storage = makeStorage({ [README_CACHE_KEY]: 'not-json{{{' });
  assert.equal(readReadmeCache(storage), null);
});

test('readReadmeCache returns null when fetchedAt field is missing', () => {
  const storage = makeStorage();
  storage.setItem(README_CACHE_KEY, JSON.stringify({ markdown: '# Hi' }));
  assert.equal(readReadmeCache(storage), null);
});

test('readReadmeCache returns null when markdown field is not a string', () => {
  const storage = makeStorage();
  storage.setItem(README_CACHE_KEY, JSON.stringify({ markdown: 42, fetchedAt: Date.now() }));
  assert.equal(readReadmeCache(storage), null);
});

// ---------------------------------------------------------------------------
// writeReadmeCache
// ---------------------------------------------------------------------------

test('writeReadmeCache persists markdown with a numeric timestamp', () => {
  const storage = makeStorage();
  const before = Date.now();
  writeReadmeCache('# Written', storage);
  const after = Date.now();
  const entry = JSON.parse(storage.getItem(README_CACHE_KEY));
  assert.equal(entry.markdown, '# Written');
  assert.ok(entry.fetchedAt >= before && entry.fetchedAt <= after,
    'fetchedAt should be approximately now');
});

test('writeReadmeCache overwrites an existing cache entry', () => {
  const storage = makeStorage();
  writeReadmeCache('# First', storage);
  writeReadmeCache('# Second', storage);
  assert.equal(readReadmeCache(storage), '# Second');
});

// ---------------------------------------------------------------------------
// clearReadmeCache
// ---------------------------------------------------------------------------

test('clearReadmeCache removes the cache entry so subsequent reads return null', () => {
  const storage = makeStorage();
  writeReadmeCache('# Stored', storage);
  clearReadmeCache(storage);
  assert.equal(readReadmeCache(storage), null);
  assert.equal(storage.getItem(README_CACHE_KEY), null);
});

// ---------------------------------------------------------------------------
// fetchWithTimeout
// ---------------------------------------------------------------------------

test('fetchWithTimeout returns text from a successful response', async () => {
  const mockFetch = async () => ({ ok: true, text: async () => '# GitHub Content' });
  const result = await fetchWithTimeout('https://example.test/', 5000, mockFetch);
  assert.equal(result, '# GitHub Content');
});

test('fetchWithTimeout throws on a non-2xx HTTP status', async () => {
  const mockFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => fetchWithTimeout('https://example.test/', 5000, mockFetch),
    /HTTP 404/,
  );
});

test('fetchWithTimeout propagates network errors', async () => {
  const mockFetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(
    () => fetchWithTimeout('https://example.test/', 5000, mockFetch),
    /Failed to fetch/,
  );
});

// ---------------------------------------------------------------------------
// fetchReadme — caching behaviour
// ---------------------------------------------------------------------------

test('fetchReadme returns cached content without making a network request', async () => {
  const storage = makeStorage();
  writeReadmeCache('# Cached Copy', storage);
  let fetched = false;
  const fetcher = async () => { fetched = true; return { ok: true, text: async () => '' }; };
  const result = await fetchReadme({ storage, fetcher });
  assert.equal(result, '# Cached Copy');
  assert.equal(fetched, false, 'should not have made a network call');
});

test('fetchReadme fetches from the GitHub URL when cache is empty', async () => {
  const storage = makeStorage();
  let calledUrl = null;
  const fetcher = async url => { calledUrl = url; return { ok: true, text: async () => '# Live' }; };
  await fetchReadme({ storage, fetcher });
  assert.equal(calledUrl, GITHUB_README_URL);
});

test('fetchReadme writes the GitHub response to the cache', async () => {
  const storage = makeStorage();
  const fetcher = async () => ({ ok: true, text: async () => '# Persisted' });
  await fetchReadme({ storage, fetcher });
  assert.equal(readReadmeCache(storage), '# Persisted');
});

test('fetchReadme bypasses cache and re-fetches when forceRefresh is true', async () => {
  const storage = makeStorage();
  writeReadmeCache('# Stale', storage);
  const fetcher = async () => ({ ok: true, text: async () => '# Refreshed' });
  const result = await fetchReadme({ forceRefresh: true, storage, fetcher });
  assert.equal(result, '# Refreshed');
});

// ---------------------------------------------------------------------------
// fetchReadme — fallback behaviour
// ---------------------------------------------------------------------------

test('fetchReadme falls back to the local URL when GitHub returns a non-2xx status', async () => {
  const storage = makeStorage();
  const fetcher = async url => {
    if (url === GITHUB_README_URL) return { ok: false, status: 503 };
    if (url === LOCAL_README_URL)  return { ok: true, text: async () => '# Local Fallback' };
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await fetchReadme({ storage, fetcher });
  assert.equal(result, '# Local Fallback');
});

test('fetchReadme does NOT cache local fallback content', async () => {
  const storage = makeStorage();
  const fetcher = async url => {
    if (url === GITHUB_README_URL) return { ok: false, status: 503 };
    return { ok: true, text: async () => '# Local' };
  };
  await fetchReadme({ storage, fetcher });
  assert.equal(readReadmeCache(storage), null, 'local fallback must not be written to cache');
});

test('fetchReadme falls back to local when GitHub throws a network error', async () => {
  const storage = makeStorage();
  const fetcher = async url => {
    if (url === GITHUB_README_URL) throw new TypeError('Network error');
    return { ok: true, text: async () => '# Local via network error fallback' };
  };
  const result = await fetchReadme({ storage, fetcher });
  assert.equal(result, '# Local via network error fallback');
});

test('fetchReadme throws the GitHub error when both sources fail', async () => {
  const storage = makeStorage();
  const fetcher = async url => {
    if (url === GITHUB_README_URL) throw new Error('GitHub is down');
    throw new Error('Local also missing');
  };
  await assert.rejects(() => fetchReadme({ storage, fetcher }), /GitHub is down/);
});

// ---------------------------------------------------------------------------
// Module constants — sanity checks
// ---------------------------------------------------------------------------

test('GITHUB_README_URL is a raw.githubusercontent.com URL ending in README.md', () => {
  assert.match(GITHUB_README_URL, /^https:\/\/raw\.githubusercontent\.com\//);
  assert.match(GITHUB_README_URL, /README\.md$/);
});

test('LOCAL_README_URL is the relative path ./README.md', () => {
  assert.equal(LOCAL_README_URL, './README.md');
});

test('README_CACHE_TTL_MS is exactly one hour in milliseconds', () => {
  assert.equal(README_CACHE_TTL_MS, 60 * 60 * 1000);
});
