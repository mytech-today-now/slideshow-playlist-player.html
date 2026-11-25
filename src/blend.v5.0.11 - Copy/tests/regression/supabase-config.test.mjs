import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  clearBlendRuntimeConfig,
  getBlendRuntimeConfig,
  readPendingBlendRuntimeConfig,
  saveBlendRuntimeConfig
} from '../../supabase-config.js';

const RUNTIME_CONFIG_KEY = 'blend-runtime-config-v1';
const TAB_CONFIG_KEY = 'blend-runtime-config-tab-v1';
const REVIEW_KEY = 'blend-runtime-config-review-v1';
const APP_ORIGIN = 'https://blend.example.test';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    failRead: false,
    failWrite: false,
    getItem(key) {
      if (this.failRead) throw new Error('storage read denied');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (this.failWrite) throw new Error('storage write denied');
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function setRuntimeSources(t, {
  globalConfig = {},
  localConfig = null,
  localRaw = undefined,
  sessionStorage = createStorage(),
  origin = APP_ORIGIN
} = {}) {
  const names = ['BLEND_RUNTIME_CONFIG', '__BLEND_RUNTIME_CONFIG__', 'localStorage', 'sessionStorage', 'location'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const localStorage = createStorage();
  if (localRaw !== undefined) localStorage.values.set(RUNTIME_CONFIG_KEY, localRaw);
  else if (localConfig !== null) localStorage.values.set(RUNTIME_CONFIG_KEY, JSON.stringify(localConfig));
  Object.defineProperty(globalThis, 'BLEND_RUNTIME_CONFIG', {
    configurable: true,
    writable: true,
    value: globalConfig
  });
  Object.defineProperty(globalThis, '__BLEND_RUNTIME_CONFIG__', {
    configurable: true,
    writable: true,
    value: undefined
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: sessionStorage });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin, href: `${origin}/index.html` }
  });
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { localStorage, sessionStorage };
}

test('unconfigured Supabase defaults and example files contain no project credentials', async t => {
  setRuntimeSources(t);
  const config = getBlendRuntimeConfig();

  assert.equal(config.supabaseUrl, '');
  assert.equal(config.supabaseAnonKey, '');
  assert.equal(config.supabaseConfigured, false);
  assert.equal(config.storageBucket, '');
  assert.equal(config.cdnBaseUrl, '');
  assert.equal(config.authRedirectUrl, '');

  const jwtPattern = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/;
  const projectUrlPattern = /https:\/\/[a-z0-9-]+\.supabase\.co\b/i;
  const files = [
    '../../supabase-config.js',
    '../../supabase-auth.js',
    '../../storage-url-resolver.js',
    '../../app.js',
    '../../.env.example'
  ];
  for (const path of files) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, jwtPattern, `${path} must not ship a JWT`);
    assert.doesNotMatch(source, projectUrlPattern, `${path} must not ship a Supabase project URL`);
  }

  const example = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^# SUPABASE_URL=$/m);
  assert.match(example, /^# SUPABASE_ANON_KEY=$/m);
  assert.doesNotMatch(example, /^(?!#).*\bSUPABASE_(?:URL|ANON_KEY)=/m);
});

test('unreviewed LocalStorage connection settings remain pending and cannot override host configuration', t => {
  const config = {
    SUPABASE_URL: 'https://host-project.example.test',
    SUPABASE_ANON_KEY: 'synthetic-host-anon-key'
  };
  setRuntimeSources(t, {
    globalConfig: config,
    localConfig: {
      SUPABASE_URL: 'https://planted-project.example.test',
      SUPABASE_ANON_KEY: 'synthetic-planted-anon-key'
    }
  });

  const resolved = getBlendRuntimeConfig();
  assert.equal(resolved.supabaseUrl, config.SUPABASE_URL);
  assert.equal(resolved.supabaseAnonKey, config.SUPABASE_ANON_KEY);
  assert.equal(resolved.runtimeConfigSource, 'host-injected');
  assert.equal(resolved.runtimeConfigReviewRequired, false);

  const pending = readPendingBlendRuntimeConfig();
  assert.equal(pending.reviewRequired, true);
  assert.equal(pending.config.SUPABASE_URL, 'https://planted-project.example.test');
});

test('reviewed LocalStorage config activates only for the current tab', t => {
  const { localStorage, sessionStorage } = setRuntimeSources(t, {
    localConfig: {
      SUPABASE_URL: 'https://local-project.example.test',
      SUPABASE_ANON_KEY: 'synthetic-local-anon-key'
    }
  });

  const pending = getBlendRuntimeConfig();
  assert.equal(pending.supabaseUrl, '');
  assert.equal(pending.supabaseConfigured, false);
  assert.equal(pending.runtimeConfigReviewRequired, true);

  const saveResult = saveBlendRuntimeConfig({
    SUPABASE_URL: 'https://local-project.example.test',
    SUPABASE_ANON_KEY: 'synthetic-local-anon-key'
  }, { confirmed: true });
  assert.deepEqual({ saved: saveResult.saved, active: saveResult.active, tabOnly: saveResult.tabOnly }, {
    saved: true, active: true, tabOnly: false
  });

  const active = getBlendRuntimeConfig();
  assert.equal(active.supabaseUrl, 'https://local-project.example.test');
  assert.equal(active.supabaseConfigured, true);
  assert.equal(active.runtimeConfigReviewRequired, false);
  assert.equal(JSON.parse(localStorage.getItem(RUNTIME_CONFIG_KEY)).SUPABASE_URL, 'https://local-project.example.test');
  assert.ok(sessionStorage.getItem(REVIEW_KEY));

  const nextTabSession = createStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: nextTabSession });
  const nextTab = getBlendRuntimeConfig();
  assert.equal(nextTab.supabaseUrl, '');
  assert.equal(nextTab.runtimeConfigReviewRequired, true);
});

test('unreadable JSON does not throw and falls back to host config or inert defaults', t => {
  setRuntimeSources(t, { localRaw: '{invalid json' });
  let config = getBlendRuntimeConfig();
  assert.equal(config.supabaseUrl, '');
  assert.equal(config.supabaseConfigured, false);
  assert.ok(config.runtimeConfigWarnings.some(warning => warning.includes('Saved connection settings could not be read')));
  assert.equal(readPendingBlendRuntimeConfig().readable, false);

  setRuntimeSources(t, {
    localRaw: '{invalid json',
    globalConfig: {
      SUPABASE_URL: 'https://host-project.example.test',
      SUPABASE_ANON_KEY: 'synthetic-host-anon-key'
    }
  });
  config = getBlendRuntimeConfig();
  assert.equal(config.supabaseUrl, 'https://host-project.example.test');
  assert.ok(config.runtimeConfigWarnings.some(warning => warning.includes('host-injected configuration')));
});

test('non-HTTP(S) project URLs and cross-origin redirects are ignored and reported', t => {
  setRuntimeSources(t, {
    globalConfig: {
      SUPABASE_URL: 'ftp://evil.example/project',
      SUPABASE_ANON_KEY: 'synthetic-anon-key',
      SUPABASE_AUTH_REDIRECT_URL: 'https://evil.example/callback'
    }
  });

  const config = getBlendRuntimeConfig();
  assert.equal(config.supabaseUrl, '');
  assert.equal(config.supabaseConfigured, false);
  assert.equal(config.authRedirectUrl, '');
  assert.ok(config.runtimeConfigWarnings.some(warning => warning.includes('project URL was ignored')));
  assert.ok(config.runtimeConfigWarnings.some(warning => warning.includes('Auth redirect URL was ignored')));
});

test('saving connection settings requires confirmation and rejects a cross-origin redirect', t => {
  const { localStorage } = setRuntimeSources(t);
  const settings = {
    SUPABASE_URL: 'https://project.example.test',
    SUPABASE_ANON_KEY: 'synthetic-anon-key',
    SUPABASE_AUTH_REDIRECT_URL: 'https://evil.example/callback'
  };

  assert.equal(saveBlendRuntimeConfig(settings).reason, 'confirmation-required');
  const rejected = saveBlendRuntimeConfig(settings, { confirmed: true });
  assert.equal(rejected.saved, false);
  assert.equal(rejected.active, false);
  assert.equal(rejected.reason, 'invalid-config');
  assert.equal(localStorage.getItem(RUNTIME_CONFIG_KEY), null);
  assert.equal(getBlendRuntimeConfig().supabaseUrl, '');
});

test('updating non-connection settings cannot activate a pending stored project without review', t => {
  const { localStorage } = setRuntimeSources(t, {
    localConfig: {
      SUPABASE_URL: 'https://unreviewed.example.test',
      SUPABASE_ANON_KEY: 'synthetic-unreviewed-anon-key'
    }
  });

  const result = saveBlendRuntimeConfig({ SUPABASE_MEDIA_BUCKET: 'updated-media' });
  assert.equal(result.saved, false);
  assert.equal(result.active, false);
  assert.equal(result.reason, 'confirmation-required');
  assert.equal(localStorage.getItem(RUNTIME_CONFIG_KEY), JSON.stringify({
    SUPABASE_URL: 'https://unreviewed.example.test',
    SUPABASE_ANON_KEY: 'synthetic-unreviewed-anon-key'
  }));
  assert.equal(getBlendRuntimeConfig().supabaseUrl, '');
  assert.equal(getBlendRuntimeConfig().runtimeConfigReviewRequired, true);
});

test('same-origin HTTP(S) Auth redirects can be saved after explicit review', t => {
  setRuntimeSources(t);
  const saveResult = saveBlendRuntimeConfig({
    SUPABASE_URL: 'https://project.example.test',
    SUPABASE_ANON_KEY: 'synthetic-anon-key',
    SUPABASE_AUTH_REDIRECT_URL: `${APP_ORIGIN}/auth/callback`
  }, { confirmed: true });

  assert.equal(saveResult.saved, true);
  assert.equal(saveResult.active, true);
  const config = getBlendRuntimeConfig();
  assert.equal(config.supabaseConfigured, true);
  assert.equal(config.authRedirectUrl, `${APP_ORIGIN}/auth/callback`);
});

test('LocalStorage write failure keeps reviewed config for this tab and reports it as unsaved', t => {
  const { localStorage } = setRuntimeSources(t);
  localStorage.failWrite = true;
  const result = saveBlendRuntimeConfig({
    SUPABASE_URL: 'https://project.example.test',
    SUPABASE_ANON_KEY: 'synthetic-anon-key'
  }, { confirmed: true });

  assert.equal(result.saved, false);
  assert.equal(result.active, true);
  assert.equal(result.tabOnly, true);
  assert.ok(result.warnings.some(warning => warning.includes('not saved to LocalStorage')));
  const config = getBlendRuntimeConfig();
  assert.equal(config.supabaseUrl, 'https://project.example.test');
  assert.equal(config.runtimeConfigSource, 'tab-session');
});

test('clearBlendRuntimeConfig removes persistent and tab-scoped settings', t => {
  const { localStorage, sessionStorage } = setRuntimeSources(t, {
    localConfig: { SUPABASE_URL: 'https://project.example.test', SUPABASE_ANON_KEY: 'synthetic-anon-key' }
  });
  sessionStorage.setItem(TAB_CONFIG_KEY, JSON.stringify({ SUPABASE_URL: 'https://tab.example.test' }));
  sessionStorage.setItem(REVIEW_KEY, JSON.stringify({ source: 'tab', fingerprint: 'test' }));

  assert.equal(clearBlendRuntimeConfig(), true);
  assert.equal(localStorage.getItem(RUNTIME_CONFIG_KEY), null);
  assert.equal(sessionStorage.getItem(TAB_CONFIG_KEY), null);
  assert.equal(sessionStorage.getItem(REVIEW_KEY), null);
  assert.equal(getBlendRuntimeConfig().supabaseUrl, '');
});
