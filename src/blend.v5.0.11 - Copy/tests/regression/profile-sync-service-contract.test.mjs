import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProfileSyncApi } from '../../server/profile-sync.mjs';

const GUID = '123e4567-e89b-42d3-a456-426614174000';
const COOKIE = 'a'.repeat(43);
const ORIGIN = 'https://blend.example.test';
const ENV = {
  BLEND_PROFILE_SYNC_ALLOWED_ORIGINS: ORIGIN,
  BLEND_PROFILE_SYNC_FRONTEND_ORIGIN: ORIGIN,
  BLEND_PROFILE_SYNC_TOKEN_PEPPER: 'synthetic-test-pepper-value-that-is-long-enough',
  BLEND_PROFILE_SYNC_GITHUB_TOKEN: ''
};

function responseDouble() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])));
    },
    end(body = '') { this.body = String(body); }
  };
}

function requestDouble({ method = 'GET', origin = ORIGIN, cookie = '', csrf = '', fetchSite = 'same-site' } = {}) {
  return {
    method,
    headers: {
      origin,
      host: 'api.mytech.today',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'api.mytech.today',
      cookie,
      'x-blend-csrf': csrf,
      'sec-fetch-site': fetchSite
    },
    socket: { remoteAddress: '127.0.0.1' }
  };
}

function poolDouble({ authorized = false } = {}) {
  return {
    async query(sql) {
      if (String(sql).startsWith('CREATE TABLE')) return { rowCount: 0, rows: [] };
      if (String(sql).includes('UPDATE blend_profile_sync_devices')) {
        return { rowCount: authorized ? 1 : 0, rows: authorized ? [{ device_id: '00000000-0000-4000-8000-000000000001' }] : [] };
      }
      return { rowCount: 0, rows: [] };
    }
  };
}

test('rejects an unlisted origin and returns exact non-cacheable CORS for an allowed origin', async () => {
  const api = createProfileSyncApi({ pool: poolDouble(), env: ENV });
  const denied = responseDouble();
  await api.route(requestDouble({ origin: 'https://attacker.example.test' }), denied, `/api/profile-sync/profiles/${GUID}`);
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(denied.body).error.code, 'origin_not_allowed');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);

  const preflight = responseDouble();
  await api.route(requestDouble({ method: 'OPTIONS' }), preflight, `/api/profile-sync/profiles/${GUID}`);
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
  assert.match(preflight.headers['cache-control'], /no-store/);
  assert.equal(preflight.headers['access-control-allow-origin'].includes('*'), false);
});

test('requires a valid server-side device record before reading protected profile state', async () => {
  const api = createProfileSyncApi({ pool: poolDouble(), env: ENV });
  const response = responseDouble();
  await api.route(requestDouble(), response, `/api/profile-sync/profiles/${GUID}`);
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error.code, 'device_credential_invalid');
  assert.match(response.headers['cache-control'], /no-store/);
  assert.equal(response.body.includes(COOKIE), false);
});

test('requires a CSRF header and same-site Fetch Metadata for protected mutations', async () => {
  const api = createProfileSyncApi({ pool: poolDouble({ authorized: true }), env: ENV });
  const missingHeader = responseDouble();
  await api.route(requestDouble({
    method: 'POST',
    cookie: `blend_profile_device_v1=${COOKIE}`,
    csrf: ''
  }), missingHeader, `/api/profile-sync/profiles/${GUID}/recovery/rotate`);
  assert.equal(missingHeader.statusCode, 403);
  assert.equal(JSON.parse(missingHeader.body).error.code, 'csrf_check_failed');

  const crossSite = responseDouble();
  await api.route(requestDouble({
    method: 'POST',
    cookie: `blend_profile_device_v1=${COOKIE}`,
    csrf: '1',
    fetchSite: 'cross-site'
  }), crossSite, `/api/profile-sync/profiles/${GUID}/recovery/rotate`);
  assert.equal(crossSite.statusCode, 403);
  assert.equal(JSON.parse(crossSite.body).error.code, 'request_origin_invalid');
});

test('migration keeps one outbox row, one pending rotation, revocable device hashes, and one-use records', async () => {
  const sql = await readFile(new URL('../../server/migrations/001-profile-sync.sql', import.meta.url), 'utf8');
  assert.match(sql, /blend_profile_sync_profiles\s*\([\s\S]*?profile_guid uuid PRIMARY KEY/);
  assert.match(sql, /blend_profile_sync_devices\s*\([\s\S]*?credential_hash char\(64\)[\s\S]*?revoked_at timestamptz/);
  assert.match(sql, /blend_profile_sync_pending_rotations\s*\([\s\S]*?UNIQUE \(profile_guid\)/);
  assert.match(sql, /blend_profile_sync_shares\s*\([\s\S]*?expires_at timestamptz[\s\S]*?consumed_at timestamptz/);
  assert.match(sql, /blend_profile_sync_outbox\s*\([\s\S]*?profile_guid uuid PRIMARY KEY[\s\S]*?desired_revision bigint/);
  assert.match(sql, /blend_profile_sync_operations\s*\([\s\S]*?PRIMARY KEY \(profile_guid, idempotency_key\)/);
  assert.match(sql, /blend_profile_sync_admin_challenges\s*\([\s\S]*?consumed_at timestamptz/);
});

test('migration failures stay handled and profile mutations fail closed with a sanitized 503', async () => {
  const pool = { async query() { throw new Error('synthetic database connection detail'); } };
  const api = createProfileSyncApi({ pool, env: ENV });
  assert.equal(await api.initialize(), false);
  assert.equal(api.health().profileSyncConfigured, false);
  const response = responseDouble();
  await api.route(requestDouble({ method: 'POST', csrf: '1' }), response, `/api/profile-sync/profiles/${GUID}/initialize`);
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error.code, 'profile_sync_unavailable');
  assert.equal(response.body.includes('synthetic database connection detail'), false);
});

test('a failed startup migration is retried on the next readiness check', async () => {
  let attempts = 0;
  const pool = { async query() {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary database startup failure');
    return { rowCount: 0, rows: [] };
  } };
  const api = createProfileSyncApi({ pool, env: ENV });
  assert.equal(await api.initialize(), false);
  assert.equal(await api.initialize(), true);
  assert.equal(attempts, 2);
  assert.equal(api.health().profileSyncConfigured, true);
});

test('admin deletion clears private Experience and credential records before queuing public-file removal', async () => {
  const source = await readFile(new URL('../../server/profile-sync.mjs', import.meta.url), 'utf8');
  assert.match(source, /SET deleted_at = now\(\), revision = \$2, experience = NULL/);
  for (const table of [
    'blend_profile_sync_devices',
    'blend_profile_sync_recovery_keys',
    'blend_profile_sync_pending_rotations',
    'blend_profile_sync_shares',
    'blend_profile_sync_locks',
    'blend_profile_sync_operations',
    'blend_profile_sync_admin_challenges'
  ]) {
    assert.match(source, new RegExp(`DELETE FROM ${table} WHERE profile_guid = \\$1`));
  }
  assert.match(source, /queueOutbox\(client, profileGuid, revision\.toString\(\), 'delete'\)/);
});
