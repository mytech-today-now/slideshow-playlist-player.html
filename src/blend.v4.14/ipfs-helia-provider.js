const DEFAULT_IMPORTS = Object.freeze({
  helia: 'https://esm.sh/helia@6.1.4/es2022/helia.bundle.mjs',
  unixfs: 'https://esm.sh/@helia/unixfs@7.2.1/es2022/unixfs.bundle.mjs',
  cid: 'https://esm.sh/multiformats@14.0.0/cid'
});

function cleanImportUrl(value, fallback) {
  const raw = String(value || fallback || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, globalThis.location?.href || import.meta.url).toString();
  } catch (_) {
    return fallback;
  }
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('IPFS operation cancelled', 'AbortError');
}

function isObjectLike(value) {
  return value != null && (typeof value === 'object' || typeof value === 'function');
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

const HELIA_SIDE_EFFECT_TIMEOUT_MS = 2500;

export async function awaitHeliaSideEffect(result, signal) {
  abortIfNeeded(signal);
  if (result == null) return;
  if (typeof result.then === 'function') {
    await result;
    abortIfNeeded(signal);
    return;
  }
  if (isObjectLike(result) && typeof result[Symbol.asyncIterator] === 'function') {
    for await (const _ of result) abortIfNeeded(signal);
    return;
  }
  if (isObjectLike(result) && typeof result[Symbol.iterator] === 'function') {
    for (const _ of result) abortIfNeeded(signal);
  }
  abortIfNeeded(signal);
}

async function captureHeliaSideEffectWarning(label, run, signal, timeoutMs = HELIA_SIDE_EFFECT_TIMEOUT_MS) {
  abortIfNeeded(signal);
  const controller = new AbortController();
  let timer = null;
  let timedOut = false;
  const abortFromParent = () => {
    try { controller.abort(signal?.reason || new DOMException('IPFS operation cancelled', 'AbortError')); }
    catch (_) { controller.abort(); }
  };
  if (signal) {
    if (signal.aborted) abortFromParent();
    else signal.addEventListener('abort', abortFromParent, { once: true });
  }
  const sideEffect = Promise.resolve().then(() => awaitHeliaSideEffect(run(controller.signal), controller.signal));
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const error = new DOMException(`${label} timed out`, 'TimeoutError');
      try { controller.abort(error); } catch (_) { controller.abort(); }
      reject(error);
    }, Math.max(250, Number(timeoutMs) || HELIA_SIDE_EFFECT_TIMEOUT_MS));
  });
  try {
    await Promise.race([sideEffect, timeout]);
    return '';
  } catch (error) {
    if (signal?.aborted || (isAbortError(error) && !timedOut)) throw (signal?.reason || error);
    return `${label}: ${timedOut ? 'timed out' : (error?.message || error)}`;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener?.('abort', abortFromParent);
  }
}

function queueHeliaSideEffect(label, run, signal) {
  void captureHeliaSideEffectWarning(label, run, signal).catch(() => {});
}

async function blobToBytes(blob, signal) {
  abortIfNeeded(signal);
  const buffer = await blob.arrayBuffer();
  abortIfNeeded(signal);
  return new Uint8Array(buffer);
}

function heliaModuleLoadError(error, urls = []) {
  const detail = error?.message || String(error || 'Unknown module load error');
  const out = new Error(`Helia module failed to load. ${detail}`);
  out.name = 'HeliaModuleLoadError';
  out.code = 'helia_module_load_failed';
  out.provider = 'helia';
  out.userMessage = 'Browser IPFS provider could not load.';
  out.userDetail = `Blend could not load the configured Helia module or one of its dependencies. Check browser shields/extensions, CDN access, and the Worker Helia module URL. ${detail}`;
  out.userAction = 'Open Settings to use a reachable worker-safe Helia module URL, or choose Kubo and run a local node.';
  out.retryable = true;
  out.diagnostic = [detail, ...urls].filter(Boolean).join(' ');
  out.cause = error;
  return out;
}

async function importHeliaModules(urls) {
  try {
    const [{ createHelia }, { unixfs }] = await Promise.all([
      import(urls.heliaUrl),
      import(urls.unixfsUrl)
    ]);
    return { createHelia, unixfs };
  } catch (error) {
    throw heliaModuleLoadError(error, [urls.heliaUrl, urls.unixfsUrl]);
  }
}

export async function createBlendHeliaProvider(config = {}) {
  const heliaUrl = cleanImportUrl(config.heliaImportUrl, DEFAULT_IMPORTS.helia);
  const unixfsUrl = cleanImportUrl(config.unixfsImportUrl, DEFAULT_IMPORTS.unixfs);
  const cidUrl = cleanImportUrl(config.multiformatsCidUrl, DEFAULT_IMPORTS.cid);
  const { createHelia, unixfs } = await importHeliaModules({ heliaUrl, unixfsUrl });

  const helia = await createHelia();
  const fs = unixfs(helia);
  let cidModulePromise = null;

  async function parseCid(cid) {
    try {
      cidModulePromise = cidModulePromise || import(cidUrl);
      const { CID } = await cidModulePromise;
      return CID.parse(String(cid || ''));
    } catch (error) {
      cidModulePromise = null;
      throw heliaModuleLoadError(error, [cidUrl]);
    }
  }

  async function addBytes(bytes, options = {}) {
    abortIfNeeded(options.signal);
    const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const cid = await fs.addBytes(content, { signal: options.signal });
    let warning = '';
    if (helia.pins?.add) {
      queueHeliaSideEffect(
        'Helia pin failed',
        sideSignal => helia.pins.add(cid, { signal: sideSignal }),
        options.signal
      );
    }
    if (config.heliaProvideOnAdd === true && helia.routing?.provide) {
      queueHeliaSideEffect(
        'Helia provide failed',
        sideSignal => helia.routing.provide(cid, { signal: sideSignal }),
        options.signal
      );
    }
    return {
      cid: cid.toString(),
      provider: 'helia',
      byteSize: content.byteLength,
      mimeType: options.mimeType || '',
      timestamp: new Date().toISOString(),
      warning
    };
  }

  async function addFile(blob, options = {}) {
    const bytes = await blobToBytes(blob, options.signal);
    return addBytes(bytes, {
      ...options,
      mimeType: options.mimeType || blob.type || ''
    });
  }

  async function fetchCid(cid, options = {}) {
    abortIfNeeded(options.signal);
    const parsed = await parseCid(cid);
    const chunks = [];
    let loaded = 0;
    for await (const chunk of fs.cat(parsed, { signal: options.signal })) {
      abortIfNeeded(options.signal);
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      loaded += bytes.byteLength;
      options.onProgress?.({
        phase: 'downloading',
        provider: 'helia',
        cid: parsed.toString(),
        loaded,
        total: options.total || 0
      });
      chunks.push(bytes);
    }
    return new Blob(chunks, { type: options.mimeType || '' });
  }

  return {
    addBytes,
    addFile,
    fetchCid,
    cat: fetchCid,
    async stop() {
      await helia.stop?.();
    }
  };
}
