const PLACEHOLDER_DEFAULTS = Object.freeze({
  SUPABASE_URL: 'https://lqpmmviiloztbanshfxy.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcG1tdmlpbG96dGJhbnNoZnh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4Mjc3MjgsImV4cCI6MjA5NjQwMzcyOH0.B7Oy2oH7YFPxgIvXLTPvduP7YFViiDaLfhROIJ44pOQ',
  SUPABASE_STORAGE_BUCKET: 'https://lqpmmviiloztbanshfxy.storage.supabase.co/storage/v1/s3',
  SUPABASE_CDN_BASE_URL: 'https://api.cloudflare.com/client/v4/accounts/<account_id>/d1/database',
  SUPABASE_AUTH_REDIRECT_URL: 'https://mytech.today/tools/player/v/index.html',
  SIGNED_URL_TTL_SECONDS: '1209600',
  MEDIA_METADATA_SOURCE: 'browser',
  SUPABASE_MEDIA_BUCKET: 'media',
  SUPABASE_PUBLIC_BUCKETS: 'public'
});

const RUNTIME_CONFIG_KEY = 'blend-runtime-config-v1';

function normalizeUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) {
    return fallback;
  }
}

function asPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function splitList(value) {
  return String(value || '')
    .split(/[,\n]+/g)
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);
}

function stripWrappedQuotes(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function readRuntimeConfigOverrides() {
  const globalConfig = globalThis.BLEND_RUNTIME_CONFIG || globalThis.__BLEND_RUNTIME_CONFIG__ || {};
  const localStorageConfig = (() => {
    try {
      const raw = globalThis.localStorage?.getItem(RUNTIME_CONFIG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  })();
  return {
    ...globalConfig,
    ...localStorageConfig
  };
}

export function getBlendRuntimeConfig(overrides = {}) {
  const runtime = readRuntimeConfigOverrides();
  const source = {
    ...PLACEHOLDER_DEFAULTS,
    ...runtime,
    ...overrides
  };

  const supabaseUrl = normalizeUrl(source.SUPABASE_URL, PLACEHOLDER_DEFAULTS.SUPABASE_URL);
  const supabaseAnonKey = String(source.SUPABASE_ANON_KEY || PLACEHOLDER_DEFAULTS.SUPABASE_ANON_KEY).trim();
  const authRedirectUrl = normalizeUrl(source.SUPABASE_AUTH_REDIRECT_URL, PLACEHOLDER_DEFAULTS.SUPABASE_AUTH_REDIRECT_URL);
  const cdnBaseUrl = normalizeUrl(source.SUPABASE_CDN_BASE_URL, PLACEHOLDER_DEFAULTS.SUPABASE_CDN_BASE_URL);
  const defaultBucket = String(source.SUPABASE_MEDIA_BUCKET || PLACEHOLDER_DEFAULTS.SUPABASE_MEDIA_BUCKET).trim() || 'media';
  const publicBucketAllowList = splitList(source.SUPABASE_PUBLIC_BUCKETS || PLACEHOLDER_DEFAULTS.SUPABASE_PUBLIC_BUCKETS);

  return Object.freeze({
    supabaseUrl,
    supabaseAnonKey,
    storageBucket: String(source.SUPABASE_STORAGE_BUCKET || PLACEHOLDER_DEFAULTS.SUPABASE_STORAGE_BUCKET).trim(),
    cdnBaseUrl,
    authRedirectUrl,
    signedUrlTtlSeconds: asPositiveInt(source.SIGNED_URL_TTL_SECONDS, 1209600),
    mediaMetadataSource: stripWrappedQuotes(source.MEDIA_METADATA_SOURCE || PLACEHOLDER_DEFAULTS.MEDIA_METADATA_SOURCE) || 'browser',
    defaultBucket,
    publicBucketAllowList,
    runtimeConfigKey: RUNTIME_CONFIG_KEY,
    placeholders: PLACEHOLDER_DEFAULTS
  });
}

export function saveBlendRuntimeConfig(overrides = {}) {
  if (!overrides || typeof overrides !== 'object') return false;
  try {
    const existing = readRuntimeConfigOverrides();
    const merged = { ...existing, ...overrides };
    globalThis.localStorage?.setItem(RUNTIME_CONFIG_KEY, JSON.stringify(merged));
    return true;
  } catch (_) {
    return false;
  }
}

export function clearBlendRuntimeConfig() {
  try {
    globalThis.localStorage?.removeItem(RUNTIME_CONFIG_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

export { PLACEHOLDER_DEFAULTS };
