import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import {
  compressExperience,
  decompressExperience,
  deserializeExperienceFromShare,
  isBearerUrlForExport,
  sanitizeMediaRecordForExport,
  serializeExperienceForShare
} from '../../url-share.js';

const LEGACY_FIXTURE = new URL('../fixtures/legacy-private-media-experience.v2.json', import.meta.url);
const LEGACY_MARKER = 'issue01-legacy-fixture-marker-78d2';

function stringLeaves(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach(entry => stringLeaves(entry, result));
  else if (value && typeof value === 'object') Object.values(value).forEach(entry => stringLeaves(entry, result));
  return result;
}

function assertNoBearerMarker(value, marker) {
  const leaves = stringLeaves(value);
  assert.ok(leaves.every(entry => !entry.includes(marker)), 'no nested string contains the synthetic bearer marker');
  assert.ok(leaves.every(entry => !/[?&](?:access_token|refresh_token|token|signature|sig)=/i.test(entry)), 'no nested URL retains a bearer query');
}

test('media export sanitizer drops signed URLs and credentials but keeps private references and public URLs', async () => {
  const legacy = JSON.parse(await readFile(LEGACY_FIXTURE, 'utf8'));
  const privateRecord = legacy.library.items.find(item => item.id === 'private-video');
  const publicRecord = legacy.library.items.find(item => item.id === 'public-video');

  assert.equal(isBearerUrlForExport(privateRecord.sourceUrl), true);
  assert.equal(isBearerUrlForExport(publicRecord.sourceUrl), false);

  const sanitizedPrivate = sanitizeMediaRecordForExport(privateRecord);
  const sanitizedPublic = sanitizeMediaRecordForExport(publicRecord);
  assertNoBearerMarker(sanitizedPrivate, LEGACY_MARKER);
  assert.equal(sanitizedPrivate.path, 'supabase://private-media/private/video.mp4');
  assert.equal(sanitizedPrivate.fullPath, 'supabase://private-media/private/video.mp4');
  assert.equal(sanitizedPrivate.sourceUrl, undefined);
  assert.equal(sanitizedPrivate.metadata.sourceUrl, undefined);
  assert.equal(sanitizedPrivate.metadata.access_token, undefined);
  assert.equal(sanitizedPrivate.metadata.storageReference, 'supabase://private-media/private/video.mp4');
  assert.equal(sanitizedPrivate.metadata.storageBucket, 'private-media');
  assert.equal(sanitizedPrivate.metadata.storagePath, 'private/video.mp4');
  assert.equal(sanitizedPrivate.metadata.signedUrlExpiresAt, 4102444800000);
  assert.equal(sanitizedPublic.path, 'https://cdn.example.test/media/public.mp4?version=3');
  assert.equal(sanitizedPublic.sourceUrl, 'https://cdn.example.test/media/public.mp4?version=3');

  const exportedExperience = {
    ...legacy,
    library: { ...legacy.library, items: [sanitizedPrivate, sanitizedPublic] },
    playlist: {
      ...legacy.playlist,
      items: legacy.playlist.items.map(item => sanitizeMediaRecordForExport(item))
    }
  };
  assert.equal(exportedExperience.schema, 'player.blend.experience.v2');
  assert.equal(exportedExperience.library.items[0].metadata.storageReference, 'supabase://private-media/private/video.mp4');
  assertNoBearerMarker(exportedExperience, LEGACY_MARKER);
});

test('compressed share sanitizes raw records and round-trips legacy private references', async () => {
  const legacy = JSON.parse(await readFile(LEGACY_FIXTURE, 'utf8'));
  const legacyCompressed = gzipSync(Buffer.from(JSON.stringify(legacy))).toString('base64url');
  const legacyDecoded = await decompressExperience(legacyCompressed);
  assert.deepEqual(legacyDecoded, legacy, 'old gzip JSON share payloads remain import-compatible');

  const compact = serializeExperienceForShare(legacyDecoded);
  const expanded = deserializeExperienceFromShare(compact);
  assert.equal(expanded.schema, 'player.blend.experience.v2');
  assertNoBearerMarker(expanded, LEGACY_MARKER);
  assert.equal(expanded.library.items[0].path, 'supabase://private-media/private/video.mp4');
  assert.equal(expanded.library.items[0].metadata.storageReference, 'supabase://private-media/private/video.mp4');
  assert.equal(expanded.library.items[1].sourceUrl, 'https://cdn.example.test/media/public.mp4?version=3');

  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') return;
  const currentShare = await decompressExperience(await compressExperience(legacyDecoded));
  assertNoBearerMarker(currentShare, LEGACY_MARKER);
  assert.equal(currentShare.library.items[0].metadata.storageReference, 'supabase://private-media/private/video.mp4');
  assert.equal(currentShare.library.items[1].sourceUrl, 'https://cdn.example.test/media/public.mp4?version=3');
});

