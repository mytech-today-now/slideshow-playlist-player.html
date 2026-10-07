import test from 'node:test';
import assert from 'node:assert/strict';

import { SupabaseAuthError, createSupabaseAuthClient } from '../../supabase-auth.js';

function createMemoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  const writes = [];
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      const normalized = String(value);
      writes.push({ key, value: normalized });
      map.set(key, normalized);
    },
    removeItem(key) {
      map.delete(key);
    },
    writes,
    keys() { return Array.from(map.keys()); }
  };
}

function createExpiredSavedSession(storageKey = 'blend-supabase-auth-session-v2') {
  const savedSession = JSON.stringify({
    access_token: 'synthetic-expired-access-token',
    refresh_token: 'synthetic-saved-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) - 1
  });
  return { storageKey, savedSession, storage: createMemoryStorage({ [storageKey]: savedSession }) };
}

function createFakeTimers() {
  const timers = [];
  let nextId = 1;
  return {
    timers,
    setTimeout(callback, delay) {
      const timer = { id: nextId++, callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    nextActive() {
      return timers.find(timer => !timer.cleared) || null;
    },
    async runNext() {
      const timer = this.nextActive();
      assert.ok(timer, 'expected a scheduled timer');
      timer.cleared = true;
      timer.callback();
      await new Promise(resolve => setImmediate(resolve));
      return timer.delay;
    }
  };
}

test('bootstrap restores and refreshes expiring session', async () => {
  const now = Math.floor(Date.now() / 1000);
  const storage = createMemoryStorage({
    'blend-auth-test': JSON.stringify({
      access_token: 'old-token',
      refresh_token: 'refresh-token',
      expires_at: now + 5
    })
  });
  const fetchCalls = [];
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey: 'blend-auth-test',
    fetchImpl: async (url) => {
      fetchCalls.push(String(url));
      return new Response(JSON.stringify({
        access_token: 'new-token',
        refresh_token: 'refresh-token',
        expires_in: 3600
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  try {
    const session = await client.bootstrap();
    assert.equal(session.access_token, 'new-token');
    assert.equal(fetchCalls.length, 1);
  } finally {
    client.shutdown();
  }
});

test('bootstrap keeps the saved session after network, timeout-status, and server refresh failures', async t => {
  for (const failure of [
    { name: 'network rejection', run: async () => { throw new Error('synthetic raw provider detail'); }, code: 'auth_network_error' },
    { name: '429 response', run: async () => new Response(JSON.stringify({ msg: 'secret provider body' }), { status: 429 }), code: 'auth_refresh_failed' },
    { name: '500 response', run: async () => new Response(JSON.stringify({ msg: 'secret provider body' }), { status: 500 }), code: 'auth_refresh_failed' }
  ]) {
    await t.test(failure.name, async () => {
      const { storageKey, savedSession, storage } = createExpiredSavedSession();
      const loggerEntries = [];
      const events = [];
      let requestCount = 0;
      const client = createSupabaseAuthClient({
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon',
        storage,
        storageKey,
        refreshRetryDelaysMs: [],
        logger: { info: (...args) => loggerEntries.push(args) },
        fetchImpl: async () => {
          requestCount += 1;
          return failure.run();
        }
      });
      client.onAuthStateChange(({ event }) => events.push(event));

      try {
        const session = await client.bootstrap();
        assert.equal(session.refresh_token, 'synthetic-saved-refresh-token');
        assert.equal(storage.getItem(storageKey), savedSession);
        assert.equal(client.getSession().refresh_token, 'synthetic-saved-refresh-token');
        assert.equal(client.getAccessToken(), '', 'an expired access token is not exposed for private media');
        assert.equal(client.getStatus().state, 'temporarily-unavailable');
        assert.equal(client.getStatus().code, failure.code);
        assert.equal(events.includes('SIGNED_OUT'), false);
        assert.equal(requestCount, 1);
        assert.doesNotMatch(JSON.stringify(loggerEntries), /synthetic raw provider detail|secret provider body/);
      } finally {
        client.shutdown();
      }
    });
  }
});

test('bootstrap keeps the saved session when the injected refresh request times out', async () => {
  const { storageKey, savedSession, storage } = createExpiredSavedSession();
  let requestCount = 0;
  let signalAborted = false;
  const client = createSupabaseAuthClient({
    storage,
    storageKey,
    requestTimeoutMs: 5,
    refreshRetryDelaysMs: [],
    fetchImpl: async (_url, init) => {
      requestCount += 1;
      return await new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          signalAborted = true;
          reject(Object.assign(new Error('synthetic timeout detail'), { name: 'AbortError' }));
        }, { once: true });
      });
    }
  });

  try {
    const session = await client.bootstrap();
    assert.equal(session.refresh_token, 'synthetic-saved-refresh-token');
    assert.equal(storage.getItem(storageKey), savedSession);
    assert.equal(client.getStatus().code, 'auth_timeout');
    assert.equal(signalAborted, true);
    assert.equal(requestCount, 1);
  } finally {
    client.shutdown();
  }
});

test('sign-in composes a caller signal and reports explicit cancellation separately from timeout', async () => {
  const caller = new AbortController();
  let requestSignal = null;
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage: createMemoryStorage(),
    requestTimeoutMs: 5_000,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('secret auth query token'), { name: 'AbortError' })), { once: true });
      });
    }
  });

  try {
    const signIn = client.signInWithPassword({ email: 'user@example.test', password: 'synthetic-password', signal: caller.signal });
    await new Promise(resolve => setImmediate(resolve));
    assert.notEqual(requestSignal, caller.signal, 'the request signal should compose caller cancellation with its deadline');
    caller.abort();
    await assert.rejects(signIn, error => error.code === 'auth_request_cancelled' && error.retryable === false);
    assert.equal(requestSignal.aborted, true);
  } finally {
    client.shutdown();
  }
});

test('auth request deadline also covers a stalled response body', async () => {
  const timers = createFakeTimers();
  let requestSignal = null;
  let bodyReadStarted = false;
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage: createMemoryStorage(),
    requestTimeoutMs: 100,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return {
        ok: true,
        status: 200,
        text: () => new Promise((_, reject) => {
          bodyReadStarted = true;
          init.signal.addEventListener('abort', () => reject(new Error('synthetic body read abort')), { once: true });
        })
      };
    }
  });

  try {
    const signIn = client.signInWithPassword({ email: 'user@example.test', password: 'synthetic-password' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(bodyReadStarted, true);
    const rejected = assert.rejects(signIn, error => error.code === 'auth_timeout' && error.retryable === true);
    await timers.runNext();
    await rejected;
    assert.equal(requestSignal.aborted, true);
  } finally {
    client.shutdown();
  }
});

test('sign-out aborts an in-flight refresh and ignores its late response', async () => {
  const { storageKey, savedSession, storage } = createExpiredSavedSession();
  let resolveRefresh;
  let refreshStartedResolve;
  const refreshStarted = new Promise(resolve => { refreshStartedResolve = resolve; });
  let refreshSignal = null;
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey,
    requestTimeoutMs: 5_000,
    refreshRetryDelaysMs: [],
    fetchImpl: async (url, init) => {
      if (String(url).includes('grant_type=refresh_token')) {
        refreshSignal = init.signal;
        refreshStartedResolve();
        return new Promise(resolve => { resolveRefresh = resolve; });
      }
      return new Response('{}', { status: 200 });
    }
  });

  try {
    const bootstrap = client.bootstrap();
    await refreshStarted;
    assert.equal(refreshSignal.aborted, false);
    await client.signOut();
    assert.equal(refreshSignal.aborted, true);
    assert.equal(client.getSession(), null);
    assert.equal(storage.getItem(storageKey), null);

    resolveRefresh(new Response(JSON.stringify({
      access_token: 'synthetic-late-access-token',
      refresh_token: 'synthetic-late-refresh-token',
      expires_in: 3600
    }), { status: 200 }));
    await bootstrap;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(client.getSession(), null);
    assert.equal(storage.getItem(storageKey), null);
    assert.doesNotMatch(storage.getItem(storageKey) || savedSession, /synthetic-late/);
  } finally {
    client.shutdown();
  }
});

test('confirmed invalid refresh token clears saved state and emits signed-out once', async () => {
  const { storageKey, storage } = createExpiredSavedSession();
  let requestCount = 0;
  const events = [];
  const client = createSupabaseAuthClient({
    storage,
    storageKey,
    fetchImpl: async () => {
      requestCount += 1;
      return new Response(JSON.stringify({
        error_code: 'refresh_token_not_found',
        msg: 'Invalid Refresh Token: Refresh Token Not Found; synthetic-provider-body-with-private-detail'
      }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
  });
  client.onAuthStateChange(({ event }) => events.push(event));

  try {
    assert.equal(await client.bootstrap(), null);
    assert.equal(storage.getItem(storageKey), null);
    assert.equal(client.getSession(), null);
    assert.equal(client.getStatus().state, 'signed-out');
    assert.equal(requestCount, 1);
    assert.equal(events.filter(event => event === 'SIGNED_OUT').length, 1);
  } finally {
    client.shutdown();
  }
});

test('bootstrap and concurrent refresh callers share one rotating-token request', async () => {
  const { storageKey, savedSession, storage } = createExpiredSavedSession();
  let requestCount = 0;
  let releaseRequest;
  const client = createSupabaseAuthClient({
    storage,
    storageKey,
    fetchImpl: async () => {
      requestCount += 1;
      return await new Promise(resolve => { releaseRequest = resolve; });
    }
  });

  try {
    const bootstrapPromise = client.bootstrap();
    await Promise.resolve();
    assert.equal(requestCount, 1);
    const first = client.refreshSession();
    const second = client.refreshSession();
    assert.equal(requestCount, 1);
    releaseRequest(new Response(JSON.stringify({
      access_token: 'synthetic-refreshed-access-token',
      refresh_token: 'synthetic-rotated-refresh-token',
      expires_in: 3600
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const [bootstrapped, refreshedA, refreshedB] = await Promise.all([bootstrapPromise, first, second]);
    assert.equal(requestCount, 1);
    assert.equal(bootstrapped.refresh_token, 'synthetic-rotated-refresh-token');
    assert.equal(refreshedA.refresh_token, 'synthetic-rotated-refresh-token');
    assert.equal(refreshedB.refresh_token, 'synthetic-rotated-refresh-token');
    assert.notEqual(storage.getItem(storageKey), savedSession);
    assert.equal(JSON.parse(storage.getItem(storageKey)).refresh_token, 'synthetic-rotated-refresh-token');
  } finally {
    client.shutdown();
  }
});

test('scheduled refresh overlapping bootstrap shares its in-flight provider request', async () => {
  const { storageKey, storage } = createExpiredSavedSession();
  const timers = createFakeTimers();
  let requestCount = 0;
  let releaseRequest;
  const client = createSupabaseAuthClient({
    storage,
    storageKey,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async () => {
      requestCount += 1;
      return await new Promise(resolve => { releaseRequest = resolve; });
    }
  });

  try {
    const bootstrapPromise = client.bootstrap();
    await Promise.resolve();
    assert.equal(requestCount, 1);
    const scheduledRefresh = timers.nextActive();
    assert.equal(scheduledRefresh.delay, 1_000);
    scheduledRefresh.cleared = true;
    scheduledRefresh.callback();
    await Promise.resolve();
    assert.equal(requestCount, 1, 'timer caller must reuse bootstrap refresh');

    releaseRequest(new Response(JSON.stringify({
      access_token: 'synthetic-scheduled-refreshed-access-token',
      refresh_token: 'synthetic-scheduled-rotated-refresh-token',
      expires_in: 3600
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const session = await bootstrapPromise;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requestCount, 1);
    assert.equal(session.refresh_token, 'synthetic-scheduled-rotated-refresh-token');
  } finally {
    client.shutdown();
  }
});

test('automatic refresh uses bounded backoff and stops scheduling after sign-out', async () => {
  const { storageKey, storage } = createExpiredSavedSession();
  const timers = createFakeTimers();
  let refreshRequests = 0;
  const client = createSupabaseAuthClient({
    storage,
    storageKey,
    refreshRetryDelaysMs: [1_000, 2_000, 4_000, 8_000, 16_000],
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async url => {
      if (String(url).includes('grant_type=refresh_token')) {
        refreshRequests += 1;
        throw new Error('synthetic unavailable');
      }
      return new Response('{}', { status: 200 });
    }
  });

  try {
    await client.bootstrap();
    const retryDelays = [];
    while (timers.nextActive()) retryDelays.push(await timers.runNext());
    assert.deepEqual(retryDelays, [1_000, 2_000, 4_000, 8_000, 16_000]);
    assert.equal(refreshRequests, 6, 'one initial request plus five bounded retries');
    assert.notEqual(storage.getItem(storageKey), null);
    assert.equal(client.getStatus().state, 'temporarily-unavailable');

    await client.signOut();
    assert.equal(storage.getItem(storageKey), null);
    assert.equal(client.getStatus().state, 'signed-out');
    assert.equal(timers.nextActive(), null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(refreshRequests, 6);
  } finally {
    client.shutdown();
  }
});

test('explicit sign-out cancels a pending automatic refresh retry', async () => {
  const { storageKey, storage } = createExpiredSavedSession();
  const timers = createFakeTimers();
  let refreshRequests = 0;
  const client = createSupabaseAuthClient({
    storage,
    storageKey,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async url => {
      if (String(url).includes('grant_type=refresh_token')) {
        refreshRequests += 1;
        throw new Error('synthetic unavailable');
      }
      return new Response('{}', { status: 200 });
    }
  });

  try {
    await client.bootstrap();
    assert.equal(refreshRequests, 1);
    assert.equal(timers.nextActive()?.delay, 1_000);
    await client.signOut();
    assert.equal(storage.getItem(storageKey), null);
    assert.equal(client.getSession(), null);
    assert.equal(timers.nextActive(), null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(refreshRequests, 1);
  } finally {
    client.shutdown();
  }
});

test('bootstrap clears an expired saved session that has no refresh token', async () => {
  const storageKey = 'blend-supabase-auth-session-v2';
  const storage = createMemoryStorage({
    [storageKey]: JSON.stringify({
      access_token: 'synthetic-expired-access-token',
      refresh_token: '',
      expires_at: Math.floor(Date.now() / 1000) - 1
    })
  });
  const client = createSupabaseAuthClient({ storage, storageKey, fetchImpl: async () => { throw new Error('unexpected fetch'); } });

  try {
    assert.equal(await client.bootstrap(), null);
    assert.equal(client.getSession(), null);
    assert.equal(client.isAuthenticated(), false);
    assert.equal(storage.getItem(storageKey), null);
  } finally {
    client.shutdown();
  }
});

test('signInWithPassword keeps its session in memory by default', async () => {
  const storage = createMemoryStorage();
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey: 'blend-auth-test',
    fetchImpl: async () => new Response(JSON.stringify({
      access_token: 'signed-in-token',
      refresh_token: 'refresh-token',
      expires_in: 3600
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  });

  try {
    const session = await client.signInWithPassword({ email: 'demo@example.com', password: 'secret' });
    assert.equal(session.access_token, 'signed-in-token');
    assert.equal(client.isAuthenticated(), true);
    assert.equal(storage.getItem('blend-auth-test'), null);
    assert.deepEqual(storage.writes, []);
  } finally {
    client.shutdown();
  }
});

test('clearLocalSession removes the saved session, memory session, and refresh timer without fetch', async () => {
  const storageKey = 'blend-supabase-auth-session-v2';
  const now = Math.floor(Date.now() / 1000);
  const storage = createMemoryStorage({
    [storageKey]: JSON.stringify({
      access_token: 'synthetic-access-token',
      refresh_token: 'synthetic-refresh-token',
      expires_at: now + 3600
    })
  });
  const fetchCalls = [];
  const events = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduledTimers = new Set();
  globalThis.setTimeout = callback => {
    const timer = { callback };
    scheduledTimers.add(timer);
    return timer;
  };
  globalThis.clearTimeout = timer => scheduledTimers.delete(timer);

  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey,
    fetchImpl: async (...args) => {
      fetchCalls.push(args);
      throw new Error('fetch must not be called while clearing a local session');
    }
  });
  client.onAuthStateChange(({ event, session }) => events.push({ event, session }));

  try {
    await client.bootstrap();
    assert.equal(client.isAuthenticated(), true);
    assert.equal(scheduledTimers.size, 1);

    assert.equal(client.clearLocalSession(), true);
    assert.equal(storage.getItem(storageKey), null);
    assert.equal(client.getSession(), null);
    assert.equal(client.getAccessToken(), '');
    assert.equal(client.isAuthenticated(), false);
    assert.equal(scheduledTimers.size, 0);
    assert.equal(events.at(-1)?.event, 'SIGNED_OUT');
    assert.equal(events.at(-1)?.session, null);
    assert.deepEqual(fetchCalls, []);
  } finally {
    client.shutdown();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('clearLocalSession reports storage removal failures after signing out in memory', async () => {
  const storageKey = 'blend-supabase-auth-session-v2';
  const storage = createMemoryStorage({
    [storageKey]: JSON.stringify({ access_token: 'synthetic-access-token', expires_at: 4102444800 })
  });
  storage.removeItem = () => { throw new Error('storage unavailable'); };
  const client = createSupabaseAuthClient({ storage, storageKey, fetchImpl: async () => { throw new Error('unexpected fetch'); } });
  const events = [];
  client.onAuthStateChange(({ event, session }) => events.push({ event, session }));

  try {
    await client.bootstrap();
    assert.throws(
      () => client.clearLocalSession(),
      error => error instanceof SupabaseAuthError && error.code === 'auth_local_clear_failed'
    );
    assert.equal(client.getSession(), null);
    assert.equal(client.isAuthenticated(), false);
    assert.equal(storage.getItem(storageKey) !== null, true);
    assert.equal(events.at(-1)?.event, 'SIGNED_OUT');
    assert.equal(events.at(-1)?.session, null);
  } finally {
    client.shutdown();
  }
});

test('ordinary signOut clears local state after a network failure', async () => {
  const storageKey = 'blend-auth-signout-network-test';
  const storage = createMemoryStorage({
    [storageKey]: JSON.stringify({ access_token: 'synthetic-access-token', expires_at: 4102444800 })
  });
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey,
    fetchImpl: async () => { throw new Error('network unavailable'); }
  });

  try {
    await client.bootstrap();
    assert.equal(await client.signOut(), true);
    assert.equal(client.getSession(), null);
    assert.equal(storage.getItem(storageKey), null);
  } finally {
    client.shutdown();
  }
});

test('ordinary signOut retains its session when Supabase reports a server failure', async () => {
  const storageKey = 'blend-auth-signout-server-test';
  const savedSession = JSON.stringify({ access_token: 'synthetic-access-token', expires_at: 4102444800 });
  const storage = createMemoryStorage({ [storageKey]: savedSession });
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey,
    fetchImpl: async () => new Response(JSON.stringify({ message: 'server unavailable' }), { status: 503 })
  });

  try {
    await client.bootstrap();
    await assert.rejects(
      () => client.signOut(),
      error => error instanceof SupabaseAuthError && error.status === 503
    );
    assert.equal(client.getAccessToken(), 'synthetic-access-token');
    assert.equal(storage.getItem(storageKey), savedSession);
  } finally {
    client.shutdown();
  }
});

test('signInWithApiToken keeps session in memory by default and infers expiry from JWT claims', async () => {
  const storage = createMemoryStorage();
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey: 'blend-auth-test',
    fetchImpl: async () => new Response('{}', { status: 200 })
  });

  try {
    const session = await client.signInWithApiToken({
      accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLXJlZ3Jlc3Npb24iLCJlbWFpbCI6InJlZ3Jlc3Npb25AZXhhbXBsZS50ZXN0IiwiZXhwIjo0MTAyNDQ0ODAwfQ.signature'
    });
    assert.equal(client.isAuthenticated(), true);
    assert.equal(session.user?.id, 'user-regression');
    assert.equal(session.user?.email, 'regression@example.test');
    assert.ok(session.expires_at > 0);
    assert.equal(storage.getItem('blend-auth-test'), null);
    assert.deepEqual(storage.writes, []);
  } finally {
    client.shutdown();
  }
});

test('default token sign-in and refresh never persist sentinel credentials or log them', async () => {
  const accessToken = 'synthetic-access-sentinel-token';
  const refreshToken = 'synthetic-refresh-sentinel-token';
  const refreshedAccessToken = 'synthetic-refreshed-access-token';
  const refreshedToken = 'synthetic-rotated-refresh-token';
  const storage = createMemoryStorage();
  const loggerEntries = [];
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey: 'blend-auth-default-test',
    logger: { info: (...args) => loggerEntries.push(args) },
    fetchImpl: async url => {
      assert.match(String(url), /grant_type=refresh_token/);
      return new Response(JSON.stringify({
        access_token: refreshedAccessToken,
        refresh_token: refreshedToken,
        expires_in: 3600
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  try {
    await client.signInWithApiToken({ accessToken, refreshToken, expiresIn: 3600 });
    assert.equal(client.getAccessToken(), accessToken);
    assert.equal(storage.getItem('blend-auth-default-test'), null);
    assert.deepEqual(storage.writes, []);

    const refreshed = await client.refreshSession();
    assert.equal(refreshed.access_token, refreshedAccessToken);
    assert.equal(refreshed.refresh_token, refreshedToken);
    assert.equal(storage.getItem('blend-auth-default-test'), null);
    assert.deepEqual(storage.writes, []);

    const logs = JSON.stringify(loggerEntries);
    for (const secret of [accessToken, refreshToken, refreshedAccessToken, refreshedToken]) {
      assert.equal(logs.includes(secret), false);
    }
  } finally {
    client.shutdown();
  }
});

test('explicit persistence stores only the documented fields, refreshes, and sign-out removes the entry', async () => {
  const accessToken = 'synthetic-opt-in-access-token';
  const refreshToken = 'synthetic-opt-in-refresh-token';
  const refreshedAccessToken = 'synthetic-opt-in-refreshed-access-token';
  const refreshedToken = 'synthetic-opt-in-rotated-refresh-token';
  const storageKey = 'blend-supabase-auth-session-v2';
  const storage = createMemoryStorage();
  const loggerEntries = [];
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage,
    storageKey,
    logger: { info: (...args) => loggerEntries.push(args) },
    fetchImpl: async url => {
      if (String(url).includes('grant_type=refresh_token')) {
        return new Response(JSON.stringify({
          access_token: refreshedAccessToken,
          refresh_token: refreshedToken,
          expires_in: 3600,
          user: { id: 'private-user-metadata' }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  try {
    await client.signInWithApiToken({ accessToken, refreshToken, expiresIn: 3600, persist: true });
    let persisted = JSON.parse(storage.getItem(storageKey));
    assert.deepEqual(Object.keys(persisted).sort(), ['access_token', 'expires_at', 'refresh_token']);
    assert.equal(persisted.access_token, accessToken);
    assert.equal(persisted.refresh_token, refreshToken);
    assert.deepEqual(storage.keys(), [storageKey]);

    await client.refreshSession();
    persisted = JSON.parse(storage.getItem(storageKey));
    assert.equal(persisted.access_token, refreshedAccessToken);
    assert.equal(persisted.refresh_token, refreshedToken);
    assert.equal(Object.hasOwn(persisted, 'user'), false);
    assert.deepEqual(storage.keys(), [storageKey]);

    assert.equal(await client.signOut(), true);
    assert.equal(storage.getItem(storageKey), null);
    assert.deepEqual(storage.keys(), []);
    const logs = JSON.stringify(loggerEntries);
    for (const secret of [accessToken, refreshToken, refreshedAccessToken, refreshedToken]) {
      assert.equal(logs.includes(secret), false);
    }
  } finally {
    client.shutdown();
  }
});

test('bootstrap rejects malformed saved sessions and fails closed', async () => {
  const storageKey = 'blend-supabase-auth-session-v2';
  const storage = createMemoryStorage({
    [storageKey]: '{"access_token":"synthetic-malformed-token"'
  });
  const client = createSupabaseAuthClient({
    storage,
    storageKey,
    fetchImpl: async () => { throw new Error('unexpected fetch'); }
  });

  try {
    assert.equal(await client.bootstrap(), null);
    assert.equal(client.isAuthenticated(), false);
    assert.equal(client.getAccessToken(), '');
    assert.equal(storage.getItem(storageKey), null);
  } finally {
    client.shutdown();
  }
});

test('bootstrap fails closed when session storage cannot be read', async () => {
  const storage = createMemoryStorage();
  storage.getItem = () => { throw new Error('storage unavailable'); };
  const client = createSupabaseAuthClient({ storage, fetchImpl: async () => { throw new Error('unexpected fetch'); } });

  try {
    assert.equal(await client.bootstrap(), null);
    assert.equal(client.isAuthenticated(), false);
    assert.equal(client.getAccessToken(), '');
  } finally {
    client.shutdown();
  }
});

test('opt-in storage write failure signs out in memory and keeps private access gated', async () => {
  const storage = createMemoryStorage();
  storage.setItem = () => { throw new Error('storage unavailable'); };
  const client = createSupabaseAuthClient({ storage, fetchImpl: async () => new Response('{}', { status: 200 }) });

  try {
    await assert.rejects(
      () => client.signInWithApiToken({
        accessToken: 'synthetic-storage-failure-access-token',
        refreshToken: 'synthetic-storage-failure-refresh-token',
        expiresIn: 3600,
        persist: true
      }),
      error => error instanceof SupabaseAuthError && error.code === 'auth_session_storage_failed'
    );
    assert.equal(client.getSession(), null);
    assert.equal(client.getAccessToken(), '');
    assert.equal(client.isAuthenticated(), false);
    assert.deepEqual(storage.keys(), []);
  } finally {
    client.shutdown();
  }
});

test('bootstrap clears legacy default-persistent sessions instead of restoring them', async () => {
  const legacyKey = 'blend-supabase-auth-session-v1';
  const storage = createMemoryStorage({
    [legacyKey]: JSON.stringify({
      access_token: 'synthetic-legacy-access-token',
      refresh_token: 'synthetic-legacy-refresh-token',
      expires_at: 4102444800
    })
  });
  const client = createSupabaseAuthClient({ storage, fetchImpl: async () => { throw new Error('unexpected fetch'); } });

  try {
    assert.equal(await client.bootstrap(), null);
    assert.equal(client.isAuthenticated(), false);
    assert.equal(storage.getItem(legacyKey), null);
  } finally {
    client.shutdown();
  }
});

test('signInWithApiToken rejects missing token', async () => {
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage: createMemoryStorage(),
    fetchImpl: async () => new Response('{}', { status: 200 })
  });
  try {
    await assert.rejects(
      () => client.signInWithApiToken({ accessToken: '' }),
      error => error instanceof SupabaseAuthError && error.code === 'auth_invalid_token'
    );
  } finally {
    client.shutdown();
  }
});

test('signInWithPassword adds guidance for invalid credentials', async () => {
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage: createMemoryStorage(),
    fetchImpl: async () => new Response(JSON.stringify({
      error_code: 'invalid_credentials',
      error_description: 'Invalid login credentials'
    }), { status: 400, headers: { 'content-type': 'application/json' } })
  });
  try {
    await assert.rejects(
      () => client.signInWithPassword({ email: 'demo@example.com', password: 'wrong' }),
      error => error instanceof SupabaseAuthError
        && error.code === 'auth_sign_in_failed'
        && /Supabase Authentication > Users/.test(error.message)
    );
  } finally {
    client.shutdown();
  }
});

test('signInWithPassword rejects missing credentials', async () => {
  const client = createSupabaseAuthClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    storage: createMemoryStorage(),
    fetchImpl: async () => new Response('{}', { status: 200 })
  });
  try {
    await assert.rejects(
      () => client.signInWithPassword({ email: '', password: '' }),
      error => error instanceof SupabaseAuthError && error.code === 'auth_invalid_credentials'
    );
  } finally {
    client.shutdown();
  }
});
