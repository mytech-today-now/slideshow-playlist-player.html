const CACHE_VERSION = 'blend-player-v4-20260611-mobilefix';
const APP_SHELL = [
  './',
  './index.html',
  './slideshow-playlist-player.html',
  './styles.css',
  './app.js',
  './logger.js',
  './drag-sort.js',
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

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);

    if (request.mode === 'navigate') {
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      } catch (_) {
        return cached || cache.match('./index.html') || cache.match('./slideshow-playlist-player.html');
      }
    }

    if (cached) {
      event.waitUntil(fetch(request).then(response => {
        if (response && response.ok) cache.put(request, response.clone());
      }).catch(() => {}));
      return cached;
    }

    try {
      const response = await fetch(request);
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    } catch (_) {
      return cached || Response.error();
    }
  })());
});
