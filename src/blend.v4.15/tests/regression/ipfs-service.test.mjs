import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_IPFS_CONFIG,
  createIpfsService,
  describeIpfsPublishReadiness,
  formatIpfsErrorForUser,
  normalizeIpfsConfig,
  parseGatewayList
} from '../../ipfs-service.js';
import { shutdownIpfsWorkerClient } from '../../ipfs-worker-client.js';

test('normalizes gateway URLs to explicit /ipfs/ paths', () => {
  const gateways = parseGatewayList('https://gateway.example, https://dweb.link/ipfs/');
  assert.deepEqual(gateways, [
    'https://gateway.example/ipfs/',
    'https://dweb.link/ipfs/'
  ]);
});

test('marks invalid kubo endpoint and falls back to default endpoint', () => {
  const config = normalizeIpfsConfig({
    mode: 'kubo',
    kuboApiEndpoint: 'not-a-valid-url'
  });

  assert.equal(config.kuboApiEndpointInvalid, true);
  assert.equal(config.kuboApiEndpoint, DEFAULT_IPFS_CONFIG.kuboApiEndpoint);
  const readiness = describeIpfsPublishReadiness(config);
  assert.equal(readiness.canPublish, false);
  assert.equal(readiness.state, 'needs_setup');
});

test('reports gateway mode as retrieval-only for publishing readiness', () => {
  const readiness = describeIpfsPublishReadiness({
    enabled: true,
    mode: 'gateway',
    gateways: ['https://ipfs.io/ipfs/']
  });

  assert.equal(readiness.canPublish, false);
  assert.equal(readiness.state, 'unavailable');
  assert.match(readiness.message, /cannot publish/i);
});

test('formats generic errors into user-facing IPFS guidance', () => {
  const out = formatIpfsErrorForUser(new Error('network timeout'));
  assert.equal(out.title, 'IPFS error');
  assert.equal(out.message, 'IPFS sharing failed.');
  assert.match(out.detail, /network timeout/i);
  assert.equal(out.retryable, true);
});

test('formats worker request timeout with retry guidance', () => {
  const error = new Error('IPFS worker request timed out');
  error.code = 'ipfs_worker_timeout';
  const out = formatIpfsErrorForUser(error);
  assert.equal(out.title, 'IPFS request timed out');
  assert.equal(out.message, 'IPFS request timed out.');
  assert.match(out.detail, /did not respond in time/i);
  assert.match(out.action, /Retry/i);
});

test('fetchCid uses the first successful gateway without waiting for slower failures', async () => {
  const service = createIpfsService({
    enabled: true,
    mode: 'gateway',
    gateways: ['https://slow.example/ipfs/', 'https://fast.example/ipfs/'],
    fetchTimeoutMs: 5000
  });
  const cid = 'bafkreigy6ylfk6qv6rg7c2jhoysknqy3l7jis4kyvyvqgbq376hqcpmut4';
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, signal: options.signal });
    if (String(url).includes('slow.example')) {
      await new Promise(resolve => setTimeout(resolve, 120));
      return new Response('slow-failure', { status: 504 });
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    return new Response('fast-success', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
  };

  const startedAt = Date.now();
  try {
    const blob = await service.fetchCid(cid);
    const elapsedMs = Date.now() - startedAt;
    assert.equal(await blob.text(), 'fast-success');
    assert.equal(calls.length, 2);
    assert.ok(elapsedMs < 250, `Expected fast gateway response, got ${elapsedMs}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchCid falls back to non-worker retrieval when worker request times out', async () => {
  const service = createIpfsService({
    enabled: true,
    mode: 'gateway',
    useWorker: true,
    gateways: ['https://fast.example/ipfs/'],
    fetchTimeoutMs: 3000
  });
  const cid = 'bafkreigy6ylfk6qv6rg7c2jhoysknqy3l7jis4kyvyvqgbq376hqcpmut4';
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalWorker = globalThis.Worker;
  const originalFetch = globalThis.fetch;

  class SilentWorker {
    constructor() {
      this.listeners = new Map();
    }
    addEventListener(type, handler) {
      const set = this.listeners.get(type) || new Set();
      set.add(handler);
      this.listeners.set(type, set);
    }
    removeEventListener(type, handler) {
      this.listeners.get(type)?.delete(handler);
    }
    emit(type, payload) {
      const listeners = Array.from(this.listeners.get(type) || []);
      for (const listener of listeners) listener(payload);
    }
    postMessage(message) {
      if (message?.action !== 'shutdown') return;
      queueMicrotask(() => {
        this.emit('message', {
          data: {
            channel: 'blend-ipfs-worker-v1',
            protocolVersion: 1,
            id: message.id,
            action: 'shutdown',
            event: 'success',
            payload: { ok: true }
          }
        });
      });
    }
    terminate() {}
  }

  globalThis.window = globalThis;
  globalThis.document = {};
  globalThis.Worker = SilentWorker;
  globalThis.fetch = async () => new Response('gateway-success', {
    status: 200,
    headers: { 'content-type': 'text/plain' }
  });

  try {
    const startedAt = Date.now();
    const blob = await service.fetchCid(cid, { timeoutMs: 1000 });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(await blob.text(), 'gateway-success');
    assert.ok(elapsedMs >= 900 && elapsedMs < 2500, `Expected worker timeout fallback around 1s, got ${elapsedMs}ms`);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Worker = originalWorker;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    await shutdownIpfsWorkerClient();
  }
});

test('fetchCid falls back to gateway when helia provider hangs', async () => {
  const service = createIpfsService({
    enabled: true,
    mode: 'auto',
    useWorker: false,
    gatewayFallback: true,
    gateways: ['https://fast.example/ipfs/'],
    fetchTimeoutMs: 200,
    heliaProvider: {
      fetchCid() {
        return new Promise(() => {});
      }
    }
  });
  const cid = 'bafkreigy6ylfk6qv6rg7c2jhoysknqy3l7jis4kyvyvqgbq376hqcpmut4';
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('gateway-success', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
  };

  const startedAt = Date.now();
  try {
    const blob = await service.fetchCid(cid, { timeoutMs: 200 });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(await blob.text(), 'gateway-success');
    assert.equal(calls.length, 1);
    assert.ok(elapsedMs >= 150 && elapsedMs < 2000, `Expected Helia timeout fallback around 200ms, got ${elapsedMs}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
