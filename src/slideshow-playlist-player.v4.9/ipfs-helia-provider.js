const DEFAULT_IMPORTS = Object.freeze({
  helia: 'https://esm.sh/helia@6.1.4',
  unixfs: 'https://esm.sh/@helia/unixfs@7.2.1',
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

async function blobToBytes(blob, signal) {
  abortIfNeeded(signal);
  const buffer = await blob.arrayBuffer();
  abortIfNeeded(signal);
  return new Uint8Array(buffer);
}

export async function createBlendHeliaProvider(config = {}) {
  const heliaUrl = cleanImportUrl(config.heliaImportUrl, DEFAULT_IMPORTS.helia);
  const unixfsUrl = cleanImportUrl(config.unixfsImportUrl, DEFAULT_IMPORTS.unixfs);
  const cidUrl = cleanImportUrl(config.multiformatsCidUrl, DEFAULT_IMPORTS.cid);
  const [{ createHelia }, { unixfs }, { CID }] = await Promise.all([
    import(heliaUrl),
    import(unixfsUrl),
    import(cidUrl)
  ]);

  const helia = await createHelia();
  const fs = unixfs(helia);

  async function addBytes(bytes, options = {}) {
    abortIfNeeded(options.signal);
    const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const cid = await fs.addBytes(content, { signal: options.signal });
    let warning = '';
    if (helia.pins?.add) {
      await helia.pins.add(cid, { signal: options.signal }).catch(error => {
        warning = `Helia pin failed: ${error?.message || error}`;
      });
    }
    if (config.heliaProvideOnAdd === true && helia.routing?.provide) {
      await helia.routing.provide(cid, { signal: options.signal }).catch(error => {
        warning = warning || `Helia provide failed: ${error?.message || error}`;
      });
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
