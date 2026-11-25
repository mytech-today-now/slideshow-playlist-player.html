export const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;
export const LEGACY_DEFAULT_SIGNED_URL_TTL_SECONDS = 1209600;
export const SIGNED_URL_TTL_POLICY_VERSION = 1;

const PLACEHOLDER_DEFAULTS = Object.freeze({
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  SUPABASE_STORAGE_BUCKET: '',
  SUPABASE_CDN_BASE_URL: '',
  SUPABASE_AUTH_REDIRECT_URL: '',
  SIGNED_URL_TTL_SECONDS: String(DEFAULT_SIGNED_URL_TTL_SECONDS),
  MEDIA_METADATA_SOURCE: 'browser',
  SUPABASE_MEDIA_BUCKET: 'media',
  SUPABASE_PUBLIC_BUCKETS: 'public'
});

const RUNTIME_CONFIG_KEY = 'blend-runtime-config-v1';
const RUNTIME_CONFIG_TAB_KEY = 'blend-runtime-config-tab-v1';
const RUNTIME_CONFIG_REVIEW_KEY = 'blend-runtime-config-review-v1';
const CONNECTION_CONFIRMATION_KEYS = new Set([
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_AUTH_REDIRECT_URL'
]);

function normalizeHttpUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return fallback;
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) {
    return fallback;
  }
}

function currentOrigin() {
  try {
    const location = globalThis.location;
    const value = String(location?.origin || location?.href || '').trim();
    const origin = new URL(value).origin;
    return origin && origin !== 'null' ? origin : '';
  } catch (_) {
    return '';
  }
}

function normalizeAuthRedirectUrl(value, fallback = '') {
  const normalized = normalizeHttpUrl(value, fallback);
  if (!normalized) return fallback;
  const origin = currentOrigin();
  if (!origin) return fallback;
  try {
    return new URL(normalized).origin === origin ? normalized : fallback;
  } catch (_) {
    return fallback;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch (_) {
    return false;
  }
}

function normalizeRuntimeConfig(source, label = 'Runtime') {
  if (!isPlainObject(source)) {
    return {
      config: {},
      warnings: source == null ? [] : [`${label} connection settings were ignored because they are not an object.`]
    };
  }

  const config = {};
  const warnings = [];
  for (const key of Object.keys(PLACEHOLDER_DEFAULTS)) {
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    if (key === 'SUPABASE_URL') {
      const raw = String(value || '').trim();
      const normalized = normalizeHttpUrl(raw);
      if (raw && !normalized) warnings.push(`${label} project URL was ignored because it must be an HTTP(S) URL without embedded credentials.`);
      else config[key] = normalized;
    } else if (key === 'SUPABASE_CDN_BASE_URL') {
      const raw = String(value || '').trim();
      const normalized = normalizeHttpUrl(raw);
      if (raw && !normalized) warnings.push(`${label} CDN URL was ignored because it must be an HTTP(S) URL without embedded credentials.`);
      else config[key] = normalized;
    } else if (key === 'SUPABASE_AUTH_REDIRECT_URL') {
      const raw = String(value || '').trim();
      const normalized = normalizeAuthRedirectUrl(raw);
      if (raw && !normalized) warnings.push(`${label} Auth redirect URL was ignored because it must use this app's HTTP(S) origin.`);
      else config[key] = normalized;
    } else if (key === 'SUPABASE_ANON_KEY') {
      config[key] = String(value || '').trim();
    } else if (key === 'SIGNED_URL_TTL_SECONDS') {
      config[key] = value === undefined ? PLACEHOLDER_DEFAULTS.SIGNED_URL_TTL_SECONDS : String(value ?? '');
    } else {
      config[key] = String(value ?? '').trim();
    }
  }
  return { config, warnings };
}

function hasRuntimeConfigValues(config = {}) {
  return Object.values(config).some(value => String(value || '').trim() !== '');
}

function runtimeConfigFingerprint(source, config) {
  const value = JSON.stringify({ source, config });
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16)}`;
}

function readStorageConfig(storageName, key, label) {
  let storage;
  try {
    storage = globalThis[storageName];
  } catch (_) {
    return { readable: false, config: {}, warnings: [`${label} connection settings could not be read.`] };
  }
  if (!storage) {
    const inBrowser = typeof globalThis.window === 'object' || typeof globalThis.document === 'object';
    if (storageName === 'sessionStorage' && !inBrowser) {
      return { readable: true, config: {}, warnings: [] };
    }
    if (storageName === 'sessionStorage' && typeof globalThis.sessionStorage === 'undefined') {
      return { readable: true, config: {}, warnings: [] };
    }
    return {
      readable: !inBrowser,
      config: {},
      warnings: inBrowser ? [`${label} connection settings could not be read.`] : []
    };
  }
  if (typeof storage.getItem !== 'function') {
    return { readable: false, config: {}, warnings: [`${label} connection settings could not be read.`] };
  }
  try {
    const raw = storage.getItem(key);
    if (!raw) return { readable: true, config: {}, warnings: [] };
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      return { readable: false, config: {}, warnings: [`${label} connection settings could not be read.`] };
    }
    const normalized = normalizeRuntimeConfig(parsed, label);
    return { readable: true, config: normalized.config, warnings: normalized.warnings };
  } catch (_) {
    return { readable: false, config: {}, warnings: [`${label} connection settings could not be read.`] };
  }
}

function readReviewRecord() {
  let storage;
  try { storage = globalThis.sessionStorage; } catch (_) { return null; }
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const raw = storage.getItem(RUNTIME_CONFIG_REVIEW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function isReviewed(source, config, record = readReviewRecord()) {
  return record?.source === source &&
    record?.fingerprint === runtimeConfigFingerprint(source, config);
}

function writeReviewRecord(source, config) {
  let storage;
  try { storage = globalThis.sessionStorage; } catch (_) { return false; }
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(RUNTIME_CONFIG_REVIEW_KEY, JSON.stringify({
      source,
      fingerprint: runtimeConfigFingerprint(source, config)
    }));
    return true;
  } catch (_) {
    return false;
  }
}

function writeTabRuntimeConfig(config) {
  let storage;
  try { storage = globalThis.sessionStorage; } catch (_) { return false; }
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(RUNTIME_CONFIG_TAB_KEY, JSON.stringify(config));
    return writeReviewRecord('tab', config);
  } catch (_) {
    return false;
  }
}

function readRuntimeConfigSources() {
  const local = readStorageConfig('localStorage', RUNTIME_CONFIG_KEY, 'Saved');
  const tab = readStorageConfig('sessionStorage', RUNTIME_CONFIG_TAB_KEY, 'Tab-only');
  const review = readReviewRecord();
  const localReviewed = local.readable && hasRuntimeConfigValues(local.config) && isReviewed('local', local.config, review);
  const tabReviewed = tab.readable && hasRuntimeConfigValues(tab.config) && isReviewed('tab', tab.config, review);
  const activeStoredConfig = tabReviewed ? tab.config : (localReviewed ? local.config : {});
  return {
    local,
    tab,
    localReviewed,
    tabReviewed,
    activeStoredConfig,
    reviewRequired: hasRuntimeConfigValues(local.config) && !localReviewed && !tabReviewed
  };
}

function readHostRuntimeConfig() {
  try {
    const host = globalThis.BLEND_RUNTIME_CONFIG || globalThis.__BLEND_RUNTIME_CONFIG__ || {};
    return normalizeRuntimeConfig(host, 'Host-injected');
  } catch (_) {
    return { config: {}, warnings: ['Host-injected connection settings could not be read.'] };
  }
}

function asPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

export function isLegacySignedUrlTtlSetting(settings = {}) {
  return Number(settings?.storageSignedUrlTtlSeconds) === LEGACY_DEFAULT_SIGNED_URL_TTL_SECONDS &&
    Number(settings?.storageSignedUrlTtlPolicyVersion || 0) < SIGNED_URL_TTL_POLICY_VERSION;
}

export function normalizeSavedSignedUrlTtlSettings(settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  const normalized = { ...settings };
  if (isLegacySignedUrlTtlSetting(settings)) {
    normalized.storageSignedUrlTtlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS;
  }
  if (Number(settings.storageSignedUrlTtlPolicyVersion || 0) < SIGNED_URL_TTL_POLICY_VERSION) {
    normalized.storageSignedUrlTtlPolicyVersion = SIGNED_URL_TTL_POLICY_VERSION;
  }
  return normalized;
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

export function getBlendRuntimeConfig(overrides = {}) {
  const sources = readRuntimeConfigSources();
  const host = readHostRuntimeConfig();
  const explicit = normalizeRuntimeConfig(overrides, 'Explicit');
  const source = {
    ...PLACEHOLDER_DEFAULTS,
    ...sources.activeStoredConfig,
    ...host.config,
    ...explicit.config
  };

  const supabaseUrl = normalizeHttpUrl(source.SUPABASE_URL, PLACEHOLDER_DEFAULTS.SUPABASE_URL);
  const supabaseAnonKey = String(source.SUPABASE_ANON_KEY || PLACEHOLDER_DEFAULTS.SUPABASE_ANON_KEY).trim();
  const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
  const authRedirectUrl = normalizeAuthRedirectUrl(source.SUPABASE_AUTH_REDIRECT_URL, PLACEHOLDER_DEFAULTS.SUPABASE_AUTH_REDIRECT_URL);
  const cdnBaseUrl = normalizeHttpUrl(source.SUPABASE_CDN_BASE_URL, PLACEHOLDER_DEFAULTS.SUPABASE_CDN_BASE_URL);
  const defaultBucket = String(source.SUPABASE_MEDIA_BUCKET || PLACEHOLDER_DEFAULTS.SUPABASE_MEDIA_BUCKET).trim() || 'media';
  const publicBucketAllowList = splitList(source.SUPABASE_PUBLIC_BUCKETS || PLACEHOLDER_DEFAULTS.SUPABASE_PUBLIC_BUCKETS);
  const hostConfigured = hasRuntimeConfigValues(host.config);
  const explicitConfigured = hasRuntimeConfigValues(explicit.config);
  const warnings = [
    ...sources.local.warnings,
    ...sources.tab.warnings,
    ...host.warnings,
    ...explicit.warnings
  ];
  if (sources.reviewRequired) warnings.push('Saved connection settings are pending operator review in this tab.');
  if (!sources.local.readable && !hostConfigured) {
    warnings.push('Saved connection settings could not be read. Blend is using the built-in unconfigured defaults for this tab. Re-enter your project URL from Configuration if you use private Storage.');
  } else if (!sources.local.readable && hostConfigured) {
    warnings.push('Saved connection settings could not be read. Blend is using its host-injected configuration for this tab.');
  }

  let runtimeConfigSource = 'defaults';
  if (sources.localReviewed) runtimeConfigSource = 'localStorage';
  if (sources.tabReviewed) runtimeConfigSource = 'tab-session';
  if (hostConfigured) runtimeConfigSource = 'host-injected';
  if (explicitConfigured) runtimeConfigSource = 'explicit';

  return Object.freeze({
    supabaseUrl,
    supabaseAnonKey,
    supabaseConfigured,
    storageBucket: String(source.SUPABASE_STORAGE_BUCKET || PLACEHOLDER_DEFAULTS.SUPABASE_STORAGE_BUCKET).trim(),
    cdnBaseUrl,
    authRedirectUrl,
    signedUrlTtlSeconds: asPositiveInt(source.SIGNED_URL_TTL_SECONDS, DEFAULT_SIGNED_URL_TTL_SECONDS),
    mediaMetadataSource: stripWrappedQuotes(source.MEDIA_METADATA_SOURCE || PLACEHOLDER_DEFAULTS.MEDIA_METADATA_SOURCE) || 'browser',
    defaultBucket,
    publicBucketAllowList,
    runtimeConfigKey: RUNTIME_CONFIG_KEY,
    runtimeConfigSource,
    runtimeConfigReviewRequired: sources.reviewRequired && !hostConfigured,
    runtimeConfigStorageReadable: sources.local.readable,
    runtimeConfigWarnings: Object.freeze(warnings),
    placeholders: PLACEHOLDER_DEFAULTS
  });
}

export function readPendingBlendRuntimeConfig() {
  const sources = readRuntimeConfigSources();
  const warnings = [
    ...sources.local.warnings,
    ...sources.tab.warnings
  ];
  if (sources.reviewRequired) warnings.push('Saved connection settings are pending operator review in this tab.');
  return Object.freeze({
    config: Object.freeze({ ...(sources.tabReviewed ? sources.tab.config : sources.local.config) }),
    reviewRequired: sources.reviewRequired,
    readable: sources.local.readable,
    tabOnly: sources.tabReviewed,
    warnings: Object.freeze(warnings)
  });
}

export function saveBlendRuntimeConfig(overrides = {}, { confirmed = false } = {}) {
  if (!isPlainObject(overrides)) {
    return { saved: false, active: false, reason: 'invalid-config', warnings: ['Connection settings must be a plain object.'] };
  }
  const existing = readStorageConfig('localStorage', RUNTIME_CONFIG_KEY, 'Saved').config;
  const requiresConfirmation = [...CONNECTION_CONFIRMATION_KEYS].some(key => (
    Object.hasOwn(overrides, key) || Object.hasOwn(existing, key)
  ));
  if (requiresConfirmation && confirmed !== true) {
    return { saved: false, active: false, reason: 'confirmation-required', warnings: ['Review and confirm the project URL, anon key, and redirect before saving.'] };
  }

  const normalizedOverrides = normalizeRuntimeConfig(overrides, 'Entered');
  const invalidOverride = normalizedOverrides.warnings.length > 0;
  if (invalidOverride) {
    return { saved: false, active: false, reason: 'invalid-config', warnings: normalizedOverrides.warnings };
  }
  const merged = normalizeRuntimeConfig({ ...existing, ...normalizedOverrides.config }, 'Entered');
  if (merged.warnings.length) {
    return { saved: false, active: false, reason: 'invalid-config', warnings: merged.warnings };
  }

  const serialized = JSON.stringify(merged.config);
  let saved = false;
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.setItem !== 'function') throw new Error('storage_unavailable');
    storage.setItem(RUNTIME_CONFIG_KEY, serialized);
    saved = true;
  } catch (_) {
    saved = false;
  }

  if (saved && writeReviewRecord('local', merged.config)) {
    return { saved: true, active: true, tabOnly: false, warnings: [] };
  }
  if (writeTabRuntimeConfig(merged.config)) {
    return {
      saved,
      active: true,
      tabOnly: true,
      reason: saved ? 'review-state-session-only' : 'local-storage-write-failed',
      warnings: saved
        ? ['Connection settings were saved, but review is limited to this tab.']
        : ['Connection settings are available for this tab only and were not saved to LocalStorage.']
    };
  }
  return {
    saved,
    active: false,
    tabOnly: false,
    reason: saved ? 'review-state-unavailable' : 'local-storage-write-failed',
    warnings: saved
      ? ['Connection settings were saved but could not be activated in this tab because review state is unavailable.']
      : ['Connection settings could not be saved or kept for this tab. The active connection was not changed.']
  };
}

export function clearBlendRuntimeConfig() {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.removeItem !== 'function') return false;
    storage.removeItem(RUNTIME_CONFIG_KEY);
  } catch (_) {
    return false;
  }
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return true;
    if (typeof storage.removeItem !== 'function') return false;
    storage.removeItem(RUNTIME_CONFIG_TAB_KEY);
    storage.removeItem(RUNTIME_CONFIG_REVIEW_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

export { PLACEHOLDER_DEFAULTS };
