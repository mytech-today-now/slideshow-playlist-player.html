import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findRelinkCandidates,
  hasSameLibraryMediaIdentity,
  hasPotentialSameLibraryMediaPath,
  indexRelinkCandidates,
  normalizeRelinkPath
} from '../../media-relink.js';

test('relink paths normalize separators while preserving case and distinct folders', () => {
  const folderA = { id: 'folder-a', name: 'clip.mp4', pathHint: 'Assets\\A\\Clip.MP4' };
  const folderB = { id: 'folder-b', name: 'clip.mp4', pathHint: 'Assets/B/clip.mp4' };
  const index = indexRelinkCandidates([folderA, folderB]);

  assert.equal(normalizeRelinkPath('ASSETS\\B\\CLIP.MP4'), 'ASSETS/B/CLIP.MP4');
  assert.deepEqual(index.byBasename.get('clip.mp4'), [folderA, folderB]);
  assert.deepEqual(index.byPath.get('Assets/A/Clip.MP4'), [folderA]);
  assert.deepEqual(index.byPath.get('Assets/B/clip.mp4'), [folderB]);

  const match = findRelinkCandidates(index, { path: 'Assets\\B\\clip.mp4', basename: 'clip.mp4' });
  assert.equal(match.matchType, 'path');
  assert.deepEqual(match.candidates, [folderB]);

  const caseDistinct = findRelinkCandidates(index, { path: 'assets\\b\\CLIP.mp4', basename: 'clip.mp4' });
  assert.equal(caseDistinct.matchType, 'basename');
  assert.deepEqual(caseDistinct.candidates, [folderA, folderB]);
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

test('library identity requires a matching root and exact-case relative path for local files', () => {
  const normalizeSourceUrl = value => String(value || '').trim().toLowerCase();
  const existing = {
    name: 'clip.mp4',
    pathHint: 'Assets/A/clip.mp4',
    directoryId: 'dir-root-a',
    sourceUrl: null,
    size: 8
  };

  assert.equal(hasSameLibraryMediaIdentity(existing, {
    name: 'clip.mp4', pathHint: 'Assets\\A\\clip.mp4', directoryId: 'dir-root-a', size: 8
  }), true);
  assert.equal(hasSameLibraryMediaIdentity(existing, {
    name: 'clip.mp4', pathHint: 'Assets/A/clip.mp4', directoryId: 'dir-root-b', size: 8
  }), false);
  assert.equal(hasSameLibraryMediaIdentity(existing, {
    name: 'clip.mp4', pathHint: 'Assets/A/Clip.mp4', directoryId: 'dir-root-a', size: 8
  }), false);
  assert.equal(hasPotentialSameLibraryMediaPath(existing, {
    name: 'clip.mp4', pathHint: 'Assets/A/Clip.mp4', directoryId: 'dir-root-a'
  }), true, 'case-only matches are surfaced as possible duplicates but are not merged');
  assert.equal(hasSameLibraryMediaIdentity(existing, {
    name: 'clip.mp4', pathHint: 'Assets/A/clip.mp4', size: 8
  }), false, 'legacy records without root identity do not merge by path alone');
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
    name: 'clip.mp4', pathHint: 'Assets/A/clip.mp4', directoryId: 'dir-root-a'
  }, {
    name: 'clip.mp4', sourceUrl: ' HTTPS://EXAMPLE.INVALID/clip.mp4 '
  }, normalizeSourceUrl), false, 'a URL identity cannot collide with a local path identity');
  assert.equal(hasSameLibraryMediaIdentity({
    name: 'clip.mp4', sourceUrl: 'https://example.invalid/other.mp4'
  }, {
    name: 'clip.mp4', sourceUrl: 'https://example.invalid/clip.mp4'
  }), false);
});
