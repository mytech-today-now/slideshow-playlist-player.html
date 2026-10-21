import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { getBlendRuntimeConfig } from '../../supabase-config.js';
import { StorageResolverError, createStorageUrlResolver } from '../../storage-url-resolver.js';
import { runStoragePolicyStaging } from '../integration/storage-policy-staging.mjs';

const STORAGE_CONFIG = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'synthetic-anon-key',
  defaultBucket: 'private-media',
  publicBucketAllowList: ['public-media'],
  signedUrlTtlSeconds: 120
};

function resolverFor({ token = '', fetchImpl, logger = null } = {}) {
  return createStorageUrlResolver({
    config: STORAGE_CONFIG,
    authClient: { getAccessToken: () => token },
    fetchImpl,
    logger
  });
}

test('runtime config never exposes a service role key to browser callers', () => {
  const hadRuntimeConfig = Object.prototype.hasOwnProperty.call(globalThis, 'BLEND_RUNTIME_CONFIG');
  const previousRuntimeConfig = globalThis.BLEND_RUNTIME_CONFIG;
  globalThis.BLEND_RUNTIME_CONFIG = {
    SUPABASE_URL: 'https://runtime.example.supabase.co',
    SUPABASE_ANON_KEY: 'synthetic-runtime-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-secret'
  };

  let config;
  try {
    config = getBlendRuntimeConfig();
  } finally {
    if (hadRuntimeConfig) globalThis.BLEND_RUNTIME_CONFIG = previousRuntimeConfig;
    else delete globalThis.BLEND_RUNTIME_CONFIG;
  }

  assert.equal(config.supabaseUrl, 'https://runtime.example.supabase.co');
  assert.equal(config.supabaseAnonKey, 'synthetic-runtime-anon-key');
  assert.equal(Object.keys(config).some(key => /service.?role/i.test(key)), false);
  assert.equal(JSON.stringify(config).includes('synthetic-service-role-secret'), false);
});

test('settings surface the required private-policy verification fallback as a note', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(
    html,
    /<p id="private-media-policy-warning" class="setting__status" data-state="error" role="note">Private URL sharing is blocked until the project owner verifies Storage access\. You can share a public-only experience or continue local playback\.<\/p>/
  );
});

test('release evidence records the named owner, policy revision, rollback, and all six matrix cells', async () => {
  const verification = await readFile(new URL('../../STORAGE_POLICY_VERIFICATION.md', import.meta.url), 'utf8');
  const staging = await readFile(new URL('../integration/storage-policy-staging.mjs', import.meta.url), 'utf8');

  assert.match(verification, /\| Policy owner \| Named person and role authorized to approve the Storage policy and release gate \|/);
  assert.match(verification, /\| Policy revision \| Non-secret revision identifier or redacted-export timestamp\/hash/);
  assert.match(verification, /\| Rollback artifact \| Reference and revision for the reviewed pre-change policy export/);
  assert.match(verification, /Any failed or missing cell keeps the release gate not passed and private-reference sharing blocked\./);
  for (const [principal, visibility] of [
    ['Anonymous', 'Private'],
    ['Anonymous', 'Allowlisted public'],
    ['Owner A', 'Private'],
    ['Owner A', 'Allowlisted public'],
    ['Unrelated user B', 'Private'],
    ['Unrelated user B', 'Allowlisted public']
  ]) {
    assert.match(verification, new RegExp(`\\| ${principal} \\| ${visibility} \\|`));
  }
  for (const cell of [
    'anonymous / private object / direct request',
    'owner A / private object / direct request',
    'unrelated user B / private object / direct request'
  ]) {
    assert.ok(staging.includes(cell), `staging runner labels the ${cell} matrix cell`);
  }
  for (const principal of ['anonymous', 'owner A', 'unrelated user B']) {
    assert.match(staging, new RegExp(`await checkPublicObject\\('${principal}'`));
  }
  assert.match(staging, /function checkedCell\(cell, condition, message\)/);
  assert.match(staging, /failCell\(cell, 'A staging Storage request failed before returning an HTTP response\.'/);
});

test('anonymous private resolution fails closed without a provider request or URL', async () => {
  let requestCount = 0;
  const resolver = resolverFor({
    fetchImpl: async () => {
      requestCount += 1;
      return new Response('{}', { status: 200 });
    }
  });

  await assert.rejects(
    () => resolver.resolve('supabase://private-media/codex-policy-check/private-object.txt'),
    error => error instanceof StorageResolverError && error.code === 'auth_required'
  );
  assert.equal(requestCount, 0);
});

test('owner access token is the private signing identity and logs omit paths and URLs', async () => {
  const logged = [];
  const ownerToken = 'synthetic-owner-access-token';
  const serviceRoleToken = 'synthetic-service-role-secret';
  let request = null;
  const resolver = resolverFor({
    token: ownerToken,
    logger: { info: (...values) => logged.push(values) },
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({
        signedURL: '/storage/v1/object/sign/private-media/codex-policy-check/private-object.txt?token=synthetic-signed-url-secret'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  const resolved = await resolver.resolve('supabase://private-media/codex-policy-check/private-object.txt');
  assert.equal(resolved.signed, true);
  assert.equal(request.init.headers.apikey, 'synthetic-anon-key');
  assert.equal(request.init.headers.Authorization, `Bearer ${ownerToken}`);
  assert.equal(request.init.headers.Authorization.includes(serviceRoleToken), false);

  const logText = JSON.stringify(logged);
  assert.equal(logText.includes('codex-policy-check'), false);
  assert.equal(logText.includes(ownerToken), false);
  assert.equal(logText.includes('synthetic-signed-url-secret'), false);
  assert.equal(logText.includes(resolved.url), false);
});

test('unrelated user signing denial is generic and does not reveal provider payloads', async () => {
  const resolver = resolverFor({
    token: 'synthetic-unrelated-user-access-token',
    fetchImpl: async () => new Response(JSON.stringify({
      message: 'denied for codex-policy-check/private-object.txt?token=synthetic-provider-secret'
    }), { status: 403, headers: { 'content-type': 'application/json' } })
  });

  await assert.rejects(
    () => resolver.resolve('supabase://private-media/codex-policy-check/private-object.txt'),
    error => {
      assert.ok(error instanceof StorageResolverError);
      assert.equal(error.code, 'permission_denied');
      assert.equal(error.status, 403);
      assert.equal(error.message, 'You do not have permission to access this media.');
      assert.doesNotMatch(`${error.message} ${error.cause?.message || ''}`, /codex-policy-check|synthetic-provider-secret/);
      return true;
    }
  );
});

test('public resolution uses only the configured bucket allowlist', async () => {
  let requestCount = 0;
  const resolver = resolverFor({
    fetchImpl: async () => {
      requestCount += 1;
      return new Response('{}', { status: 200 });
    }
  });

  const publicResult = await resolver.resolve('supabase://public-media/codex-policy-check/public-object.txt');
  assert.equal(publicResult.signed, false);
  assert.equal(publicResult.visibility, 'public');
  assert.match(publicResult.url, /\/storage\/v1\/object\/public\/public-media\//);
  await assert.rejects(
    () => resolver.resolve('supabase://private-media/codex-policy-check/private-object.txt'),
    error => error instanceof StorageResolverError && error.code === 'auth_required'
  );
  assert.equal(requestCount, 0);
});

for (const [label, confirmation] of [
  ['absent', undefined],
  ['inexact', 'I_CONFIRM_DISPOSABLE_STAGING_ONLY ']
]) {
  test(`staging command skips before reading credentials or sending requests with ${label} confirmation`, async () => {
    const envReads = [];
    const env = new Proxy({}, {
      get(_target, key) {
        envReads.push(String(key));
        if (key !== 'BLEND_STORAGE_STAGING_CONFIRM') {
          throw new Error(`Unexpected staging environment read: ${String(key)}`);
        }
        return confirmation;
      }
    });
    const requests = [];
    const output = [];

    const result = await runStoragePolicyStaging({
      env,
      fetchImpl: async (...args) => {
        requests.push(args);
        throw new Error('Network access is blocked in this regression test.');
      },
      log: message => output.push(message)
    });

    assert.equal(result, 'SKIP');
    assert.deepEqual(envReads, ['BLEND_STORAGE_STAGING_CONFIRM']);
    assert.deepEqual(requests, []);
    assert.deepEqual(output, [
      'SKIP: no requests sent. Set BLEND_STORAGE_STAGING_CONFIRM to opt into the disposable staging matrix.'
    ]);
  });
}
