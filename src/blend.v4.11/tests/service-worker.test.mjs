import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

async function loadServiceWorker() {
  const listeners = new Map();
  const cache = {
    puts: [],
    async match() {
      return undefined;
    },
    async put(request, response) {
      this.puts.push({ request, response });
      if (response.status === 206) {
        throw new Error('Partial responses must not be cached');
      }
    }
  };
  const caches = {
    async keys() {
      return [];
    },
    async delete() {
      return true;
    },
    async open() {
      return cache;
    }
  };
  const self = {
    location: { origin: 'https://mytech.today' },
    clients: { claim() {} },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    skipWaiting() {}
  };
  const context = vm.createContext({
    caches,
    fetch: async () => new Response('ok'),
    Promise,
    Response,
    self,
    URL
  });
  const code = await readFile(resolve('service-worker.js'), 'utf8');
  vm.runInContext(code, context, { filename: 'service-worker.js' });

  return {
    cache,
    listeners,
    setFetch(fn) {
      context.fetch = fn;
    }
  };
}

function createFetchEvent(request) {
  const waitUntilPromises = [];
  let responsePromise;
  return {
    request,
    waitUntilPromises,
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    },
    waitUntil(promise) {
      waitUntilPromises.push(Promise.resolve(promise));
    },
    get responsePromise() {
      return responsePromise;
    }
  };
}

test('range media requests bypass runtime cache', async () => {
  const worker = await loadServiceWorker();
  const request = new Request('https://mytech.today/tools/media/videos/clip.mp4', {
    headers: { range: 'bytes=0-' }
  });
  worker.setFetch(async () => new Response('partial', { status: 206 }));

  const event = createFetchEvent(request);
  worker.listeners.get('fetch')(event);
  const response = await event.responsePromise;
  await Promise.all(event.waitUntilPromises);

  assert.equal(response.status, 206);
  assert.equal(worker.cache.puts.length, 0);
});

test('non-200 runtime responses are not cached', async () => {
  const worker = await loadServiceWorker();
  const request = new Request('https://mytech.today/data/chunk.bin');
  worker.setFetch(async () => new Response('partial', { status: 206 }));

  const event = createFetchEvent(request);
  worker.listeners.get('fetch')(event);
  const response = await event.responsePromise;
  await Promise.all(event.waitUntilPromises);

  assert.equal(response.status, 206);
  assert.equal(worker.cache.puts.length, 0);
});

test('200 runtime responses are cached', async () => {
  const worker = await loadServiceWorker();
  const request = new Request('https://mytech.today/data/config.json');
  worker.setFetch(async () => new Response('{}', { status: 200 }));

  const event = createFetchEvent(request);
  worker.listeners.get('fetch')(event);
  const response = await event.responsePromise;
  await Promise.all(event.waitUntilPromises);

  assert.equal(response.status, 200);
  assert.equal(worker.cache.puts.length, 1);
});
