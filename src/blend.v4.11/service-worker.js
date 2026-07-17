const CACHE_VERSION = 'blend-player-v4.11-20260620-console-cleanup';
const MEDIA_EXTENSIONS = /\.(?:mp4|m4v|mov|mkv|webm|ogv|avi|mp3|m4a|wav|ogg|flac|aac)(?:$|\?)/i;
const APP_SHELL = [
  './',
  './index.html',
  './slideshow-playlist-player.html',
  './styles.css?v=20260619-v4.9-ipfs2',
  './app.js?v=20260620-v4.10-helia-local',
  './logger.js?v=20260619-v4.9-ipfs2',
  './drag-sort.js?v=20260619-v4.9-ipfs2',
  './ipfs-service.js?v=20260619-v4.9-ipfs2',
  './ipfs-manifest.js?v=20260619-v4.9-ipfs2',
  './ipfs-share-warning.js?v=20260619-v4.9-ipfs2',
  './ipfs-worker.js?v=20260619-v4.9-ipfs2',
  './ipfs-helia-provider.bundle.js?v=20260620-v4.10-helia-local',
  './ipfs-service.js',
  './ipfs-manifest.js',
  './ipfs-share-warning.js',
  './ipfs-worker-client.js',
  './ipfs-worker-protocol.js',
  './ipfs-worker.js',
  './ipfs-helia-provider.js',
  './ipfs-helia-provider.bundle.js',
  './service-worker.js',
  './sw.js',
  './manifest.json',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg'
];

async function cleanupOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)));
}

function isRangeRequest(request) {
  return request.headers.has('range');
}

function isMediaRequest(request, url) {
  return request.destination === 'audio' || request.destination === 'video' || MEDIA_EXTENSIONS.test(url.pathname);
}

function canCacheResponse(response) {
  return response && response.status === 200;
}

async function putRuntimeCache(cache, request, response) {
  if (!canCacheResponse(response)) return;
  try {
    await cache.put(request, response.clone());
  } catch (_) {}
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    cleanupOldCaches().then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isRangeRequest(request) || isMediaRequest(request, url)) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);

    if (request.mode === 'navigate') {
      try {
        const response = await fetch(request);
        event.waitUntil(putRuntimeCache(cache, request, response));
        return response;
      } catch (_) {
        return cached || await cache.match('./index.html') || await cache.match('./slideshow-playlist-player.html') || Response.error();
      }
    }

    if (cached) {
      event.waitUntil(fetch(request).then(response => {
        return putRuntimeCache(cache, request, response);
      }).catch(() => {}));
      return cached;
    }

    try {
      const response = await fetch(request);
      event.waitUntil(putRuntimeCache(cache, request, response));
      return response;
    } catch (_) {
      return cached || Response.error();
    }
  })());
});
