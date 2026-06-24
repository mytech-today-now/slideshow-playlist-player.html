import test from 'node:test';
import assert from 'node:assert/strict';

import {
  StorageResolverError,
  createStorageUrlResolver,
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
