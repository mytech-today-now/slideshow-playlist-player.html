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
  assert.ok(required.has('./analytics-consent.js?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./analytics-event-params.js?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./experience-persistence.js?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./indexeddb-open.js?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./local-import-limits.js?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./media-relink.js?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./shared-experience-download.js?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./save-state.js?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./url-share.js?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./playback-mode.js'));
  assert.ok(required.has('./resume-on-load.js?v=20260927-v5.0.11-resume'));
  assert.ok(required.has('./pwa-config.js'));
  assert.ok(required.has('./pwa-client.js'));
  assert.ok(required.has('./alias-router.js'));
  assert.ok(required.has('./manifest.webmanifest?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./icon.svg?v=' + config.ASSET_VERSION));
  assert.ok(required.has('./icon-maskable.svg?v=' + config.ASSET_VERSION));
});

test('same-folder README is precached in the documentation cache for offline help', () => {
  assert.ok(config.PRECACHE_OPTIONAL.includes('./README.md'));
});

test('both manifests use versioned root icons and the worker skips legacy asset icon paths', async () => {
  for (const manifestName of ['manifest.webmanifest', 'manifest.json']) {
    const manifest = JSON.parse(await readFile(new URL(manifestName, root), 'utf8'));
    assert.equal(manifest.icons.length, 2);
    for (const icon of manifest.icons) {
      const iconFile = icon.purpose === 'maskable' ? 'icon-maskable.svg' : 'icon.svg';
      assert.equal(icon.src, `./${iconFile}?v=${config.ASSET_VERSION}`);
      const manifestUrl = new URL(manifestName, 'https://blend.example.test/');
      assert.equal(new URL(icon.src, manifestUrl).pathname, `/${iconFile}`);
      await readFile(new URL(iconFile, root));
    }
  }

  assert.equal(config.PRECACHE_OPTIONAL.includes('./assets/icon.svg'), false);
  assert.equal(config.PRECACHE_OPTIONAL.includes('./assets/icon-maskable.svg'), false);
});

test('HTML shell uses manifest.webmanifest and the configured asset version', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const app = await readFile(new URL('app.js', root), 'utf8');
  assert.ok(html.includes(`<link rel="manifest" href="./manifest.webmanifest?v=${config.ASSET_VERSION}">`));
  assert.match(html, new RegExp(`styles\\.css\\?v=${config.ASSET_VERSION}`));
  assert.match(html, new RegExp(`app\\.js\\?v=${config.ASSET_VERSION}`));
  assert.match(app, new RegExp(`analytics-consent\\.js\\?v=${config.ASSET_VERSION}`));
  assert.match(app, new RegExp(`media-relink\\.js\\?v=${config.ASSET_VERSION}`));
  assert.match(app, new RegExp(`indexeddb-open\\.js\\?v=${config.ASSET_VERSION}`));
  assert.match(app, new RegExp(`url-share\\.js\\?v=${config.ASSET_VERSION}`));
  assert.match(html, new RegExp(`content="${config.APP_VERSION}"`));
});
