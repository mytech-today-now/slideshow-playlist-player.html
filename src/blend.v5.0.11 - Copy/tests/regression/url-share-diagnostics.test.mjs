import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeExperienceSize,
  formatBytes,
  buildSizeBreakdownHtml
} from '../../url-share-diagnostics.js';

// ---- Test fixtures ----------------------------------------------------------

const MINIMAL_EXPERIENCE = {
  version: '5.0.9',
  schema: 'player.blend.experience.v2',
  type: 'experience',
  id: 'test-id',
  name: 'Test',
  project: 'Test',
  exportedAt: '2026-01-01T00:00:00.000Z',
  settings: { defaultImageDuration: 4.0 },
  library:  { order: [], items: [] },
  playlist: { type: 'playlist',  order: [], items: [] },
  slideshow: { type: 'slideshow', order: [], items: [] }
};

function makeExperience(libraryItemCount = 0, pathLength = 30) {
  const items = Array.from({ length: libraryItemCount }, (_, i) => ({
    id:   `item-${i}`,
    name: `file-${i}.mp4`,
    type: i % 3 === 0 ? 'video' : i % 3 === 1 ? 'image' : 'audio',
    size: 1024 * (i + 1),
    path: 'C:\\Media\\' + 'x'.repeat(pathLength) + `\\file-${i}.mp4`
  }));
  return {
    ...MINIMAL_EXPERIENCE,
    library:  { order: items.map(x => x.id), items },
    playlist: { type: 'playlist',  order: items.slice(0, Math.ceil(items.length / 2)).map(x => x.id), items: items.slice(0, Math.ceil(items.length / 2)).map(x => ({ id: x.id })) },
    slideshow: { type: 'slideshow', order: items.slice(Math.ceil(items.length / 2)).map(x => x.id), items: items.slice(Math.ceil(items.length / 2)).map(x => ({ id: x.id })) }
  };
}

// ---- formatBytes ------------------------------------------------------------

test('formatBytes: 0 bytes', () => {
  assert.equal(formatBytes(0), '0 B');
});

test('formatBytes: sub-kilobyte values', () => {
  assert.equal(formatBytes(1),    '1 B');
  assert.equal(formatBytes(512),  '512 B');
  assert.equal(formatBytes(1023), '1023 B');
});

test('formatBytes: kilobyte values', () => {
  assert.equal(formatBytes(1024),       '1.0 KB');
  assert.equal(formatBytes(1536),       '1.5 KB');
  assert.equal(formatBytes(2048),       '2.0 KB');
  assert.equal(formatBytes(1023 * 1024), `${(1023).toFixed(1)} KB`);
});

test('formatBytes: megabyte values', () => {
  assert.equal(formatBytes(1024 * 1024),     '1.00 MB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2.00 MB');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.50 MB');
});

test('formatBytes: invalid inputs return "0 B"', () => {
  assert.equal(formatBytes(-1),       '0 B');
  assert.equal(formatBytes(NaN),      '0 B');
  assert.equal(formatBytes(Infinity), '0 B');
  assert.equal(formatBytes(-Infinity), '0 B');
});

// ---- analyzeExperienceSize --------------------------------------------------

test('analyzeExperienceSize: null/undefined return empty report', () => {
  const r1 = analyzeExperienceSize(null);
  const r2 = analyzeExperienceSize(undefined);
  assert.equal(r1.totalBytes,             0);
  assert.equal(r2.totalBytes,             0);
  assert.deepEqual(r1.largeItems,         []);
  assert.deepEqual(r1.itemCount, { library: 0, playlist: 0, slideshow: 0 });
  assert.equal(r1.estimatedCompressedBytes, 0);
});

test('analyzeExperienceSize: non-object returns empty report', () => {
  assert.equal(analyzeExperienceSize('string').totalBytes, 0);
  assert.equal(analyzeExperienceSize(42).totalBytes,       0);
});

test('analyzeExperienceSize: minimal experience has positive totalBytes', () => {
  const r = analyzeExperienceSize(MINIMAL_EXPERIENCE);
  assert.ok(r.totalBytes > 0, 'totalBytes must be > 0');
});

test('analyzeExperienceSize: all section byte counts are non-negative', () => {
  const r = analyzeExperienceSize(MINIMAL_EXPERIENCE);
  for (const [key, val] of Object.entries(r.sections)) {
    assert.ok(val >= 0, `sections.${key} must be >= 0`);
  }
});

test('analyzeExperienceSize: sections object has expected keys', () => {
  const r = analyzeExperienceSize(MINIMAL_EXPERIENCE);
  for (const key of ['metadata', 'settings', 'library', 'playlist', 'slideshow']) {
    assert.ok(key in r.sections, `sections must contain key: ${key}`);
  }
});

test('analyzeExperienceSize: correct item counts for non-empty experience', () => {
  const exp = makeExperience(6);
  const r   = analyzeExperienceSize(exp);
  assert.equal(r.itemCount.library,   6);
  assert.equal(r.itemCount.playlist,  3);
  assert.equal(r.itemCount.slideshow, 3);
});

test('analyzeExperienceSize: zero items when library is empty', () => {
  const r = analyzeExperienceSize(MINIMAL_EXPERIENCE);
  assert.equal(r.itemCount.library,   0);
  assert.equal(r.itemCount.playlist,  0);
  assert.equal(r.itemCount.slideshow, 0);
  assert.deepEqual(r.largeItems, []);
});

test('analyzeExperienceSize: largeItems capped at 10 entries', () => {
  const exp = makeExperience(30);
  const r   = analyzeExperienceSize(exp);
  assert.ok(r.largeItems.length <= 10, `expected ≤ 10, got ${r.largeItems.length}`);
});

test('analyzeExperienceSize: largeItems sorted by bytes descending', () => {
  // Create items whose sizes differ significantly by varying path length.
  const items = Array.from({ length: 15 }, (_, i) => ({
    id:    `item-${i}`,
    name:  `file-${i}.mp4`,
    type:  'video',
    size:  100,
    extra: 'padding'.repeat(i * 10)  // items at higher index have larger JSON size
  }));
  const exp = { ...MINIMAL_EXPERIENCE, library: { order: items.map(x => x.id), items } };
  const r   = analyzeExperienceSize(exp);
  for (let i = 1; i < r.largeItems.length; i++) {
    assert.ok(
      r.largeItems[i - 1].bytes >= r.largeItems[i].bytes,
      `largeItems[${i - 1}].bytes (${r.largeItems[i - 1].bytes}) must be >= largeItems[${i}].bytes (${r.largeItems[i].bytes})`
    );
  }
});

test('analyzeExperienceSize: largeItems contain id, name, type, bytes', () => {
  const exp = makeExperience(3);
  const r   = analyzeExperienceSize(exp);
  for (const item of r.largeItems) {
    assert.ok('id'    in item, 'item must have id');
    assert.ok('name'  in item, 'item must have name');
    assert.ok('type'  in item, 'item must have type');
    assert.ok('bytes' in item, 'item must have bytes');
    assert.ok(typeof item.bytes === 'number' && item.bytes >= 0);
  }
});

test('analyzeExperienceSize: totalBytes grows with more items', () => {
  const r5  = analyzeExperienceSize(makeExperience(5));
  const r20 = analyzeExperienceSize(makeExperience(20));
  assert.ok(r20.totalBytes > r5.totalBytes, 'more items → larger total');
});

test('analyzeExperienceSize: estimatedCompressedBytes < totalBytes', () => {
  const r = analyzeExperienceSize(makeExperience(20));
  assert.ok(
    r.estimatedCompressedBytes < r.totalBytes,
    `estimated compressed (${r.estimatedCompressedBytes}) should be < total (${r.totalBytes})`
  );
});

test('analyzeExperienceSize: totalBytes >= sum of section bytes', () => {
  const r = analyzeExperienceSize(makeExperience(10));
  const sectionSum = Object.values(r.sections).reduce((s, v) => s + v, 0);
  assert.ok(
    r.totalBytes >= sectionSum,
    `totalBytes (${r.totalBytes}) should be >= section sum (${sectionSum})`
  );
});

test('analyzeExperienceSize: handles missing sections gracefully', () => {
  const partial = { version: '5.0.9', type: 'experience', name: 'Partial' };
  const r = analyzeExperienceSize(partial);
  assert.ok(r.totalBytes > 0);
  assert.equal(r.itemCount.library,   0);
  assert.equal(r.itemCount.playlist,  0);
  assert.equal(r.itemCount.slideshow, 0);
});

// ---- buildSizeBreakdownHtml -------------------------------------------------

test('buildSizeBreakdownHtml: returns non-empty string', () => {
  const r    = analyzeExperienceSize(MINIMAL_EXPERIENCE);
  const html = buildSizeBreakdownHtml(r, 500, 2048);
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0);
});

test('buildSizeBreakdownHtml: includes all section labels', () => {
  const r    = analyzeExperienceSize(MINIMAL_EXPERIENCE);
  const html = buildSizeBreakdownHtml(r, 500, 2048);
  for (const label of ['Metadata', 'Settings', 'Library', 'Playlist', 'Slideshow']) {
    assert.ok(html.includes(label), `HTML must mention section: ${label}`);
  }
});

test('buildSizeBreakdownHtml: escapes HTML special chars in item names', () => {
  const maliciousReport = {
    totalBytes: 2000,
    sections: { metadata: 100, settings: 100, library: 1200, playlist: 300, slideshow: 300 },
    largeItems: [
      { id: 'x', name: '<script>alert("xss")</script>', type: 'video', bytes: 1200 }
    ],
    itemCount: { library: 1, playlist: 0, slideshow: 0 },
    estimatedCompressedBytes: 1000
  };
  const html = buildSizeBreakdownHtml(maliciousReport, 3000, 2048);
  assert.ok(!html.includes('<script>'),        'raw <script> must not appear');
  assert.ok(html.includes('&lt;script&gt;'),   'script tag must be HTML-escaped');
  assert.ok(!html.includes('alert("xss")'),    'JS payload must not appear unescaped');
});

test('buildSizeBreakdownHtml: shows "Tip" when URL exceeds limit', () => {
  const r    = analyzeExperienceSize(MINIMAL_EXPERIENCE);
  const html = buildSizeBreakdownHtml(r, 3000, 2048); // 3000 > 2048
  assert.ok(html.includes('Tip:'), '"Tip" must appear when URL is too long');
});

test('buildSizeBreakdownHtml: hides "Tip" when URL is within limit', () => {
  const r    = analyzeExperienceSize(MINIMAL_EXPERIENCE);
  const html = buildSizeBreakdownHtml(r, 500, 2048); // 500 < 2048
  assert.ok(!html.includes('Tip:'), '"Tip" must not appear when URL is OK');
});

test('buildSizeBreakdownHtml: includes item names when largeItems present', () => {
  const exp = makeExperience(3);
  const r   = analyzeExperienceSize(exp);
  const html = buildSizeBreakdownHtml(r, 3000, 2048);
  assert.ok(html.includes('file-'), 'file names must appear in breakdown');
});

test('buildSizeBreakdownHtml: uses default urlLimit of 2048', () => {
  const r = analyzeExperienceSize(MINIMAL_EXPERIENCE);
  // Calling with only 2 args should not throw
  assert.doesNotThrow(() => buildSizeBreakdownHtml(r, 3000));
  const html = buildSizeBreakdownHtml(r, 3000);
  assert.ok(html.includes('Tip:'), 'default limit 2048 applied when 3rd arg omitted');
});

test('buildSizeBreakdownHtml: shows item type badges', () => {
  const exp = makeExperience(3);
  const r   = analyzeExperienceSize(exp);
  const html = buildSizeBreakdownHtml(r, 500, 2048);
  // At least one of the type badges should appear
  const hasTypeBadge = html.includes('url-diag-item__type');
  assert.ok(hasTypeBadge, 'type badge CSS class must appear');
});
