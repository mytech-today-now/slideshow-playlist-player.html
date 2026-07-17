const HTTP_URL_RE = /^https?:\/\//i;
const LEGACY_IPFS_URI_RE = /^ipfs:\/\//i;
const SUPABASE_URI_RE = /^(supabase|storage):\/\//i;
const SUPABASE_BUCKET_PATH_RE = /^([a-z0-9][a-z0-9._-]{1,62})([/:])(.+)$/i;

const DEFAULT_RETRY = Object.freeze({
  attempts: 3,
  baseDelayMs: 250
});

export class StorageResolverError extends Error {
  constructor(message, { code = 'resolver_error', status = 0, retryable = false, cause = null } = {}) {
    super(message || 'Unable to resolve media URL');
    this.name = 'StorageResolverError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms | 0)));
}

function nowMs() {
  return Date.now();
}

function sanitizePath(path = '') {
  return String(path || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')
    .map(seg => encodeURIComponent(decodeURIComponent(seg)))
    .join('/');
}

function encodePath(path = '') {
  return sanitizePath(path).replace(/%2F/gi, '/');
}

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

function normalizeBucket(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9._-]/g, '');
}

function looksLikeLineReferencePath(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (!/^\d+(?::\d+)?(?:\s|$)/.test(raw)) return false;
  const firstToken = raw.split(/\s+/, 1)[0] || '';
  return !/\.[a-z0-9]{2,5}$/i.test(firstToken);
}

export function isLegacyIpfsReference(value) {
  return LEGACY_IPFS_URI_RE.test(String(value || '').trim());
}

export function sanitizeLegacyIpfsReference(value) {
  const raw = String(value || '').trim();
  if (!isLegacyIpfsReference(raw)) return '';
  const payload = raw.replace(LEGACY_IPFS_URI_RE, '');
  const [cidPart, ...rest] = payload.split('/');
  const cid = String(cidPart || '').trim();
  if (!cid || cid.length > 180) return '';
  const path = sanitizePath(rest.join('/'));
  return `ipfs://${cid}${path ? `/${path}` : ''}`;
}

export function legacyIpfsCidFromReference(value) {
  const normalized = sanitizeLegacyIpfsReference(value);
  if (!normalized) return '';
  return normalized.replace(LEGACY_IPFS_URI_RE, '').split('/')[0] || '';
}

export function isSupabaseStorageReference(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (SUPABASE_URI_RE.test(raw)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return false;
  const byBucketPath = SUPABASE_BUCKET_PATH_RE.exec(raw);
  if (!byBucketPath) return false;
  const delimiter = byBucketPath[2];
  const objectPath = byBucketPath[3];
  if (delimiter === ':' && looksLikeLineReferencePath(objectPath)) return false;
  return true;
}

export function sanitizeSupabaseStorageReference(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (SUPABASE_URI_RE.test(raw)) {
    const normalized = raw.replace(SUPABASE_URI_RE, '');
    const slashIndex = normalized.indexOf('/');
    if (slashIndex <= 0) return '';
    const bucket = normalizeBucket(normalized.slice(0, slashIndex));
    const path = sanitizePath(normalized.slice(slashIndex + 1));
    return bucket && path ? `supabase://${bucket}/${path}` : '';
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return '';
  const byBucketPath = SUPABASE_BUCKET_PATH_RE.exec(raw);
  if (!byBucketPath) return '';
  const delimiter = byBucketPath[2];
  const objectPath = String(byBucketPath[3] || '').trim();
  if (delimiter === ':' && looksLikeLineReferencePath(objectPath)) return '';
  const bucket = normalizeBucket(byBucketPath[1]);
  const path = sanitizePath(objectPath);
  return bucket && path ? `supabase://${bucket}/${path}` : '';
}

function isHttpUrl(value) {
  return HTTP_URL_RE.test(String(value || '').trim());
}

function normalizeObjectReference(reference, options = {}) {
  if (!reference || typeof reference !== 'object') return null;
  const directUrl = String(reference.url || reference.sourceUrl || '').trim();
  if (isHttpUrl(directUrl)) {
    return {
      mode: 'direct',
      url: directUrl
    };
  }
    const bucket = normalizeBucket(reference.bucket || reference.storageBucket || options.defaultBucket);
  const rawPath = String(reference.path || reference.storagePath || reference.objectPath || '').trim();
  const path = sanitizePath(rawPath);
  if (bucket && path) {
    return {
      mode: reference.visibility === 'public' || reference.public === true ? 'public' : 'private',
      bucket,
      path,
      visibility: reference.visibility || (reference.public ? 'public' : 'private'),
      origin: reference.origin || 'object'
    };
  }
  return null;
}

function normalizeStringReference(reference, options = {}) {
  const raw = String(reference || '').trim();
  if (!raw) return null;
  if (isHttpUrl(raw)) {
    return {
      mode: 'direct',
      url: raw
    };
  }
  const legacy = sanitizeLegacyIpfsReference(raw);
  if (legacy) {
    const cid = legacyIpfsCidFromReference(legacy);
    const legacyPath = legacy.replace(LEGACY_IPFS_URI_RE, '').split('/').slice(1).join('/');
    const bucket = normalizeBucket(options.defaultBucket || 'media');
    const normalizedPath = sanitizePath(`${options.legacyIpfsPrefix || 'legacy/ipfs'}/${cid}${legacyPath ? `/${legacyPath}` : ''}`);
    const publicByBucket = Array.isArray(options.publicBucketAllowList) && options.publicBucketAllowList.includes(bucket);
    const visibility = options.legacyIpfsVisibility || (publicByBucket ? 'public' : 'private');
    return {
      mode: visibility === 'public' ? 'public' : 'private',
      bucket,
      path: normalizedPath,
      visibility,
      origin: 'legacy_ipfs',
      legacyIpfs: legacy
    };
  }
  const supabaseRef = sanitizeSupabaseStorageReference(raw);
  if (supabaseRef) {
    const payload = supabaseRef.replace(/^supabase:\/\//i, '');
    const slashIndex = payload.indexOf('/');
    const bucket = normalizeBucket(payload.slice(0, slashIndex));
    const path = sanitizePath(payload.slice(slashIndex + 1));
    const publicByBucket = Array.isArray(options.publicBucketAllowList) && options.publicBucketAllowList.includes(bucket);
    return {
      mode: publicByBucket ? 'public' : 'private',
      bucket,
      path,
      visibility: publicByBucket ? 'public' : 'private',
      origin: 'supabase_uri'
    };
  }
  if (!raw.includes('://') && options.defaultBucket) {
    const path = sanitizePath(raw);
    if (path) {
      const bucket = normalizeBucket(options.defaultBucket);
      const publicByBucket = Array.isArray(options.publicBucketAllowList) && options.publicBucketAllowList.includes(bucket);
      return {
        mode: publicByBucket ? 'public' : 'private',
        bucket,
        path,
        visibility: publicByBucket ? 'public' : 'private',
        origin: 'bucket_default'
      };
    }
  }
  return null;
}

function normalizeReference(reference, options = {}) {
  if (typeof reference === 'string') return normalizeStringReference(reference, options);
  return normalizeObjectReference(reference, options);
}

function makePublicUrl(config, bucket, path) {
  const bucketName = normalizeBucket(bucket);
  const cleanPath = encodePath(path);
  const cdnBaseUrl = normalizeUrl(config.cdnBaseUrl || '');
  if (cdnBaseUrl && !cdnBaseUrl.includes('<account_id>')) {
    return `${cdnBaseUrl.replace(/\/+$/, '')}/${bucketName}/${cleanPath}`;
  }
  const base = normalizeUrl(config.supabaseUrl || '');
  return `${base}/storage/v1/object/public/${bucketName}/${cleanPath}`;
}

async function fetchWithRetry(fetchImpl, url, init = {}, retry = DEFAULT_RETRY) {
  const attempts = Math.max(1, Number(retry.attempts) || DEFAULT_RETRY.attempts);
  const baseDelayMs = Math.max(0, Number(retry.baseDelayMs) || DEFAULT_RETRY.baseDelayMs);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, init);
      if (response.status >= 500 || response.status === 429 || response.status === 408) {
        lastError = new StorageResolverError(`Storage endpoint responded with ${response.status}`, {
          code: 'storage_transient_error',
          status: response.status,
          retryable: true
        });
      } else {
        return response;
      }
    } catch (cause) {
      lastError = new StorageResolverError('Storage network request failed.', {
        code: 'storage_network_error',
        retryable: true,
        cause
      });
    }
    if (attempt < attempts) {
      await wait(baseDelayMs * Math.pow(2, attempt - 1));
    }
  }
  throw lastError || new StorageResolverError('Storage request failed.', {
    code: 'storage_request_failed',
    retryable: false
  });
}

export function createStorageUrlResolver({
  config,
  authClient = null,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  logger = null
} = {}) {
  const cache = new Map();

  function logDebug(message, context = null) {
    if (!logger?.info) return;
    logger.info(message, context || {});
  }

  function cacheKeyFromReference(normalized) {
    if (!normalized) return '';
    if (normalized.mode === 'direct') return `direct:${normalized.url}`;
    return `${normalized.mode}:${normalized.bucket}:${normalized.path}`;
  }

  function readFromCache(key) {
    if (!key || !cache.has(key)) return null;
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= nowMs()) {
      cache.delete(key);
      return null;
    }
    return entry;
  }

  function writeToCache(key, value, ttlMs = 0) {
    if (!key || !value) return value;
    cache.set(key, {
      ...value,
      expiresAt: ttlMs > 0 ? nowMs() + ttlMs : 0
    });
    return value;
  }

  async function signPrivateUrl(bucket, path, options = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new StorageResolverError('Fetch is not available in this environment.', {
        code: 'fetch_unavailable',
        retryable: false
      });
    }
    const token = authClient?.getAccessToken?.() || '';
    if (!token) {
      throw new StorageResolverError('Authentication is required to access private media.', {
        code: 'auth_required',
        status: 401,
        retryable: false
      });
    }

    const bucketName = normalizeBucket(bucket);
    const cleanPath = encodePath(path);
    const ttlSeconds = Math.max(1, Number(options.signedUrlTtlSeconds || config.signedUrlTtlSeconds) || 1209600);
    const endpoint = `${normalizeUrl(config.supabaseUrl || '')}/storage/v1/object/sign/${bucketName}/${cleanPath}`;
    const response = await fetchWithRetry(fetchImpl, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ expiresIn: ttlSeconds })
    }, options.retry);

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        throw new StorageResolverError('Authentication is required to access private media.', {
          code: 'auth_required',
          status: 401,
          retryable: false
        });
      }
      if (response.status === 403) {
        throw new StorageResolverError('You do not have permission to access this media.', {
          code: 'permission_denied',
          status: 403,
          retryable: false
        });
      }
      if (response.status === 404) {
        throw new StorageResolverError('Media file was not found in Supabase Storage.', {
          code: 'missing_media',
          status: 404,
          retryable: false
        });
      }
      throw new StorageResolverError(payload?.error || `Failed to sign storage URL (${response.status}).`, {
        code: 'sign_failed',
        status: response.status,
        retryable: response.status >= 500 || response.status === 429
      });
    }

    const signedRelative = String(payload.signedURL || payload.signedUrl || payload.url || '').trim();
    if (!signedRelative) {
      throw new StorageResolverError('Supabase did not return a signed URL.', {
        code: 'sign_response_invalid',
        retryable: false
      });
    }

    const absoluteSigned = normalizeUrl(
      signedRelative.startsWith('http')
        ? signedRelative
        : `${normalizeUrl(config.supabaseUrl || '')}${signedRelative.startsWith('/') ? '' : '/'}${signedRelative}`
    );
    return {
      url: absoluteSigned,
      signed: true,
      expiresAt: nowMs() + (ttlSeconds * 1000)
    };
  }

  async function resolve(reference, options = {}) {
    const normalized = normalizeReference(reference, {
      defaultBucket: options.defaultBucket || config.defaultBucket,
      legacyIpfsPrefix: options.legacyIpfsPrefix || 'legacy/ipfs',
      legacyIpfsVisibility: options.legacyIpfsVisibility || 'private',
      publicBucketAllowList: options.publicBucketAllowList || config.publicBucketAllowList || []
    });
    if (!normalized) {
      throw new StorageResolverError('Media reference is not a valid Supabase or URL source.', {
        code: 'invalid_reference',
        retryable: false
      });
    }

    const key = cacheKeyFromReference(normalized);
    const cached = readFromCache(key);
    if (cached) return cached;

    if (normalized.mode === 'direct') {
      return writeToCache(key, {
        url: normalized.url,
        signed: false,
        bucket: '',
        path: '',
        origin: normalized.origin || 'direct'
      }, 5 * 60 * 1000);
    }

    if (normalized.mode === 'public') {
      const url = makePublicUrl(config, normalized.bucket, normalized.path);
      return writeToCache(key, {
        url,
        signed: false,
        bucket: normalized.bucket,
        path: normalized.path,
        visibility: 'public',
        origin: normalized.origin || 'public'
      }, 10 * 60 * 1000);
    }

    const signed = await signPrivateUrl(normalized.bucket, normalized.path, options);
    const skewMs = 45 * 1000;
    const ttlMs = Math.max(1, (signed.expiresAt - nowMs()) - skewMs);
    const result = {
      url: signed.url,
      signed: true,
      expiresAt: signed.expiresAt,
      bucket: normalized.bucket,
      path: normalized.path,
      visibility: 'private',
      origin: normalized.origin || 'private'
    };
    logDebug('[storage] signed URL generated', {
      bucket: normalized.bucket,
      path: normalized.path,
      expiresAt: signed.expiresAt
    });
    return writeToCache(key, result, ttlMs);
  }

  function clearCache() {
    cache.clear();
  }

  function invalidate(reference, options = {}) {
    const normalized = normalizeReference(reference, {
      defaultBucket: options.defaultBucket || config.defaultBucket,
      publicBucketAllowList: options.publicBucketAllowList || config.publicBucketAllowList || []
    });
    const key = cacheKeyFromReference(normalized);
    if (key) cache.delete(key);
  }

  return {
    resolve,
    clearCache,
    invalidate
  };
}
