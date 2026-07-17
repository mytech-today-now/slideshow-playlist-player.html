import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import('../../pwa-config.js');

const config = globalThis.BlendPwaConfig;
const root = new URL('../../', import.meta.url);

test('PWA config version matches package metadata', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(config.APP_VERSION, pkg.version);
  assert.equal(config.DB_VERSION, 5);
});

test('cache names are split and include the shared cache version', () => {
  assert.notEqual(config.CACHE_NAMES.shell, config.CACHE_NAMES.static);
  assert.notEqual(config.CACHE_NAMES.static, config.CACHE_NAMES.docs);
  for (const name of Object.values(config.CACHE_NAMES)) {
    assert.ok(name.includes(config.CACHE_VERSION), `${name} includes cache version`);
    assert.equal(config.isBlendCacheName(name), true);
  }
});

test('required precache contains the offline shell and PWA modules', () => {
  const required = new Set(config.PRECACHE_REQUIRED);
  assert.ok(required.has('./index.html'));
  assert.ok(required.has('./offline.html'));
  assert.ok(required.has('./alias-manifest.json'));
  assert.ok(required.has('./pwa-config.js'));
  assert.ok(required.has('./pwa-client.js'));
  assert.ok(required.has('./alias-router.js'));
});

test('HTML shell uses manifest.webmanifest and the configured asset version', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(html, new RegExp(`styles\\.css\\?v=${config.ASSET_VERSION}`));
  assert.match(html, new RegExp(`app\\.js\\?v=${config.ASSET_VERSION}`));
  assert.match(html, new RegExp(`content="${config.APP_VERSION}"`));
});
