import test from 'node:test';
import assert from 'node:assert/strict';

import { IpfsWorkerClient } from '../ipfs-worker-client.js';
import {
  IPFS_WORKER_ACTION,
  IPFS_WORKER_EVENT,
  createIpfsWorkerResponse
} from '../ipfs-worker-protocol.js';

const CID = 'QmWmyoMoctfbdiQcRVLda5D4gA7D6Drb5St9Qf7N9YJ5dA';

class FakeWorker {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
    this.autoRespond = true;
    FakeWorker.instances.push(this);
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
    this.messages.push(message);
    if (!this.autoRespond) return;
    queueMicrotask(() => this.respond(message));
  }

  respond(message) {
    if (message.action === IPFS_WORKER_ACTION.INIT) {
      this.emit('message', createIpfsWorkerResponse(IPFS_WORKER_EVENT.READY, message, {
        payload: { phase: 'ready', provider: message.config?.mode || 'auto' }
      }));
      return;
    }
    if (message.action === IPFS_WORKER_ACTION.ADD_FILE) {
      this.emit('message', createIpfsWorkerResponse(IPFS_WORKER_EVENT.PROGRESS, message, {
        payload: { phase: 'uploading', provider: 'helia', loaded: 1, total: 3 }
      }));
      this.emit('message', createIpfsWorkerResponse(IPFS_WORKER_EVENT.SUCCESS, message, {
        payload: {
          cid: CID,
          provider: 'helia',
          byteSize: 3,
          mimeType: message.payload?.mimeType || ''
        }
      }));
      return;
    }
    if (message.action === IPFS_WORKER_ACTION.SHUTDOWN || message.action === IPFS_WORKER_ACTION.CANCEL) {
      this.emit('message', createIpfsWorkerResponse(IPFS_WORKER_EVENT.SUCCESS, message, {
        payload: { ok: true }
      }));
    }
  }

  terminate() {
    this.terminated = true;
  }
}

test('lazy-starts one module worker and reuses initialization for matching config', async () => {
  FakeWorker.instances = [];
  const client = new IpfsWorkerClient({
    WorkerCtor: FakeWorker,
    workerUrl: 'worker.js',
    requestTimeoutMs: 1000
  });
  const progress = [];

  const first = await client.addFile(new Blob(['abc'], { type: 'video/mp4' }), {
    config: { mode: 'helia', heliaModuleUrl: './provider.js' },
    filename: 'clip.mp4',
    mimeType: 'video/mp4',
    onProgress: event => progress.push(event)
  });
  const second = await client.addFile(new Blob(['abc']), {
    config: { mode: 'helia', heliaModuleUrl: './provider.js' }
  });

  assert.equal(first.cid, CID);
  assert.equal(second.cid, CID);
  assert.equal(FakeWorker.instances.length, 1);
  assert.equal(FakeWorker.instances[0].options.type, 'module');
  assert.deepEqual(
    FakeWorker.instances[0].messages.map(message => message.action),
    [IPFS_WORKER_ACTION.INIT, IPFS_WORKER_ACTION.ADD_FILE, IPFS_WORKER_ACTION.ADD_FILE]
  );
  assert.equal(progress.some(event => event.phase === 'uploading'), true);

  await client.shutdown();
  assert.equal(FakeWorker.instances[0].terminated, true);
});

test('sends cancellation to the worker when an upload aborts', async () => {
  FakeWorker.instances = [];
  const client = new IpfsWorkerClient({
    WorkerCtor: FakeWorker,
    workerUrl: 'worker.js',
    requestTimeoutMs: 1000
  });
  const worker = client.ensureWorker();
  worker.autoRespond = false;
  const controller = new AbortController();

  const promise = client.addFile(new Blob(['abc']), {
    config: { mode: 'kubo', kuboConfigured: true },
    signal: controller.signal
  });
  controller.abort();

  await assert.rejects(promise, error => {
    assert.equal(error.name, 'AbortError');
    return true;
  });
  assert.equal(worker.messages.some(message => message.action === IPFS_WORKER_ACTION.CANCEL), true);
  client.terminate();
});
