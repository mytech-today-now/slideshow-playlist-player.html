import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpaqueToken,
  createRateLimiter,
  createRecoveryKeys,
  githubExperiencePath,
  hashSecret,
  isSameOrNewerRevision,
  normalizeAllowedOrigins,
  normalizeProfileGuid,
  profileSyncCookieHeader,
  safeEqualHex,
  stableJsonStringify,
  validateExperienceDocument
} from '../../server/profile-sync-core.mjs';

const GUID = '123e4567-e89b-42d3-a456-426614174000';
const PEPPER = 'synthetic-test-pepper-value-that-is-long-enough';

function experience(overrides = {}) {
  return {
    version: '5.0.11',
    schema: 'player.blend.experience.v2',
    type: 'experience',
    id: 'exp-test',
    name: 'Synthetic Experience',
    settings: { futureSetting: { keep: true } },
    library: { items: [{ id: 'media-1', sourceUrl: 'https://media.example.test/a.mp4', metadata: { label: 'fixture' } }] },
    playlist: { items: [{ id: 'media-1', itemExtension: ['keep', 'this'] }] },
    slideshow: { items: [] },
    vendorExtension: { nested: ['data'] },
    ...overrides
  };
}

test('validates UUIDs before constructing the one allowed GitHub path', () => {
  assert.equal(normalizeProfileGuid(GUID), GUID);
  assert.equal(normalizeProfileGuid(GUID.toUpperCase()), GUID);
  assert.equal(githubExperiencePath(GUID), `experiences/${GUID}/experience.json`);
  for (const invalid of ['', '../experience.json', 'not-a-guid', '123e4567-e89b-02d3-a456-426614174000', '123e4567-e89b-42d3-7456-426614174000']) {
    assert.throws(() => normalizeProfileGuid(invalid), { code: 'profile_guid_invalid' });
    assert.throws(() => githubExperiencePath(invalid), { code: 'profile_guid_invalid' });
  }
});

test('accepts exact HTTPS app origins and rejects paths, wildcards, and HTTP origins', () => {
  assert.deepEqual(Array.from(normalizeAllowedOrigins('https://blend.example.test, https://www.blend.example.test')), [
    'https://blend.example.test',
    'https://www.blend.example.test'
  ]);
  for (const invalid of ['*', 'https://blend.example.test/path', 'http://localhost:4173', 'https://user:pass@blend.example.test']) {
    assert.throws(() => normalizeAllowedOrigins(invalid), { code: 'profile_sync_origin_config_invalid' });
  }
});

test('validates the Experience schema and preserves complete JSON extension fields', () => {
  const original = experience();
  const stored = validateExperienceDocument(original);
  assert.deepEqual(stored, original);
  assert.deepEqual(stored.vendorExtension, original.vendorExtension);
  assert.deepEqual(stored.library.items[0].metadata, original.library.items[0].metadata);
  assert.throws(() => validateExperienceDocument([]), { code: 'experience_invalid' });
  assert.throws(() => validateExperienceDocument({ ...original, schema: 'wrong' }), { code: 'experience_schema_invalid' });
  assert.throws(() => validateExperienceDocument(original, 20), { code: 'experience_too_large' });
});

test('stable JSON comparison ignores object key order and preserves array order', () => {
  assert.equal(stableJsonStringify({ z: 1, a: { b: 2, a: 3 } }), '{"a":{"a":3,"b":2},"z":1}');
  assert.equal(stableJsonStringify({ a: [1, 2] }), stableJsonStringify({ a: [1, 2] }));
  assert.notEqual(stableJsonStringify({ a: [1, 2] }), stableJsonStringify({ a: [2, 1] }));
});

test('hashes and compares secrets without accepting weak peppers or malformed hashes', () => {
  const hash = hashSecret('synthetic-device-secret', PEPPER);
  assert.equal(hash.length, 64);
  assert.equal(safeEqualHex(hash, hash), true);
  assert.equal(safeEqualHex(hash, '00'), false);
  assert.throws(() => hashSecret('synthetic-device-secret', 'short'), { code: 'profile_sync_pepper_missing' });
});

test('creates high-entropy one-use recovery and bearer tokens', () => {
  let counter = 0;
  const randomBytesFn = size => Buffer.alloc(size, ++counter);
  const keys = createRecoveryKeys(randomBytesFn);
  assert.equal(keys.length, 10);
  assert.equal(new Set(keys).size, 10);
  assert.ok(keys.every(key => /^BLD1-[A-Za-z0-9_-]{27}$/.test(key)));
  assert.match(createOpaqueToken(32, randomBytesFn), /^[A-Za-z0-9_-]{43}$/);
});

test('requires HTTPS for a Secure HttpOnly cookie and validates SameSite configuration', () => {
  const request = { headers: { 'x-forwarded-proto': 'https' } };
  const cookie = profileSyncCookieHeader(request, 'a'.repeat(43));
  assert.match(cookie, /Path=\/api\/profile-sync/);
  assert.match(cookie, /Max-Age=2592000/);
  assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/);
  assert.match(profileSyncCookieHeader(request, '', { maxAge: 0, sameSite: 'None' }), /Max-Age=0; Secure; HttpOnly; SameSite=None/);
  assert.throws(() => profileSyncCookieHeader({ headers: { 'x-forwarded-proto': 'http' } }, 'x'), { code: 'profile_sync_https_required' });
  assert.throws(() => profileSyncCookieHeader(request, 'x', { sameSite: 'Invalid' }), { code: 'profile_sync_cookie_config_invalid' });
});

test('uses monotonic revision comparisons and enforces rate limits per key', () => {
  assert.equal(isSameOrNewerRevision('10', '9'), true);
  assert.equal(isSameOrNewerRevision('8', '9'), false);
  assert.equal(isSameOrNewerRevision('bad', '1'), false);
  let now = 100;
  const check = createRateLimiter({ limit: 2, windowMs: 50, now: () => now });
  assert.equal(check('fixture'), true);
  assert.equal(check('fixture'), true);
  assert.equal(check('fixture'), false);
  now = 151;
  assert.equal(check('fixture'), true);
});
