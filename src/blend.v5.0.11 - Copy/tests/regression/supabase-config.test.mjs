import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { getBlendRuntimeConfig } from '../../supabase-config.js';

const RUNTIME_CONFIG_KEY = 'blend-runtime-config-v1';

function setRuntimeSources(t, { globalConfig = {}, localConfig = null } = {}) {
  const names = ['BLEND_RUNTIME_CONFIG', '__BLEND_RUNTIME_CONFIG__', 'localStorage'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const localStorage = {
    value: localConfig,
    getItem(key) {
      return key === RUNTIME_CONFIG_KEY && this.value
        ? JSON.stringify(this.value)
        : null;
    }
  };
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
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorage
  });
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return localStorage;
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

test('explicit overrides win over LocalStorage, which wins over global config and defaults', t => {
  const localStorage = setRuntimeSources(t, {
    globalConfig: {
      SUPABASE_URL: 'https://global.example.test',
      SUPABASE_ANON_KEY: 'synthetic-global-anon-key'
    }
  });

  let config = getBlendRuntimeConfig();
  assert.equal(config.supabaseUrl, 'https://global.example.test');
  assert.equal(config.supabaseAnonKey, 'synthetic-global-anon-key');

  localStorage.value = {
    SUPABASE_URL: 'https://local.example.test',
    SUPABASE_ANON_KEY: 'synthetic-local-anon-key'
  };
  config = getBlendRuntimeConfig();
  assert.equal(config.supabaseUrl, 'https://local.example.test');
  assert.equal(config.supabaseAnonKey, 'synthetic-local-anon-key');

  config = getBlendRuntimeConfig({
    SUPABASE_URL: 'https://explicit.example.test',
    SUPABASE_ANON_KEY: 'synthetic-explicit-anon-key'
  });
  assert.equal(config.supabaseUrl, 'https://explicit.example.test');
  assert.equal(config.supabaseAnonKey, 'synthetic-explicit-anon-key');
  assert.equal(config.supabaseConfigured, true);
});
