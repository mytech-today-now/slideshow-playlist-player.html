import {
  IPFS_WORKER_ACTION,
  IPFS_WORKER_EVENT,
  createIpfsWorkerResponse,
  sanitizeIpfsWorkerConfig,
  sanitizeWorkerId,
  serializeIpfsWorkerError,
  validateIpfsWorkerRequest
} from './ipfs-worker-protocol.js';
import {
  createIpfsService,
  getIpfsPublishProviders,
  getIpfsRetrievalProviders,
  normalizeIpfsConfig,
  prepareIpfsPublishConfig
} from './ipfs-service.js';

let service = null;
let serviceFingerprint = '';
const controllers = new Map();

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function workerConfig(config = {}) {
  return {
    ...sanitizeIpfsWorkerConfig(config),
    _workerDisabled: true
  };
}

function fingerprintConfig(config = {}) {
  const safe = sanitizeIpfsWorkerConfig(config);
  delete safe.workerUrl;
  return stableStringify(safe);
}

function post(event, request, payload = null, error = null) {
  globalThis.postMessage(createIpfsWorkerResponse(event, request, { payload, error }));
}

function postProgress(request, payload = {}) {
  post(IPFS_WORKER_EVENT.PROGRESS, request, {
    ...payload,
    timestamp: new Date().toISOString()
  });
}

function serializeReadiness(readiness = {}) {
  if (!readiness || typeof readiness !== 'object') return readiness;
  return {
    ...readiness,
    error: readiness.error ? serializeIpfsWorkerError(readiness.error) : null
  };
}

function serializePrepared(prepared = {}) {
  return {
    config: sanitizeIpfsWorkerConfig(prepared.config),
    readiness: serializeReadiness(prepared.readiness),
    checks: Array.isArray(prepared.checks)
      ? prepared.checks.map(check => ({
        ...check,
        error: check?.error ? serializeIpfsWorkerError(check.error) : null
      }))
      : []
  };
}

async function shutdownService() {
  const current = service;
  service = null;
  serviceFingerprint = '';
  if (current && typeof current.shutdown === 'function') {
    await current.shutdown().catch(() => {});
  }
}

async function ensureService(config, request, signal) {
  const normalized = normalizeIpfsConfig(workerConfig(config));
  const fingerprint = fingerprintConfig(normalized);
  if (service && serviceFingerprint === fingerprint) return service;

  await shutdownService();
  postProgress(request, {
    phase: 'initializing',
    status: 'Starting IPFS worker',
    provider: normalized.mode
  });
  service = createIpfsService(normalized);
  serviceFingerprint = fingerprint;

  const providers = new Set([
    ...getIpfsPublishProviders(normalized),
    ...getIpfsRetrievalProviders(normalized)
  ]);
  if (providers.has('helia')) {
    postProgress(request, {
      phase: 'starting_node',
      status: 'Starting browser IPFS node',
      provider: 'helia'
    });
    if (signal?.aborted) throw signal.reason || new DOMException('IPFS operation cancelled', 'AbortError');
    await service.getHeliaProvider();
  }
  return service;
}

function enrichUploadResult(result, request) {
  return {
    ...result,
    filename: request.payload?.filename || result?.filename || result?.name || '',
    itemType: request.payload?.itemType || request.payload?.kind || result?.itemType || result?.type || '',
    timestamp: result?.timestamp || new Date().toISOString()
  };
}

async function runWithController(request, fn) {
  const controller = new AbortController();
  controllers.set(request.id, controller);
  try {
    const result = await fn(controller.signal);
    post(IPFS_WORKER_EVENT.SUCCESS, request, result);
  } catch (error) {
    post(IPFS_WORKER_EVENT.ERROR, request, null, error);
  } finally {
    controllers.delete(request.id);
  }
}

async function handlePreparePublishConfig(request) {
  await runWithController(request, async signal => {
    postProgress(request, {
      phase: 'checking',
      status: 'Checking IPFS publisher',
      provider: request.config?.mode || 'auto'
    });
    const prepared = await prepareIpfsPublishConfig(workerConfig(request.config), {
      ...(request.payload?.options || {}),
      signal,
      _workerDisabled: true
    });
    return serializePrepared(prepared);
  });
}

async function handleInit(request) {
  const controller = new AbortController();
  controllers.set(request.id, controller);
  try {
    const normalized = normalizeIpfsConfig(workerConfig(request.config));
    await ensureService(normalized, request, controller.signal);
    post(IPFS_WORKER_EVENT.READY, request, {
      phase: 'ready',
      status: 'IPFS worker ready',
      provider: getIpfsPublishProviders(normalized).join(',') || normalized.mode,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    post(IPFS_WORKER_EVENT.ERROR, request, null, error);
  } finally {
    controllers.delete(request.id);
  }
}

async function handleAddFile(request) {
  await runWithController(request, async signal => {
    const current = await ensureService(request.config, request, signal);
    const result = await current.addFile(request.payload.blob, {
      filename: request.payload.filename,
      mimeType: request.payload.mimeType,
      kind: request.payload.kind,
      itemType: request.payload.itemType,
      signal,
      onProgress: progress => postProgress(request, progress)
    });
    return enrichUploadResult(result, request);
  });
}

async function handleAddJson(request) {
  await runWithController(request, async signal => {
    const current = await ensureService(request.config, request, signal);
    const result = await current.addJson(request.payload.json, {
      filename: request.payload.filename,
      kind: request.payload.kind,
      itemType: request.payload.itemType,
      signal,
      onProgress: progress => postProgress(request, progress)
    });
    return enrichUploadResult(result, request);
  });
}

async function handleFetchCid(request) {
  await runWithController(request, async signal => {
    const current = await ensureService(request.config, request, signal);
    const blob = await current.fetchCid(request.payload.cid, {
      ...(request.payload.options || {}),
      signal,
      onProgress: progress => postProgress(request, progress)
    });
    return {
      blob,
      cid: request.payload.cid,
      byteSize: blob.size,
      mimeType: blob.type || request.payload.options?.mimeType || '',
      timestamp: new Date().toISOString()
    };
  });
}

async function handleFetchJson(request) {
  await runWithController(request, async signal => {
    const current = await ensureService(request.config, request, signal);
    return current.fetchJson(request.payload.cid, {
      ...(request.payload.options || {}),
      signal,
      onProgress: progress => postProgress(request, progress)
    });
  });
}

function handleCancel(request) {
  const targetId = request.payload?.targetId || '';
  const controller = controllers.get(targetId);
  if (controller) {
    try { controller.abort(new DOMException('IPFS operation cancelled', 'AbortError')); }
    catch (_) { controller.abort(); }
  }
  post(IPFS_WORKER_EVENT.SUCCESS, request, { ok: true, cancelled: !!controller, targetId });
}

async function handleShutdown(request) {
  for (const controller of controllers.values()) {
    try { controller.abort(new DOMException('IPFS worker shutting down', 'AbortError')); }
    catch (_) { controller.abort(); }
  }
  controllers.clear();
  await shutdownService();
  post(IPFS_WORKER_EVENT.SUCCESS, request, { ok: true, stoppedAt: new Date().toISOString() });
  setTimeout(() => globalThis.close?.(), 0);
}

async function handleMessage(raw) {
  const validation = validateIpfsWorkerRequest(raw);
  if (!validation.ok) {
    const fallback = {
      id: sanitizeWorkerId(raw?.id || 'invalid'),
      action: IPFS_WORKER_ACTION.INIT
    };
    post(IPFS_WORKER_EVENT.ERROR, fallback, null, new Error(validation.error));
    return;
  }

  const request = validation.message;
  if (request.action === IPFS_WORKER_ACTION.PREPARE_PUBLISH_CONFIG) return handlePreparePublishConfig(request);
  if (request.action === IPFS_WORKER_ACTION.INIT) return handleInit(request);
  if (request.action === IPFS_WORKER_ACTION.ADD_FILE) return handleAddFile(request);
  if (request.action === IPFS_WORKER_ACTION.ADD_JSON) return handleAddJson(request);
  if (request.action === IPFS_WORKER_ACTION.FETCH_CID) return handleFetchCid(request);
  if (request.action === IPFS_WORKER_ACTION.FETCH_JSON) return handleFetchJson(request);
  if (request.action === IPFS_WORKER_ACTION.CANCEL) return handleCancel(request);
  if (request.action === IPFS_WORKER_ACTION.SHUTDOWN) return handleShutdown(request);
}

globalThis.addEventListener('message', event => {
  void handleMessage(event.data);
});
