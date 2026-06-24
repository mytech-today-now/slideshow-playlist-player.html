import {
  IPFS_WORKER_ACTION,
  IPFS_WORKER_EVENT,
  createIpfsWorkerRequest,
  sanitizeIpfsWorkerConfig,
  serializeIpfsWorkerError,
  validateIpfsWorkerResponse
} from './ipfs-worker-protocol.js';

const DEFAULT_WORKER_URL = new URL('./ipfs-worker.js', import.meta.url);

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  if (typeof DOMException !== 'undefined') return new DOMException('IPFS operation cancelled', 'AbortError');
  const error = new Error('IPFS operation cancelled');
  error.name = 'AbortError';
  return error;
}

function reviveWorkerError(serialized) {
  const safe = serializeIpfsWorkerError(serialized);
  const error = new Error(safe.message);
  error.name = safe.name || 'IpfsWorkerError';
  error.code = safe.code;
  error.provider = safe.provider;
  error.endpoint = safe.endpoint;
  error.userMessage = safe.userMessage;
  error.userDetail = safe.userDetail;
  error.userAction = safe.userAction;
  error.retryable = safe.retryable;
  error.diagnostic = safe.diagnostic;
  return error;
}

function workerUnavailableError(error = null) {
  const message = error?.message || String(error || 'Web Workers are not available');
  const out = new Error(`IPFS worker is unavailable. ${message}`);
  out.name = 'IpfsWorkerUnavailableError';
  out.code = 'ipfs_worker_unavailable';
  out.userMessage = 'IPFS sharing is unavailable in this browser.';
  out.userDetail = 'Blend needs module Web Worker support to publish or retrieve IPFS content without blocking playback.';
  out.userAction = 'Use a modern browser with Web Worker support, or run a local Kubo node from a supported browser.';
  out.retryable = false;
  return out;
}

export function isIpfsWorkerSupported(scope = globalThis) {
  return typeof scope?.Worker === 'function' && typeof URL === 'function';
}

export class IpfsWorkerClient {
  constructor({
    workerUrl = DEFAULT_WORKER_URL,
    WorkerCtor = globalThis.Worker,
    name = 'Blend IPFS Worker',
    requestTimeoutMs = 10 * 60 * 1000
  } = {}) {
    this.workerUrl = workerUrl;
    this.WorkerCtor = WorkerCtor;
    this.name = name;
    this.requestTimeoutMs = requestTimeoutMs;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.readyFingerprint = '';
    this.initPromise = null;
    this.initFingerprint = '';
    this.boundMessage = event => this.handleMessage(event);
    this.boundError = event => this.handleWorkerFailure(event);
  }

  get activeRequests() {
    return this.pending.size;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    if (typeof this.WorkerCtor !== 'function') throw workerUnavailableError();
    try {
      this.worker = new this.WorkerCtor(this.workerUrl, {
        type: 'module',
        name: this.name
      });
    } catch (error) {
      throw workerUnavailableError(error);
    }
    if (typeof this.worker.addEventListener === 'function') {
      this.worker.addEventListener('message', this.boundMessage);
      this.worker.addEventListener('error', this.boundError);
      this.worker.addEventListener('messageerror', this.boundError);
    } else {
      this.worker.onmessage = this.boundMessage;
      this.worker.onerror = this.boundError;
      this.worker.onmessageerror = this.boundError;
    }
    return this.worker;
  }

  nextRequestId(action) {
    return `ipfs:${action}:${this.nextId++}`;
  }

  configFingerprint(config) {
    const safe = sanitizeIpfsWorkerConfig(config);
    delete safe.workerUrl;
    return stableStringify(safe);
  }

  async init(config = {}, options = {}) {
    const fingerprint = this.configFingerprint(config);
    if (this.readyFingerprint === fingerprint) return { ok: true, reused: true };
    if (this.initPromise && this.initFingerprint === fingerprint) return this.initPromise;
    this.initFingerprint = fingerprint;
    this.initPromise = this.request(IPFS_WORKER_ACTION.INIT, {}, {
      ...options,
      config,
      timeoutMs: options.timeoutMs || Math.max(Number(config.timeoutMs) || 0, 30000)
    }).then(result => {
      this.readyFingerprint = fingerprint;
      return result || { ok: true };
    }).catch(error => {
      this.readyFingerprint = '';
      throw error;
    }).finally(() => {
      if (this.initFingerprint === fingerprint) {
        this.initPromise = null;
        this.initFingerprint = '';
      }
    });
    return this.initPromise;
  }

  async preparePublishConfig(config = {}, options = {}) {
    return this.request(IPFS_WORKER_ACTION.PREPARE_PUBLISH_CONFIG, {
      options
    }, {
      config,
      signal: options.signal,
      onProgress: options.onProgress,
      timeoutMs: options.timeoutMs || Math.max(Number(config.timeoutMs) || 0, 30000)
    });
  }

  async addFile(fileOrBlob, options = {}) {
    await this.init(options.config || {}, options);
    return this.request(IPFS_WORKER_ACTION.ADD_FILE, {
      blob: fileOrBlob,
      filename: options.filename || fileOrBlob?.name || 'blob',
      mimeType: options.mimeType || fileOrBlob?.type || '',
      kind: options.kind || 'item',
      itemType: options.itemType || options.type || ''
    }, options);
  }

  async addJson(payload, options = {}) {
    await this.init(options.config || {}, options);
    return this.request(IPFS_WORKER_ACTION.ADD_JSON, {
      json: payload,
      filename: options.filename || 'blend-experience-manifest.json',
      kind: options.kind || 'manifest',
      itemType: options.itemType || 'manifest'
    }, options);
  }

  async fetchCid(cid, options = {}) {
    await this.init(options.config || {}, options);
    const result = await this.request(IPFS_WORKER_ACTION.FETCH_CID, {
      cid,
      options
    }, options);
    if (!result?.blob) throw new Error('IPFS worker did not return content');
    return result.blob;
  }

  async fetchJson(cid, options = {}) {
    await this.init(options.config || {}, options);
    return this.request(IPFS_WORKER_ACTION.FETCH_JSON, {
      cid,
      options
    }, options);
  }

  request(action, payload = {}, options = {}) {
    const worker = this.ensureWorker();
    const id = this.nextRequestId(action);
    const message = createIpfsWorkerRequest(action, {
      id,
      config: options.config || {},
      payload
    });
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || this.requestTimeoutMs);
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(abortError(signal));

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        const pending = this.pending.get(id);
        if (pending?.timer) clearTimeout(pending.timer);
        if (signal && pending?.abortHandler) signal.removeEventListener('abort', pending.abortHandler);
        this.pending.delete(id);
      };
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      const abortHandler = () => {
        try {
          worker.postMessage(createIpfsWorkerRequest(IPFS_WORKER_ACTION.CANCEL, {
            id: this.nextRequestId(IPFS_WORKER_ACTION.CANCEL),
            payload: { targetId: id }
          }));
        } catch (_) {}
        finish(reject, abortError(signal));
      };
      const timer = setTimeout(() => {
        try {
          worker.postMessage(createIpfsWorkerRequest(IPFS_WORKER_ACTION.CANCEL, {
            id: this.nextRequestId(IPFS_WORKER_ACTION.CANCEL),
            payload: { targetId: id }
          }));
        } catch (_) {}
        const error = new Error('IPFS worker request timed out');
        error.name = 'TimeoutError';
        error.code = 'ipfs_worker_timeout';
        error.retryable = true;
        finish(reject, error);
      }, timeoutMs);

      this.pending.set(id, {
        action,
        resolve: value => finish(resolve, value),
        reject: error => finish(reject, error),
        onProgress: typeof options.onProgress === 'function' ? options.onProgress : null,
        onWarning: typeof options.onWarning === 'function' ? options.onWarning : null,
        abortHandler,
        timer
      });

      if (signal) signal.addEventListener('abort', abortHandler, { once: true });
      try {
        worker.postMessage(message);
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  handleMessage(event) {
    const validation = validateIpfsWorkerResponse(event?.data);
    if (!validation.ok) return;
    const message = validation.message;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.event === IPFS_WORKER_EVENT.PROGRESS) {
      pending.onProgress?.(message.payload);
      return;
    }
    if (message.event === IPFS_WORKER_EVENT.WARNING) {
      pending.onWarning?.(message.payload);
      pending.onProgress?.({ ...message.payload, phase: 'warning' });
      return;
    }
    if (message.event === IPFS_WORKER_EVENT.READY) {
      pending.onProgress?.({ ...message.payload, phase: message.payload?.phase || 'ready' });
      if (pending.action === IPFS_WORKER_ACTION.INIT) pending.resolve(message.payload);
      return;
    }
    if (message.event === IPFS_WORKER_EVENT.ERROR) {
      pending.reject(reviveWorkerError(message.error));
      return;
    }
    pending.resolve(message.payload);
  }

  handleWorkerFailure(event) {
    const error = workerUnavailableError(event?.error || event?.message || 'Worker failed');
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.readyFingerprint = '';
    this.initPromise = null;
    this.initFingerprint = '';
    this.terminate();
  }

  async shutdown(options = {}) {
    if (!this.worker) return { ok: true, alreadyStopped: true };
    try {
      await this.request(IPFS_WORKER_ACTION.SHUTDOWN, {}, {
        ...options,
        timeoutMs: options.timeoutMs || 5000
      });
    } catch (_) {
      // Termination below is the final cleanup path if shutdown cannot round-trip.
    }
    this.terminate();
    return { ok: true };
  }

  terminate() {
    if (!this.worker) return;
    if (typeof this.worker.removeEventListener === 'function') {
      this.worker.removeEventListener('message', this.boundMessage);
      this.worker.removeEventListener('error', this.boundError);
      this.worker.removeEventListener('messageerror', this.boundError);
    }
    try { this.worker.terminate?.(); } catch (_) {}
    this.worker = null;
    this.readyFingerprint = '';
  }
}

let sharedClient = null;

export function getIpfsWorkerClient(options = {}) {
  if (!sharedClient) sharedClient = new IpfsWorkerClient(options);
  return sharedClient;
}

export async function shutdownIpfsWorkerClient() {
  if (!sharedClient) return { ok: true, alreadyStopped: true };
  const client = sharedClient;
  sharedClient = null;
  return client.shutdown();
}
