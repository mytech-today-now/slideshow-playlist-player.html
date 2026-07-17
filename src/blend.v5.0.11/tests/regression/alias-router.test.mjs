import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../alias-router.js');

const router = globalThis.BlendAliasRouter;
const baseUrl = 'https://example.test/app/index.html';

function manifest(aliases) {
  return router.normalizeAliasManifest({
    schema: router.DEFAULT_SCHEMA,
    version: 1,
    generatedAt: '2026-07-10T00:00:00.000Z',
    aliases
  }, { baseUrl });
}

test('exact navigation aliases preserve query and hash', () => {
  const normalized = manifest([
    {
      id: 'legacy',
      from: './legacy',
      to: './index.html',
      match: 'exact',
      preserveQuery: true,
      preserveHash: true
    }
  ]);

  const result = router.resolveAlias('https://example.test/app/legacy?deck=summer#slide-3', normalized.aliases, { baseUrl });
  assert.equal(result.matched, true);
  assert.equal(result.url.pathname, '/app/index.html');
  assert.equal(result.url.search, '?deck=summer');
  assert.equal(result.url.hash, '#slide-3');
});

test('canonical target query wins unless mergeQuery is enabled', () => {
  const normalized = manifest([
    {
      id: 'target-query',
      from: './legacy',
      to: './index.html?fixed=1',
      preserveQuery: true
    }
  ]);

  const result = router.resolveAlias('https://example.test/app/legacy?deck=summer', normalized.aliases, { baseUrl });
  assert.equal(result.url.pathname, '/app/index.html');
  assert.equal(result.url.search, '?fixed=1');
});

test('prefix aliases preserve the unmatched path suffix', () => {
  const normalized = manifest([
    {
      id: 'prefix',
      from: './old',
      to: './new',
      match: 'prefix'
    }
  ]);

  const result = router.resolveAlias('https://example.test/app/old/folder/item', normalized.aliases, { baseUrl });
  assert.equal(result.matched, true);
  assert.equal(result.url.pathname, '/app/new/folder/item');
});

test('disabled and expired aliases are ignored', () => {
  const normalized = manifest([
    {
      id: 'disabled',
      from: './legacy',
      to: './disabled.html',
      enabled: false,
      priority: 100
    },
    {
      id: 'expired',
      from: './legacy',
      to: './expired.html',
      expiresAt: '2020-01-01T00:00:00.000Z',
      priority: 90
    },
    {
      id: 'active',
      from: './legacy',
      to: './index.html',
      priority: 1
    }
  ]);

  const result = router.resolveAlias('https://example.test/app/legacy', normalized.aliases, { baseUrl });
  assert.equal(result.matched, true);
  assert.equal(result.url.pathname, '/app/index.html');
});

test('unsafe cross-origin targets are rejected', () => {
  assert.throws(() => manifest([
    {
      id: 'external',
      from: './legacy',
      to: 'https://evil.example/index.html'
    }
  ]), /allowed origin/);
});

test('alias loops are rejected during manifest validation', () => {
  assert.throws(() => manifest([
    {
      id: 'a',
      from: './a',
      to: './b'
    },
    {
      id: 'b',
      from: './b',
      to: './a'
    }
  ]), /loop/);
});
