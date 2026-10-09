import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readReadmeCache,
  writeReadmeCache,
  clearReadmeCache,
  fetchWithTimeout,
  fetchReadme,
  createReadmeViewModel,
  extractReadmeVersion,
  README_CACHE_KEY,
  LEGACY_README_CACHE_KEY,
  README_CACHE_TTL_MS,
  FETCH_TIMEOUT_MS,
  GITHUB_README_URL,
  LOCAL_README_URL,
} from '../../readme-fetcher.js';

const LOCAL_GUIDE = '# Blend Player\n\n- **Runtime app version string in code/UI:** `5.0.11`\n\nInstalled guide.';
const ONLINE_GUIDE = '# Blend Player\n\n- **Runtime app version string in code/UI:** `5.1.0`\n\nCurrent online guide.';
const OLD_ONLINE_GUIDE = '# Blend Player\n\n- **Runtime app version string in code/UI:** `5.0.10`\n\nCached old guide.';

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  };
}

function response(markdown) {
  return { ok: true, text: async () => markdown };
}

function makeClock(startAt = 1000) {
  let now = startAt;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, deadline: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    pendingCount: () => timers.size,
    advance(ms) {
      now += ms;
      const due = Array.from(timers.entries()).filter(([, timer]) => timer.deadline <= now);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
}

test('extractReadmeVersion reads the explicit runtime-version marker only', () => {
  assert.equal(extractReadmeVersion(LOCAL_GUIDE), '5.0.11');
  assert.equal(extractReadmeVersion('# Blend Player\n\n### 5.1.0 (changelog)'), null);
});

test('createReadmeViewModel reports matching, mismatched, and unknown versions', () => {
  const matching = createReadmeViewModel({ markdown: LOCAL_GUIDE, source: 'local', appVersion: '5.0.11' });
  assert.equal(matching.source, 'local');
  assert.equal(matching.documentVersion, '5.0.11');
  assert.equal(matching.versionMatchesApp, true);
  assert.equal(matching.versionStatus, 'match');

  const mismatch = createReadmeViewModel({ markdown: ONLINE_GUIDE, source: 'online', appVersion: '5.0.11' });
  assert.equal(mismatch.source, 'online');
  assert.equal(mismatch.versionMatchesApp, false);
  assert.equal(mismatch.versionStatus, 'mismatch');

  const unknown = createReadmeViewModel({ markdown: '# Online guide', source: 'online', appVersion: '5.0.11' });
  assert.equal(unknown.documentVersion, null);
  assert.equal(unknown.versionStatus, 'unknown');
});

test('readReadmeCache returns null when storage is empty, malformed, or has invalid fields', () => {
  assert.equal(readReadmeCache(makeStorage()), null);
  assert.equal(readReadmeCache(makeStorage({ [README_CACHE_KEY]: 'not-json{{{' })), null);
  assert.equal(readReadmeCache(makeStorage({
    [README_CACHE_KEY]: JSON.stringify({ source: 'online', markdown: 42, version: null, fetchedAt: Date.now() })
  })), null);
});

test('readReadmeCache returns null for expired entries', () => {
  const storage = makeStorage();
  writeReadmeCache(ONLINE_GUIDE, storage, 1000);
  assert.equal(readReadmeCache(storage, 1000 + README_CACHE_TTL_MS), null);
});

test('readReadmeCache rejects entries whose stored version does not match their Markdown', () => {
  const storage = makeStorage({
    [README_CACHE_KEY]: JSON.stringify({
      source: 'online', markdown: ONLINE_GUIDE, version: '5.0.10', fetchedAt: Date.now()
    })
  });
  assert.equal(readReadmeCache(storage), null);
});

test('writeReadmeCache persists source, document version, and fetch timestamp together', () => {
  const storage = makeStorage();
  const fetchedAt = Date.now() - 500;
  writeReadmeCache(ONLINE_GUIDE, storage, fetchedAt);
  const entry = JSON.parse(storage.getItem(README_CACHE_KEY));
  assert.equal(entry.source, 'online');
  assert.equal(entry.markdown, ONLINE_GUIDE);
  assert.equal(entry.version, '5.1.0');
  assert.equal(entry.fetchedAt, fetchedAt);
  assert.deepEqual(readReadmeCache(storage), {
    markdown: ONLINE_GUIDE,
    fetchedAt,
    version: '5.1.0'
  });
});

test('clearReadmeCache removes both current and legacy cache entries', () => {
  const storage = makeStorage({
    [README_CACHE_KEY]: 'current',
    [LEGACY_README_CACHE_KEY]: 'legacy'
  });
  clearReadmeCache(storage);
  assert.equal(storage.getItem(README_CACHE_KEY), null);
  assert.equal(storage.getItem(LEGACY_README_CACHE_KEY), null);
});

test('fetchWithTimeout returns text from a successful response', async () => {
  const result = await fetchWithTimeout('https://example.test/', 5000, async () => response('# Online'));
  assert.equal(result, '# Online');
});

test('fetchWithTimeout clears its injected timeout after the response body completes', async () => {
  const clock = makeClock();
  const result = await fetchWithTimeout('https://example.test/', 5000, async () => response('# Online'), clock);
  assert.equal(result, '# Online');
  assert.equal(clock.pendingCount(), 0);
});

test('fetchWithTimeout throws on a non-2xx status and propagates network errors', async () => {
  await assert.rejects(
    () => fetchWithTimeout('https://example.test/', 5000, async () => ({ ok: false, status: 503 })),
    /HTTP 503/
  );
  await assert.rejects(
    () => fetchWithTimeout('https://example.test/', 5000, async () => { throw new TypeError('Network error'); }),
    /Network error/
  );
});

test('fetchReadme defaults to the installed guide even when an online cache exists', async () => {
  const storage = makeStorage();
  writeReadmeCache(OLD_ONLINE_GUIDE, storage);
  const calledUrls = [];
  const model = await fetchReadme({
    storage,
    appVersion: '5.0.11',
    fetcher: async url => {
      calledUrls.push(url);
      if (url === LOCAL_README_URL) return response(LOCAL_GUIDE);
      throw new Error(`Unexpected network request: ${url}`);
    }
  });

  assert.deepEqual(calledUrls, [LOCAL_README_URL]);
  assert.equal(model.source, 'local');
  assert.equal(model.markdown, LOCAL_GUIDE);
  assert.equal(model.documentVersion, '5.0.11');
  assert.equal(model.versionMatchesApp, true);
  assert.equal(readReadmeCache(storage).version, '5.0.10');
});

test('fetchReadme fetches and caches online documentation only when requested', async () => {
  const storage = makeStorage();
  const calledUrls = [];
  let localModel = null;
  const model = await fetchReadme({
    source: 'online',
    storage,
    appVersion: '5.0.11',
    onLocal: viewModel => { localModel = viewModel; },
    fetcher: async url => {
      calledUrls.push(url);
      return response(url === LOCAL_README_URL ? LOCAL_GUIDE : ONLINE_GUIDE);
    }
  });
  const cache = readReadmeCache(storage);

  assert.deepEqual(calledUrls, [LOCAL_README_URL, GITHUB_README_URL]);
  assert.equal(localModel.source, 'local');
  assert.equal(localModel.markdown, LOCAL_GUIDE);
  assert.equal(model.source, 'online');
  assert.equal(model.documentVersion, '5.1.0');
  assert.equal(model.versionMatchesApp, false);
  assert.equal(model.fromCache, false);
  assert.equal(cache.version, model.documentVersion);
  assert.equal(cache.fetchedAt, model.fetchedAt);
});

test('fetchReadme returns a fresh cached online guide with its original version and timestamp', async () => {
  const storage = makeStorage();
  const fetchedAt = Date.now() - 1000;
  writeReadmeCache(OLD_ONLINE_GUIDE, storage, fetchedAt);
  let calledUrl = null;
  const model = await fetchReadme({
    source: 'online',
    storage,
    appVersion: '5.0.11',
    fetcher: async url => { calledUrl = url; return response(ONLINE_GUIDE); }
  });

  assert.equal(calledUrl, null);
  assert.equal(model.markdown, OLD_ONLINE_GUIDE);
  assert.equal(model.documentVersion, '5.0.10');
  assert.equal(model.versionMatchesApp, false);
  assert.equal(model.fromCache, true);
  assert.equal(model.fetchedAt, fetchedAt);
});

test('fetchReadme bypasses a fresh cache on user-triggered retry', async () => {
  const storage = makeStorage();
  writeReadmeCache(OLD_ONLINE_GUIDE, storage);
  let calledUrl = null;
  const model = await fetchReadme({
    source: 'online',
    forceRefresh: true,
    storage,
    appVersion: '5.0.11',
    fetcher: async url => { calledUrl = url; return response(ONLINE_GUIDE); }
  });

  assert.equal(calledUrl, GITHUB_README_URL);
  assert.equal(model.markdown, ONLINE_GUIDE);
  assert.equal(model.fromCache, false);
});

test('fetchReadme ignores an expired online cache and fetches current online documentation', async () => {
  const storage = makeStorage();
  writeReadmeCache(OLD_ONLINE_GUIDE, storage, Date.now() - README_CACHE_TTL_MS - 1);
  const calledUrls = [];
  const model = await fetchReadme({
    source: 'online',
    storage,
    appVersion: '5.0.11',
    fetcher: async url => {
      calledUrls.push(url);
      return response(url === GITHUB_README_URL ? ONLINE_GUIDE : LOCAL_GUIDE);
    }
  });

  assert.deepEqual(calledUrls, [LOCAL_README_URL, GITHUB_README_URL]);
  assert.equal(model.documentVersion, '5.1.0');
  assert.equal(model.fromCache, false);
});

test('fetchReadme exposes the installed guide before an uncached remote timeout', async () => {
  const clock = makeClock();
  const storage = makeStorage();
  let localReady;
  let remoteStarted;
  const localAvailable = new Promise(resolve => { localReady = resolve; });
  const remotePending = new Promise(resolve => { remoteStarted = resolve; });
  const request = fetchReadme({
    source: 'online',
    storage,
    appVersion: '5.0.11',
    clock,
    onLocal: localReady,
    fetcher: async (url, { signal } = {}) => {
      if (url === LOCAL_README_URL) return response(LOCAL_GUIDE);
      remoteStarted();
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Remote fetch aborted')), { once: true });
      });
    }
  });

  const localModel = await localAvailable;
  await remotePending;
  assert.equal(localModel.markdown, LOCAL_GUIDE);
  assert.equal(localModel.source, 'local');
  assert.equal(clock.now(), 1000);
  assert.equal(clock.pendingCount(), 1);

  clock.advance(FETCH_TIMEOUT_MS);
  const model = await request;
  assert.equal(model.source, 'local');
  assert.equal(model.onlineUnavailable, true);
  assert.equal(model.markdown, LOCAL_GUIDE);
  assert.equal(clock.pendingCount(), 0);
  assert.equal(readReadmeCache(storage), null);
});

test('fetchReadme uses the installed guide after online failure without caching the fallback', async () => {
  const storage = makeStorage();
  const calledUrls = [];
  const model = await fetchReadme({
    source: 'online',
    storage,
    appVersion: '5.0.11',
    fetcher: async url => {
      calledUrls.push(url);
      if (url === LOCAL_README_URL) return response(LOCAL_GUIDE);
      if (url === GITHUB_README_URL) throw new TypeError('Network unavailable');
      throw new Error(`Unexpected URL: ${url}`);
    }
  });

  assert.deepEqual(calledUrls, [LOCAL_README_URL, GITHUB_README_URL]);
  assert.equal(model.source, 'local');
  assert.equal(model.onlineUnavailable, true);
  assert.equal(model.documentVersion, '5.0.11');
  assert.equal(readReadmeCache(storage), null);
});

test('fetchReadme rejects when online and installed documentation both fail', async () => {
  const model = fetchReadme({
    source: 'online',
    fetcher: async url => { throw new Error(`${url} failed`); }
  });
  await assert.rejects(model, /raw\.githubusercontent\.com/);
});

test('local README failure does not trigger an implicit online request', async () => {
  const calledUrls = [];
  await assert.rejects(
    () => fetchReadme({
      source: 'local',
      fetcher: async url => { calledUrls.push(url); throw new Error('Local README missing'); }
    }),
    /Local README missing/
  );
  assert.deepEqual(calledUrls, [LOCAL_README_URL]);
});

test('source URLs and the online cache lifetime remain explicit', () => {
  assert.match(GITHUB_README_URL, /^https:\/\/raw\.githubusercontent\.com\//);
  assert.match(GITHUB_README_URL, /README\.md$/);
  assert.equal(LOCAL_README_URL, './README.md');
  assert.equal(README_CACHE_TTL_MS, 60 * 60 * 1000);
});
