import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createIpfsService,
  describeIpfsPublishReadiness,
  formatIpfsErrorForUser,
  gatewayUrlForCid,
  getIpfsPublishProviders,
  getIpfsRetrievalProviders,
  prepareIpfsPublishConfig,
  shutdownIpfsWorkerRuntime
} from '../ipfs-service.js';
import {
  IPFS_WORKER_ACTION,
  IPFS_WORKER_EVENT,
  createIpfsWorkerResponse
} from '../ipfs-worker-protocol.js';

const CID = 'QmWmyoMoctfbdiQcRVLda5D4gA7D6Drb5St9Qf7N9YJ5dA';

test('default auto addFile requires setup until a publisher is prepared', async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('unexpected fetch');
  };

  assert.deepEqual(getIpfsPublishProviders({}), []);
  assert.deepEqual(getIpfsRetrievalProviders({}), ['gateway']);
  const readiness = describeIpfsPublishReadiness({});
  assert.equal(readiness.canPublish, false);
  assert.equal(readiness.state, 'needs_setup');

  const service = createIpfsService();
  await assert.rejects(
    () => service.addFile(new Blob(['abc'])),
    error => {
      assert.match(error.message, /IPFS sharing needs a publisher/);
      assert.match(error.message, /Auto mode can use/);
      assert.doesNotMatch(error.message, /Kubo is not reachable/);
      assert.doesNotMatch(error.message, /Browser Helia is not available/);
      return true;
    }
  );
  assert.equal(fetchCalled, false);
});

test('default auto preparation uses a reachable local Kubo endpoint', async (t) => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (url, options) => {
    urls.push(String(url));
    assert.equal(options.method, 'POST');
    if (String(url).includes('/api/v0/version')) {
      return new Response(JSON.stringify({ Version: '0.31.0' }), { status: 200 });
    }
    assert.match(String(url), /\/api\/v0\/add/);
    return new Response(`${JSON.stringify({ Name: 'clip.mp4', Hash: CID, Size: '3' })}\n`, { status: 200 });
  };

  const prepared = await prepareIpfsPublishConfig({}, { timeoutMs: 1000 });
  assert.equal(prepared.readiness.canPublish, true);
  assert.deepEqual(prepared.readiness.providers, ['kubo']);
  assert.match(prepared.readiness.detail, /Local Kubo responded/);

  const service = createIpfsService(prepared.config);
  const result = await service.addFile(new Blob(['abc']));
  assert.equal(result.cid, CID);
  assert.equal(result.provider, 'kubo');
  assert.deepEqual(urls.map(url => url.replace(/\?.*$/, '')), [
    'http://127.0.0.1:5001/api/v0/version',
    'http://127.0.0.1:5001/api/v0/add'
  ]);
});

test('default auto preparation gives setup guidance when Kubo and browser publishing are unavailable', async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new TypeError('Failed to fetch');
  };

  const prepared = await prepareIpfsPublishConfig({}, { timeoutMs: 1000 });
  assert.equal(fetchCalled, true);
  assert.equal(prepared.readiness.canPublish, false);
  assert.equal(prepared.readiness.state, 'needs_setup');
  assert.match(prepared.readiness.message, /IPFS sharing needs setup/);
  assert.match(prepared.readiness.detail, /could not reach the local Kubo node/);
  assert.match(prepared.readiness.detail, /no browser IPFS publisher is configured/);
  assert.doesNotMatch(`${prepared.readiness.message} ${prepared.readiness.detail}`, /Browser Helia is not available/);

  const formatted = formatIpfsErrorForUser(prepared.readiness.error, prepared.config);
  assert.match(formatted.message, /Local IPFS node is not reachable/);
  assert.match(formatted.detail, /allow this app origin/);
  assert.match(formatted.diagnostic, /Failed to fetch/);
});

test('auto preparation does not fall back to an unconfigured bundled Helia module', async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new TypeError('Failed to fetch');
  };

  const config = {
    mode: 'auto',
    heliaModuleUrl: './ipfs-helia-provider.bundle.js?v=20260620-v4.11-helia-pin-iterable',
    heliaConfigured: false
  };

  assert.deepEqual(getIpfsPublishProviders(config), []);
  assert.deepEqual(getIpfsRetrievalProviders(config), ['gateway']);

  const prepared = await prepareIpfsPublishConfig(config, { timeoutMs: 1000 });
  assert.equal(fetchCalled, true);
  assert.equal(prepared.readiness.canPublish, false);
  assert.deepEqual(prepared.readiness.providers, []);
  assert.equal(prepared.config.heliaConfigured, false);
  assert.match(prepared.readiness.detail, /no browser IPFS publisher is configured/);
});

test('invalid Kubo endpoint is reported before network probing', async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('unexpected fetch');
  };

  const readiness = describeIpfsPublishReadiness({
    mode: 'kubo',
    kuboApiEndpoint: 'not a url'
  });
  assert.equal(readiness.canPublish, false);
  assert.match(readiness.message, /Kubo API endpoint is not valid/);

  const prepared = await prepareIpfsPublishConfig({
    mode: 'kubo',
    kuboApiEndpoint: 'not a url'
  }, { timeoutMs: 1000 });
  assert.equal(prepared.readiness.canPublish, false);
  assert.match(prepared.readiness.detail, /not a url/);
  assert.equal(fetchCalled, false);
});

test('adds files through Kubo and reports progress without a public network', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/api\/v0\/add/);
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    return new Response(`${JSON.stringify({ Name: 'clip.mp4', Hash: CID, Size: '3' })}\n`, { status: 200 });
  };

  const service = createIpfsService({
    mode: 'kubo',
    kuboApiEndpoint: 'http://127.0.0.1:5001',
    gateways: []
  });
  const progress = [];
  const result = await service.addFile(new Blob(['abc'], { type: 'video/mp4' }), {
    filename: 'clip.mp4',
    mimeType: 'video/mp4',
    onProgress: event => progress.push(event)
  });

  assert.equal(result.cid, CID);
  assert.equal(result.provider, 'kubo');
  assert.equal(result.byteSize, 3);
  assert.equal(progress.at(0).phase, 'uploading');
  assert.equal(progress.at(-1).phase, 'uploaded');
});

test('explicit Kubo publish failures include endpoint and do not cascade to Helia', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  const service = createIpfsService({
    mode: 'kubo',
    kuboApiEndpoint: 'http://127.0.0.1:5001'
  });

  await assert.rejects(
    () => service.addFile(new Blob(['abc'])),
    error => {
      assert.match(error.message, /Kubo provider failed at http:\/\/127\.0\.0\.1:5001/);
      assert.match(error.message, /Failed to fetch/);
      assert.doesNotMatch(error.message, /Browser Helia is not available/);
      const formatted = formatIpfsErrorForUser(error, service.config);
      assert.equal(formatted.message, 'Kubo upload failed.');
      assert.match(formatted.detail, /http:\/\/127\.0\.0\.1:5001/);
      return true;
    }
  );
});

test('auto mode preserves custom Kubo endpoint publishing', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/kubo\.example\.test\/api\/v0\/add/);
    return new Response(`${JSON.stringify({ Hash: CID })}\n`, { status: 200 });
  };

  assert.deepEqual(getIpfsPublishProviders({
    mode: 'auto',
    kuboApiEndpoint: 'https://kubo.example.test'
  }), ['kubo']);

  const service = createIpfsService({
    mode: 'auto',
    kuboApiEndpoint: 'https://kubo.example.test'
  });
  const result = await service.addFile(new Blob(['abc']));
  assert.equal(result.cid, CID);
  assert.equal(result.provider, 'kubo');
});

test('Helia publish mode requires a configured provider before uploading', async () => {
  assert.deepEqual(getIpfsPublishProviders({ mode: 'helia' }), []);
  const readiness = describeIpfsPublishReadiness({ mode: 'helia' });
  assert.equal(readiness.canPublish, false);
  assert.equal(readiness.state, 'needs_setup');
  assert.match(readiness.message, /Browser IPFS publishing is not configured/);

  const service = createIpfsService({
    mode: 'helia',
    gateways: []
  });

  await assert.rejects(
    () => service.addFile(new Blob(['abc'])),
    /Browser IPFS publishing is not configured/
  );
});

test('auto preparation falls back to configured Helia when Kubo is unavailable', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  const prepared = await prepareIpfsPublishConfig({
    mode: 'auto',
    kuboApiEndpoint: 'https://kubo.example.test',
    heliaProvider: {
      async addBytes() {
        return { cid: CID };
      }
    }
  }, { timeoutMs: 1000 });

  assert.equal(prepared.readiness.canPublish, true);
  assert.deepEqual(prepared.readiness.providers, ['helia']);
  assert.match(prepared.readiness.detail, /Kubo is not reachable/);

  const service = createIpfsService(prepared.config);
  const result = await service.addFile(new Blob(['abc']));
  assert.equal(result.provider, 'helia');
  assert.equal(result.cid, CID);
});

test('auto mode can still use an explicitly configured Helia module URL', () => {
  const moduleUrl = `data:text/javascript,export function createBlendHeliaProvider(){return {addBytes(){return {cid:${JSON.stringify(CID)}}}}}`;

  assert.deepEqual(getIpfsPublishProviders({
    mode: 'auto',
    heliaModuleUrl: moduleUrl
  }), ['helia']);
  assert.deepEqual(getIpfsPublishProviders({
    mode: 'auto',
    heliaModuleUrl: moduleUrl,
    heliaConfigured: true
  }), ['helia']);
  assert.deepEqual(getIpfsPublishProviders({
    mode: 'auto',
    heliaModuleUrl: moduleUrl,
    heliaConfigured: false
  }), []);
  assert.deepEqual(getIpfsPublishProviders({
    mode: 'helia',
    heliaModuleUrl: moduleUrl,
    heliaConfigured: false
  }), ['helia']);
});


test('adds files through a configured Helia provider', async () => {
  const service = createIpfsService({
    mode: 'helia',
    heliaProvider: {
      async addBytes(bytes, options) {
        assert.equal(bytes.byteLength, 3);
        assert.equal(options.filename, 'clip.bin');
        assert.equal(options.mimeType, 'application/octet-stream');
        return { cid: CID };
      }
    }
  });
  const progress = [];
  const result = await service.addFile(new Blob(['abc'], { type: 'application/octet-stream' }), {
    filename: 'clip.bin',
    mimeType: 'application/octet-stream',
    onProgress: event => progress.push(event)
  });

  assert.equal(result.cid, CID);
  assert.equal(result.provider, 'helia');
  assert.equal(result.byteSize, 3);
  assert.equal(progress.at(0).phase, 'uploading');
  assert.equal(progress.at(-1).phase, 'uploaded');
});

test('adds files through a configured Helia module URL', async () => {
  const moduleUrl = `data:text/javascript,export function createBlendHeliaProvider(){return {addBytes(){return {cid:${JSON.stringify(CID)}}}}}`;
  const service = createIpfsService({
    mode: 'helia',
    heliaModuleUrl: moduleUrl
  });

  assert.deepEqual(getIpfsPublishProviders({ mode: 'helia', heliaModuleUrl: moduleUrl }), ['helia']);
  const result = await service.addFile(new Blob(['abc']));
  assert.equal(result.cid, CID);
  assert.equal(result.provider, 'helia');
});

test('worker Helia module load failures keep provider guidance', () => {
  const error = new Error('Helia module failed to load. Failed to fetch dynamically imported module');
  error.code = 'helia_module_load_failed';
  error.provider = 'helia';
  error.userMessage = 'Browser IPFS provider could not load.';
  error.userDetail = 'Blend could not load the configured Helia module or one of its dependencies.';
  error.userAction = 'Open Settings to use a reachable worker-safe Helia module URL, or choose Kubo and run a local node.';
  error.retryable = true;

  const formatted = formatIpfsErrorForUser(error, { mode: 'helia' });
  assert.equal(formatted.title, 'IPFS provider unavailable');
  assert.equal(formatted.message, 'Browser IPFS provider could not load.');
  assert.match(formatted.detail, /Helia module/);
  assert.doesNotMatch(formatted.action, /modern browser/i);
  assert.equal(formatted.provider, 'helia');
});

test('gateway mode retrieves but does not publish', async () => {
  const service = createIpfsService({
    mode: 'gateway',
    gateways: ['https://example.test/ipfs/']
  });

  await assert.rejects(
    () => service.addFile(new Blob(['abc'])),
    /Gateway mode can retrieve IPFS content but cannot publish/
  );
});

test('gateway fetch streams progress and enforces configured size limits', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), gatewayUrlForCid('https://example.test/ipfs/', CID));
    assert.equal(options.method, 'GET');
    return new Response(new Blob(['abcdef'], { type: 'video/mp4' }).stream(), {
      status: 200,
      headers: {
        'content-length': '6',
        'content-type': 'video/mp4'
      }
    });
  };

  const service = createIpfsService({
    mode: 'gateway',
    gateways: ['https://example.test/ipfs/']
  });
  const progress = [];
  const blob = await service.fetchCid(CID, {
    maxBytes: 10,
    onProgress: event => progress.push(event)
  });

  assert.equal(await blob.text(), 'abcdef');
  assert.equal(blob.type, 'video/mp4');
  assert.equal(progress.at(-1).loaded, 6);
  assert.equal(progress.at(-1).provider, 'gateway');

  await assert.rejects(
    () => service.fetchCid(CID, { maxBytes: 3 }),
    /exceeds configured size limit/
  );
});

test('auto retrieval uses gateway fallback without probing default Kubo', async (t) => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (url, options) => {
    urls.push(String(url));
    assert.equal(String(url), gatewayUrlForCid('https://example.test/ipfs/', CID));
    assert.equal(options.method, 'GET');
    return new Response('abc', { status: 200 });
  };

  const service = createIpfsService({
    mode: 'auto',
    gateways: ['https://example.test/ipfs/']
  });
  const blob = await service.fetchCid(CID, { maxBytes: 10 });

  assert.equal(await blob.text(), 'abc');
  assert.deepEqual(urls, [gatewayUrlForCid('https://example.test/ipfs/', CID)]);
});

test('Helia provider cat async iterables are accepted and bounded', async () => {
  const service = createIpfsService({
    mode: 'helia',
    heliaProvider: {
      async *cat(cid) {
        assert.equal(cid, CID);
        yield new Uint8Array([97, 98]);
        yield new Uint8Array([99]);
      }
    }
  });
  const progress = [];
  const blob = await service.fetchCid(CID, {
    maxBytes: 10,
    mimeType: 'video/mp4',
    onProgress: event => progress.push(event)
  });

  assert.equal(await blob.text(), 'abc');
  assert.equal(blob.type, 'video/mp4');
  assert.equal(progress.at(-1).loaded, 3);
  assert.equal(progress.at(-1).provider, 'helia');

  await assert.rejects(
    () => service.fetchCid(CID, { maxBytes: 2 }),
    /exceeds configured size limit/
  );
});

test('browser runtime delegates IPFS uploads through the worker client', async (t) => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalWorker = globalThis.Worker;
  t.after(async () => {
    await shutdownIpfsWorkerRuntime();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  });

  class FakeWorker {
    static messages = [];

    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, handler) {
      const list = this.listeners.get(type) || [];
      list.push(handler);
      this.listeners.set(type, list);
    }

    removeEventListener(type, handler) {
      const list = this.listeners.get(type) || [];
      this.listeners.set(type, list.filter(item => item !== handler));
    }

    emit(type, data) {
      for (const handler of this.listeners.get(type) || []) handler({ data });
    }

    postMessage(message) {
      FakeWorker.messages.push(message);
      queueMicrotask(() => {
        if (message.action === IPFS_WORKER_ACTION.INIT) {
          this.emit('message', createIpfsWorkerResponse(IPFS_WORKER_EVENT.READY, message, {
            payload: { phase: 'ready', provider: 'kubo' }
          }));
        } else if (message.action === IPFS_WORKER_ACTION.ADD_FILE) {
          this.emit('message', createIpfsWorkerResponse(IPFS_WORKER_EVENT.SUCCESS, message, {
            payload: {
              cid: CID,
              provider: 'kubo',
              byteSize: 3,
              mimeType: message.payload?.mimeType || ''
            }
          }));
        } else if (message.action === IPFS_WORKER_ACTION.SHUTDOWN) {
          this.emit('message', createIpfsWorkerResponse(IPFS_WORKER_EVENT.SUCCESS, message, {
            payload: { ok: true }
          }));
        }
      });
    }

    terminate() {}
  }

  globalThis.window = globalThis;
  globalThis.document = {};
  globalThis.Worker = FakeWorker;

  const service = createIpfsService({
    mode: 'kubo',
    kuboApiEndpoint: 'http://127.0.0.1:5001',
    gateways: ['https://example.test/ipfs/']
  });
  const result = await service.addFile(new Blob(['abc'], { type: 'video/mp4' }), {
    filename: 'clip.mp4',
    mimeType: 'video/mp4'
  });

  assert.equal(result.cid, CID);
  assert.equal(result.provider, 'kubo');
  assert.deepEqual(
    FakeWorker.messages.map(message => message.action),
    [IPFS_WORKER_ACTION.INIT, IPFS_WORKER_ACTION.ADD_FILE]
  );
});
