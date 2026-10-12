import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySignedMediaUrlCleanup,
  clearSignedMediaElements,
  planSignedMediaUrlCleanup
} from '../../signed-url-cleanup.js';
import { createStorageUrlResolver } from '../../storage-url-resolver.js';

const SIGNED_URL = 'https://project.example.test/storage/v1/object/sign/media/private/clip.mp4?token=synthetic-signed-token';
const STORAGE_REFERENCE = 'supabase://media/private/clip.mp4';

function createAuth(token = 'signed-in-token') {
  return { getAccessToken: () => token };
}

test('clears signed URLs from library, active lists, and saved experiences while retaining portable data and retry resolution', async () => {
  const item = {
    id: 'private-clip',
    sourceUrl: SIGNED_URL,
    pathHint: STORAGE_REFERENCE,
    handle: { remote: true, sourceUrl: SIGNED_URL },
    metadata: {
      sourceUrl: SIGNED_URL,
      signedUrlExpiresAt: Date.now() + 60_000,
      storageReference: STORAGE_REFERENCE,
      storageBucket: 'media',
      storagePath: 'private/clip.mp4',
      curatorNote: 'keep this note'
    }
  };
  const listReference = {
    id: item.id,
    sourceUrl: SIGNED_URL,
    path: STORAGE_REFERENCE,
    metadata: { sourceUrl: SIGNED_URL, signedUrlExpiresAt: item.metadata.signedUrlExpiresAt, storageReference: STORAGE_REFERENCE }
  };
  const savedExperienceReference = {
    id: item.id,
    sourceUrl: SIGNED_URL,
    path: STORAGE_REFERENCE,
    metadata: { sourceUrl: SIGNED_URL, signedUrlExpiresAt: item.metadata.signedUrlExpiresAt, storageReference: STORAGE_REFERENCE }
  };
  const state = {
    library: new Map([[item.id, item]]),
    playlist: [listReference],
    slideshow: [],
    experiences: [{ id: 'saved-experience', payload: { playlist: [savedExperienceReference], slideshow: [] } }]
  };

  const plan = planSignedMediaUrlCleanup(state);
  assert.equal(item.sourceUrl, SIGNED_URL, 'planning does not mutate records');
  assert.equal(plan.signedUrls.has(SIGNED_URL), true);
  assert.equal(plan.clearedIds.has(item.id), true);
  assert.equal(applySignedMediaUrlCleanup(plan), 7);

  for (const record of [item, listReference, savedExperienceReference]) {
    assert.equal(record.sourceUrl, null);
    assert.equal(record.metadata.sourceUrl, undefined);
    assert.equal(record.metadata.storageReference, STORAGE_REFERENCE);
  }
  assert.equal(item.handle.sourceUrl, null);
  assert.equal(item.pathHint, STORAGE_REFERENCE);
  assert.equal(listReference.path, STORAGE_REFERENCE);
  assert.equal(item.metadata.storageBucket, 'media');
  assert.equal(item.metadata.storagePath, 'private/clip.mp4');
  assert.equal(item.metadata.curatorNote, 'keep this note');
  assert.ok(item.metadata.signedUrlExpiresAt, 'expiry metadata remains available for refresh decisions');

  let signingRequests = 0;
  const resolver = createStorageUrlResolver({
    config: {
      supabaseUrl: 'https://project.example.test',
      supabaseAnonKey: 'anon',
      defaultBucket: 'media',
      publicBucketAllowList: [],
      signedUrlTtlSeconds: 120
    },
    authClient: createAuth(),
    fetchImpl: async () => {
      signingRequests++;
      return new Response(JSON.stringify({ signedURL: '/storage/v1/object/sign/media/private/clip.mp4?token=fresh-signed-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  const resolved = await resolver.resolve(item.metadata.storageReference);
  assert.equal(signingRequests, 1);
  assert.match(resolved.url, /token=fresh-signed-token$/);
});

test('preserves signed-looking URLs without expiry metadata and explicitly imported public URLs', () => {
  const publicUrl = 'https://cdn.example.test/public/preview.mp4?version=7';
  const state = {
    library: new Map([
      ['unknown-expiry', { id: 'unknown-expiry', sourceUrl: SIGNED_URL, metadata: { storageReference: STORAGE_REFERENCE } }],
      ['public-url', { id: 'public-url', sourceUrl: publicUrl, metadata: { signedUrlExpiresAt: Date.now() + 60_000 } }]
    ]),
    playlist: [],
    slideshow: [],
    experiences: []
  };

  const plan = planSignedMediaUrlCleanup(state);
  assert.equal(plan.signedUrls.size, 0);
  assert.equal(applySignedMediaUrlCleanup(plan), 0);
  assert.equal(state.library.get('unknown-expiry').sourceUrl, SIGNED_URL);
  assert.equal(state.library.get('public-url').sourceUrl, publicUrl);
});

test('clears expired signed URLs and continues after a media pause failure without logging private data', () => {
  const expiredUrl = SIGNED_URL.replace('clip.mp4', 'expired.mp4').replace('synthetic-signed-token', 'pause-error-secret');
  const state = {
    library: new Map([['expired', {
      id: 'expired',
      sourceUrl: expiredUrl,
      metadata: { sourceUrl: expiredUrl, signedUrlExpiresAt: Date.now() - 1, storageReference: 'supabase://media/private/expired.mp4' }
    }]]),
    playlist: [],
    slideshow: [],
    experiences: []
  };
  const plan = planSignedMediaUrlCleanup(state);
  applySignedMediaUrlCleanup(plan);

  const operations = [];
  const diagnostics = [];
  const failingVideo = {
    tagName: 'VIDEO',
    currentSrc: expiredUrl,
    src: expiredUrl,
    getAttribute: name => name === 'src' ? expiredUrl : null,
    pause() { operations.push('pause'); throw Object.assign(new Error(expiredUrl), { name: 'TypeError' }); },
    removeAttribute(name) { operations.push(`remove:${name}`); this.currentSrc = ''; this.src = ''; },
    load() { operations.push('load'); }
  };
  const healthyImage = {
    tagName: 'IMG',
    currentSrc: expiredUrl,
    getAttribute: name => name === 'src' ? expiredUrl : null,
    removeAttribute(name) { operations.push(`image-remove:${name}`); }
  };

  const cleared = clearSignedMediaElements([failingVideo, healthyImage], {
    signedUrls: plan.signedUrls,
    onCleanupError: detail => diagnostics.push(detail)
  });
  assert.equal(cleared, 2);
  assert.deepEqual(operations, ['pause', 'remove:src', 'load', 'image-remove:src']);
  assert.deepEqual(diagnostics, [{ operation: 'pause', errorName: 'TypeError' }]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /pause-error-secret|private\/expired/);
  assert.equal(state.library.get('expired').sourceUrl, null);
});
