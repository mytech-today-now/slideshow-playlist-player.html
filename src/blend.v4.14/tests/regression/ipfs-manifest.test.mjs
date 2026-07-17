import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IPFS_EXPERIENCE_SCHEMA,
  createExperienceManifest,
  manifestToImportPayload,
  validateExperienceManifest
} from '../../ipfs-manifest.js';

test('builds and validates a shareable manifest with private metadata stripped', () => {
  const uploadedItems = [
    {
      id: 'item-1',
      cid: 'bafybeiab47tncsmv4ystfwwh3zujdipnfmgporoahsppz6g22t7uifpfqe',
      type: 'video',
      mimeType: 'video/mp4',
      byteSize: 2600000,
      name: 'nyc-01.mp4',
      metadata: {
        artist: 'A Test Artist',
        fullPath: 'C:\\private\\secret\\nyc-01.mp4',
        token: 'top-secret-token'
      }
    }
  ];

  const manifest = createExperienceManifest({
    appVersion: '4.12',
    experienceId: 'exp-test',
    experienceTitle: 'Regression Manifest',
    settings: { opacity: 0.5, resumeOnLoad: true },
    playlist: [{ id: 'item-1', name: 'nyc-01.mp4' }],
    slideshow: [],
    uploadedItems
  });

  const validation = validateExperienceManifest(manifest);
  assert.equal(validation.ok, true);
  assert.equal(manifest.schema, IPFS_EXPERIENCE_SCHEMA);
  assert.equal(manifest.items.length, 1);
  assert.equal(manifest.items[0].metadata.artist, 'A Test Artist');
  assert.equal('fullPath' in (manifest.items[0].metadata || {}), false);
  assert.equal('token' in (manifest.items[0].metadata || {}), false);
  assert.equal(manifest.playbackSettings.resumeOnLoad, false);
});

test('converts manifest back to import payload with ipfs library entries', () => {
  const manifest = createExperienceManifest({
    appVersion: '4.12',
    experienceId: 'exp-test-2',
    experienceTitle: 'Import Payload Test',
    settings: { effectIntensity: 'subtle' },
    playlist: [{ id: 'video-item', name: 'clip.mp4' }],
    slideshow: [{ id: 'image-item', name: 'cover.jpg', displayDuration: 5 }],
    uploadedItems: [
      {
        id: 'video-item',
        cid: 'bafybeif2ck5j6vuik2v5jzff6jfb4aqv4f6kugujc6c5w5pz2f6wc3l2ha',
        type: 'video',
        mimeType: 'video/mp4',
        byteSize: 1000,
        name: 'clip.mp4'
      },
      {
        id: 'image-item',
        sourceUrl: 'https://cdn.example.test/cover.jpg',
        type: 'image',
        mimeType: 'image/jpeg',
        byteSize: 2000,
        name: 'cover.jpg'
      }
    ]
  });

  const payload = manifestToImportPayload(manifest);
  assert.equal(payload.name, 'Import Payload Test');
  assert.equal(payload.libraryItems.length, 2);
  assert.ok(payload.libraryItems.some(item => item.sourceUrl.startsWith('ipfs://')));
  assert.ok(payload.libraryItems.some(item => item.sourceUrl.startsWith('https://')));
  assert.equal(payload.playlistEntries.length, 1);
  assert.equal(payload.slideshowEntries.length, 1);
});

