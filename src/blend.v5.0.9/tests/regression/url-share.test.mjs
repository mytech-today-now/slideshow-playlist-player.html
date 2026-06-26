import test from 'node:test';
import assert from 'node:assert/strict';

import {
  URL_SHARE_PARAM,
  URL_SHARE_PARAM_ALIAS,
  URL_SHARE_SIZE_LIMIT,
  URL_MAX_LENGTH,
  compressExperience,
  decompressExperience,
  estimateShareUrlSize,
  checkUrlLength,
  uint8ToBase64Url,
  base64UrlToUint8,
  sanitizeBase64UrlInput
} from '../../url-share.js';

// ---- constants --------------------------------------------------------------

test('URL_SHARE_PARAM is "experience"', () => {
  assert.equal(URL_SHARE_PARAM, 'experience');
});

test('URL_SHARE_PARAM_ALIAS is "data"', () => {
  assert.equal(URL_SHARE_PARAM_ALIAS, 'data');
});

test('URL_SHARE_SIZE_LIMIT is 524288 (500 KiB)', () => {
  assert.equal(URL_SHARE_SIZE_LIMIT, 524288);
});

// ---- Base64URL encoding / decoding ------------------------------------------

test('uint8ToBase64Url produces URL-safe Base64 without padding', () => {
  const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
  const result = uint8ToBase64Url(bytes);
  assert.equal(result, 'SGVsbG8');
  assert.ok(!result.includes('+'), 'no + characters');
  assert.ok(!result.includes('/'), 'no / characters');
  assert.ok(!result.includes('='), 'no padding characters');
});

test('base64UrlToUint8 decodes correctly without explicit padding', () => {
  const decoded = base64UrlToUint8('SGVsbG8');
  assert.deepEqual(Array.from(decoded), [72, 101, 108, 108, 111]);
});

test('uint8ToBase64Url → base64UrlToUint8 is a lossless roundtrip', () => {
  const original = new Uint8Array(256);
  for (let i = 0; i < 256; i++) original[i] = i;
  const encoded = uint8ToBase64Url(original);
  const decoded = base64UrlToUint8(encoded);
  assert.deepEqual(Array.from(decoded), Array.from(original));
});

test('uint8ToBase64Url handles empty array', () => {
  const result = uint8ToBase64Url(new Uint8Array(0));
  assert.equal(result, '');
});

test('base64UrlToUint8 handles standard base64 with + and / characters', () => {
  // Standard base64: "ff//" → bytes [125, 255, 255]
  // URL-safe version: "ff__"
  const decoded = base64UrlToUint8('ff__');
  assert.deepEqual(Array.from(decoded), [125, 255, 255]);
});

test('base64UrlToUint8 handles padded input', () => {
  const withPad = base64UrlToUint8('SGVsbG8=');
  const withoutPad = base64UrlToUint8('SGVsbG8');
  assert.deepEqual(Array.from(withPad), Array.from(withoutPad));
});

test('uint8ToBase64Url handles large arrays (> 8192 bytes)', () => {
  const large = new Uint8Array(20000);
  for (let i = 0; i < large.length; i++) large[i] = i % 256;
  const encoded = uint8ToBase64Url(large);
  const decoded = base64UrlToUint8(encoded);
  assert.deepEqual(Array.from(decoded), Array.from(large));
});

// ---- sanitizeBase64UrlInput -------------------------------------------------

test('sanitizeBase64UrlInput strips surrounding whitespace and newlines', () => {
  const result = sanitizeBase64UrlInput('  SGVsbG8\n  ');
  assert.equal(result, 'SGVsbG8');
});

test('sanitizeBase64UrlInput throws TypeError for non-string input', () => {
  assert.throws(() => sanitizeBase64UrlInput(null), TypeError);
  assert.throws(() => sanitizeBase64UrlInput(42), TypeError);
  assert.throws(() => sanitizeBase64UrlInput(undefined), TypeError);
});

test('sanitizeBase64UrlInput throws for empty input', () => {
  assert.throws(() => sanitizeBase64UrlInput(''), { message: /empty/i });
  assert.throws(() => sanitizeBase64UrlInput('   '), { message: /empty/i });
});

test('sanitizeBase64UrlInput throws for invalid Base64URL characters', () => {
  assert.throws(() => sanitizeBase64UrlInput('hello world!'), { message: /not valid Base64URL/i });
  assert.throws(() => sanitizeBase64UrlInput('abc<script>'), { message: /not valid Base64URL/i });
  assert.throws(() => sanitizeBase64UrlInput('abc%20'), { message: /not valid Base64URL/i });
});

test('sanitizeBase64UrlInput accepts valid Base64URL characters', () => {
  const valid = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  assert.equal(sanitizeBase64UrlInput(valid), valid);
});

test('sanitizeBase64UrlInput throws for oversized input', () => {
  const huge = 'A'.repeat(4194305); // 4 MiB + 1
  assert.throws(() => sanitizeBase64UrlInput(huge), { message: /4 MB safety limit/i });
});

// ---- estimateShareUrlSize ---------------------------------------------------

test('estimateShareUrlSize returns correct character count', () => {
  // 'experience' (10) + '=' (1) + payload length
  const payload = 'SGVsbG8';
  assert.equal(estimateShareUrlSize(payload), 10 + 1 + 7);
});

test('estimateShareUrlSize handles empty string', () => {
  assert.equal(estimateShareUrlSize(''), URL_SHARE_PARAM.length + 1);
});

test('estimateShareUrlSize handles non-string gracefully', () => {
  assert.equal(estimateShareUrlSize(undefined), URL_SHARE_PARAM.length + 1);
});

// ---- compression roundtrip (requires CompressionStream) --------------------
// These tests run only when the native Compression Streams API is available.

const hasCompressionAPI = typeof CompressionStream !== 'undefined';
const maybeTest = hasCompressionAPI ? test : test.skip;

maybeTest('compressExperience → decompressExperience roundtrip (simple)', async () => {
  const experience = {
    version: '5.0.7',
    schema: 'player.blend.experience.v2',
    type: 'experience',
    id: 'test-id',
    name: 'Test Experience',
    settings: { defaultImageDuration: 4.0 },
    library: { order: [], items: [] },
    playlist: { type: 'playlist', order: [], items: [] },
    slideshow: { type: 'slideshow', order: [], items: [] }
  };

  const compressed = await compressExperience(experience);
  assert.equal(typeof compressed, 'string');
  assert.ok(compressed.length > 0, 'compressed string is non-empty');
  assert.ok(!compressed.includes('+'), 'no + in Base64URL');
  assert.ok(!compressed.includes('/'), 'no / in Base64URL');
  assert.ok(!compressed.includes('='), 'no padding');

  const decompressed = await decompressExperience(compressed);
  assert.deepEqual(decompressed, experience);
});

maybeTest('compressExperience produces smaller output than input JSON', async () => {
  const experience = {
    version: '5.0.7',
    schema: 'player.blend.experience.v2',
    type: 'experience',
    id: 'exp-abc',
    name: 'Wedding Playlist',
    settings: { defaultImageDuration: 4.0, playlistVolume: 1.0 },
    library: {
      order: ['id1', 'id2', 'id3'],
      items: [
        { id: 'id1', name: 'video-one.mp4', type: 'video', size: 102400, path: 'C:\\Videos\\video-one.mp4' },
        { id: 'id2', name: 'photo-two.jpg', type: 'image', size: 204800, path: 'C:\\Photos\\photo-two.jpg' },
        { id: 'id3', name: 'audio-three.mp3', type: 'audio', size: 51200, path: 'C:\\Music\\audio-three.mp3' }
      ]
    },
    playlist: { type: 'playlist', order: ['id1', 'id3'], items: [{ id: 'id1' }, { id: 'id3' }] },
    slideshow: { type: 'slideshow', order: ['id2'], items: [{ id: 'id2' }] }
  };

  const compressed = await compressExperience(experience);
  const originalSize = JSON.stringify(experience).length;
  // Base64URL adds ~33% overhead over binary, so the threshold is relaxed.
  // gzip on repetitive JSON typically compresses better than 50%.
  assert.ok(
    compressed.length < originalSize,
    `Compressed (${compressed.length}) should be shorter than original JSON (${originalSize})`
  );
});

maybeTest('decompressExperience round-trips a large experience without data loss', async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({
    id: `item-${i}`,
    name: `file-${i}.mp4`,
    type: i % 3 === 0 ? 'video' : i % 3 === 1 ? 'image' : 'audio',
    size: 1024 * (i + 1),
    path: `C:\\Media\\folder-${Math.floor(i / 10)}\\file-${i}.mp4`,
    sourceUrl: ''
  }));
  const experience = {
    version: '5.0.7',
    schema: 'player.blend.experience.v2',
    type: 'experience',
    id: 'exp-large',
    name: 'Large Experience',
    settings: {},
    library: { order: items.map(x => x.id), items },
    playlist: { type: 'playlist', order: items.slice(0, 25).map(x => x.id), items: items.slice(0, 25).map(x => ({ id: x.id })) },
    slideshow: { type: 'slideshow', order: items.slice(25).map(x => x.id), items: items.slice(25).map(x => ({ id: x.id })) }
  };

  const compressed = await compressExperience(experience);
  const decompressed = await decompressExperience(compressed);
  assert.deepEqual(decompressed.library.items.length, 50);
  assert.equal(decompressed.name, 'Large Experience');
  assert.equal(decompressed.library.items[49].id, 'item-49');
});

maybeTest('compressExperience rejects non-object input', async () => {
  await assert.rejects(() => compressExperience('not an object'), TypeError);
  await assert.rejects(() => compressExperience(null), TypeError);
  await assert.rejects(() => compressExperience(42), TypeError);
});

maybeTest('decompressExperience rejects garbage input', async () => {
  await assert.rejects(() => decompressExperience('AAAA'), Error);
});

maybeTest('decompressExperience rejects invalid Base64URL', async () => {
  await assert.rejects(() => decompressExperience('not!valid@base64'), Error);
});

maybeTest('compressExperience → decompressExperience preserves Unicode content', async () => {
  const experience = {
    type: 'experience',
    name: 'Ünïcödé 🎵 Experience — 日本語',
    library: { items: [{ id: '1', name: 'El Niño & Naïve résumé.mp4' }] }
  };
  const compressed = await compressExperience(experience);
  const decompressed = await decompressExperience(compressed);
  assert.equal(decompressed.name, experience.name);
  assert.equal(decompressed.library.items[0].name, experience.library.items[0].name);
});

// ---- URL_MAX_LENGTH and checkUrlLength (v5.0.9) ----------------------------

test('URL_MAX_LENGTH is 2048', () => {
  assert.equal(URL_MAX_LENGTH, 2048);
});

test('checkUrlLength ok:true for URL within limit', () => {
  const url = 'https://example.com/?experience=' + 'A'.repeat(100);
  const result = checkUrlLength(url);
  assert.equal(result.ok, true);
  assert.equal(result.length, url.length);
  assert.equal(result.limit, 2048);
  assert.equal(result.excess, 0);
  assert.ok(result.pct > 0 && result.pct < 100, 'pct in range 1–99 for a short URL');
});

test('checkUrlLength ok:false for URL over limit', () => {
  const url = 'https://example.com/?experience=' + 'A'.repeat(2100);
  const result = checkUrlLength(url);
  assert.equal(result.ok, false);
  assert.ok(result.length > 2048, 'length > limit');
  assert.ok(result.excess > 0,    'excess > 0');
  assert.ok(result.pct > 100,     'pct > 100 for oversized URL');
});

test('checkUrlLength ok:true for exactly 2048-character URL', () => {
  const url = 'A'.repeat(2048);
  const result = checkUrlLength(url);
  assert.equal(result.ok,     true);
  assert.equal(result.length, 2048);
  assert.equal(result.excess, 0);
  assert.equal(result.pct,    100);
});

test('checkUrlLength ok:false for 2049-character URL', () => {
  const url = 'A'.repeat(2049);
  const result = checkUrlLength(url);
  assert.equal(result.ok,     false);
  assert.equal(result.length, 2049);
  assert.equal(result.excess, 1);
});

test('checkUrlLength handles non-string input gracefully', () => {
  const result = checkUrlLength(undefined);
  assert.equal(result.length, 0);
  assert.equal(result.ok,     true);
  assert.equal(result.excess, 0);
  assert.equal(result.pct,    0);
});

test('checkUrlLength handles null input gracefully', () => {
  const result = checkUrlLength(null);
  assert.equal(result.length, 0);
  assert.equal(result.ok,     true);
});

test('checkUrlLength correctly computes excess for greatly oversized URL', () => {
  const over = 500;
  const url = 'A'.repeat(2048 + over);
  const result = checkUrlLength(url);
  assert.equal(result.ok,     false);
  assert.equal(result.excess, over);
  assert.equal(result.pct,    Math.round(((2048 + over) / 2048) * 100));
});

test('checkUrlLength pct reflects raw ratio (not clamped at 100)', () => {
  const url = 'A'.repeat(4096); // exactly double the limit
  const result = checkUrlLength(url);
  assert.equal(result.pct, 200, 'pct = 200 for a URL exactly 2× the limit');
});

maybeTest('compressed minimal experience fits within URL_MAX_LENGTH', async () => {
  const minimalExp = {
    version: '5.0.9',
    schema: 'player.blend.experience.v2',
    type: 'experience',
    id: 'test',
    name: 'Minimal',
    project: 'Minimal',
    exportedAt: '2026-01-01T00:00:00.000Z',
    settings: { defaultImageDuration: 4.0 },
    library:  { order: [], items: [] },
    playlist: { type: 'playlist',  order: [], items: [] },
    slideshow: { type: 'slideshow', order: [], items: [] }
  };
  const compressed = await compressExperience(minimalExp);
  const fullUrl = 'https://example.com/index.html?' + URL_SHARE_PARAM + '=' + compressed;
  const check = checkUrlLength(fullUrl);
  assert.ok(
    check.ok,
    `Minimal experience URL (${check.length} chars) should fit within ${check.limit} chars`
  );
});
