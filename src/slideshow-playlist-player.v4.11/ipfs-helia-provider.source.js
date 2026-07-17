import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('IPFS operation cancelled', 'AbortError');
}

function isObjectLike(value) {
  return value != null && (typeof value === 'object' || typeof value === 'function');
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

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

async function captureHeliaSideEffectWarning(label, run, signal) {
  try {
    await awaitHeliaSideEffect(run(), signal);
    return '';
  } catch (error) {
    if (isAbortError(error)) throw error;
    return `${label}: ${error?.message || error}`;
  }
}

async function blobToBytes(blob, signal) {
  abortIfNeeded(signal);
  const buffer = await blob.arrayBuffer();
  abortIfNeeded(signal);
  return new Uint8Array(buffer);
}

export async function createBlendHeliaProvider(config = {}) {
  const helia = await createHelia();
  const fs = unixfs(helia);

  async function addBytes(bytes, options = {}) {
    abortIfNeeded(options.signal);
    const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const cid = await fs.addBytes(content, { signal: options.signal });
    let warning = '';
    if (helia.pins?.add) {
      warning = warning || await captureHeliaSideEffectWarning(
        'Helia pin failed',
        () => helia.pins.add(cid, { signal: options.signal }),
        options.signal
      );
    }
    if (config.heliaProvideOnAdd === true && helia.routing?.provide) {
      warning = warning || await captureHeliaSideEffectWarning(
        'Helia provide failed',
        () => helia.routing.provide(cid, { signal: options.signal }),
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
    const parsed = CID.parse(String(cid || ''));
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
