import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_STORAGE_REQUEST_TIMEOUT_MS,
  SIGNED_URL_SAFETY_MARGIN_MS,
  StorageResolverError,
  createStorageUrlResolver,
  isSignedUrlFresh,
  isSupabaseStorageReference,
  sanitizeSupabaseStorageReference
} from '../../storage-url-resolver.js';

function createAuth(token = 'access-token') {
  return {
    getAccessToken() {
      return token;
    }
  };
}

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const timer = { id: nextId++, at: now + Math.max(0, Number(delay) || 0), callback };
      timers.set(timer.id, timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timers.delete(timer.id);
    },
    async advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers.values()]
          .filter(timer => timer.at <= target)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        now = next.at;
        timers.delete(next.id);
        next.callback();
        await new Promise(resolve => setImmediate(resolve));
      }
      now = target;
      await new Promise(resolve => setImmediate(resolve));
    },
    now: () => now,
    count: () => timers.size
  };
}

function createResolver({ fetchImpl, ...options } = {}) {
  return createStorageUrlResolver({
    config: {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      defaultBucket: 'media',
      publicBucketAllowList: [],
      signedUrlTtlSeconds: 120
    },
    authClient: createAuth('synthetic-access-token'),
    fetchImpl,
    ...options
  });
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

test('signed URL freshness includes the resolver safety margin', () => {
  const now = 1_000_000;
  assert.equal(isSignedUrlFresh(now + SIGNED_URL_SAFETY_MARGIN_MS + 1, now), true);
  assert.equal(isSignedUrlFresh(now + SIGNED_URL_SAFETY_MARGIN_MS, now), false);
  assert.equal(isSignedUrlFresh(now - 1, now), false);
  assert.equal(isSignedUrlFresh('', now), false);
});

test('reuses a cached private signed URL until its safety-adjusted expiry', async () => {
  let now = 1_000_000;
  let signingRequests = 0;
  const resolver = createStorageUrlResolver({
    config: {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      defaultBucket: 'media',
      publicBucketAllowList: [],
      signedUrlTtlSeconds: 120
    },
    authClient: createAuth('jwt-token'),
    now: () => now,
    fetchImpl: async () => {
      signingRequests += 1;
      return new Response(JSON.stringify({
        signedURL: `/storage/v1/object/sign/media/private/item.png?token=${signingRequests}`
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  const first = await resolver.resolve('supabase://media/private/item.png');
  assert.equal(signingRequests, 1);
  assert.match(first.url, /token=1$/);

  now += 30_000;
  const unexpired = await resolver.resolve('supabase://media/private/item.png');
  assert.equal(signingRequests, 1);
  assert.equal(unexpired.url, first.url);

  now = first.expiresAt - SIGNED_URL_SAFETY_MARGIN_MS;
  const expired = await resolver.resolve('supabase://media/private/item.png');
  assert.equal(signingRequests, 2);
  assert.match(expired.url, /token=2$/);
});

test('resolves public supabase URI to public object URL', async () => {
  const resolver = createStorageUrlResolver({
    config: {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      defaultBucket: 'media',
      publicBucketAllowList: ['public'],
      signedUrlTtlSeconds: 120
    },
    authClient: createAuth(''),
    fetchImpl: async () => {
      throw new Error('fetch should not be called for public URL resolution');
    }
  });

  const result = await resolver.resolve('supabase://public/video/trailer.mp4');
  assert.equal(result.signed, false);
  assert.equal(result.url, 'https://example.supabase.co/storage/v1/object/public/public/video/trailer.mp4');
});

test('preserves valid encoded and Unicode storage paths and existing separator normalization', async () => {
  const resolver = createStorageUrlResolver({
    config: {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      defaultBucket: 'media',
      publicBucketAllowList: ['public'],
      signedUrlTtlSeconds: 120
    },
    authClient: createAuth(''),
    fetchImpl: async () => {
      throw new Error('fetch should not be called for public URL resolution');
    }
  });
  const cases = [
    {
      reference: 'supabase://public/folder/space%20name.mp4',
      path: 'folder/space%20name.mp4',
      urlPath: 'folder/space%20name.mp4'
    },
    {
      reference: 'supabase://public/folder/space%20%E2%9C%93.mp4',
      path: 'folder/space%20%E2%9C%93.mp4',
      urlPath: 'folder/space%20%E2%9C%93.mp4'
    },
    {
      reference: 'supabase://public/folder/Rêve%20雪.mp4',
      path: 'folder/R%C3%AAve%20%E9%9B%AA.mp4',
      urlPath: 'folder/R%C3%AAve%20%E9%9B%AA.mp4'
    },
    {
      reference: 'supabase://public/folder/literal-%2520.mp4',
      path: 'folder/literal-%2520.mp4',
      urlPath: 'folder/literal-%2520.mp4'
    },
    {
      reference: 'supabase://public/folder%2Fclip.mp4',
      path: 'folder%2Fclip.mp4',
      urlPath: 'folder/clip.mp4'
    },
    {
      reference: 'supabase://public/folder\\clip.mp4',
      path: 'folder/clip.mp4',
      urlPath: 'folder/clip.mp4'
    },
    {
      reference: 'supabase://public/folder/./../clip.mp4',
      path: 'folder/clip.mp4',
      urlPath: 'folder/clip.mp4'
    }
  ];

  for (const { reference, path, urlPath } of cases) {
    const result = await resolver.resolve(reference);
    assert.equal(result.path, path, reference);
    assert.equal(result.url, `https://example.supabase.co/storage/v1/object/public/public/${urlPath}`, reference);
  }
});

test('rejects malformed percent encoding as a typed invalid reference before any signing request', async () => {
  let fetchCalls = 0;
  const resolver = createResolver({
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ signedURL: '/signed/should-not-run.mp4' }), { status: 200 });
    }
  });
  const invalidReferences = [
    'supabase://media/private/trailing%',
    'supabase://media/private/invalid%GG.mp4',
    'supabase://media/private/incomplete-utf8%E2%9C.mp4',
    { bucket: 'media', path: 'private/object%2.mp4' },
    { storageBucket: 'media', storagePath: 'private/invalid%Q1.mp4' }
  ];

  for (const reference of invalidReferences) {
    await assert.rejects(
      () => resolver.resolve(reference),
      error => {
        assert.ok(error instanceof StorageResolverError);
        assert.equal(error.code, 'invalid_reference');
        assert.equal(error.retryable, false);
        assert.equal(error.message, 'The storage path has invalid percent encoding. Check the URL and try again.');
        assert.doesNotMatch(error.message, /private\/|trailing|invalid%|object/);
        return true;
      }
    );
  }
  assert.equal(fetchCalls, 0);
});

test('rejects empty storage paths with invalid_reference before signing', async () => {
  let fetchCalls = 0;
  const resolver = createResolver({
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('{}', { status: 200 });
    }
  });

  for (const reference of ['supabase://media/', { bucket: 'media', path: '' }]) {
    await assert.rejects(
      () => resolver.resolve(reference),
      error => error instanceof StorageResolverError && error.code === 'invalid_reference'
    );
  }
  assert.equal(fetchCalls, 0);
});

test('resolves private bucket with signed URL', async () => {
  const calls = [];
  const resolver = createStorageUrlResolver({
    config: {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      defaultBucket: 'media',
      publicBucketAllowList: [],
      signedUrlTtlSeconds: 120
    },
    authClient: createAuth('jwt-token'),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        signedURL: '/storage/v1/object/sign/media/private/item.mp4?token=abc'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  const result = await resolver.resolve('supabase://media/private/item.mp4');
  assert.equal(result.signed, true);
  assert.match(result.url, /token=abc$/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/storage\/v1\/object\/sign\/media\/private\/item\.mp4$/);
  assert.equal(calls[0].init.headers.apikey, 'anon');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt-token');
});

test('private signing has a bounded deadline, aborts a stalled fetch, and allows a later retry', async () => {
  const timers = createFakeTimers();
  let requestCount = 0;
  let abortCount = 0;
  let shouldHang = true;
  const resolver = createResolver({
    requestTimeoutMs: 40,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, init) => {
      requestCount += 1;
      if (shouldHang) {
        return new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => {
            abortCount += 1;
            reject(Object.assign(new Error('synthetic private detail'), { name: 'AbortError' }));
          }, { once: true });
        });
      }
      return new Response(JSON.stringify({ signedURL: '/signed/retried.png?token=synthetic' }), { status: 200 });
    }
  });

  const startedAt = timers.now();
  const firstRequest = resolver.resolve('supabase://media/private/stalled.png');
  const firstRequestRejected = assert.rejects(firstRequest, error => {
    assert.ok(error instanceof StorageResolverError);
    assert.equal(error.code, 'storage_request_timeout');
    assert.equal(error.retryable, true);
    assert.doesNotMatch(`${error.message} ${error.cause?.message || ''}`, /synthetic-access-token|synthetic private detail/);
    return true;
  });
  await flushAsyncWork();
  assert.equal(requestCount, 1);
  await timers.advance(40);
  await firstRequestRejected;
  assert.equal(timers.now() - startedAt, 40);
  assert.equal(abortCount, 1);

  shouldHang = false;
  const retried = await resolver.resolve('supabase://media/private/stalled.png');
  assert.equal(requestCount, 2);
  assert.match(retried.url, /token=synthetic$/);
});

test('a slow signing response below the deadline succeeds without aborting', async () => {
  const timers = createFakeTimers();
  let requestSignal = null;
  const resolver = createResolver({
    requestTimeoutMs: 100,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return new Promise(resolve => {
        timers.setTimeout(() => resolve(new Response(JSON.stringify({ signedURL: '/signed/slow.png' }), { status: 200 })), 35);
      });
    }
  });

  const resultPromise = resolver.resolve('supabase://media/private/slow.png');
  await flushAsyncWork();
  await timers.advance(35);
  const result = await resultPromise;
  assert.match(result.url, /\/signed\/slow\.png$/);
  assert.equal(requestSignal.aborted, false);
  assert.equal(timers.count(), 0);
});

test('the signing deadline also covers a stalled response body', async () => {
  const timers = createFakeTimers();
  let requestSignal = null;
  const resolver = createResolver({
    requestTimeoutMs: 40,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return {
        ok: true,
        status: 200,
        json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('body read aborted')), { once: true }))
      };
    }
  });

  const resolution = resolver.resolve('supabase://media/private/stalled-body.png');
  await flushAsyncWork();
  const rejected = assert.rejects(resolution, error => error.code === 'storage_request_timeout' && error.retryable === true);
  await timers.advance(40);
  await rejected;
  assert.equal(requestSignal.aborted, true);
});

test('storage retry backoff stays within the overall request budget', async () => {
  const timers = createFakeTimers();
  let requestCount = 0;
  const resolver = createResolver({
    requestTimeoutMs: 200,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async () => {
      requestCount += 1;
      return new Response('{}', { status: 503 });
    }
  });

  const resolution = resolver.resolve('supabase://media/private/retry-budget.png');
  const resolutionRejected = assert.rejects(resolution, error => error.code === 'storage_request_timeout' && error.retryable === true);
  await flushAsyncWork();
  assert.equal(requestCount, 1);
  await timers.advance(200);
  await resolutionRejected;
  assert.equal(requestCount, 1, 'the next attempt must not begin after the overall deadline');
  assert.equal(timers.count(), 0);
});

test('caller cancellation is distinct from a signing timeout', async () => {
  const timers = createFakeTimers();
  const caller = new AbortController();
  let requestSignal = null;
  const resolver = createResolver({
    requestTimeoutMs: 100,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
      });
    }
  });

  const resolution = resolver.resolve('supabase://media/private/cancel.png', { signal: caller.signal });
  await flushAsyncWork();
  caller.abort();
  await assert.rejects(resolution, error => error.code === 'storage_request_cancelled' && error.retryable === false);
  assert.equal(requestSignal.aborted, true);
  assert.equal(timers.count(), 0);
});

test('default signing request deadline is explicit and finite', () => {
  assert.equal(DEFAULT_STORAGE_REQUEST_TIMEOUT_MS, 15_000);
});

test('throws auth_required when private media has no token', async () => {
  const resolver = createStorageUrlResolver({
    config: {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      defaultBucket: 'media',
      publicBucketAllowList: [],
      signedUrlTtlSeconds: 120
    },
    authClient: createAuth(''),
    fetchImpl: async () => new Response('{}', { status: 200 })
  });

  await assert.rejects(
    () => resolver.resolve('supabase://media/private/item.mp4'),
    error => error instanceof StorageResolverError && error.code === 'auth_required'
  );
});

test('maps legacy ipfs URI into Supabase legacy prefix', async () => {
  const resolver = createStorageUrlResolver({
    config: {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      defaultBucket: 'media',
      publicBucketAllowList: ['media'],
      signedUrlTtlSeconds: 120
    },
    authClient: createAuth(''),
    fetchImpl: async () => new Response('{}', { status: 200 })
  });

  const result = await resolver.resolve('ipfs://bafybeigdyrzt4/sample.mp4', {
    legacyIpfsPrefix: 'legacy/ipfs',
    legacyIpfsVisibility: 'public',
    publicBucketAllowList: ['media']
  });
  assert.equal(result.signed, false);
  assert.match(result.url, /legacy\/ipfs\/bafybeigdyrzt4\/sample\.mp4$/);
});

test('does not treat console source location tokens as supabase references', () => {
  assert.equal(isSupabaseStorageReference('index.html:1 Banner not shown'), false);
  assert.equal(isSupabaseStorageReference('app.js:2882:45'), false);
  assert.equal(sanitizeSupabaseStorageReference('index.html:1 Banner not shown'), '');
  assert.equal(sanitizeSupabaseStorageReference('app.js:2882:45'), '');
});

test('keeps valid colon-delimited supabase shorthand references', () => {
  assert.equal(isSupabaseStorageReference('media:clip.mp4'), true);
  assert.equal(sanitizeSupabaseStorageReference('media:clip.mp4'), 'supabase://media/clip.mp4');
  assert.equal(sanitizeSupabaseStorageReference('media:folder/clip.mp4'), 'supabase://media/folder/clip.mp4');
});
