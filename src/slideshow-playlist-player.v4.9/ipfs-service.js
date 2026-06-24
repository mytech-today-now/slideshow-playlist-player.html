import { getIpfsWorkerClient, isIpfsWorkerSupported, shutdownIpfsWorkerClient } from './ipfs-worker-client.js';

export const IPFS_SHARE_PARAM = 'ipfsExperience';
export const IPFS_GATEWAY_PARAM = 'ipfsGateway';
export { shutdownIpfsWorkerClient as shutdownIpfsWorkerRuntime };

export const DEFAULT_IPFS_CONFIG = Object.freeze({
  enabled: true,
  mode: 'auto',
  kuboApiEndpoint: 'http://127.0.0.1:5001',
  gateways: ['https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/'],
  timeoutMs: 60000,
  fetchTimeoutMs: 90000,
  maxManifestBytes: 5 * 1024 * 1024,
  maxItemBytes: 2 * 1024 * 1024 * 1024,
  heliaModuleUrl: '',
  workerUrl: './ipfs-worker.js?v=20260619-v4.9-ipfs2',
  useWorker: true,
  gatewayFallback: true,
  reuseCachedCids: true
});

const KUBO_PREFLIGHT_TIMEOUT_MS = 3500;
const PUBLISH_PROVIDER_IDS = new Set(['kubo', 'helia']);

export class IpfsServiceError extends Error {
  constructor(message, {
    code = 'ipfs_error',
    provider = '',
    endpoint = '',
    userMessage = '',
    userDetail = '',
    userAction = '',
    retryable = true,
    cause = null,
    failures = []
  } = {}) {
    super(message || userMessage || 'IPFS operation failed');
    this.name = 'IpfsServiceError';
    this.code = code;
    this.provider = provider;
    this.endpoint = endpoint;
    this.userMessage = userMessage;
    this.userDetail = userDetail;
    this.userAction = userAction;
    this.retryable = retryable;
    this.failures = Array.isArray(failures) ? failures : [];
    if (cause) this.cause = cause;
  }
}

export function isIpfsServiceError(error) {
  return error instanceof IpfsServiceError || error?.name === 'IpfsServiceError';
}

const CID_V0_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_RE = /^[bB][a-zA-Z2-7]{20,}$/;
const CID_BASE58_RE = /^[zZ][1-9A-HJ-NP-Za-km-z]{20,}$/;

export function validateCid(value) {
  const cid = String(value || '').trim();
  if (!cid || cid.length > 180) return false;
  return CID_V0_RE.test(cid) || CID_V1_RE.test(cid) || CID_BASE58_RE.test(cid);
}

export function sanitizeCid(value) {
  const cid = String(value || '').trim();
  return validateCid(cid) ? cid : '';
}

export function isIpfsUri(value) {
  return /^ipfs:\/\//i.test(String(value || '').trim());
}

export function sanitizeIpfsUri(value) {
  const raw = String(value || '').trim();
  if (!isIpfsUri(raw)) return '';
  try {
    const withoutScheme = raw.replace(/^ipfs:\/\//i, '');
    const [cidPart, ...pathParts] = withoutScheme.split('/');
    const cid = sanitizeCid(cidPart);
    if (!cid) return '';
    const cleanPath = pathParts
      .map(part => part.trim())
      .filter(part => part && part !== '.' && part !== '..')
      .map(part => encodeURIComponent(decodeURIComponent(part)).replace(/%2F/gi, ''))
      .join('/');
    return `ipfs://${cid}${cleanPath ? `/${cleanPath}` : ''}`;
  } catch (_) {
    return '';
  }
}

export function cidFromIpfsUri(value) {
  const uri = sanitizeIpfsUri(value);
  if (!uri) return '';
  return sanitizeCid(uri.replace(/^ipfs:\/\//i, '').split('/')[0]);
}

function normalizeTimeout(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(3000, Math.min(10 * 60 * 1000, Math.floor(parsed)));
}

function normalizeEndpoint(value, fallback) {
  const raw = String(value || fallback || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback || '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch (_) {
    return fallback || '';
  }
}

function normalizeGateway(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    url.search = '';
    let path = url.pathname || '/';
    path = path.replace(/\/+$/, '');
    if (!/\/ipfs$/i.test(path)) path = `${path}/ipfs`;
    url.pathname = `${path}/`;
    return url.toString();
  } catch (_) {
    return '';
  }
}

export function parseGatewayList(value, fallback = DEFAULT_IPFS_CONFIG.gateways) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]+/);
  const normalized = source.map(normalizeGateway).filter(Boolean);
  const unique = Array.from(new Set(normalized));
  if (unique.length) return unique;
  return Array.from(new Set((fallback || []).map(normalizeGateway).filter(Boolean)));
}

export function normalizeIpfsConfig(config = {}) {
  const merged = { ...DEFAULT_IPFS_CONFIG, ...(config && typeof config === 'object' ? config : {}) };
  const mode = ['auto', 'kubo', 'helia', 'gateway'].includes(merged.mode) ? merged.mode : 'auto';
  const rawKuboApiEndpoint = String(merged.kuboApiEndpointInvalid ? merged.kuboApiEndpointInput : merged.kuboApiEndpoint || '').trim();
  const inheritedInvalidKuboEndpoint = merged.kuboApiEndpointInvalid === true && !!rawKuboApiEndpoint;
  const validKuboApiEndpoint = inheritedInvalidKuboEndpoint ? '' : normalizeEndpoint(rawKuboApiEndpoint, '');
  const kuboApiEndpointInvalid = inheritedInvalidKuboEndpoint || (!!rawKuboApiEndpoint && !validKuboApiEndpoint);
  const normalizedKuboApiEndpoint = validKuboApiEndpoint || DEFAULT_IPFS_CONFIG.kuboApiEndpoint;
  const customKuboEndpoint = !!validKuboApiEndpoint && !isDefaultKuboEndpoint(normalizedKuboApiEndpoint);
  const publishProviders = uniqueProviders(Array.isArray(merged.publishProviders)
    ? merged.publishProviders.map(provider => String(provider || '').toLowerCase()).filter(provider => PUBLISH_PROVIDER_IDS.has(provider))
    : []);
  return {
    ...merged,
    enabled: merged.enabled !== false,
    mode,
    kuboApiEndpoint: normalizedKuboApiEndpoint,
    kuboApiEndpointInput: rawKuboApiEndpoint,
    kuboApiEndpointInvalid,
    kuboConfigured: mode === 'kubo' || customKuboEndpoint || (merged.kuboConfigured === true && customKuboEndpoint),
    gateways: parseGatewayList(merged.gateways),
    timeoutMs: normalizeTimeout(merged.timeoutMs, DEFAULT_IPFS_CONFIG.timeoutMs),
    fetchTimeoutMs: normalizeTimeout(merged.fetchTimeoutMs, DEFAULT_IPFS_CONFIG.fetchTimeoutMs),
    maxManifestBytes: Math.max(1024, Math.min(50 * 1024 * 1024, Number(merged.maxManifestBytes) || DEFAULT_IPFS_CONFIG.maxManifestBytes)),
    maxItemBytes: Math.max(1024 * 1024, Math.min(20 * 1024 * 1024 * 1024, Number(merged.maxItemBytes) || DEFAULT_IPFS_CONFIG.maxItemBytes)),
    heliaModuleUrl: String(merged.heliaModuleUrl || '').trim(),
    workerUrl: String(merged.workerUrl || DEFAULT_IPFS_CONFIG.workerUrl).trim() || DEFAULT_IPFS_CONFIG.workerUrl,
    useWorker: merged.useWorker !== false,
    heliaImportUrl: String(merged.heliaImportUrl || '').trim(),
    unixfsImportUrl: String(merged.unixfsImportUrl || '').trim(),
    multiformatsCidUrl: String(merged.multiformatsCidUrl || '').trim(),
    heliaStorageName: String(merged.heliaStorageName || '').trim(),
    heliaProvideOnAdd: merged.heliaProvideOnAdd === true,
    publishProviders,
    gatewayFallback: merged.gatewayFallback !== false,
    reuseCachedCids: merged.reuseCachedCids !== false
  };
}

function isDefaultKuboEndpoint(value) {
  const endpoint = normalizeEndpoint(value, '');
  const defaultEndpoint = normalizeEndpoint(DEFAULT_IPFS_CONFIG.kuboApiEndpoint, '');
  return !!endpoint && endpoint === defaultEndpoint;
}

function isMainBrowserThread(scope = globalThis) {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && scope === window;
}

function shouldUseIpfsWorker(config = {}, options = {}) {
  if (config?._workerDisabled || options?._workerDisabled) return false;
  if (config?.useWorker === false || options?.useWorker === false) return false;
  if (!isMainBrowserThread()) return false;
  return isIpfsWorkerSupported();
}

function isIpfsWorkerRequiredButUnavailable(config = {}, scope = globalThis) {
  return isMainBrowserThread(scope) &&
    config?.useWorker !== false &&
    config?.enabled !== false &&
    config?.mode !== 'gateway' &&
    !isIpfsWorkerSupported(scope);
}

export function isKuboProviderConfigured(config = {}) {
  const normalized = normalizeIpfsConfig(config);
  if (normalized.mode === 'kubo' || normalized.kuboConfigured === true) return true;
  return !!normalized.kuboApiEndpoint && !isDefaultKuboEndpoint(normalized.kuboApiEndpoint);
}

function injectedHeliaProvider(config = {}, scope = globalThis) {
  return config.heliaProvider ||
    scope?.BlendHeliaProvider ||
    scope?.blendHeliaProvider ||
    null;
}

export function hasHeliaProviderCandidate(config = {}, scope = globalThis) {
  const normalized = normalizeIpfsConfig(config);
  const injected = injectedHeliaProvider(normalized, scope);
  const canUseInjected = !!injected && !(isMainBrowserThread(scope) && normalized.useWorker !== false);
  return !!(canUseInjected || normalized.heliaModuleUrl);
}

function uniqueProviders(providers) {
  return Array.from(new Set(providers.filter(Boolean)));
}

export function getIpfsPublishProviders(config = {}) {
  const normalized = normalizeIpfsConfig(config);
  if (isIpfsWorkerRequiredButUnavailable(normalized)) return [];
  if (!normalized.enabled || normalized.mode === 'gateway') return [];
  if (normalized.mode === 'kubo' && normalized.kuboApiEndpointInvalid) return [];
  if (normalized.publishProviders.length) return normalized.publishProviders;
  if (normalized.mode === 'kubo') return ['kubo'];
  if (normalized.mode === 'helia') return hasHeliaProviderCandidate(normalized) ? ['helia'] : [];
  return uniqueProviders([
    isKuboProviderConfigured(normalized) ? 'kubo' : '',
    hasHeliaProviderCandidate(normalized) ? 'helia' : ''
  ]);
}

export function getIpfsRetrievalProviders(config = {}) {
  const normalized = normalizeIpfsConfig(config);
  if (isIpfsWorkerRequiredButUnavailable(normalized)) {
    return normalized.gateways.length ? ['gateway'] : [];
  }
  const canUseGateway = (normalized.mode === 'gateway' || normalized.gatewayFallback !== false) && normalized.gateways.length > 0;
  if (normalized.mode === 'gateway') return canUseGateway ? ['gateway'] : [];
  if (normalized.mode === 'kubo') return uniqueProviders(['kubo', canUseGateway ? 'gateway' : '']);
  if (normalized.mode === 'helia') {
    return uniqueProviders([
      hasHeliaProviderCandidate(normalized) ? 'helia' : '',
      canUseGateway ? 'gateway' : ''
    ]);
  }
  return uniqueProviders([
    hasHeliaProviderCandidate(normalized) ? 'helia' : '',
    isKuboProviderConfigured(normalized) ? 'kubo' : '',
    canUseGateway ? 'gateway' : ''
  ]);
}

function providerListLabel(providers = []) {
  const labels = providers.map(provider => (
    provider === 'kubo' ? 'Kubo' :
      provider === 'helia' ? 'Helia' :
        provider === 'gateway' ? 'gateway playback' :
          provider
  ));
  if (labels.length <= 1) return labels[0] || '';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

export function describeIpfsPublishReadiness(config = {}) {
  const normalized = normalizeIpfsConfig(config);
  const providers = getIpfsPublishProviders(normalized);
  if (!normalized.enabled) {
    return {
      state: 'disabled',
      canPublish: false,
      providers,
      message: 'IPFS sharing is disabled.',
      detail: 'Enable IPFS sharing before publishing this experience.',
      action: 'Open settings and turn on IPFS sharing.'
    };
  }
  if (isIpfsWorkerRequiredButUnavailable(normalized)) {
    return {
      state: 'unavailable',
      canPublish: false,
      providers,
      message: 'IPFS sharing needs Web Worker support.',
      detail: 'This browser cannot start the IPFS worker required for non-blocking publishing.',
      action: 'Use a modern browser with module Web Worker support.'
    };
  }
  if (normalized.kuboApiEndpointInvalid && (normalized.mode === 'kubo' || (normalized.mode === 'auto' && !providers.length))) {
    return {
      state: 'needs_setup',
      canPublish: false,
      providers,
      message: 'Kubo API endpoint is not valid.',
      detail: `Enter an http:// or https:// URL. Blend could not use "${normalized.kuboApiEndpointInput}".`,
      action: 'Open Settings and correct the Kubo API endpoint before publishing.'
    };
  }
  if (providers.length) {
    return {
      state: 'ready',
      canPublish: true,
      providers,
      message: `Ready to publish through ${providerListLabel(providers)}.`,
      detail: normalized.mode === 'auto'
        ? 'Auto mode will only use providers that are configured or present in this browser.'
        : `${providerListLabel(providers)} is selected for publishing.`,
      action: ''
    };
  }
  if (normalized.mode === 'gateway') {
    return {
      state: 'unavailable',
      canPublish: false,
      providers,
      message: 'Gateway mode can retrieve IPFS content but cannot publish new content.',
      detail: 'Choose Kubo or Helia when you want this browser to add new media and manifests to IPFS.',
      action: 'Select Kubo if you run a node, or configure a worker Helia module.'
    };
  }
  if (normalized.mode === 'helia') {
    return {
      state: 'needs_setup',
      canPublish: false,
      providers,
      message: 'Browser IPFS publishing is not configured.',
      detail: 'Blend did not find a worker Helia module URL.',
      action: 'Enter a worker-safe Helia module URL before publishing.'
    };
  }
  return {
    state: 'needs_setup',
    canPublish: false,
    providers,
    message: 'IPFS sharing needs a publisher.',
    detail: `Auto mode can use a reachable local Kubo node at ${normalized.kuboApiEndpoint}, a custom Kubo endpoint, or a configured worker Helia module.`,
    action: 'Start Kubo, choose Kubo in Settings, or configure a worker Helia module before publishing.'
  };
}

export function readIpfsConfigFromUrl(search = globalThis.location?.search || '') {
  const params = new URLSearchParams(String(search || ''));
  const out = {};
  const mode = params.get('ipfsMode');
  if (mode) out.mode = mode;
  const gateway = params.get(IPFS_GATEWAY_PARAM);
  if (gateway) out.gateways = [gateway];
  const kubo = params.get('kuboApi');
  if (kubo) out.kuboApiEndpoint = kubo;
  return out;
}

function mergeAbortSignals(signal, timeoutMs) {
  const controller = new AbortController();
  let timer = null;
  const abort = reason => {
    try { controller.abort(reason); } catch (_) { controller.abort(); }
  };
  if (signal) {
    if (signal.aborted) abort(signal.reason);
    else signal.addEventListener('abort', () => abort(signal.reason), { once: true });
  }
  if (timeoutMs) {
    timer = setTimeout(() => abort(new DOMException('IPFS request timed out', 'TimeoutError')), timeoutMs);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
    }
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_IPFS_CONFIG.timeoutMs) {
  const merged = mergeAbortSignals(options.signal, timeoutMs);
  try {
    return await fetch(url, { ...options, signal: merged.signal });
  } finally {
    merged.cleanup();
  }
}

function kuboUnavailableError(config = {}, cause = null, prefix = 'Kubo is not reachable') {
  const endpoint = normalizeIpfsConfig(config).kuboApiEndpoint || DEFAULT_IPFS_CONFIG.kuboApiEndpoint;
  const detail = cause?.message || String(cause || 'No response');
  return new IpfsServiceError(`${prefix} at ${endpoint}. ${detail}`, {
    code: 'kubo_unavailable',
    provider: 'kubo',
    endpoint,
    userMessage: 'Local IPFS node is not reachable.',
    userDetail: `Blend could not reach Kubo at ${endpoint}. Start Kubo, confirm the endpoint, and allow this app origin in the Kubo HTTP API CORS settings.`,
    userAction: 'Open Settings to update the endpoint or choose a different IPFS publisher.',
    retryable: true,
    cause
  });
}

export async function checkKuboApiReachability(config = {}, options = {}) {
  const normalized = normalizeIpfsConfig(config);
  const endpoint = normalized.kuboApiEndpoint;
  if (normalized.kuboApiEndpointInvalid) {
    throw new IpfsServiceError(`Kubo API endpoint is not valid: ${normalized.kuboApiEndpointInput}`, {
      code: 'kubo_endpoint_invalid',
      provider: 'kubo',
      endpoint: normalized.kuboApiEndpointInput,
      userMessage: 'Kubo API endpoint is not valid.',
      userDetail: `Enter an http:// or https:// URL. Blend could not use "${normalized.kuboApiEndpointInput}".`,
      userAction: 'Open Settings and correct the Kubo API endpoint before publishing.',
      retryable: false
    });
  }
  if (!endpoint) {
    throw new IpfsServiceError('Kubo API endpoint is not configured.', {
      code: 'kubo_endpoint_missing',
      provider: 'kubo',
      userMessage: 'Kubo API endpoint is missing.',
      userDetail: 'Enter the HTTP API endpoint for the Kubo node you want Blend to use.',
      userAction: 'Open Settings and enter a Kubo API endpoint.',
      retryable: false
    });
  }

  const api = `${endpoint}/api/v0/version`;
  let response;
  try {
    response = await fetchWithTimeout(api, {
      method: 'POST',
      signal: options.signal,
      credentials: 'omit',
      mode: 'cors'
    }, Math.max(1000, Math.min(Number(options.timeoutMs) || KUBO_PREFLIGHT_TIMEOUT_MS, normalized.timeoutMs)));
  } catch (error) {
    throw kuboUnavailableError(normalized, error);
  }

  if (!response.ok) {
    throw kuboUnavailableError(normalized, new Error(`Kubo version check failed (${response.status})`), 'Kubo responded with an error');
  }

  const text = await response.text().catch(() => '');
  let version = '';
  try {
    const parsed = JSON.parse(text);
    version = String(parsed?.Version || parsed?.Commit || '').trim();
  } catch (_) {}
  return {
    ok: true,
    provider: 'kubo',
    endpoint,
    version
  };
}

function readyPublishReadiness(config = {}, providers = getIpfsPublishProviders(config), detail = '') {
  return {
    state: 'ready',
    canPublish: true,
    providers,
    message: `Ready to publish through ${providerListLabel(providers)}.`,
    detail: detail || (normalizeIpfsConfig(config).mode === 'auto'
      ? 'Auto mode selected an available publishing provider.'
      : `${providerListLabel(providers)} is selected for publishing.`),
    action: ''
  };
}

function defaultAutoUnavailableReadiness(config = {}, kuboError = null) {
  const normalized = normalizeIpfsConfig(config);
  const kuboDetail = kuboError
    ? `Blend could not reach the local Kubo node at ${normalized.kuboApiEndpoint}, and no browser IPFS publisher is configured.`
    : 'Blend did not find an available local node, custom endpoint, or browser IPFS publisher.';
  return {
    state: 'needs_setup',
    canPublish: false,
    providers: [],
    message: 'IPFS sharing needs setup.',
    detail: kuboDetail,
    action: 'Start Kubo and allow this app origin, or configure browser IPFS publishing in Settings.',
    error: kuboError || null
  };
}

function unavailableReadinessFromError(error, config = {}) {
  const normalized = normalizeIpfsConfig(config);
  return {
    state: 'unavailable',
    canPublish: false,
    providers: [],
    message: error?.userMessage || 'IPFS publisher is unavailable.',
    detail: error?.userDetail || `Blend could not reach the configured IPFS publisher at ${normalized.kuboApiEndpoint}.`,
    action: error?.userAction || 'Open Settings to update provider configuration.',
    error
  };
}

function workerUnavailableReadiness(error, config = {}) {
  return {
    state: 'unavailable',
    canPublish: false,
    providers: [],
    message: error?.userMessage || 'IPFS sharing is unavailable in this browser.',
    detail: error?.userDetail || 'Blend could not start the IPFS worker required for non-blocking publishing.',
    action: error?.userAction || 'Use a modern browser with module Web Worker support.',
    error
  };
}

export async function prepareIpfsPublishConfig(config = {}, options = {}) {
  const normalized = normalizeIpfsConfig(config);
  if (shouldUseIpfsWorker(normalized, options)) {
    try {
      return await getIpfsWorkerClient({ workerUrl: normalized.workerUrl }).preparePublishConfig(normalized, options);
    } catch (error) {
      return {
        config: normalized,
        readiness: workerUnavailableReadiness(error, normalized),
        checks: []
      };
    }
  }
  const checks = [];
  const baseReadiness = describeIpfsPublishReadiness(normalized);
  if (!normalized.enabled || normalized.mode === 'gateway' || normalized.mode === 'helia') {
    return { config: normalized, readiness: baseReadiness, checks };
  }

  let providers = getIpfsPublishProviders(normalized);
  const hasKubo = providers.includes('kubo');
  const canProbeDefaultKubo = normalized.mode === 'auto' &&
    !hasKubo &&
    !normalized.kuboApiEndpointInvalid &&
    isDefaultKuboEndpoint(normalized.kuboApiEndpoint) &&
    options.probeDefaultKubo !== false;

  if (canProbeDefaultKubo) {
    try {
      const check = await checkKuboApiReachability(normalized, options);
      checks.push(check);
      providers = uniqueProviders(['kubo', ...providers]);
      const prepared = normalizeIpfsConfig({ ...normalized, kuboConfigured: true, publishProviders: providers });
      return {
        config: prepared,
        readiness: readyPublishReadiness(prepared, providers, `Local Kubo responded at ${check.endpoint}.`),
        checks
      };
    } catch (error) {
      checks.push({ ok: false, provider: 'kubo', endpoint: normalized.kuboApiEndpoint, error });
      if (!providers.length) {
        return {
          config: normalized,
          readiness: defaultAutoUnavailableReadiness(normalized, error),
          checks
        };
      }
    }
  }

  if (!providers.length) return { config: normalized, readiness: baseReadiness, checks };

  if (providers.includes('kubo') && options.verifyKubo !== false) {
    try {
      const check = await checkKuboApiReachability(normalized, options);
      checks.push(check);
    } catch (error) {
      checks.push({ ok: false, provider: 'kubo', endpoint: normalized.kuboApiEndpoint, error });
      if (normalized.mode === 'auto') {
        const fallbackProviders = providers.filter(provider => provider !== 'kubo');
        if (fallbackProviders.length) {
          const prepared = normalizeIpfsConfig({ ...normalized, publishProviders: fallbackProviders });
          return {
            config: prepared,
            readiness: readyPublishReadiness(prepared, fallbackProviders, 'Kubo is not reachable, so Blend will use the configured browser IPFS provider.'),
            checks
          };
        }
      }
      return {
        config: normalizeIpfsConfig({ ...normalized, publishProviders: [] }),
        readiness: unavailableReadinessFromError(error, normalized),
        checks
      };
    }
  }

  const prepared = normalizeIpfsConfig({ ...normalized, publishProviders: providers });
  return {
    config: prepared,
    readiness: readyPublishReadiness(prepared, providers),
    checks
  };
}

function sizeLimitForKind(config, kind) {
  return kind === 'manifest' ? config.maxManifestBytes : config.maxItemBytes;
}

function assertWithinSizeLimit(size, maxBytes, label = 'IPFS content') {
  if (!Number.isFinite(size) || !Number.isFinite(maxBytes) || maxBytes <= 0) return;
  if (size > maxBytes) {
    throw new Error(`${label} exceeds configured size limit (${size} bytes)`);
  }
}

function contentLengthFor(response) {
  const parsed = Number(response?.headers?.get?.('content-length'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function iterableToBlob(iterable, {
  mimeType = '',
  maxBytes = DEFAULT_IPFS_CONFIG.maxItemBytes,
  onProgress = null,
  provider = '',
  cid = '',
  total = 0
} = {}) {
  const chunks = [];
  let loaded = 0;
  for await (const chunk of iterable) {
    const bytes = chunk instanceof Uint8Array
      ? chunk
      : chunk instanceof ArrayBuffer
        ? new Uint8Array(chunk)
        : new Uint8Array(await new Blob([chunk]).arrayBuffer());
    loaded += bytes.byteLength;
    assertWithinSizeLimit(loaded, maxBytes, 'IPFS content');
    chunks.push(bytes);
    onProgress?.({
      phase: 'downloading',
      provider,
      cid,
      loaded,
      total
    });
  }
  return new Blob(chunks, { type: mimeType });
}

async function responseToBlobWithProgress(response, {
  mimeType = '',
  maxBytes = DEFAULT_IPFS_CONFIG.maxItemBytes,
  onProgress = null,
  provider = '',
  cid = ''
} = {}) {
  const total = contentLengthFor(response);
  if (total) assertWithinSizeLimit(total, maxBytes, 'IPFS content');
  const contentType = mimeType || String(response.headers?.get?.('content-type') || '').split(';')[0].trim();

  if (!response.body || typeof response.body.getReader !== 'function') {
    const blob = await response.blob();
    assertWithinSizeLimit(blob.size, maxBytes, 'IPFS content');
    onProgress?.({
      phase: 'downloaded',
      provider,
      cid,
      loaded: blob.size,
      total: total || blob.size
    });
    return contentType && blob.type !== contentType ? blob.slice(0, blob.size, contentType) : blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      loaded += bytes.byteLength;
      assertWithinSizeLimit(loaded, maxBytes, 'IPFS content');
      chunks.push(bytes);
      onProgress?.({
        phase: 'downloading',
        provider,
        cid,
        loaded,
        total
      });
    }
  } catch (error) {
    try { await reader.cancel(error); } catch (_) {}
    throw error;
  }
  onProgress?.({
    phase: 'downloaded',
    provider,
    cid,
    loaded,
    total: total || loaded
  });
  return new Blob(chunks, { type: contentType });
}

function parseKuboAddResponse(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  let last = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.Hash || parsed?.Cid || parsed?.Name) last = parsed;
    } catch (_) {}
  }
  const cid = sanitizeCid(last?.Hash || last?.Cid?.['/'] || last?.Cid || '');
  if (!cid) throw new Error('Kubo did not return a valid CID');
  return {
    cid,
    name: last?.Name || '',
    size: Number(last?.Size) || 0,
    provider: 'kubo'
  };
}

function uploadResultMetadata(result = {}, config = {}, {
  blob = null,
  filename = '',
  mimeType = '',
  itemType = '',
  kind = ''
} = {}) {
  const cid = sanitizeCid(result.cid);
  return {
    ...result,
    cid,
    filename: filename || result.name || '',
    name: result.name || filename || '',
    byteSize: Number(result.byteSize ?? blob?.size ?? result.size) || 0,
    size: Number(result.size ?? result.byteSize ?? blob?.size) || 0,
    mimeType: mimeType || result.mimeType || blob?.type || '',
    contentType: result.contentType || mimeType || result.mimeType || blob?.type || '',
    itemType: itemType || result.itemType || kind || '',
    timestamp: result.timestamp || new Date().toISOString(),
    gatewayUrl: result.gatewayUrl || gatewayUrlForCid(config.gateways?.[0], cid)
  };
}

function heliaProviderSource(config = {}) {
  const normalized = normalizeIpfsConfig(config);
  if (normalized.heliaModuleUrl && normalized.useWorker !== false && isMainBrowserThread()) return `worker module ${normalized.heliaModuleUrl}`;
  if (normalized.heliaProvider) return 'configured provider';
  if (globalThis.BlendHeliaProvider) return 'window.BlendHeliaProvider';
  if (globalThis.blendHeliaProvider) return 'window.blendHeliaProvider';
  if (normalized.heliaModuleUrl) return `module ${normalized.heliaModuleUrl}`;
  return '';
}

function providerErrorMessage(provider, error, config = {}) {
  const message = error?.message || String(error || 'Unknown error');
  if (provider === 'kubo') {
    const endpoint = normalizeIpfsConfig(config).kuboApiEndpoint || DEFAULT_IPFS_CONFIG.kuboApiEndpoint;
    return `Kubo provider failed at ${endpoint}. Start Kubo, confirm the endpoint, and allow this app origin in the Kubo HTTP API CORS settings. ${message}`;
  }
  if (provider === 'helia') {
    const source = heliaProviderSource(config);
    if (!source) {
      return `Helia provider is not configured. Enter a worker-safe Helia module URL before publishing. ${message}`;
    }
    return `Helia provider failed from ${source}. Verify that it loads successfully and exposes addFile()/addBytes() for publishing or fetchCid()/cat() for retrieval. ${message}`;
  }
  if (provider === 'gateway') {
    return `Gateway retrieval failed. ${message}`;
  }
  return message;
}

function providerFailureError(provider, error, config = {}, operation = 'publish') {
  const normalized = normalizeIpfsConfig(config);
  const message = providerErrorMessage(provider, error, normalized);
  const isRetrieval = operation === 'retrieval';
  if (provider === 'kubo') {
    return new IpfsServiceError(message, {
      code: isRetrieval ? 'kubo_retrieval_failed' : 'kubo_publish_failed',
      provider,
      endpoint: normalized.kuboApiEndpoint,
      userMessage: isRetrieval ? 'Kubo retrieval failed.' : 'Kubo upload failed.',
      userDetail: isRetrieval
        ? `Blend reached the Kubo API at ${normalized.kuboApiEndpoint}, but it could not fetch the requested CID. Check that the content is available to that node and that this app origin is allowed.`
        : `Blend reached the Kubo API at ${normalized.kuboApiEndpoint}, but the upload did not complete. Check that Kubo is running, writable, and allows this app origin.`,
      userAction: isRetrieval
        ? 'Open Settings to verify the Kubo endpoint, then retry loading.'
        : 'Open Settings to verify the Kubo endpoint, then retry sharing.',
      retryable: true,
      cause: error
    });
  }
  if (provider === 'helia') {
    const source = heliaProviderSource(normalized);
    return new IpfsServiceError(message, {
      code: source ? (isRetrieval ? 'helia_retrieval_failed' : 'helia_publish_failed') : 'helia_not_configured',
      provider,
      userMessage: source
        ? (isRetrieval ? 'Browser IPFS retrieval failed.' : 'Browser IPFS upload failed.')
        : 'Browser IPFS publishing is not configured.',
      userDetail: source
        ? (isRetrieval
          ? 'The configured browser IPFS provider loaded, but it could not fetch the requested CID.'
          : 'The configured browser IPFS provider loaded, but it could not add the content.')
        : 'Blend did not find a worker Helia module URL.',
      userAction: source
        ? (isRetrieval
          ? 'Verify the provider exposes fetchCid() or cat(), then retry loading.'
          : 'Verify the provider exposes addFile() or addBytes(), then retry sharing.')
        : 'Enter a worker-safe Helia module URL before publishing.',
      retryable: !!source,
      cause: error
    });
  }
  return new IpfsServiceError(message, {
    code: 'ipfs_provider_failed',
    provider,
    userMessage: 'IPFS provider failed.',
    userDetail: message,
    userAction: 'Check provider settings and retry.',
    retryable: true,
    cause: error
  });
}

function aggregateProviderFailureError(failures = [], {
  code = 'ipfs_publish_failed',
  userMessage = 'IPFS upload failed.',
  fallbackDetail = 'Blend could not publish through any configured IPFS provider.',
  userAction = 'Check provider settings, network access, and media permissions, then retry.'
} = {}) {
  const details = failures
    .map(failure => failure?.userDetail || failure?.message || '')
    .filter(Boolean)
    .join(' ');
  return new IpfsServiceError(
    failures.map(failure => failure?.message || String(failure || '')).filter(Boolean).join(' ') || userMessage,
    {
      code,
      userMessage,
      userDetail: details || fallbackDetail,
      userAction,
      retryable: true,
      failures
    }
  );
}

function noPublishProviderMessage(config = {}) {
  const readiness = describeIpfsPublishReadiness(config);
  return [readiness.message, readiness.detail, readiness.action]
    .filter(Boolean)
    .join(' ');
}

export function formatIpfsErrorForUser(error, config = {}) {
  const normalized = normalizeIpfsConfig(config);
  if (isIpfsServiceError(error)) {
    return {
      title: 'IPFS error',
      message: error.userMessage || error.message || 'IPFS sharing failed.',
      detail: error.userDetail || error.message || 'Check provider settings and retry.',
      action: error.userAction || '',
      code: error.code || 'ipfs_error',
      provider: error.provider || '',
      retryable: error.retryable !== false,
      diagnostic: error.message || ''
    };
  }

  const message = error?.message || String(error || '');
  if (/ipfs_worker_|IPFS worker|Web Worker/i.test(error?.code || message)) {
    return {
      title: 'IPFS worker unavailable',
      message: error?.userMessage || 'IPFS sharing is unavailable in this browser.',
      detail: error?.userDetail || message || 'Blend could not start the IPFS worker required for non-blocking publishing.',
      action: error?.userAction || 'Use a modern browser with module Web Worker support.',
      code: error?.code || 'ipfs_worker_unavailable',
      provider: '',
      retryable: error?.retryable !== false,
      diagnostic: error?.diagnostic || message
    };
  }
  if (/IPFS sharing is disabled/i.test(message)) {
    const readiness = describeIpfsPublishReadiness({ ...normalized, enabled: false });
    return {
      title: 'IPFS sharing disabled',
      message: readiness.message,
      detail: readiness.detail,
      action: readiness.action,
      code: 'ipfs_disabled',
      provider: '',
      retryable: false,
      diagnostic: message
    };
  }
  if (/Gateway mode can retrieve/i.test(message)) {
    const readiness = describeIpfsPublishReadiness({ ...normalized, mode: 'gateway' });
    return {
      title: 'IPFS sharing setup',
      message: readiness.message,
      detail: [readiness.detail, readiness.action].filter(Boolean).join(' '),
      action: readiness.action,
      code: 'gateway_publish_unavailable',
      provider: 'gateway',
      retryable: false,
      diagnostic: message
    };
  }
  if (/publishing needs|publisher|provider is not configured|No Helia provider/i.test(message)) {
    const readiness = describeIpfsPublishReadiness(normalized);
    return {
      title: 'IPFS sharing setup',
      message: readiness.message || 'IPFS sharing needs setup.',
      detail: [readiness.detail, readiness.action].filter(Boolean).join(' '),
      action: readiness.action,
      code: 'ipfs_needs_setup',
      provider: '',
      retryable: false,
      diagnostic: message
    };
  }

  return {
    title: 'IPFS error',
    message: 'IPFS sharing failed.',
    detail: message || 'Check provider settings, network availability, and media permissions.',
    action: 'Check provider settings and retry.',
    code: 'ipfs_error',
    provider: '',
    retryable: true,
    diagnostic: message
  };
}

async function resolveHeliaProviderCandidate(candidate, config) {
  const value = typeof candidate === 'function'
    ? candidate(config)
    : candidate;
  return await value;
}

function toBlob(value, mimeType = '', options = {}) {
  if (value instanceof Blob) return value;
  if (value instanceof Response) {
    return responseToBlobWithProgress(value, {
      ...options,
      mimeType,
      maxBytes: options.maxBytes || DEFAULT_IPFS_CONFIG.maxItemBytes
    });
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return new Blob([value], { type: mimeType });
  if (value && typeof value[Symbol.asyncIterator] === 'function') {
    return iterableToBlob(value, {
      ...options,
      mimeType,
      maxBytes: options.maxBytes || DEFAULT_IPFS_CONFIG.maxItemBytes
    });
  }
  if (value && typeof value[Symbol.iterator] === 'function' && typeof value !== 'string' && !Array.isArray(value)) {
    return iterableToBlob(value, {
      ...options,
      mimeType,
      maxBytes: options.maxBytes || DEFAULT_IPFS_CONFIG.maxItemBytes
    });
  }
  if (Array.isArray(value)) return new Blob(value, { type: mimeType });
  return new Blob([String(value ?? '')], { type: mimeType });
}

export class IpfsService {
  constructor(config = {}) {
    this.config = normalizeIpfsConfig(config);
    this._heliaProviderPromise = null;
  }

  get canFetchViaGateway() {
    return (this.config.mode === 'gateway' || !!this.config.gatewayFallback) && this.config.gateways.length > 0;
  }

  async getHeliaProvider() {
    if (this._heliaProviderPromise) return this._heliaProviderPromise;
    this._heliaProviderPromise = (async () => {
      const injected = injectedHeliaProvider(this.config);
      if (injected) return resolveHeliaProviderCandidate(injected, this.config);
      if (!this.config.heliaModuleUrl) return null;
      const mod = await import(this.config.heliaModuleUrl);
      if (typeof mod.createBlendHeliaProvider === 'function') {
        return resolveHeliaProviderCandidate(mod.createBlendHeliaProvider, this.config);
      }
      if (mod.default && typeof mod.default.createBlendHeliaProvider === 'function') {
        return resolveHeliaProviderCandidate(mod.default.createBlendHeliaProvider, this.config);
      }
      if (typeof mod.default === 'function') return resolveHeliaProviderCandidate(mod.default, this.config);
      if (mod.default && typeof mod.default === 'object') return mod.default;
      return null;
    })().catch(error => {
      this._heliaProviderPromise = null;
      throw error;
    });
    return this._heliaProviderPromise;
  }

  async addFile(fileOrBlob, options = {}) {
    if (shouldUseIpfsWorker(this.config, options)) {
      return getIpfsWorkerClient({ workerUrl: this.config.workerUrl }).addFile(fileOrBlob, {
        ...options,
        config: this.config
      });
    }
    if (!this.config.enabled) {
      throw new IpfsServiceError('IPFS sharing is disabled in settings', {
        code: 'ipfs_disabled',
        userMessage: 'IPFS sharing is disabled.',
        userDetail: 'Enable IPFS sharing before publishing this experience.',
        userAction: 'Open Settings and turn on IPFS sharing.',
        retryable: false
      });
    }
    const providers = getIpfsPublishProviders(this.config);
    if (!providers.length) {
      const readiness = describeIpfsPublishReadiness(this.config);
      throw new IpfsServiceError(noPublishProviderMessage(this.config), {
        code: 'ipfs_needs_setup',
        userMessage: readiness.message,
        userDetail: readiness.detail,
        userAction: readiness.action,
        retryable: false
      });
    }
    const failures = [];
    for (const provider of providers) {
      try {
        if (provider === 'kubo') return await this.addFileWithKubo(fileOrBlob, options);
        return await this.addFileWithHelia(fileOrBlob, options);
      } catch (error) {
        const failure = providerFailureError(provider, error, this.config, 'publish');
        failures.push(failure);
        if (this.config.mode === provider) throw failure;
      }
    }
    throw aggregateProviderFailureError(failures);
  }

  async addJson(payload, options = {}) {
    if (shouldUseIpfsWorker(this.config, options)) {
      return getIpfsWorkerClient({ workerUrl: this.config.workerUrl }).addJson(payload, {
        ...options,
        config: this.config
      });
    }
    const json = JSON.stringify(payload);
    const blob = new Blob([json], { type: 'application/json' });
    return this.addFile(blob, {
      ...options,
      kind: options.kind || 'manifest',
      filename: options.filename || 'blend-experience-manifest.json',
      mimeType: 'application/json'
    });
  }

  async addFileWithKubo(fileOrBlob, options = {}) {
    const blob = await toBlob(fileOrBlob, options.mimeType || fileOrBlob?.type || '');
    const filename = options.filename || fileOrBlob?.name || 'blob';
    assertWithinSizeLimit(blob.size, sizeLimitForKind(this.config, options.kind), options.kind === 'manifest' ? 'Manifest' : 'Item');
    options.onProgress?.({
      phase: 'uploading',
      provider: 'kubo',
      loaded: 0,
      total: blob.size,
      filename
    });

    const form = new FormData();
    form.append('file', blob, filename);
    const api = `${this.config.kuboApiEndpoint}/api/v0/add?cid-version=1&pin=true&wrap-with-directory=false&progress=false`;
    const response = await fetchWithTimeout(api, {
      method: 'POST',
      body: form,
      signal: options.signal,
      credentials: 'omit',
      mode: 'cors'
    }, this.config.timeoutMs);
    if (!response.ok) throw new Error(`Kubo add failed (${response.status})`);
    const text = await response.text();
    const result = parseKuboAddResponse(text);
    options.onProgress?.({
      phase: 'uploaded',
      provider: 'kubo',
      loaded: blob.size,
      total: blob.size,
      filename,
      cid: result.cid
    });
    return uploadResultMetadata(result, this.config, {
      blob,
      filename,
      mimeType: options.mimeType || blob.type || '',
      itemType: options.itemType,
      kind: options.kind
    });
  }

  async addFileWithHelia(fileOrBlob, options = {}) {
    const provider = await this.getHeliaProvider();
    if (!provider) {
      throw new Error('No Helia provider is injected. Configure a Helia module URL or set window.BlendHeliaProvider.');
    }
    const blob = await toBlob(fileOrBlob, options.mimeType || fileOrBlob?.type || '');
    const filename = options.filename || fileOrBlob?.name || 'blob';
    assertWithinSizeLimit(blob.size, sizeLimitForKind(this.config, options.kind), options.kind === 'manifest' ? 'Manifest' : 'Item');
    if (options.signal?.aborted) throw options.signal.reason || new DOMException('IPFS operation cancelled', 'AbortError');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    options.onProgress?.({
      phase: 'uploading',
      provider: 'helia',
      loaded: 0,
      total: bytes.byteLength,
      filename
    });
    let result;
    if (typeof provider.addFile === 'function') {
      result = await provider.addFile(blob, { ...options, filename, bytes });
    } else if (typeof provider.addBytes === 'function') {
      result = await provider.addBytes(bytes, { ...options, filename, mimeType: options.mimeType || blob.type || '' });
    } else {
      throw new Error('Configured Helia provider must expose addFile() or addBytes()');
    }
    const cid = sanitizeCid(result?.cid || result?.toString?.() || result);
    if (!cid) throw new Error('Helia provider did not return a valid CID');
    options.onProgress?.({
      phase: 'uploaded',
      provider: 'helia',
      loaded: bytes.byteLength,
      total: bytes.byteLength,
      filename,
      cid
    });
    return uploadResultMetadata({
      cid,
      provider: 'helia',
      byteSize: result?.byteSize ?? blob.size,
      mimeType: result?.mimeType || options.mimeType || blob.type || '',
      warning: result?.warning || ''
    }, this.config, {
      blob,
      filename,
      mimeType: options.mimeType || blob.type || '',
      itemType: options.itemType,
      kind: options.kind
    });
  }

  async fetchCid(cid, options = {}) {
    if (shouldUseIpfsWorker(this.config, options)) {
      return getIpfsWorkerClient({ workerUrl: this.config.workerUrl }).fetchCid(cid, {
        ...options,
        config: this.config
      });
    }
    const cleanCid = sanitizeCid(cid);
    if (!cleanCid) throw new Error('Invalid IPFS CID');
    const maxBytes = Number(options.maxBytes) || this.config.maxItemBytes;
    const providers = getIpfsRetrievalProviders(this.config);
    const failures = [];
    for (const provider of providers) {
      if (provider === 'gateway' && !this.canFetchViaGateway) continue;
      try {
        const blob = provider === 'kubo'
          ? await this.fetchCidWithKubo(cleanCid, options)
          : provider === 'helia'
            ? await this.fetchCidWithHelia(cleanCid, options)
            : await this.fetchCidWithGateways(cleanCid, options);
        if (blob.size > maxBytes) throw new Error('IPFS content exceeds configured size limit');
        return blob;
      } catch (error) {
        const failure = providerFailureError(provider, error, this.config, 'retrieval');
        failures.push(failure);
        if (this.config.mode === provider) throw failure;
      }
    }
    throw aggregateProviderFailureError(failures.length
      ? failures
      : [new IpfsServiceError('No IPFS retrieval provider is available. Configure a gateway, Kubo endpoint, or Helia provider.', {
        code: 'ipfs_retrieval_needs_setup',
        userMessage: 'No IPFS retrieval provider is available.',
        userDetail: 'Configure a gateway, Kubo endpoint, or browser IPFS provider before opening this content.',
        userAction: 'Open Settings to update IPFS retrieval settings.',
        retryable: false
      })], {
      code: 'ipfs_retrieval_failed',
      userMessage: 'IPFS retrieval failed.',
      fallbackDetail: 'Blend could not retrieve content through any configured IPFS provider.',
      userAction: 'Check gateway/provider settings and retry.'
    });
  }

  async fetchJson(cid, options = {}) {
    if (shouldUseIpfsWorker(this.config, options)) {
      return getIpfsWorkerClient({ workerUrl: this.config.workerUrl }).fetchJson(cid, {
        ...options,
        config: this.config
      });
    }
    const blob = await this.fetchCid(cid, {
      ...options,
      maxBytes: options.maxBytes || this.config.maxManifestBytes
    });
    const text = await blob.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('IPFS manifest is not valid JSON');
    }
  }

  async fetchCidWithKubo(cid, options = {}) {
    const api = `${this.config.kuboApiEndpoint}/api/v0/cat?arg=${encodeURIComponent(cid)}`;
    const response = await fetchWithTimeout(api, {
      method: 'POST',
      signal: options.signal,
      credentials: 'omit',
      mode: 'cors'
    }, this.config.fetchTimeoutMs);
    if (!response.ok) throw new Error(`Kubo cat failed (${response.status})`);
    return responseToBlobWithProgress(response, {
      ...options,
      provider: 'kubo',
      cid,
      maxBytes: options.maxBytes || this.config.maxItemBytes
    });
  }

  async fetchCidWithHelia(cid, options = {}) {
    const provider = await this.getHeliaProvider();
    if (!provider) throw new Error('No Helia provider is injected');
    let value;
    if (typeof provider.fetchCid === 'function') value = await provider.fetchCid(cid, options);
    else if (typeof provider.cat === 'function') value = await provider.cat(cid, options);
    else throw new Error('Configured Helia provider must expose fetchCid() or cat()');
    return toBlob(value, options.mimeType || '', {
      ...options,
      provider: 'helia',
      cid,
      maxBytes: options.maxBytes || this.config.maxItemBytes
    });
  }

  async fetchCidWithGateways(cid, options = {}) {
    const failures = [];
    for (const gateway of this.config.gateways) {
      const url = gatewayUrlForCid(gateway, cid);
      try {
        const response = await fetchWithTimeout(url, {
          method: 'GET',
          signal: options.signal,
          credentials: 'omit',
          cache: options.cache || 'default'
        }, this.config.fetchTimeoutMs);
        if (!response.ok) throw new Error(`Gateway failed (${response.status})`);
        return await responseToBlobWithProgress(response, {
          ...options,
          provider: 'gateway',
          gateway,
          cid,
          maxBytes: options.maxBytes || this.config.maxItemBytes
        });
      } catch (error) {
        failures.push(`${gateway}: ${error?.message || error}`);
      }
    }
    throw new Error(failures.join(' '));
  }

  async shutdown() {
    if (shouldUseIpfsWorker(this.config, {})) {
      await shutdownIpfsWorkerClient();
      return;
    }
    const providerPromise = this._heliaProviderPromise;
    this._heliaProviderPromise = null;
    if (!providerPromise) return;
    const provider = await providerPromise.catch(() => null);
    if (!provider) return;
    if (typeof provider.stop === 'function') await provider.stop();
    else if (typeof provider.close === 'function') await provider.close();
    else if (typeof provider.destroy === 'function') await provider.destroy();
  }
}

export function gatewayUrlForCid(gateway, cid) {
  const cleanGateway = normalizeGateway(gateway);
  const cleanCid = sanitizeCid(cid);
  if (!cleanGateway || !cleanCid) return '';
  return `${cleanGateway}${encodeURIComponent(cleanCid)}`;
}

export function createIpfsService(config = {}) {
  return new IpfsService(config);
}
