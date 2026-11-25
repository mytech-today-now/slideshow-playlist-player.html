import {
  createHash,
  randomBytes,
  randomUUID
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createOpaqueToken,
  createRateLimiter,
  hashSecret,
  isSameOrNewerRevision,
  normalizeAllowedOrigins,
  normalizeProfileGuid,
  PROFILE_SYNC_API_PATH,
  PROFILE_SYNC_COOKIE,
  PROFILE_SYNC_DEVICE_TTL_SECONDS,
  PROFILE_SYNC_MAX_EXPERIENCE_BYTES,
  PROFILE_SYNC_SHARE_TTL_SECONDS,
  profileSyncCookieHeader,
  ProfileSyncError,
  safeEqualHex,
  stableJsonStringify,
  validProfileSyncCookie,
  validateExperienceDocument
} from './profile-sync-core.mjs';
import {
  createGitHubExperienceProvider,
  GitHubSyncError
} from './profile-sync-github.mjs';

const MAX_REQUEST_BYTES = PROFILE_SYNC_MAX_EXPERIENCE_BYTES + 64 * 1024;
const LOCK_SECONDS = 300;
const ROTATION_SECONDS = 15 * 60;
const ADMIN_CHALLENGE_SECONDS = 2 * 60;
const MIGRATION_URL = new URL('./migrations/001-profile-sync.sql', import.meta.url);
const API_PREFIX = `${PROFILE_SYNC_API_PATH}/`;

function digestAdminKey(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function requestAddress(request, trustProxy) {
  if (trustProxy) {
    const first = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (first && first.length <= 128) return first;
  }
  return String(request.socket?.remoteAddress || 'unknown').slice(0, 128);
}

function requestCookie(request, name) {
  for (const part of String(request.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return '';
}

function safeRevision(value) {
  try {
    const revision = BigInt(value);
    return revision >= 0n ? revision : null;
  } catch (_) {
    return null;
  }
}

function safeSha(value) {
  const sha = String(value || '');
  return /^[0-9a-f]{40,64}$/i.test(sha) ? sha : null;
}

function parseLockToken(value) {
  const token = String(value || '').trim();
  const match = token.match(/^<urn:uuid:([0-9a-f-]{36})>$/i);
  return match ? match[1].toLowerCase() : '';
}

function jsonResponse(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store, private',
    'Content-Type': 'application/json; charset=utf-8',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function emptyResponse(response, status, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store, private',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end();
}

function apiError(error) {
  if (error instanceof ProfileSyncError || error instanceof GitHubSyncError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }
  return {
    status: 500,
    code: 'profile_sync_error',
    message: 'Profile synchronization could not complete this request.',
    details: null
  };
}

async function readJsonBody(request) {
  const contentType = String(request.headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new ProfileSyncError('content_type_invalid', 'Profile sync requests must use application/json.', 415);
  }
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new ProfileSyncError('request_too_large', 'The profile sync request is too large.', 413);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new ProfileSyncError('request_too_large', 'The profile sync request is too large.', 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_) {
    throw new ProfileSyncError('request_json_invalid', 'The profile sync request must contain valid JSON.', 400);
  }
}

function configFromEnv(env) {
  const origins = normalizeAllowedOrigins(env.BLEND_PROFILE_SYNC_ALLOWED_ORIGINS || '');
  const frontendOrigin = String(env.BLEND_PROFILE_SYNC_FRONTEND_ORIGIN || '').trim();
  if (frontendOrigin && !origins.has(frontendOrigin)) {
    throw new ProfileSyncError('profile_sync_frontend_origin_invalid', 'The profile sync frontend origin must match an allowed HTTPS origin.', 500);
  }
  const rawFrontendUrl = String(env.BLEND_PROFILE_SYNC_FRONTEND_URL || '').trim();
  let frontendUrl = '';
  if (rawFrontendUrl) {
    let parsed;
    try { parsed = new URL(rawFrontendUrl); } catch (_) {
      throw new ProfileSyncError('profile_sync_frontend_url_invalid', 'The profile sync frontend URL is invalid.', 500);
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== frontendOrigin || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new ProfileSyncError('profile_sync_frontend_url_invalid', 'The profile sync frontend URL must be HTTPS and match the configured frontend origin.', 500);
    }
    frontendUrl = parsed.toString();
  } else if (frontendOrigin) {
    frontendUrl = new URL('/index.html', frontendOrigin).toString();
  }
  const pepper = String(env.BLEND_PROFILE_SYNC_TOKEN_PEPPER || '');
  const cookieSameSite = String(env.BLEND_PROFILE_SYNC_COOKIE_SAME_SITE || 'Strict').trim();
  if (!['Strict', 'Lax', 'None'].includes(cookieSameSite)) {
    throw new ProfileSyncError('profile_sync_cookie_config_invalid', 'The profile sync cookie policy is invalid.', 500);
  }
  const adminKeyHash = String(env.BLEND_PROFILE_SYNC_ADMIN_KEY_SHA256 || '').trim().toLowerCase();
  const adminConfigured = /^[0-9a-f]{64}$/.test(adminKeyHash);
  const ready = origins.size > 0 && Buffer.byteLength(pepper, 'utf8') >= 32;
  return {
    origins,
    frontendOrigin,
    frontendUrl,
    cookieSameSite,
    pepper,
    adminKeyHash: adminConfigured ? adminKeyHash : '',
    adminConfigured,
    ready,
    trustProxy: env.BLEND_PROFILE_SYNC_TRUST_PROXY === '1'
  };
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, LOCK, UNLOCK, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, Lock-Token, X-Blend-CSRF',
    'Access-Control-Expose-Headers': 'DAV, Lock-Token, Timeout',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

function publicProfile(row, extra = {}) {
  return {
    profileGuid: String(row.profile_guid),
    revision: String(row.revision),
    experience: row.experience || null,
    github: {
      status: String(row.github_status),
      sha: row.github_sha || null,
      syncedRevision: String(row.github_synced_revision || 0),
      errorCode: row.github_error_code || null
    },
    updatedAt: row.updated_at,
    ...extra
  };
}

export function createProfileSyncApi({
  pool = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  randomBytesFn = randomBytes,
  randomUUIDFn = randomUUID
} = {}) {
  const config = configFromEnv(env);
  const github = createGitHubExperienceProvider({
    token: env.BLEND_PROFILE_SYNC_GITHUB_TOKEN || '',
    branch: env.BLEND_PROFILE_SYNC_GITHUB_BRANCH || 'main',
    fetchImpl
  });
  let migrationReady = false;
  let migrationInFlight = null;
  function ensureMigration() {
    if (!pool || !config.ready) return Promise.resolve(false);
    if (migrationReady) return Promise.resolve(true);
    if (migrationInFlight) return migrationInFlight;
    migrationInFlight = readFile(MIGRATION_URL, 'utf8').then(sql => pool.query(sql)).then(() => {
      migrationReady = true;
      return true;
    }).catch(() => false).finally(() => { migrationInFlight = null; });
    return migrationInFlight;
  }
  const checkGeneralRate = createRateLimiter({ limit: 90, windowMs: 60_000, now });
  const checkSensitiveRate = createRateLimiter({ limit: 8, windowMs: 60_000, now });
  const checkAdminRate = createRateLimiter({ limit: 30, windowMs: 60_000, now });

  function hash(token) {
    return hashSecret(token, config.pepper);
  }

  function mutationAllowed(request) {
    const fetchSite = String(request.headers['sec-fetch-site'] || '').toLowerCase();
    return request.headers['x-blend-csrf'] === '1'
      && !['cross-site', 'none'].includes(fetchSite);
  }

  async function authenticate(request, profileGuid) {
    const credential = requestCookie(request, PROFILE_SYNC_COOKIE);
    if (!validProfileSyncCookie(credential)) {
      throw new ProfileSyncError('device_credential_invalid', 'This browser is not enrolled in the profile.', 401);
    }
    const result = await pool.query(
      `UPDATE blend_profile_sync_devices
       SET last_used_at = now()
       WHERE profile_guid = $1 AND credential_hash = $2 AND revoked_at IS NULL
       RETURNING device_id`,
      [profileGuid, hash(credential)]
    );
    if (!result.rowCount) {
      throw new ProfileSyncError('device_credential_invalid', 'This browser is not enrolled in the profile.', 401);
    }
    return credential;
  }

  function setDeviceCookie(request, response, credential) {
    response.setHeader('Set-Cookie', profileSyncCookieHeader(request, credential, { sameSite: config.cookieSameSite }));
  }

  async function loadProfile(profileGuid, { forUpdate = false, client = pool } = {}) {
    const result = await client.query(
      `SELECT profile_guid, revision, experience, github_sha, github_synced_revision,
              github_status, github_error_code, recovery_generation, deleted_at, updated_at
       FROM blend_profile_sync_profiles WHERE profile_guid = $1${forUpdate ? ' FOR UPDATE' : ''}`,
      [profileGuid]
    );
    return result.rows[0] || null;
  }

  function deviceRecord(profileGuid, credential) {
    return pool.query(
      `INSERT INTO blend_profile_sync_devices(device_id, profile_guid, credential_hash)
       VALUES ($1, $2, $3)`,
      [randomUUIDFn(), profileGuid, hash(credential)]
    );
  }

  async function recordAudit(profileGuid, action, outcome, metadata = {}) {
    await pool.query(
      `INSERT INTO blend_profile_sync_audit(profile_guid, action, outcome, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [profileGuid, action, outcome, JSON.stringify(metadata)]
    );
  }

  async function githubConflictFor(profileGuid, expectedSha, expectedRevision, row = null) {
    let remote = null;
    let remoteFetchFailed = false;
    if (github.configured) {
      try { remote = await github.getExperience(profileGuid); } catch (_) { remoteFetchFailed = true; }
    }
    return {
      conflict: true,
      code: 'profile_revision_conflict',
      message: 'A newer saved Experience exists. Choose whether to resubmit this draft or load the current saved version.',
      revision: row ? String(row.revision) : String(expectedRevision ?? 0),
      sha: row?.github_sha || null,
      remoteSha: remote?.sha || null,
      remoteExperience: remote?.experience || null,
      remoteUnavailable: remoteFetchFailed,
      expectedSha: expectedSha || null
    };
  }

  async function initializeProfile(profileGuid, request, response) {
    if (!mutationAllowed(request)) {
      throw new ProfileSyncError('csrf_check_failed', 'The profile request could not be verified.', 403);
    }
    const existingRemote = github.configured ? await github.getExperience(profileGuid) : null;
    if (existingRemote) {
      throw new ProfileSyncError('profile_exists', 'A saved public Experience already uses this profile identifier. Use a recovery key to enroll this browser.', 409);
    }
    const keys = Array.from({ length: 10 }, () => `BLD1-${randomBytesFn(20).toString('base64url')}`);
    const credential = createOpaqueToken(32, randomBytesFn);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO blend_profile_sync_profiles(profile_guid)
         VALUES ($1) ON CONFLICT (profile_guid) DO NOTHING RETURNING profile_guid`,
        [profileGuid]
      );
      if (!inserted.rowCount) {
        throw new ProfileSyncError('profile_exists', 'This profile already exists. Use a recovery key to enroll this browser.', 409);
      }
      const generation = 1;
      await client.query(
        `INSERT INTO blend_profile_sync_recovery_keys(profile_guid, key_hash, generation)
         SELECT $1, value, $2 FROM unnest($3::char(64)[]) AS value`,
        [profileGuid, generation, keys.map(key => hash(key))]
      );
      await client.query(
        `INSERT INTO blend_profile_sync_devices(device_id, profile_guid, credential_hash)
         VALUES ($1, $2, $3)`,
        [randomUUIDFn(), profileGuid, hash(credential)]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    setDeviceCookie(request, response, credential);
    response.setHeader('Cache-Control', 'no-store, private');
    await recordAudit(profileGuid, 'profile_initialize', 'success');
    jsonResponse(response, 201, {
      profileGuid,
      recoveryKeys: keys,
      recoveryGeneration: 1,
      revision: '0',
      experience: null,
      github: { status: 'local_only', sha: null, syncedRevision: '0', errorCode: null }
    }, corsHeaders(request.headers.origin));
  }

  async function enrollProfile(profileGuid, request, response, body) {
    if (!mutationAllowed(request)) {
      throw new ProfileSyncError('csrf_check_failed', 'The profile request could not be verified.', 403);
    }
    const recoveryKey = String(body.recoveryKey || '');
    const shareToken = String(body.shareToken || '');
    if (!!recoveryKey === !!shareToken || recoveryKey.length > 128 || shareToken.length > 128) {
      throw new ProfileSyncError('enrollment_invalid', 'Provide one valid recovery key or one share token.', 400);
    }
    const credential = createOpaqueToken(32, randomBytesFn);
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      const profile = await loadProfile(profileGuid, { forUpdate: true, client });
      if (!profile || profile.deleted_at) {
        throw new ProfileSyncError('profile_not_found', 'The profile is unavailable or has been deleted.', 404);
      }
      if (recoveryKey) {
        const keyResult = await client.query(
          `UPDATE blend_profile_sync_recovery_keys SET consumed_at = now()
           WHERE profile_guid = $1 AND key_hash = $2 AND generation = $3 AND consumed_at IS NULL
           RETURNING key_hash`,
          [profileGuid, hash(recoveryKey), profile.recovery_generation]
        );
        if (!keyResult.rowCount) {
          throw new ProfileSyncError('recovery_key_invalid', 'That recovery key is invalid or has already been used.', 401);
        }
      } else {
        const shareResult = await client.query(
          `UPDATE blend_profile_sync_shares SET consumed_at = now()
           WHERE profile_guid = $1 AND token_hash = $2 AND expires_at > now() AND consumed_at IS NULL
           RETURNING token_hash`,
          [profileGuid, hash(shareToken)]
        );
        if (!shareResult.rowCount) {
          throw new ProfileSyncError('share_token_invalid', 'That share link is expired or has already been used.', 401);
        }
      }
      await client.query(
        `INSERT INTO blend_profile_sync_devices(device_id, profile_guid, credential_hash)
         VALUES ($1, $2, $3)`,
        [randomUUIDFn(), profileGuid, hash(credential)]
      );
      result = await loadProfile(profileGuid, { client });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    setDeviceCookie(request, response, credential);
    await recordAudit(profileGuid, recoveryKey ? 'device_enroll_recovery' : 'device_enroll_share', 'success');
    jsonResponse(response, 200, publicProfile(result), corsHeaders(request.headers.origin));
  }

  async function createRecoveryRotation(profileGuid, request, response) {
    await authenticate(request, profileGuid);
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The profile request could not be verified.', 403);
    const keys = Array.from({ length: 10 }, () => `BLD1-${randomBytesFn(20).toString('base64url')}`);
    const rotationId = randomUUIDFn();
    const client = await pool.connect();
    let nextGeneration;
    try {
      await client.query('BEGIN');
      const profile = await loadProfile(profileGuid, { forUpdate: true, client });
      if (!profile || profile.deleted_at) throw new ProfileSyncError('profile_not_found', 'The profile is unavailable or has been deleted.', 404);
      nextGeneration = Number(profile.recovery_generation) + 1;
      await client.query('DELETE FROM blend_profile_sync_pending_rotations WHERE profile_guid = $1', [profileGuid]);
      await client.query(
        `INSERT INTO blend_profile_sync_pending_rotations(rotation_id, profile_guid, generation, key_hashes, expires_at)
         VALUES ($1, $2, $3, $4::char(64)[], now() + ($5 * interval '1 second'))`,
        [rotationId, profileGuid, nextGeneration, keys.map(key => hash(key)), ROTATION_SECONDS]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await recordAudit(profileGuid, 'recovery_rotation_prepare', 'success');
    jsonResponse(response, 200, { rotationId, recoveryGeneration: nextGeneration, recoveryKeys: keys }, corsHeaders(request.headers.origin));
  }

  async function commitRecoveryRotation(profileGuid, request, response, body) {
    await authenticate(request, profileGuid);
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The profile request could not be verified.', 403);
    const rotationId = String(body.rotationId || '');
    if (!/^[0-9a-f-]{36}$/i.test(rotationId)) throw new ProfileSyncError('rotation_invalid', 'The recovery key update is unavailable.', 400);
    const nextCredential = createOpaqueToken(32, randomBytesFn);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const profile = await loadProfile(profileGuid, { forUpdate: true, client });
      if (!profile || profile.deleted_at) throw new ProfileSyncError('profile_not_found', 'The profile is unavailable or has been deleted.', 404);
      const pending = await client.query(
        `SELECT rotation_id, generation, key_hashes FROM blend_profile_sync_pending_rotations
         WHERE rotation_id = $1 AND profile_guid = $2 AND expires_at > now() FOR UPDATE`,
        [rotationId, profileGuid]
      );
      if (!pending.rowCount) throw new ProfileSyncError('rotation_expired', 'The prepared recovery keys expired. Existing keys and devices remain active.', 409);
      const rotation = pending.rows[0];
      if (Number(rotation.generation) !== Number(profile.recovery_generation) + 1
          || !Array.isArray(rotation.key_hashes) || rotation.key_hashes.length !== 10) {
        throw new ProfileSyncError('rotation_expired', 'The prepared recovery keys are no longer current. Existing keys and devices remain active.', 409);
      }
      await client.query('DELETE FROM blend_profile_sync_recovery_keys WHERE profile_guid = $1', [profileGuid]);
      await client.query(
        `INSERT INTO blend_profile_sync_recovery_keys(profile_guid, key_hash, generation)
         SELECT $1, value, $2 FROM unnest($3::char(64)[]) AS value`,
        [profileGuid, rotation.generation, rotation.key_hashes]
      );
      await client.query(
        `UPDATE blend_profile_sync_devices SET revoked_at = now()
         WHERE profile_guid = $1 AND revoked_at IS NULL`,
        [profileGuid]
      );
      await client.query(
        `INSERT INTO blend_profile_sync_devices(device_id, profile_guid, credential_hash)
         VALUES ($1, $2, $3)`,
        [randomUUIDFn(), profileGuid, hash(nextCredential)]
      );
      await client.query('DELETE FROM blend_profile_sync_pending_rotations WHERE rotation_id = $1', [rotationId]);
      await client.query(
        `UPDATE blend_profile_sync_profiles SET recovery_generation = $2, updated_at = now()
         WHERE profile_guid = $1`,
        [profileGuid, rotation.generation]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    setDeviceCookie(request, response, nextCredential);
    await recordAudit(profileGuid, 'recovery_rotation_commit', 'success');
    jsonResponse(response, 200, { rotated: true, recoveryGeneration: Number((await loadProfile(profileGuid)).recovery_generation) }, corsHeaders(request.headers.origin));
  }

  async function createShareLink(profileGuid, request, response) {
    await authenticate(request, profileGuid);
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The profile request could not be verified.', 403);
    if (!config.frontendOrigin) throw new ProfileSyncError('profile_sync_frontend_origin_missing', 'Profile sharing is not configured on this service.', 503);
    const profile = await loadProfile(profileGuid);
    if (!profile || profile.deleted_at || !profile.experience) {
      throw new ProfileSyncError('experience_missing', 'Save this profile to GitHub before creating a share link.', 409);
    }
    const token = createOpaqueToken(32, randomBytesFn);
    await pool.query(
      `INSERT INTO blend_profile_sync_shares(token_hash, profile_guid, expires_at)
       VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
      [hash(token), profileGuid, PROFILE_SYNC_SHARE_TTL_SECONDS]
    );
    const shareUrl = new URL(config.frontendUrl);
    shareUrl.hash = new URLSearchParams({
      'blend-profile-share': token,
      'blend-profile-guid': profileGuid
    }).toString();
    await recordAudit(profileGuid, 'share_create', 'success');
    jsonResponse(response, 201, {
      shareUrl: shareUrl.toString(),
      expiresInSeconds: PROFILE_SYNC_SHARE_TTL_SECONDS
    }, corsHeaders(request.headers.origin));
  }

  async function createLock(profileGuid, request, response, body) {
    await authenticate(request, profileGuid);
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The profile request could not be verified.', 403);
    const baseRevision = safeRevision(body.baseRevision);
    if (baseRevision == null) throw new ProfileSyncError('base_revision_invalid', 'A current saved revision is required.', 400);
    const profile = await loadProfile(profileGuid);
    if (!profile || profile.deleted_at) throw new ProfileSyncError('profile_not_found', 'The profile is unavailable or has been deleted.', 404);
    if (baseRevision !== BigInt(profile.revision)) {
      jsonResponse(response, 409, await githubConflictFor(profileGuid, body.baseSha, profile.revision, profile), corsHeaders(request.headers.origin));
      return;
    }
    const lockId = randomUUIDFn();
    const lockValue = `<urn:uuid:${lockId}>`;
    const result = await pool.query(
      `INSERT INTO blend_profile_sync_locks(profile_guid, token_hash, expires_at)
       VALUES ($1, $2, now() + ($3 * interval '1 second'))
       ON CONFLICT (profile_guid) DO UPDATE
       SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at
       WHERE blend_profile_sync_locks.expires_at <= now()
       RETURNING profile_guid`,
      [profileGuid, hash(lockId), LOCK_SECONDS]
    );
    if (!result.rowCount) throw new ProfileSyncError('profile_locked', 'Another browser is currently saving this profile. Try again shortly.', 423);
    jsonResponse(response, 200, { revision: String(profile.revision) }, {
      ...corsHeaders(request.headers.origin),
      DAV: '1, 2',
      'Lock-Token': lockValue,
      Timeout: `Second-${LOCK_SECONDS}`
    });
  }

  async function releaseLock(profileGuid, request, response) {
    await authenticate(request, profileGuid);
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The profile request could not be verified.', 403);
    const lockId = parseLockToken(request.headers['lock-token']);
    if (!lockId) throw new ProfileSyncError('lock_token_invalid', 'The profile lock is no longer valid.', 409);
    const result = await pool.query(
      `DELETE FROM blend_profile_sync_locks WHERE profile_guid = $1 AND token_hash = $2 RETURNING profile_guid`,
      [profileGuid, hash(lockId)]
    );
    if (!result.rowCount) throw new ProfileSyncError('lock_token_invalid', 'The profile lock is no longer valid.', 409);
    emptyResponse(response, 204, corsHeaders(request.headers.origin));
  }

  async function disconnectDevice(profileGuid, request, response) {
    const credential = requestCookie(request, PROFILE_SYNC_COOKIE);
    if (!validProfileSyncCookie(credential)) {
      throw new ProfileSyncError('device_credential_invalid', 'This browser is not enrolled in the profile.', 401);
    }
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The profile request could not be verified.', 403);
    const result = await pool.query(
      `UPDATE blend_profile_sync_devices SET revoked_at = now()
       WHERE profile_guid = $1 AND credential_hash = $2 AND revoked_at IS NULL
       RETURNING device_id`,
      [profileGuid, hash(credential)]
    );
    response.setHeader('Set-Cookie', profileSyncCookieHeader(request, '', { maxAge: 0, sameSite: config.cookieSameSite }));
    await recordAudit(profileGuid, 'device_disconnect', result.rowCount ? 'success' : 'already_disconnected');
    jsonResponse(response, 200, { disconnected: true }, corsHeaders(request.headers.origin));
  }

  async function queueOutbox(client, profileGuid, revision, operation = 'put') {
    await client.query(
      `INSERT INTO blend_profile_sync_outbox(profile_guid, desired_revision, operation, attempts, next_attempt_at,
                                              lease_until, blocked_by_conflict, last_error_code, updated_at)
       VALUES ($1, $2, $3, 0, now(), NULL, false, NULL, now())
       ON CONFLICT (profile_guid) DO UPDATE SET
         desired_revision = EXCLUDED.desired_revision,
         operation = EXCLUDED.operation,
         attempts = 0,
         next_attempt_at = now(),
         lease_until = NULL,
         blocked_by_conflict = false,
         last_error_code = NULL,
         updated_at = now()`,
      [profileGuid, revision, operation]
    );
  }

  async function writeExperience(profileGuid, request, response, body) {
    await authenticate(request, profileGuid);
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The profile request could not be verified.', 403);
    const experience = validateExperienceDocument(body.experience);
    const baseRevision = safeRevision(body.baseRevision);
    const idempotencyKey = String(request.headers['idempotency-key'] || '');
    const lockId = parseLockToken(request.headers['lock-token']);
    if (baseRevision == null || !/^[0-9a-f-]{36}$/i.test(idempotencyKey) || !lockId) {
      throw new ProfileSyncError('write_headers_invalid', 'The profile write is missing its revision, idempotency key, or WebDAV lock.', 400);
    }
    const expectedSha = safeSha(body.baseSha);
    const decision = String(body.conflictDecision || '');
    let remote = null;
    if (decision === 'resubmit') {
      if (!github.configured) throw new ProfileSyncError('github_not_configured', 'GitHub conflict resolution is unavailable until server credentials are configured.', 503);
      remote = await github.getExperience(profileGuid);
      if ((remote?.sha || null) !== (safeSha(body.remoteSha) || null)) {
        const current = await loadProfile(profileGuid);
        jsonResponse(response, 409, await githubConflictFor(profileGuid, body.remoteSha, current?.revision, current), corsHeaders(request.headers.origin));
        return;
      }
    }
    const idempotencyHash = createHash('sha256').update(stableJsonStringify(experience), 'utf8').digest('hex');
    const client = await pool.connect();
    let newRevision;
    try {
      await client.query('BEGIN');
      const previous = await client.query(
        `SELECT payload_hash, response_revision FROM blend_profile_sync_operations
         WHERE profile_guid = $1 AND idempotency_key = $2`,
        [profileGuid, idempotencyKey]
      );
      if (previous.rowCount) {
        if (previous.rows[0].payload_hash !== idempotencyHash) {
          throw new ProfileSyncError('idempotency_key_reused', 'This profile write identifier was already used for different data.', 409);
        }
        newRevision = BigInt(previous.rows[0].response_revision);
        await client.query('COMMIT');
        const row = await loadProfile(profileGuid);
        jsonResponse(response, 200, {
          revision: String(newRevision),
          github: { status: String(row.github_status), sha: row.github_sha || null, errorCode: row.github_error_code || null }
        }, corsHeaders(request.headers.origin));
        return;
      }
      const profile = await loadProfile(profileGuid, { forUpdate: true, client });
      if (!profile || profile.deleted_at) throw new ProfileSyncError('profile_not_found', 'The profile is unavailable or has been deleted.', 404);
      const activeLock = await client.query(
        `SELECT token_hash FROM blend_profile_sync_locks WHERE profile_guid = $1 AND expires_at > now() FOR UPDATE`,
        [profileGuid]
      );
      if (!activeLock.rowCount || activeLock.rows[0].token_hash !== hash(lockId)) {
        throw new ProfileSyncError('profile_lock_expired', 'The profile lock expired. Fetch the current revision and try again.', 423);
      }
      if (BigInt(profile.revision) !== baseRevision) {
        await client.query('ROLLBACK');
        const current = await loadProfile(profileGuid);
        jsonResponse(response, 409, await githubConflictFor(profileGuid, body.baseSha, current?.revision, current), corsHeaders(request.headers.origin));
        return;
      }
      if (profile.github_status === 'conflict' && decision !== 'resubmit') {
        throw new ProfileSyncError('explicit_conflict_choice_required', 'Choose whether to resubmit this Experience or load the current saved version.', 409);
      }
      if (decision === 'resubmit' && profile.github_status !== 'conflict') {
        const remoteSha = remote?.sha || null;
        if (profile.github_status !== 'synced' || (profile.github_sha || null) !== remoteSha) {
          throw new ProfileSyncError('conflict_state_changed', 'The saved profile changed. Fetch its current state and choose again.', 409);
        }
      }
      if (decision === 'resubmit' && (remote?.sha || null) !== (safeSha(body.remoteSha) || null)) {
        throw new ProfileSyncError('github_revision_conflict', 'The GitHub file changed again. Choose whether to resubmit or load the current file.', 409);
      }
      if (decision !== 'resubmit' && (expectedSha || null) !== (profile.github_sha || null)) {
        throw new ProfileSyncError('github_revision_conflict', 'The GitHub revision changed. Fetch the current profile before saving.', 409);
      }
      newRevision = BigInt(profile.revision) + 1n;
      const nextSha = decision === 'resubmit' ? (remote?.sha || null) : profile.github_sha;
      await client.query(
        `UPDATE blend_profile_sync_profiles
         SET revision = $2, experience = $3::jsonb, github_sha = $4,
             github_status = 'pending', github_error_code = NULL, updated_at = now()
         WHERE profile_guid = $1`,
        [profileGuid, newRevision.toString(), JSON.stringify(experience), nextSha]
      );
      await queueOutbox(client, profileGuid, newRevision.toString());
      await client.query(
        `INSERT INTO blend_profile_sync_operations(profile_guid, idempotency_key, payload_hash, response_revision)
         VALUES ($1, $2, $3, $4)`,
        [profileGuid, idempotencyKey, idempotencyHash, newRevision.toString()]
      );
      await client.query(
        `DELETE FROM blend_profile_sync_locks WHERE profile_guid = $1 AND token_hash = $2`,
        [profileGuid, hash(lockId)]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    void processProfileSync(profileGuid);
    const saved = await loadProfile(profileGuid);
    await recordAudit(profileGuid, 'experience_write', 'accepted', { revision: String(newRevision) });
    jsonResponse(response, 202, {
      revision: String(newRevision),
      github: { status: String(saved.github_status), sha: saved.github_sha || null, errorCode: saved.github_error_code || null }
    }, corsHeaders(request.headers.origin));
  }

  async function acceptRemoteExperience(profileGuid, request, response, body) {
    await authenticate(request, profileGuid);
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The profile request could not be verified.', 403);
    const baseRevision = safeRevision(body.baseRevision);
    const remoteSha = safeSha(body.remoteSha);
    if (baseRevision == null || !remoteSha || !github.configured) {
      throw new ProfileSyncError('remote_accept_invalid', 'The current GitHub Experience could not be accepted.', 400);
    }
    const remote = await github.getExperience(profileGuid);
    if (!remote || remote.sha !== remoteSha) {
      const current = await loadProfile(profileGuid);
      jsonResponse(response, 409, await githubConflictFor(profileGuid, remoteSha, current?.revision, current), corsHeaders(request.headers.origin));
      return;
    }
    const client = await pool.connect();
    let updated;
    try {
      await client.query('BEGIN');
      const profile = await loadProfile(profileGuid, { forUpdate: true, client });
      if (!profile || profile.deleted_at || BigInt(profile.revision) !== baseRevision || profile.github_status !== 'conflict') {
        throw new ProfileSyncError('profile_revision_conflict', 'The profile changed while the saved Experience was being loaded.', 409);
      }
      const revision = BigInt(profile.revision) + 1n;
      const result = await client.query(
        `UPDATE blend_profile_sync_profiles
         SET revision = $2, experience = $3::jsonb, github_sha = $4,
             github_synced_revision = $2, github_status = 'synced', github_error_code = NULL, updated_at = now()
         WHERE profile_guid = $1
         RETURNING profile_guid, revision, experience, github_sha, github_synced_revision,
                   github_status, github_error_code, updated_at`,
        [profileGuid, revision.toString(), JSON.stringify(remote.experience), remote.sha]
      );
      await client.query('DELETE FROM blend_profile_sync_outbox WHERE profile_guid = $1', [profileGuid]);
      updated = result.rows[0];
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await recordAudit(profileGuid, 'conflict_accept_remote', 'success', { revision: String(updated.revision) });
    jsonResponse(response, 200, publicProfile(updated), corsHeaders(request.headers.origin));
  }

  async function readProfile(profileGuid, request, response) {
    await authenticate(request, profileGuid);
    const profile = await loadProfile(profileGuid);
    if (!profile || profile.deleted_at) throw new ProfileSyncError('profile_not_found', 'The profile is unavailable or has been deleted.', 404);
    const extra = {};
    if (profile.github_status === 'conflict' && github.configured) {
      try {
        const remote = await github.getExperience(profileGuid);
        extra.remoteExperience = remote?.experience || null;
        extra.remoteSha = remote?.sha || null;
      } catch (_) {
        extra.remoteUnavailable = true;
      }
    }
    jsonResponse(response, 200, publicProfile(profile, extra), corsHeaders(request.headers.origin));
  }

  async function processProfileSync(profileGuid) {
    if (!pool || !config.ready || !await ensureMigration()) return false;
    const claim = await pool.query(
      `UPDATE blend_profile_sync_outbox
       SET lease_until = now() + interval '30 seconds'
       WHERE profile_guid = $1 AND next_attempt_at <= now()
         AND (lease_until IS NULL OR lease_until <= now()) AND blocked_by_conflict = false
       RETURNING operation`,
      [profileGuid]
    );
    if (!claim.rowCount) return false;
    const operation = claim.rows[0].operation;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const profile = await loadProfile(profileGuid, { forUpdate: true, client });
      const outboxResult = await client.query(
        `SELECT desired_revision, operation, attempts FROM blend_profile_sync_outbox
         WHERE profile_guid = $1 AND lease_until > now() AND blocked_by_conflict = false FOR UPDATE`,
        [profileGuid]
      );
      if (!profile || !outboxResult.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      const job = outboxResult.rows[0];
      const current = await github.getExperience(profileGuid);
      const githubShaChanged = (profile.github_sha || null) !== (current?.sha || null);
      const retryAlreadyApplied = githubShaChanged && job.operation === 'put' && current
        && stableJsonStringify(current.experience) === stableJsonStringify(profile.experience);
      const retryDeleteAlreadyApplied = githubShaChanged && job.operation === 'delete' && !current;
      if (githubShaChanged && !retryAlreadyApplied && !retryDeleteAlreadyApplied && job.operation !== 'delete') {
        await client.query(
          `UPDATE blend_profile_sync_profiles SET github_status = 'conflict',
             github_error_code = 'github_revision_conflict', updated_at = now()
           WHERE profile_guid = $1`,
          [profileGuid]
        );
        await client.query(
          `UPDATE blend_profile_sync_outbox SET blocked_by_conflict = true, lease_until = NULL,
             last_error_code = 'github_revision_conflict', updated_at = now() WHERE profile_guid = $1`,
          [profileGuid]
        );
        await client.query('COMMIT');
        return false;
      }
      if (retryAlreadyApplied || retryDeleteAlreadyApplied) {
        await client.query(
          `UPDATE blend_profile_sync_profiles SET github_sha = $2,
             github_synced_revision = revision, github_status = $3, github_error_code = NULL, updated_at = now()
           WHERE profile_guid = $1`,
          [profileGuid, current?.sha || null, retryDeleteAlreadyApplied ? 'deleted' : 'synced']
        );
        await client.query('DELETE FROM blend_profile_sync_outbox WHERE profile_guid = $1', [profileGuid]);
        await client.query('COMMIT');
        return true;
      }
      if (job.operation === 'delete') {
        if (current) await github.deleteExperience(profileGuid, current.sha);
        await client.query(
          `UPDATE blend_profile_sync_profiles SET github_sha = NULL,
             github_synced_revision = revision, github_status = 'deleted', github_error_code = NULL, updated_at = now()
           WHERE profile_guid = $1`,
          [profileGuid]
        );
        await client.query('DELETE FROM blend_profile_sync_outbox WHERE profile_guid = $1', [profileGuid]);
      } else {
        if (!profile.experience) throw new ProfileSyncError('experience_missing', 'The profile has no saved Experience to synchronize.', 409);
        const pushed = await github.putExperience(profileGuid, profile.experience, current?.sha || null);
        await client.query(
          `UPDATE blend_profile_sync_profiles SET github_sha = $2,
             github_synced_revision = $3, github_status = 'synced', github_error_code = NULL, updated_at = now()
           WHERE profile_guid = $1`,
          [profileGuid, pushed.sha, profile.revision]
        );
        await client.query(
          `DELETE FROM blend_profile_sync_outbox WHERE profile_guid = $1 AND desired_revision <= $2`,
          [profileGuid, job.desired_revision]
        );
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      const mapped = apiError(error);
      const conflict = error instanceof GitHubSyncError && error.conflict;
      await pool.query(
        `UPDATE blend_profile_sync_outbox SET attempts = attempts + 1,
           next_attempt_at = now() + (LEAST(3600, (2 ^ LEAST(attempts, 10)) * 15) * interval '1 second'),
           lease_until = NULL, blocked_by_conflict = $2, last_error_code = $3, updated_at = now()
         WHERE profile_guid = $1 RETURNING attempts`,
        [profileGuid, conflict, mapped.code]
      ).catch(() => ({ rows: [] }));
      await pool.query(
        `UPDATE blend_profile_sync_profiles SET github_status = $2, github_error_code = $3, updated_at = now()
         WHERE profile_guid = $1`,
        [profileGuid, conflict ? 'conflict' : 'pending', mapped.code]
      ).catch(() => {});
      return false;
    } finally {
      client.release();
    }
  }

  async function processDueOutbox(limit = 20) {
    if (!pool || !config.ready || !await ensureMigration()) return 0;
    const ids = await pool.query(
      `SELECT profile_guid FROM blend_profile_sync_outbox
       WHERE next_attempt_at <= now() AND (lease_until IS NULL OR lease_until <= now())
         AND blocked_by_conflict = false
       ORDER BY next_attempt_at ASC LIMIT $1`,
      [Math.max(1, Math.min(100, Number(limit) || 20))]
    );
    let processed = 0;
    for (const row of ids.rows) {
      if (await processProfileSync(String(row.profile_guid))) processed += 1;
    }
    return processed;
  }

  async function prepareAdminDelete(profileGuid, request, response) {
    if (!adminAuthorized(request)) throw new ProfileSyncError('admin_unauthorized', 'The admin key is invalid.', 401);
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The admin request could not be verified.', 403);
    const profile = await loadProfile(profileGuid);
    if (!profile || profile.deleted_at) throw new ProfileSyncError('profile_not_found', 'The profile is unavailable or has already been deleted.', 404);
    const challengeId = randomUUIDFn();
    const challenge = createOpaqueToken(32, randomBytesFn);
    await pool.query(
      `INSERT INTO blend_profile_sync_admin_challenges(challenge_id, token_hash, profile_guid, operation, expires_at)
       VALUES ($1, $2, $3, 'delete_experience', now() + ($4 * interval '1 second'))`,
      [challengeId, hash(challenge), profileGuid, ADMIN_CHALLENGE_SECONDS]
    );
    await recordAudit(profileGuid, 'admin_delete_prepare', 'success');
    jsonResponse(response, 200, { challengeId, challenge, expiresInSeconds: ADMIN_CHALLENGE_SECONDS }, corsHeaders(request.headers.origin));
  }

  function adminAuthorized(request) {
    if (!config.adminConfigured) return false;
    const match = String(request.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    if (!match) return false;
    return safeEqualHex(digestAdminKey(match[1]), config.adminKeyHash);
  }

  async function commitAdminDelete(profileGuid, request, response, body) {
    if (!adminAuthorized(request)) throw new ProfileSyncError('admin_unauthorized', 'The admin key is invalid.', 401);
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The admin request could not be verified.', 403);
    const challengeId = String(body.challengeId || '');
    const challenge = String(body.challenge || '');
    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      throw new ProfileSyncError('admin_confirmation_invalid', 'The delete confirmation expired or is invalid.', 409);
    }
    const client = await pool.connect();
    let revision;
    try {
      await client.query('BEGIN');
      const profile = await loadProfile(profileGuid, { forUpdate: true, client });
      if (!profile || profile.deleted_at) throw new ProfileSyncError('profile_not_found', 'The profile is unavailable or has already been deleted.', 404);
      const confirmed = await client.query(
        `UPDATE blend_profile_sync_admin_challenges SET consumed_at = now()
         WHERE challenge_id = $1 AND profile_guid = $2 AND operation = 'delete_experience'
           AND token_hash = $3 AND expires_at > now() AND consumed_at IS NULL
         RETURNING challenge_id`,
        [challengeId, profileGuid, hash(challenge)]
      );
      if (!confirmed.rowCount) throw new ProfileSyncError('admin_confirmation_invalid', 'The delete confirmation expired or is invalid.', 409);
      revision = BigInt(profile.revision) + 1n;
      await client.query(
        `UPDATE blend_profile_sync_profiles SET deleted_at = now(), revision = $2, experience = NULL,
           github_status = 'delete_pending', github_error_code = NULL, updated_at = now()
         WHERE profile_guid = $1`,
        [profileGuid, revision.toString()]
      );
      await client.query('DELETE FROM blend_profile_sync_devices WHERE profile_guid = $1', [profileGuid]);
      await client.query('DELETE FROM blend_profile_sync_recovery_keys WHERE profile_guid = $1', [profileGuid]);
      await client.query('DELETE FROM blend_profile_sync_pending_rotations WHERE profile_guid = $1', [profileGuid]);
      await client.query('DELETE FROM blend_profile_sync_shares WHERE profile_guid = $1', [profileGuid]);
      await client.query('DELETE FROM blend_profile_sync_locks WHERE profile_guid = $1', [profileGuid]);
      await client.query('DELETE FROM blend_profile_sync_operations WHERE profile_guid = $1', [profileGuid]);
      await client.query('DELETE FROM blend_profile_sync_admin_challenges WHERE profile_guid = $1', [profileGuid]);
      await queueOutbox(client, profileGuid, revision.toString(), 'delete');
      await client.query(
        `INSERT INTO blend_profile_sync_audit(profile_guid, action, outcome, metadata)
         VALUES ($1, 'admin_delete_experience', 'accepted', $2::jsonb)`,
        [profileGuid, JSON.stringify({ revision: revision.toString() })]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    void processProfileSync(profileGuid);
    jsonResponse(response, 202, { accepted: true, revision: String(revision), status: 'delete_pending' }, corsHeaders(request.headers.origin));
  }

  async function adminHealth(request, response) {
    if (!adminAuthorized(request)) throw new ProfileSyncError('admin_unauthorized', 'The admin key is invalid.', 401);
    let database = false;
    let pending = 0;
    try {
      await pool.query('SELECT 1');
      database = true;
      const result = await pool.query('SELECT count(*)::integer AS count FROM blend_profile_sync_outbox');
      pending = Number(result.rows[0]?.count || 0);
    } catch (_) {}
    let githubStatus = github.configured ? 'unavailable' : 'not_configured';
    if (github.configured) {
      try { await github.health(); githubStatus = 'available'; } catch (error) {
        githubStatus = error instanceof GitHubSyncError ? error.code : 'unavailable';
      }
    }
    jsonResponse(response, 200, {
      database: database ? 'available' : 'unavailable',
      github: githubStatus,
      githubRepository: github.repository,
      githubBranch: github.branch,
      allowedOriginCount: config.origins.size,
      adminKeyConfigured: config.adminConfigured,
      pendingSyncCount: pending
    }, corsHeaders(request.headers.origin));
  }

  async function adminProfile(profileGuid, request, response) {
    if (!adminAuthorized(request)) throw new ProfileSyncError('admin_unauthorized', 'The admin key is invalid.', 401);
    const result = await pool.query(
      `SELECT p.profile_guid, p.revision, p.github_sha, p.github_synced_revision,
              p.github_status, p.github_error_code, p.recovery_generation, p.deleted_at,
              p.created_at, p.updated_at, o.desired_revision, o.operation, o.attempts,
              o.next_attempt_at, o.blocked_by_conflict, o.last_error_code
       FROM blend_profile_sync_profiles p
       LEFT JOIN blend_profile_sync_outbox o USING (profile_guid)
       WHERE p.profile_guid = $1`,
      [profileGuid]
    );
    const row = result.rows[0];
    if (!row) throw new ProfileSyncError('profile_not_found', 'The profile was not found.', 404);
    jsonResponse(response, 200, {
      profileGuid: String(row.profile_guid),
      revision: String(row.revision),
      github: {
        sha: row.github_sha || null,
        syncedRevision: String(row.github_synced_revision || 0),
        status: row.github_status,
        errorCode: row.github_error_code || null
      },
      recoveryGeneration: Number(row.recovery_generation),
      deleted: !!row.deleted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      outbox: row.desired_revision == null ? null : {
        desiredRevision: String(row.desired_revision),
        operation: row.operation,
        attempts: Number(row.attempts),
        nextAttemptAt: row.next_attempt_at,
        blockedByConflict: !!row.blocked_by_conflict,
        lastErrorCode: row.last_error_code || null
      }
    }, corsHeaders(request.headers.origin));
  }

  async function retryAdminSync(profileGuid, request, response) {
    if (!adminAuthorized(request)) throw new ProfileSyncError('admin_unauthorized', 'The admin key is invalid.', 401);
    if (!mutationAllowed(request)) throw new ProfileSyncError('csrf_check_failed', 'The admin request could not be verified.', 403);
    if (!github.configured) throw new ProfileSyncError('github_not_configured', 'GitHub retry is unavailable until server credentials are configured.', 503);
    const client = await pool.connect();
    let row;
    try {
      await client.query('BEGIN');
      const profile = await loadProfile(profileGuid, { forUpdate: true, client });
      if (!profile) throw new ProfileSyncError('profile_not_found', 'The profile was not found.', 404);
      if (profile.deleted_at) {
        const existing = await client.query(
          `SELECT operation FROM blend_profile_sync_outbox WHERE profile_guid = $1 FOR UPDATE`,
          [profileGuid]
        );
        if (!existing.rowCount || existing.rows[0].operation !== 'delete') {
          throw new ProfileSyncError('sync_retry_not_eligible', 'This profile has no eligible synchronization retry.', 409);
        }
      } else {
        if (profile.github_status === 'conflict') {
          throw new ProfileSyncError('sync_conflict_requires_user_choice', 'Resolve the GitHub revision conflict in an enrolled browser first.', 409);
        }
        if (!profile.experience) throw new ProfileSyncError('experience_missing', 'This profile has no saved Experience to retry.', 409);
      }
      await queueOutbox(client, profileGuid, profile.revision.toString(), profile.deleted_at ? 'delete' : 'put');
      await client.query(
        `UPDATE blend_profile_sync_profiles SET github_status = $2, github_error_code = NULL, updated_at = now()
         WHERE profile_guid = $1`,
        [profileGuid, profile.deleted_at ? 'delete_pending' : 'pending']
      );
      const loaded = await loadProfile(profileGuid, { client });
      row = loaded;
      await client.query(
        `INSERT INTO blend_profile_sync_audit(profile_guid, action, outcome, metadata)
         VALUES ($1, 'admin_sync_retry', 'accepted', $2::jsonb)`,
        [profileGuid, JSON.stringify({ revision: String(profile.revision) })]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await processProfileSync(profileGuid);
    row = await loadProfile(profileGuid);
    jsonResponse(response, 202, { status: row?.github_status || 'pending', revision: String(row?.revision || 0) }, corsHeaders(request.headers.origin));
  }

  async function route(request, response, pathname) {
    if (pathname !== PROFILE_SYNC_API_PATH && !pathname.startsWith(API_PREFIX)) return false;
    const origin = String(request.headers.origin || '');
    const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').trim().toLowerCase();
    const serviceOrigin = forwardedHost && forwardedProtocol === 'https' ? `https://${forwardedHost}` : '';
    if (!config.origins.has(origin) && origin !== serviceOrigin) {
      jsonResponse(response, 403, { error: { code: 'origin_not_allowed', message: 'This app origin is not allowed to use profile sync.' } });
      return true;
    }
    const headers = corsHeaders(origin);
    if (request.method === 'OPTIONS') {
      emptyResponse(response, 204, headers);
      return true;
    }
    if (!pool || !config.ready) {
      jsonResponse(response, 503, { error: { code: 'profile_sync_unavailable', message: 'Profile sync is not configured on this service.' } }, headers);
      return true;
    }
    try {
      const migrated = await ensureMigration();
      const address = requestAddress(request, config.trustProxy);
      const isAdminPath = pathname.startsWith(`${PROFILE_SYNC_API_PATH}/admin/`);
      const isAdminHealthPath = pathname === `${PROFILE_SYNC_API_PATH}/admin/health` && request.method === 'GET';
      if (!(isAdminPath ? checkAdminRate(`${address}:admin`) : checkGeneralRate(`${address}:profile`))) {
        throw new ProfileSyncError('rate_limited', 'Profile sync is temporarily rate limited. Try again shortly.', 429);
      }
      if (!migrated && !isAdminHealthPath) {
        throw new ProfileSyncError('profile_sync_unavailable', 'Profile sync storage is not ready on this service.', 503);
      }
      if (request.method === 'POST' || request.method === 'PUT' || request.method === 'LOCK'
          || request.method === 'UNLOCK') {
        if (isAdminPath || /\/recovery\/|\/enroll$|\/share$|\/initialize$/.test(pathname)) {
          if (!checkSensitiveRate(`${address}:sensitive`)) {
            throw new ProfileSyncError('rate_limited', 'Profile sync is temporarily rate limited. Try again shortly.', 429);
          }
        }
        const fetchSite = String(request.headers['sec-fetch-site'] || '').toLowerCase();
        if (['cross-site', 'none'].includes(fetchSite)) {
          throw new ProfileSyncError('request_origin_invalid', 'The profile request could not be verified.', 403);
        }
      }

      const adminHealthPath = `${PROFILE_SYNC_API_PATH}/admin/health`;
      if (pathname === adminHealthPath && request.method === 'GET') {
        await adminHealth(request, response);
        return true;
      }
      const adminProfileMatch = pathname.match(/^\/api\/profile-sync\/admin\/profiles\/([^/]+)(?:\/(retry|delete\/prepare|delete))?$/);
      if (adminProfileMatch) {
        const profileGuid = normalizeProfileGuid(adminProfileMatch[1]);
        const action = adminProfileMatch[2] || '';
        if (!action && request.method === 'GET') await adminProfile(profileGuid, request, response);
        else if (action === 'retry' && request.method === 'POST') await retryAdminSync(profileGuid, request, response);
        else if (action === 'delete/prepare' && request.method === 'POST') await prepareAdminDelete(profileGuid, request, response);
        else if (action === 'delete' && request.method === 'POST') await commitAdminDelete(profileGuid, request, response, await readJsonBody(request));
        else throw new ProfileSyncError('route_not_found', 'The profile sync route was not found.', 404);
        return true;
      }

      const match = pathname.match(/^\/api\/profile-sync\/profiles\/([^/]+)(?:\/(.+))?$/);
      if (!match) throw new ProfileSyncError('route_not_found', 'The profile sync route was not found.', 404);
      const profileGuid = normalizeProfileGuid(match[1]);
      const action = match[2] || '';
      if (action === 'initialize' && request.method === 'POST') {
        await initializeProfile(profileGuid, request, response);
        return true;
      }
      if (action === 'enroll' && request.method === 'POST') {
        await enrollProfile(profileGuid, request, response, await readJsonBody(request));
        return true;
      }
      if (action === 'recovery/rotate' && request.method === 'POST') {
        await createRecoveryRotation(profileGuid, request, response);
        return true;
      }
      if (action === 'recovery/rotate/commit' && request.method === 'POST') {
        await commitRecoveryRotation(profileGuid, request, response, await readJsonBody(request));
        return true;
      }
      if (action === 'share' && request.method === 'POST') {
        await createShareLink(profileGuid, request, response);
        return true;
      }
      if (action === 'accept-remote' && request.method === 'POST') {
        await acceptRemoteExperience(profileGuid, request, response, await readJsonBody(request));
        return true;
      }
      if (action === 'disconnect' && request.method === 'POST') {
        await disconnectDevice(profileGuid, request, response);
        return true;
      }
      if (action === 'experience' && request.method === 'LOCK') {
        await createLock(profileGuid, request, response, await readJsonBody(request));
        return true;
      }
      if (action === 'experience' && request.method === 'UNLOCK') {
        await releaseLock(profileGuid, request, response);
        return true;
      }
      if (action === 'experience' && request.method === 'PUT') {
        await writeExperience(profileGuid, request, response, await readJsonBody(request));
        return true;
      }
      if (!action && request.method === 'GET') {
        await readProfile(profileGuid, request, response);
        return true;
      }
      throw new ProfileSyncError('route_not_found', 'The profile sync route was not found.', 404);
    } catch (error) {
      const result = apiError(error);
      if (error instanceof ProfileSyncError && error.code === 'recovery_key_invalid') {
        await recordAudit(null, 'device_enroll_recovery', 'rejected', { code: error.code }).catch(() => {});
      }
      jsonResponse(response, result.status, {
        error: {
          code: result.code,
          message: result.message,
          ...(result.details ? { details: result.details } : {})
        }
      }, headers);
      return true;
    }
  }

  function health() {
    return {
      profileSyncConfigured: !!pool && config.ready && migrationReady,
      profileSyncMigrationReady: migrationReady,
      githubConfigured: github.configured
    };
  }

  return Object.freeze({
    route,
    health,
    initialize: ensureMigration,
    processProfileSync,
    processDueOutbox,
    github
  });
}
