import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compactAliasSnapshot,
  validateAliasManifestForStore
} from '../../alias-store.js';

const baseUrl = 'https://example.test/app/index.html';

function sampleManifest(version = 2) {
  return {
    schema: 'blend.aliases.v1',
    version,
    generatedAt: '2026-07-10T00:00:00.000Z',
    aliases: [
      {
        id: 'legacy',
        from: './legacy',
        to: './index.html',
        match: 'exact',
        preserveQuery: true,
        preserveHash: true,
        enabled: true,
        priority: 10
      }
    ]
  };
}

test('alias store validation normalizes entries for persistence', () => {
  const normalized = validateAliasManifestForStore(sampleManifest(), { baseUrl });
  assert.equal(normalized.version, 2);
  assert.equal(normalized.aliases[0].from, '/app/legacy');
  assert.equal(normalized.aliases[0].to, '/app/index.html');
});

test('alias store rejects manifest downgrades by default', () => {
  assert.throws(() => validateAliasManifestForStore(sampleManifest(1), {
    baseUrl,
    currentVersion: 2
  }), /downgrade/);
});

test('alias store can allow explicit rollback downgrades', () => {
  const normalized = validateAliasManifestForStore(sampleManifest(1), {
    baseUrl,
    currentVersion: 2,
    allowDowngrade: true
  });
  assert.equal(normalized.version, 1);
});

test('compact alias snapshots are structured clone friendly', () => {
  const snapshot = compactAliasSnapshot(sampleManifest());
  assert.equal(snapshot.schema, 'blend.aliases.v1');
  assert.equal(snapshot.aliases[0].id, 'legacy');
  assert.equal(Object.isFrozen(snapshot), false);
});
