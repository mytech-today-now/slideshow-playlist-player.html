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

test('share serializer passes through non-experience values with nullable options', () => {
  assert.equal(serializeExperienceForShare(null, null), null);
});

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

test('nested absolute paths are omitted from full JSON and compressed shares without changing source metadata', async () => {
  const sentinels = [
    'C:\\Users\\blend-issue05\\private\\windows-secret-05.mp4',
    '\\\\blend-server-issue05\\private-share\\unc-secret-05.mp4',
    '/home/blend-issue05/private/posix-secret-05.mp4',
    '\\blend-issue05\\rooted-secret-05.mp4'
  ];
  const credentialMarker = 'issue05-synthetic-private-token-marker';
  const publicUrl = 'https://cdn.example.test/media/public.mp4?version=7';
  const storageReference = 'supabase://private-media/issue05/video.mp4';
  const record = {
    id: 'issue05-video',
    name: 'Issue 05 video',
    type: 'video',
    path: storageReference,
    fullPath: storageReference,
    sourceUrl: publicUrl,
    metadata: {
      safeLabel: 'Approved project label',
      relativePath: 'media/issue05/video.mp4',
      relativeWindowsPath: 'media\\issue05\\video.mp4',
      storageReference,
      publicUrl,
      nested: {
        privatePath: sentinels[0],
        details: [
          { importedLocation: sentinels[1] },
          { legacySource: sentinels[2] },
          { rootedWindowsPath: sentinels[3] }
        ],
        access_token: credentialMarker,
        signedUrl: `https://fixture.invalid/storage/v1/object/sign/private-media/video.mp4?token=${credentialMarker}`
      }
    }
  };
  const experience = {
    schema: 'player.blend.experience.v2',
    name: 'Issue 05 synthetic export',
    library: { order: [record.id], items: [record] },
    playlist: { items: [{ id: record.id, metadata: { nestedSource: sentinels[0] } }] },
    slideshow: { items: [] }
  };
  const sourceSnapshot = structuredClone(experience);
  let omittedPathCount = 0;
  const trackOmission = () => { omittedPathCount++; };

  const sanitizedRecord = sanitizeMediaRecordForExport(record, {
    storageReference,
    onMetadataPathOmitted: trackOmission
  });
  const fullJsonExport = JSON.stringify({
    schema: 'player.blend.library.v1',
    items: [sanitizedRecord]
  });
  for (const sentinel of sentinels) {
    assert.ok(!fullJsonExport.includes(sentinel), 'full JSON omits every synthetic path sentinel');
  }
  assert.equal(sanitizedRecord.metadata.safeLabel, 'Approved project label');
  assert.equal(sanitizedRecord.metadata.relativePath, 'media/issue05/video.mp4');
  assert.equal(sanitizedRecord.metadata.relativeWindowsPath, 'media\\issue05\\video.mp4');
  assert.equal(sanitizedRecord.metadata.storageReference, storageReference);
  assert.equal(sanitizedRecord.metadata.publicUrl, publicUrl);
  assert.equal(sanitizedRecord.metadata.nested.access_token, undefined);
  assert.equal(sanitizedRecord.metadata.nested.signedUrl, undefined);
  assert.ok(omittedPathCount >= 4, 'sanitizer reports nested path omissions');

  const derivedReferenceRecord = sanitizeMediaRecordForExport({
    id: 'issue05-derived-reference',
    name: 'Issue 05 derived reference',
    type: 'video',
    metadata: {
      storageBucket: 'private-media',
      storagePath: sentinels[0],
      importedLocation: sentinels[1],
      safeLabel: 'Retained reference label'
    }
  }, {
    storageReference: `supabase://private-media/${sentinels[0]}`,
    onMetadataPathOmitted: trackOmission
  });
  assert.ok(stringLeaves(derivedReferenceRecord).every(leaf => sentinels.every(path => !leaf.includes(path))));
  assert.equal(derivedReferenceRecord.metadata.storagePath, undefined);
  assert.equal(derivedReferenceRecord.metadata.storageReference, undefined);
  assert.equal(derivedReferenceRecord.metadata.safeLabel, 'Retained reference label');

  const compact = serializeExperienceForShare(experience, { onMetadataPathOmitted: trackOmission });
  const expanded = deserializeExperienceFromShare(compact);
  const compressed = await compressExperience(experience);
  const decompressed = await decompressExperience(compressed);
  for (const shared of [expanded, decompressed]) {
    const serialized = JSON.stringify(shared);
    const leaves = stringLeaves(shared);
    for (const sentinel of sentinels) {
      assert.ok(!serialized.includes(sentinel), 'compressed share omits every synthetic path sentinel');
      assert.ok(leaves.every(leaf => !leaf.includes(sentinel)), 'no nested string leaf contains a path sentinel');
    }
    assert.ok(leaves.every(leaf => !leaf.includes(credentialMarker)), 'no nested string leaf contains the credential marker');
    assert.equal(shared.library.items[0].metadata.safeLabel, 'Approved project label');
    assert.equal(shared.library.items[0].metadata.relativePath, 'media/issue05/video.mp4');
    assert.equal(shared.library.items[0].metadata.storageReference, storageReference);
    assert.equal(shared.library.items[0].metadata.publicUrl, publicUrl);
  }
  assert.deepEqual(experience, sourceSnapshot, 'serialization leaves the imported source data unchanged');
});

