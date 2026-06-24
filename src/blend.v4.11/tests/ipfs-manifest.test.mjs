import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IPFS_EXPERIENCE_SCHEMA,
  createExperienceManifest,
  manifestToImportPayload,
  validateExperienceManifest
} from '../ipfs-manifest.js';

const VIDEO_CID = 'QmWmyoMoctfbdiQcRVLda5D4gA7D6Drb5St9Qf7N9YJ5dA';
const IMAGE_CID = 'bafybeigdyrztxylh2xy7q5xzd3b3b6xq5lqk2cj4a6q7d4rjvnxcny';

function sampleManifest() {
  return createExperienceManifest({
    appVersion: '4.9',
    experienceId: 'exp-local',
    experienceTitle: 'Friday Set',
    settings: {
      opacity: 0.4,
      defaultImageDuration: 5,
      resumeOnLoad: true,
      ipfsKuboApiEndpoint: 'http://127.0.0.1:5001'
    },
    listMeta: {
      playlist: { name: 'Main playlist', description: 'Audio base', createdAt: '2026-06-19T12:00:00.000Z' },
      slideshow: { name: 'Visuals', description: 'Images', createdAt: '2026-06-19T12:00:00.000Z' }
    },
    playlist: [{ id: 'video-1', name: 'clip.mp4', addedAt: '2026-06-19T12:01:00.000Z' }],
    slideshow: [{ id: 'image-1', name: 'slide.png', displayDuration: 7, addedAt: '2026-06-19T12:02:00.000Z' }],
    uploadedItems: [
      {
        id: 'video-1',
        cid: VIDEO_CID,
        type: 'video',
        mimeType: 'video/mp4',
        byteSize: 1234,
        name: 'clip.mp4',
        metadata: {
          title: 'Clip',
          localPath: 'C:/Users/me/private/clip.mp4',
          ipfs: {
            cid: VIDEO_CID,
            signature: 'clip.mp4|1234|1781822400000|video/mp4|video'
          },
          signature: 'clip.mp4|1234|1781822400000|video/mp4|video',
          token: 'do-not-publish'
        }
      },
      {
        id: 'image-1',
        cid: IMAGE_CID,
        type: 'image',
        mimeType: 'image/png',
        byteSize: 4321,
        name: 'slide.png',
        metadata: { caption: 'Opening slide' }
      }
    ]
  });
}

test('creates and validates a versioned IPFS experience manifest', () => {
  const manifest = sampleManifest();
  assert.equal(manifest.schema, IPFS_EXPERIENCE_SCHEMA);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.items.length, 2);
  assert.equal(manifest.lists.playlist.items.length, 1);
  assert.equal(manifest.lists.slideshow.items[0].displayDuration, 7);
  assert.equal(manifest.playbackSettings.resumeOnLoad, false);

  const validation = validateExperienceManifest(manifest);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(validation.manifest.items[0].metadata.title, 'Clip');
  assert.equal(validation.manifest.items[0].metadata.localPath, undefined);
  assert.equal(validation.manifest.items[0].metadata.ipfs, undefined);
  assert.equal(validation.manifest.items[0].metadata.signature, undefined);
  assert.equal(validation.manifest.items[0].metadata.token, undefined);
});

test('strips path-like labels before manifest data becomes public', () => {
  const manifest = createExperienceManifest({
    experienceTitle: 'Portable Set',
    playlist: [{ id: 'video-1', name: 'C:\\Users\\me\\Videos\\clip.mp4' }],
    slideshow: [],
    uploadedItems: [{
      id: 'video-1',
      cid: VIDEO_CID,
      type: 'video',
      mimeType: 'video/mp4',
      byteSize: 1234,
      name: 'C:\\Users\\me\\Videos\\clip.mp4',
      title: 'C:\\Users\\me\\Videos\\clip.mp4'
    }]
  });

  assert.equal(manifest.items[0].name, 'clip.mp4');
  assert.equal(manifest.items[0].title, 'clip.mp4');
  assert.equal(manifest.lists.playlist.items[0].title, 'clip.mp4');
});

test('rejects malformed manifests and unsafe item declarations', () => {
  const manifest = sampleManifest();
  manifest.items[0].cid = 'not-a-cid';
  manifest.items[1].mimeType = 'text/html';
  manifest.lists.playlist.items[0].cid = IMAGE_CID;
  manifest.lists.playlist.items[0].type = 'image';

  const validation = validateExperienceManifest(manifest);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /invalid CID/);
  assert.match(validation.errors.join('\n'), /unsafe MIME/);
  assert.match(validation.errors.join('\n'), /Playlist entry/);
});

test('rejects mismatched list CIDs, declared types, and oversize items', () => {
  const manifest = sampleManifest();
  manifest.items[0].byteSize = 99;
  manifest.lists.playlist.items[0].cid = IMAGE_CID;
  manifest.lists.playlist.items[0].type = 'video';

  const validation = validateExperienceManifest(manifest, { maxItemBytes: 50 });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /exceeds the configured item size limit/);
  assert.match(validation.errors.join('\n'), /itemId does not match its CID/);
  assert.match(validation.errors.join('\n'), /type does not match its referenced item/);
  assert.match(validation.errors.join('\n'), /Playlist entry/);
});

test('converts a validated manifest into import payload records', () => {
  const payload = manifestToImportPayload(sampleManifest());
  assert.equal(payload.name, 'Friday Set');
  assert.equal(payload.libraryItems.length, 2);
  assert.equal(payload.libraryItems[0].sourceUrl, `ipfs://${VIDEO_CID}`);
  assert.equal(payload.playlistEntries[0].sourceUrl, `ipfs://${VIDEO_CID}`);
  assert.equal(payload.slideshowEntries[0].displayDuration, 7);
  assert.equal(payload.settings.resumeOnLoad, false);
});

test('creates and imports URL-backed manifest entries without media CIDs', () => {
  const sourceUrl = 'https://media.example.test/nyc/clip.mp4';
  const manifest = createExperienceManifest({
    experienceTitle: 'Remote Set',
    playlist: [{ id: 'remote-video', name: 'clip.mp4', sourceUrl }],
    slideshow: [{ id: 'remote-video', name: 'clip.mp4', sourceUrl, includeAudio: false }],
    uploadedItems: [{
      id: 'remote-video',
      sourceUrl,
      type: 'video',
      mimeType: 'video/mp4',
      name: 'clip.mp4',
      title: 'Clip'
    }]
  });

  const validation = validateExperienceManifest(manifest);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(validation.manifest.items[0].cid, undefined);
  assert.equal(validation.manifest.items[0].sourceUrl, sourceUrl);
  assert.equal(validation.manifest.lists.playlist.items[0].sourceUrl, sourceUrl);

  const payload = manifestToImportPayload(validation.manifest);
  assert.equal(payload.libraryItems[0].sourceUrl, sourceUrl);
  assert.equal(payload.playlistEntries[0].sourceUrl, sourceUrl);
  assert.equal(payload.slideshowEntries[0].sourceUrl, sourceUrl);
});
