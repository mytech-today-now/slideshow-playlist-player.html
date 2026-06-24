export const IPFS_WORKER_PROTOCOL_VERSION = 1;
export const IPFS_WORKER_CHANNEL = 'blend-ipfs-worker-v1';

export const IPFS_WORKER_ACTION = Object.freeze({
  PREPARE_PUBLISH_CONFIG: 'preparePublishConfig',
  INIT: 'init',
  ADD_FILE: 'addFile',
  ADD_JSON: 'addJson',
  FETCH_CID: 'fetchCid',
  FETCH_JSON: 'fetchJson',
  CANCEL: 'cancel',
  SHUTDOWN: 'shutdown'
});

export const IPFS_WORKER_EVENT = Object.freeze({
  READY: 'ready',
  PROGRESS: 'progress',
  WARNING: 'warning',
  SUCCESS: 'success',
  ERROR: 'error'
});

const REQUEST_ACTIONS = new Set(Object.values(IPFS_WORKER_ACTION));
const RESPONSE_EVENTS = new Set(Object.values(IPFS_WORKER_EVENT));
const CID_V0_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_RE = /^[bB][a-zA-Z2-7]{20,}$/;
const CID_BASE58_RE = /^[zZ][1-9A-HJ-NP-Za-km-z]{20,}$/;
const MAX_TEXT = 1200;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeText(value, maxLength = MAX_TEXT) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, maxLength | 0));
}

function numberOrNull(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeDate(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function isBlobLike(value) {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function sanitizeUrl(value, { allowRelative = true } = {}) {
  const raw = sanitizeText(value, 2048);
  if (!raw) return '';
  try {
    const base = allowRelative
      ? (globalThis.location?.href || 'https://blend.invalid/')
      : undefined;
    const url = new URL(raw, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'data:' && url.protocol !== 'blob:' && url.protocol !== 'file:') return '';
    return allowRelative && !/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : url.toString();
  } catch (_) {
    return '';
  }
}

export function validateWorkerCid(value) {
  const cid = sanitizeText(value, 180);
  return !!cid && (CID_V0_RE.test(cid) || CID_V1_RE.test(cid) || CID_BASE58_RE.test(cid));
}

export function sanitizeWorkerCid(value) {
  const cid = sanitizeText(value, 180);
  return validateWorkerCid(cid) ? cid : '';
}

export function sanitizeWorkerId(value) {
  const id = sanitizeText(value, 96).replace(/[^a-zA-Z0-9:._-]+/g, '');
  return id || `ipfs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeWorkerOptions(options = {}) {
  const source = isPlainObject(options) ? options : {};
  const out = {};
  if (source.timeoutMs != null) out.timeoutMs = numberOrNull(source.timeoutMs, 100, 10 * 60 * 1000);
  if (source.probeDefaultKubo != null) out.probeDefaultKubo = source.probeDefaultKubo !== false;
  if (source.verifyKubo != null) out.verifyKubo = source.verifyKubo !== false;
  if (source.maxBytes != null) out.maxBytes = numberOrNull(source.maxBytes, 1, 20 * 1024 * 1024 * 1024);
  if (source.mimeType != null) out.mimeType = sanitizeText(source.mimeType, 180);
  if (source.cache != null) out.cache = sanitizeText(source.cache, 40);
  return out;
}

function sanitizeStringArray(value, maxItems = 40, maxLength = 2048) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => sanitizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function sanitizeIpfsWorkerConfig(config = {}) {
  const source = isPlainObject(config) ? config : {};
  const out = {};
  if (source.enabled != null) out.enabled = source.enabled !== false;
  if (source.mode != null) out.mode = sanitizeText(source.mode, 20);
  if (source.kuboApiEndpoint != null) out.kuboApiEndpoint = sanitizeText(source.kuboApiEndpoint, 2048);
  if (source.kuboApiEndpointInput != null) out.kuboApiEndpointInput = sanitizeText(source.kuboApiEndpointInput, 2048);
  if (source.kuboApiEndpointInvalid != null) out.kuboApiEndpointInvalid = source.kuboApiEndpointInvalid === true;
  if (source.kuboConfigured != null) out.kuboConfigured = source.kuboConfigured === true;
  if (source.gateways != null) out.gateways = Array.isArray(source.gateways)
    ? sanitizeStringArray(source.gateways)
    : sanitizeText(source.gateways, 4096);
  if (source.timeoutMs != null) out.timeoutMs = numberOrNull(source.timeoutMs, 3000, 10 * 60 * 1000);
  if (source.fetchTimeoutMs != null) out.fetchTimeoutMs = numberOrNull(source.fetchTimeoutMs, 3000, 10 * 60 * 1000);
  if (source.maxManifestBytes != null) out.maxManifestBytes = numberOrNull(source.maxManifestBytes, 1024, 50 * 1024 * 1024);
  if (source.maxItemBytes != null) out.maxItemBytes = numberOrNull(source.maxItemBytes, 1024 * 1024, 20 * 1024 * 1024 * 1024);
  if (source.heliaModuleUrl != null) out.heliaModuleUrl = sanitizeUrl(source.heliaModuleUrl) || sanitizeText(source.heliaModuleUrl, 2048);
  if (source.workerUrl != null) out.workerUrl = sanitizeUrl(source.workerUrl) || sanitizeText(source.workerUrl, 2048);
  if (source.gatewayFallback != null) out.gatewayFallback = source.gatewayFallback !== false;
  if (source.reuseCachedCids != null) out.reuseCachedCids = source.reuseCachedCids !== false;
  if (source.publishProviders != null) out.publishProviders = sanitizeStringArray(source.publishProviders, 4, 20);
  if (source.useWorker != null) out.useWorker = source.useWorker !== false;
  if (source.heliaImportUrl != null) out.heliaImportUrl = sanitizeUrl(source.heliaImportUrl) || sanitizeText(source.heliaImportUrl, 2048);
  if (source.unixfsImportUrl != null) out.unixfsImportUrl = sanitizeUrl(source.unixfsImportUrl) || sanitizeText(source.unixfsImportUrl, 2048);
  if (source.multiformatsCidUrl != null) out.multiformatsCidUrl = sanitizeUrl(source.multiformatsCidUrl) || sanitizeText(source.multiformatsCidUrl, 2048);
  if (source.heliaStorageName != null) out.heliaStorageName = sanitizeText(source.heliaStorageName, 120);
  if (source.heliaProvideOnAdd != null) out.heliaProvideOnAdd = source.heliaProvideOnAdd === true;
  return out;
}

function sanitizeJsonPayload(value, depth = 0) {
  if (depth > 8) return null;
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20000).map(item => sanitizeJsonPayload(item, depth + 1));
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'function' || typeof raw === 'symbol') continue;
    out[sanitizeText(key, 160)] = sanitizeJsonPayload(raw, depth + 1);
  }
  return out;
}

function sanitizeRequestPayload(action, payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  if (action === IPFS_WORKER_ACTION.PREPARE_PUBLISH_CONFIG) {
    return { options: sanitizeWorkerOptions(source.options) };
  }
  if (action === IPFS_WORKER_ACTION.ADD_FILE) {
    return {
      blob: isBlobLike(source.blob) ? source.blob : null,
      filename: sanitizeText(source.filename || source.name || 'blob', 260) || 'blob',
      mimeType: sanitizeText(source.mimeType || source.contentType || source.blob?.type || '', 180),
      kind: sanitizeText(source.kind || 'item', 40),
      itemType: sanitizeText(source.itemType || source.type || '', 40)
    };
  }
  if (action === IPFS_WORKER_ACTION.ADD_JSON) {
    return {
      json: sanitizeJsonPayload(source.json ?? source.payload ?? null),
      filename: sanitizeText(source.filename || 'blend-experience-manifest.json', 260),
      kind: sanitizeText(source.kind || 'manifest', 40),
      itemType: sanitizeText(source.itemType || 'manifest', 40)
    };
  }
  if (action === IPFS_WORKER_ACTION.FETCH_CID || action === IPFS_WORKER_ACTION.FETCH_JSON) {
    return {
      cid: sanitizeWorkerCid(source.cid),
      options: sanitizeWorkerOptions(source.options)
    };
  }
  if (action === IPFS_WORKER_ACTION.CANCEL) {
    return { targetId: sanitizeText(source.targetId || source.id || '', 96).replace(/[^a-zA-Z0-9:._-]+/g, '') };
  }
  return {};
}

function invalid(message) {
  return { ok: false, error: sanitizeText(message, 300), message: null };
}

export function createIpfsWorkerRequest(action, {
  id = '',
  config = null,
  payload = null
} = {}) {
  return {
    channel: IPFS_WORKER_CHANNEL,
    protocolVersion: IPFS_WORKER_PROTOCOL_VERSION,
    id: sanitizeWorkerId(id),
    action,
    config: config ? sanitizeIpfsWorkerConfig(config) : undefined,
    payload: sanitizeRequestPayload(action, payload)
  };
}

export function validateIpfsWorkerRequest(value) {
  if (!isPlainObject(value)) return invalid('Worker request must be an object');
  if (value.channel !== IPFS_WORKER_CHANNEL) return invalid('Worker request channel is not supported');
  if (value.protocolVersion !== IPFS_WORKER_PROTOCOL_VERSION) return invalid('Worker protocol version is not supported');
  const action = sanitizeText(value.action, 40);
  if (!REQUEST_ACTIONS.has(action)) return invalid('Worker request action is not supported');
  const id = sanitizeText(value.id, 96).replace(/[^a-zA-Z0-9:._-]+/g, '');
  if (!id) return invalid('Worker request id is missing');
  const message = {
    channel: IPFS_WORKER_CHANNEL,
    protocolVersion: IPFS_WORKER_PROTOCOL_VERSION,
    id,
    action,
    config: sanitizeIpfsWorkerConfig(value.config),
    payload: sanitizeRequestPayload(action, value.payload)
  };
  if (action === IPFS_WORKER_ACTION.ADD_FILE && !message.payload.blob) return invalid('Worker addFile request is missing a Blob');
  if ((action === IPFS_WORKER_ACTION.FETCH_CID || action === IPFS_WORKER_ACTION.FETCH_JSON) && !message.payload.cid) return invalid('Worker fetch request has an invalid CID');
  if (action === IPFS_WORKER_ACTION.CANCEL && !message.payload.targetId) return invalid('Worker cancel request is missing a target id');
  return { ok: true, message, error: '' };
}

export function serializeIpfsWorkerError(error, fallback = 'IPFS worker operation failed') {
  const source = isPlainObject(error) || error instanceof Error ? error : {};
  return {
    name: sanitizeText(source.name || 'IpfsWorkerError', 80),
    message: sanitizeText(source.message || String(error || fallback), 1000) || fallback,
    code: sanitizeText(source.code || 'ipfs_worker_error', 80),
    provider: sanitizeText(source.provider || '', 40),
    endpoint: sanitizeText(source.endpoint || '', 2048),
    userMessage: sanitizeText(source.userMessage || '', 500),
    userDetail: sanitizeText(source.userDetail || '', 1200),
    userAction: sanitizeText(source.userAction || '', 500),
    retryable: source.retryable !== false,
    diagnostic: sanitizeText(source.diagnostic || source.stack || source.message || '', 1600)
  };
}

export function sanitizeIpfsUploadResult(result = {}) {
  const source = isPlainObject(result) ? result : {};
  const cid = sanitizeWorkerCid(source.cid);
  const out = {
    cid,
    provider: sanitizeText(source.provider || '', 40),
    byteSize: numberOrNull(source.byteSize ?? source.size, 0),
    size: numberOrNull(source.size ?? source.byteSize, 0),
    mimeType: sanitizeText(source.mimeType || source.contentType || '', 180),
    contentType: sanitizeText(source.contentType || source.mimeType || '', 180),
    itemType: sanitizeText(source.itemType || source.type || source.kind || '', 40),
    filename: sanitizeText(source.filename || source.name || '', 260),
    name: sanitizeText(source.name || source.filename || '', 260),
    timestamp: normalizeDate(source.timestamp || source.uploadedAt || source.updatedAt) || new Date().toISOString(),
    gatewayUrl: sanitizeUrl(source.gatewayUrl, { allowRelative: false }),
    shareUrl: sanitizeUrl(source.shareUrl, { allowRelative: false }),
    reused: source.reused === true
  };
  if (source.warning) out.warning = sanitizeText(source.warning, 1000);
  return out;
}

function sanitizeProgressPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    phase: sanitizeText(source.phase || source.status || 'working', 80),
    status: sanitizeText(source.status || '', 300),
    detail: sanitizeText(source.detail || '', 700),
    provider: sanitizeText(source.provider || '', 40),
    cid: sanitizeWorkerCid(source.cid),
    filename: sanitizeText(source.filename || '', 260),
    loaded: numberOrNull(source.loaded, 0),
    total: numberOrNull(source.total, 0),
    percent: numberOrNull(source.percent, 0, 100),
    timestamp: normalizeDate(source.timestamp) || new Date().toISOString()
  };
}

function sanitizeWorkerResponsePayload(event, action, payload = {}) {
  if (event === IPFS_WORKER_EVENT.PROGRESS || event === IPFS_WORKER_EVENT.READY) return sanitizeProgressPayload(payload);
  if (event === IPFS_WORKER_EVENT.WARNING) return { message: sanitizeText(payload?.message || payload, 1000), ...sanitizeProgressPayload(payload) };
  if (action === IPFS_WORKER_ACTION.ADD_FILE || action === IPFS_WORKER_ACTION.ADD_JSON) return sanitizeIpfsUploadResult(payload);
  if (action === IPFS_WORKER_ACTION.FETCH_CID) {
    return {
      blob: isBlobLike(payload?.blob) ? payload.blob : null,
      cid: sanitizeWorkerCid(payload?.cid),
      byteSize: numberOrNull(payload?.byteSize ?? payload?.blob?.size, 0),
      mimeType: sanitizeText(payload?.mimeType || payload?.blob?.type || '', 180),
      timestamp: normalizeDate(payload?.timestamp) || new Date().toISOString()
    };
  }
  if (action === IPFS_WORKER_ACTION.FETCH_JSON || action === IPFS_WORKER_ACTION.PREPARE_PUBLISH_CONFIG || action === IPFS_WORKER_ACTION.INIT || action === IPFS_WORKER_ACTION.SHUTDOWN || action === IPFS_WORKER_ACTION.CANCEL) {
    return sanitizeJsonPayload(payload);
  }
  return sanitizeJsonPayload(payload);
}

export function createIpfsWorkerResponse(event, request, {
  payload = null,
  error = null
} = {}) {
  const action = sanitizeText(request?.action, 40);
  const id = sanitizeText(request?.id, 96).replace(/[^a-zA-Z0-9:._-]+/g, '');
  return {
    channel: IPFS_WORKER_CHANNEL,
    protocolVersion: IPFS_WORKER_PROTOCOL_VERSION,
    id,
    action,
    event,
    payload: error ? undefined : sanitizeWorkerResponsePayload(event, action, payload),
    error: error ? serializeIpfsWorkerError(error) : undefined
  };
}

export function validateIpfsWorkerResponse(value) {
  if (!isPlainObject(value)) return invalid('Worker response must be an object');
  if (value.channel !== IPFS_WORKER_CHANNEL) return invalid('Worker response channel is not supported');
  if (value.protocolVersion !== IPFS_WORKER_PROTOCOL_VERSION) return invalid('Worker protocol version is not supported');
  const event = sanitizeText(value.event, 40);
  const action = sanitizeText(value.action, 40);
  const id = sanitizeText(value.id, 96).replace(/[^a-zA-Z0-9:._-]+/g, '');
  if (!RESPONSE_EVENTS.has(event)) return invalid('Worker response event is not supported');
  if (!REQUEST_ACTIONS.has(action)) return invalid('Worker response action is not supported');
  if (!id) return invalid('Worker response id is missing');
  const message = {
    channel: IPFS_WORKER_CHANNEL,
    protocolVersion: IPFS_WORKER_PROTOCOL_VERSION,
    id,
    action,
    event,
    payload: event === IPFS_WORKER_EVENT.ERROR ? undefined : sanitizeWorkerResponsePayload(event, action, value.payload),
    error: event === IPFS_WORKER_EVENT.ERROR ? serializeIpfsWorkerError(value.error) : undefined
  };
  return { ok: true, message, error: '' };
}
