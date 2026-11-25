import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const PROFILE_SYNC_API_PATH = '/api/profile-sync';
export const PROFILE_SYNC_COOKIE = 'blend_profile_device_v1';
export const PROFILE_SYNC_SCHEMA = 'player.blend.experience.v2';
export const PROFILE_SYNC_MAX_EXPERIENCE_BYTES = 5 * 1024 * 1024;
export const PROFILE_SYNC_DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const PROFILE_SYNC_SHARE_TTL_SECONDS = 10 * 60;

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ORIGIN_PROTOCOLS = new Set(['https:']);

export class ProfileSyncError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'ProfileSyncError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeProfileGuid(value) {
  const candidate = String(value || '').trim();
  if (!GUID_PATTERN.test(candidate)) {
    throw new ProfileSyncError('profile_guid_invalid', 'The profile identifier must be a valid GUID.');
  }
  return candidate.toLowerCase();
}

export function isProfileGuid(value) {
  return GUID_PATTERN.test(String(value || '').trim());
}

export function normalizeAllowedOrigins(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(',');
  const origins = new Set();
  for (const entry of entries) {
    const candidate = String(entry || '').trim();
    if (!candidate) continue;
    let url;
    try { url = new URL(candidate); } catch (_) {
      throw new ProfileSyncError('profile_sync_origin_config_invalid', 'A configured app origin is invalid.', 500);
    }
    if (!SAFE_ORIGIN_PROTOCOLS.has(url.protocol) || url.origin !== candidate || url.username || url.password) {
      throw new ProfileSyncError('profile_sync_origin_config_invalid', 'Configured app origins must be exact HTTPS origins.', 500);
    }
    origins.add(candidate);
  }
  return origins;
}

export function validateExperienceDocument(value, maxBytes = PROFILE_SYNC_MAX_EXPERIENCE_BYTES) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProfileSyncError('experience_invalid', 'The saved Experience must be a JSON object.');
  }
  if (value.schema !== PROFILE_SYNC_SCHEMA || value.type !== 'experience') {
    throw new ProfileSyncError('experience_schema_invalid', 'The Experience must use the player.blend.experience.v2 format.');
  }
  let serialized;
  try { serialized = JSON.stringify(value); } catch (_) {
    throw new ProfileSyncError('experience_invalid', 'The Experience could not be serialized as JSON.');
  }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new ProfileSyncError('experience_too_large', 'The serialized Experience is larger than the profile sync limit.', 413);
  }
  try {
    return JSON.parse(serialized);
  } catch (_) {
    throw new ProfileSyncError('experience_invalid', 'The Experience could not be serialized as JSON.');
  }
}

export function stableJsonStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function githubExperiencePath(guid) {
  return `experiences/${normalizeProfileGuid(guid)}/experience.json`;
}

export function hashSecret(value, pepper) {
  const key = Buffer.from(String(pepper || ''), 'utf8');
  if (key.length < 32) {
    throw new ProfileSyncError('profile_sync_pepper_missing', 'Profile sync token protection is not configured.', 503);
  }
  return createHmac('sha256', key).update(String(value || ''), 'utf8').digest('hex');
}

export function createOpaqueToken(size = 32, randomBytesFn = randomBytes) {
  return randomBytesFn(size).toString('base64url');
}

export function createRecoveryKeys(randomBytesFn = randomBytes) {
  return Array.from({ length: 10 }, () => `BLD1-${randomBytesFn(20).toString('base64url')}`);
}

export function safeEqualHex(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

export function validProfileSyncCookie(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

export function profileSyncCookieHeader(request, value, {
  maxAge = PROFILE_SYNC_DEVICE_TTL_SECONDS,
  sameSite = 'Strict'
} = {}) {
  const forwardedProtocol = String(request?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwardedProtocol !== 'https') {
    throw new ProfileSyncError('profile_sync_https_required', 'Profile sync requires HTTPS.', 400);
  }
  const normalizedSameSite = String(sameSite || '').trim();
  if (!['Strict', 'Lax', 'None'].includes(normalizedSameSite)) {
    throw new ProfileSyncError('profile_sync_cookie_config_invalid', 'The profile sync cookie policy is invalid.', 500);
  }
  return `${PROFILE_SYNC_COOKIE}=${value}; Path=${PROFILE_SYNC_API_PATH}; Max-Age=${Math.max(0, Math.floor(maxAge))}; Secure; HttpOnly; SameSite=${normalizedSameSite}`;
}

export function isSameOrNewerRevision(candidate, current) {
  try { return BigInt(candidate) >= BigInt(current); } catch (_) { return false; }
}

export function createRateLimiter({ limit, windowMs, now = Date.now, maxEntries = 20_000 } = {}) {
  const entries = new Map();
  return function checkRateLimit(key) {
    const currentTime = now();
    const normalized = String(key || 'unknown').slice(0, 180);
    const current = entries.get(normalized);
    if (!current || current.expiresAt <= currentTime) {
      entries.set(normalized, { count: 1, expiresAt: currentTime + windowMs });
      if (entries.size > maxEntries) {
        for (const [entryKey, entry] of entries) {
          if (entry.expiresAt <= currentTime) entries.delete(entryKey);
        }
        if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      }
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  };
}
