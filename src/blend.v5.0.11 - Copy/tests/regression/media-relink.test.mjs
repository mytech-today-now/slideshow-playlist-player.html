import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findRelinkCandidates,
  hasSameLibraryMediaIdentity,
  indexRelinkCandidates,
  normalizeRelinkPath
} from '../../media-relink.js';

test('relink paths normalize case and slash direction without merging distinct folders', () => {
  const folderA = { id: 'folder-a', name: 'clip.mp4', pathHint: 'Assets\\A\\Clip.MP4' };
  const folderB = { id: 'folder-b', name: 'clip.mp4', pathHint: 'Assets/B/clip.mp4' };
  const index = indexRelinkCandidates([folderA, folderB]);

  assert.equal(normalizeRelinkPath('ASSETS\\B\\CLIP.MP4'), 'assets/b/clip.mp4');
  assert.deepEqual(index.byBasename.get('clip.mp4'), [folderA, folderB]);
  assert.deepEqual(index.byPath.get('assets/a/clip.mp4'), [folderA]);
  assert.deepEqual(index.byPath.get('assets/b/clip.mp4'), [folderB]);

  const match = findRelinkCandidates(index, { path: 'assets\\b\\CLIP.mp4', basename: 'clip.mp4' });
  assert.equal(match.matchType, 'path');
  assert.deepEqual(match.candidates, [folderB]);
});

test('basename fallback preserves every candidate so ambiguous names cannot overwrite each other', () => {
  const candidates = [
    { id: 'folder-a', name: 'clip.mp4', pathHint: 'Assets/A/clip.mp4' },
    { id: 'folder-b', name: 'clip.mp4', pathHint: 'Assets/B/clip.mp4' }
  ];
  const index = indexRelinkCandidates(candidates);
  const match = findRelinkCandidates(index, { path: 'Legacy/clip.mp4', basename: 'clip.mp4' });

  assert.equal(match.matchType, 'basename');
  assert.deepEqual(match.candidates, candidates);
});

test('absolute and unsafe paths do not become exact relative-path matches', () => {
  assert.equal(normalizeRelinkPath('C:\\Media\\clip.mp4'), '');
  assert.equal(normalizeRelinkPath('../Media/clip.mp4'), '');
  assert.equal(normalizeRelinkPath('https://example.invalid/Media/clip.mp4'), '');
});

test('library identity deduplicates matching source URLs and normalized folder paths only', () => {
  const normalizeSourceUrl = value => String(value || '').trim().toLowerCase();
  const existing = { name: 'clip.mp4', pathHint: 'Assets/A/clip.mp4', sourceUrl: null, size: 8 };

  assert.equal(hasSameLibraryMediaIdentity(existing, {
    name: 'clip.mp4', pathHint: 'assets\\a\\CLIP.MP4', size: 8
  }), true);
  assert.equal(hasSameLibraryMediaIdentity(existing, {
    name: 'clip.mp4', pathHint: 'Assets/B/clip.mp4', size: 8
  }), false);
  assert.equal(hasSameLibraryMediaIdentity({ name: 'clip.mp4', size: 8 }, {
    name: 'clip.mp4', size: 8
  }), false);
  assert.equal(hasSameLibraryMediaIdentity({ name: 'clip.mp4', pathHint: 'clip.mp4', size: 8 }, {
    name: 'clip.mp4', pathHint: 'CLIP.MP4', size: 8
  }), false);
  assert.equal(hasSameLibraryMediaIdentity({ pathHint: 'Assets/clip.mp4' }, {
    pathHint: 'Assets/clip.mp4'
  }), false);
  assert.equal(hasSameLibraryMediaIdentity({ name: 'clip.mp4' }, {
    name: 'clip.mp4', size: 0
  }), false);
  assert.equal(hasSameLibraryMediaIdentity({
    name: 'clip.mp4', sourceUrl: ' HTTPS://EXAMPLE.INVALID/clip.mp4 '
  }, {
    name: 'clip.mp4', sourceUrl: 'https://example.invalid/clip.mp4'
  }, normalizeSourceUrl), true);
  assert.equal(hasSameLibraryMediaIdentity({
    name: 'clip.mp4', sourceUrl: 'https://example.invalid/other.mp4'
  }, {
    name: 'clip.mp4', sourceUrl: 'https://example.invalid/clip.mp4'
  }), false);
});
