/* global BlendPwaConfig, BlendAliasRouter */
importScripts('./pwa-config.js', './alias-router.js');

const config = BlendPwaConfig;
const aliasRouter = BlendAliasRouter;

const {
  APP_VERSION,
  CACHE_VERSION,
  CACHE_NAMES,
  PRECACHE_REQUIRED,
  PRECACHE_OPTIONAL,
  ROUTE_POLICIES,
  ALIAS_MANIFEST_URL,
  OFFLINE_URL
} = config;

const MEDIA_EXTENSIONS = /\.(?:mp4|m4v|mov|mkv|webm|ogv|avi|mp3|m4a|wav|ogg|flac|aac)(?:$|\?)/i;
const STATIC_EXTENSIONS = /\.(?:js|css|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf)(?:$|\?)/i;
const DOC_EXTENSIONS = /\.(?:md|txt)(?:$|\?)/i;
const JSON_EXTENSIONS = /\.(?:json|webmanifest)(?:$|\?)/i;
const CURRENT_CACHE_NAMES = new Set(Object.values(CACHE_NAMES));

let aliasSnapshot = {
  schema: aliasRouter.DEFAULT_SCHEMA,
  version: 0,
  generatedAt: new Date(0).toISOString(),
  aliases: []
};

function log(...args) {
  // Keep production noise low; uncomment during local worker debugging.
  // console.debug('[Blend SW]', ...args);
  void args;
}

function isSupportedProtocol(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function isRangeRequest(request) {
  return request.headers.has('range');
}

function isMediaRequest(request, url) {
  return request.destination === 'audio' ||
    request.destination === 'video' ||
    MEDIA_EXTENSIONS.test(url.pathname);
}

function shouldBypassWorker(request, url) {
  const path = url.pathname.toLowerCase();
  if (request.cache === 'no-store') return true;
  if (path.endsWith('/readme.md')) return true;
  return false;
}

function cacheNameForPolicy(policy) {
  return policy?.cacheName ? CACHE_NAMES[policy.cacheName] : null;
}

function canCacheResponse(request, response, policy = {}) {
  if (!response || response.status !== 200) return false;
  if (response.type === 'opaque' && !policy.allowOpaque) return false;
  if (request.headers.has('authorization')) return false;
  const cacheControl = response.headers.get('cache-control') || '';
  if (/\bno-store\b/i.test(cacheControl)) return false;
  return true;
}

async function trimCache(cacheName, policy = {}) {
  if (!cacheName) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const maxEntries = Number(policy.maxEntries || 0);
  if (maxEntries > 0 && keys.length > maxEntries) {
    const deleteCount = keys.length - maxEntries;
    await Promise.all(keys.slice(0, deleteCount).map(key => cache.delete(key)));
  }

  const maxAgeSeconds = Number(policy.maxAgeSeconds || 0);
  if (maxAgeSeconds > 0) {
    const cutoff = Date.now() - (maxAgeSeconds * 1000);
    await Promise.all(keys.map(async (key) => {
      const response = await cache.match(key);
      const responseDate = Date.parse(response?.headers?.get('date') || '');
      if (Number.isFinite(responseDate) && responseDate < cutoff) {
        await cache.delete(key);
      }
    }));
  }
}

async function trimRuntimeCaches() {
  await Promise.all([
    trimCache(CACHE_NAMES.static, ROUTE_POLICIES.static),
    trimCache(CACHE_NAMES.docs, ROUTE_POLICIES.docs),
    trimCache(CACHE_NAMES.api, ROUTE_POLICIES.api),
    trimCache(CACHE_NAMES.aliases, ROUTE_POLICIES.aliasManifest)
  ]);
}

async function putCache(cacheName, request, response, policy = {}) {
  if (!cacheName || !canCacheResponse(request, response, policy)) return false;
  const cache = await caches.open(cacheName);
  try {
    await cache.put(request, response.clone());
    await trimCache(cacheName, policy);
    return true;
  } catch (error) {
    log('cache put failed; trimming runtime caches and retrying', error);
    await trimRuntimeCaches().catch(() => {});
    try {
      await cache.put(request, response.clone());
      await trimCache(cacheName, policy);
      return true;
    } catch (_) {
      return false;
    }
  }
}

async function cacheAsset(cacheName, asset, required) {
  const cache = await caches.open(cacheName);
  try {
    await cache.add(new Request(asset, { cache: 'reload', credentials: 'same-origin' }));
    return true;
  } catch (error) {
    if (required) throw error;
    log('optional precache failed', asset, error);
    return false;
  }
}

async function precacheShell() {
  const requiredResults = await Promise.allSettled(
    PRECACHE_REQUIRED.map(asset => cacheAsset(CACHE_NAMES.shell, asset, true))
  );
  const failedRequired = requiredResults.filter(result => result.status === 'rejected');
  if (failedRequired.length) {
    throw failedRequired[0].reason;
  }

  await Promise.allSettled([
    ...PRECACHE_OPTIONAL.map(asset => cacheAsset(CACHE_NAMES.docs, asset, false)),
    cacheAsset(CACHE_NAMES.aliases, ALIAS_MANIFEST_URL, false)
  ]);
}

async function cleanupOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => {
    if (!config.isBlendCacheName(key) || CURRENT_CACHE_NAMES.has(key)) return false;
    return caches.delete(key);
  }));
}

function classifyRequest(request, url) {
  const path = url.pathname.toLowerCase();
  if (request.mode === 'navigate') return ROUTE_POLICIES.navigation;
  if (path.endsWith('/alias-manifest.json')) return ROUTE_POLICIES.aliasManifest;
  if (DOC_EXTENSIONS.test(path) || path.endsWith('/readme.md')) return ROUTE_POLICIES.docs;
  if (request.destination === 'manifest' || path.endsWith('/manifest.webmanifest')) return ROUTE_POLICIES.static;
  if (request.destination === 'style' || request.destination === 'script' || request.destination === 'worker') return ROUTE_POLICIES.static;
  if (request.destination === 'image' || request.destination === 'font' || STATIC_EXTENSIONS.test(path)) return ROUTE_POLICIES.immutable;
  if (JSON_EXTENSIONS.test(path)) return ROUTE_POLICIES.docs;
  return ROUTE_POLICIES.api;
}

function makeRequestForUrl(originalRequest, url) {
  if (url.href === originalRequest.url) return originalRequest;
  return new Request(url.href, {
    method: 'GET',
    headers: originalRequest.headers,
    credentials: 'same-origin',
    redirect: 'follow'
  });
}

function shouldResolveAliases(request) {
  return request.mode === 'navigate' ||
    request.destination === 'document' ||
    request.destination === '' ||
    request.destination === 'manifest';
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage(message);
}

function resolveAliasRequest(request, url) {
  if (!shouldResolveAliases(request) || !aliasSnapshot.aliases.length) return { request, url, aliases: [] };
  const result = aliasRouter.resolveAlias(url.href, aliasSnapshot.aliases, {
    baseUrl: self.registration.scope
  });
  if (!result.matched || result.error || !result.url) return { request, url, aliases: [] };
  const resolvedRequest = makeRequestForUrl(request, result.url);
  return {
    request: resolvedRequest,
    url: result.url,
    aliases: result.aliases || []
  };
}

async function cacheFirst(event, request, cacheName, policy) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  event.waitUntil(putCache(cacheName, request, response, policy));
  return response;
}

async function staleWhileRevalidate(event, request, cacheName, policy) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchAndCache = fetch(request).then((response) => {
    event.waitUntil(putCache(cacheName, request, response, policy));
    return response;
  });
  if (cached) {
    event.waitUntil(fetchAndCache.catch(() => null));
    return cached;
  }
  return fetchAndCache;
}

async function networkFirst(event, request, cacheName, policy, options = {}) {
  const isNavigation = options.isNavigation || request.mode === 'navigate';
  const cache = cacheName ? await caches.open(cacheName) : null;
  try {
    const preload = isNavigation && !options.skipPreload ? await event.preloadResponse : null;
    const response = preload || await fetch(request);
    if (cacheName) event.waitUntil(putCache(cacheName, request, response, policy));
    return response;
  } catch (_) {
    const cached = cache ? await cache.match(request) : null;
    if (cached) return cached;
    if (isNavigation) {
      const shell = await caches.match(policy.fallback || './index.html');
      if (shell) {
        event.waitUntil(broadcast({
          type: 'OFFLINE_FALLBACK_USED',
          appVersion: APP_VERSION,
          cacheVersion: CACHE_VERSION
        }));
        return shell;
      }
      const offline = await caches.match(policy.offlineFallback || OFFLINE_URL);
      if (offline) return offline;
    }
    throw _;
  }
}

async function respondByPolicy(event, request, url, policy, options = {}) {
  const cacheName = cacheNameForPolicy(policy);
  if (policy.strategy === 'networkOnly') return fetch(request);
  if (policy.strategy === 'cacheFirst') return cacheFirst(event, request, cacheName, policy);
  if (policy.strategy === 'staleWhileRevalidate') return staleWhileRevalidate(event, request, cacheName, policy);
  return networkFirst(event, request, cacheName, policy, options);
}

async function loadAliasSnapshotFromCache() {
  try {
    const response = await caches.match(ALIAS_MANIFEST_URL);
    if (!response) return;
    const manifest = await response.clone().json();
    aliasSnapshot = aliasRouter.normalizeAliasManifest(manifest, {
      baseUrl: self.registration.scope
    });
  } catch (error) {
    log('alias snapshot cache load failed', error);
  }
}

async function storeAliasSnapshot(manifest) {
  const normalized = aliasRouter.normalizeAliasManifest(manifest, {
    baseUrl: self.registration.scope
  });
  aliasSnapshot = normalized;
  const cache = await caches.open(CACHE_NAMES.aliases);
  await cache.put(ALIAS_MANIFEST_URL, new Response(JSON.stringify(normalized), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache'
    }
  }));
  return normalized;
}

async function cacheStatusPayload() {
  const keys = await caches.keys();
  const cachesStatus = {};
  await Promise.all(keys.filter(key => config.isBlendCacheName(key)).map(async (key) => {
    const cache = await caches.open(key);
    cachesStatus[key] = (await cache.keys()).length;
  }));
  return {
    type: 'CACHE_STATUS',
    appVersion: APP_VERSION,
    cacheVersion: CACHE_VERSION,
    aliasVersion: aliasSnapshot.version || 0,
    caches: cachesStatus
  };
}

function replyToMessage(event, payload) {
  if (event.ports && event.ports[0]) {
    event.ports[0].postMessage(payload);
    return;
  }
  event.source?.postMessage?.(payload);
}

self.addEventListener('install', event => {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await cleanupOldCaches();
    await loadAliasSnapshotFromCache();
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable().catch(() => {});
    }
    await self.clients.claim();
    await broadcast({
      type: 'PWA_ACTIVATED',
      appVersion: APP_VERSION,
      cacheVersion: CACHE_VERSION,
      aliasVersion: aliasSnapshot.version || 0
    });
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  event.waitUntil((async () => {
    if (data.type === 'SKIP_WAITING') {
      replyToMessage(event, { type: 'SKIP_WAITING', ok: true });
      await self.skipWaiting();
      return;
    }

    if (data.type === 'GET_VERSION') {
      replyToMessage(event, {
        type: 'GET_VERSION',
        appVersion: APP_VERSION,
        cacheVersion: CACHE_VERSION,
        aliasVersion: aliasSnapshot.version || 0
      });
      return;
    }

    if (data.type === 'REFRESH_ALIAS_SNAPSHOT') {
      try {
        const normalized = await storeAliasSnapshot(data.manifest || data.snapshot);
        replyToMessage(event, {
          type: 'REFRESH_ALIAS_SNAPSHOT',
          ok: true,
          aliasVersion: normalized.version
        });
      } catch (error) {
        replyToMessage(event, {
          type: 'REFRESH_ALIAS_SNAPSHOT',
          ok: false,
          error: error?.code || error?.message || String(error)
        });
      }
      return;
    }

    if (data.type === 'CLEAR_RUNTIME_CACHES') {
      await Promise.all([
        caches.delete(CACHE_NAMES.static),
        caches.delete(CACHE_NAMES.docs),
        caches.delete(CACHE_NAMES.api),
        caches.delete(CACHE_NAMES.aliases)
      ]);
      replyToMessage(event, { type: 'CLEAR_RUNTIME_CACHES', ok: true });
      return;
    }

    if (data.type === 'WARM_URLS') {
      const urls = Array.isArray(data.urls) ? data.urls.slice(0, 32) : [];
      await Promise.allSettled(urls.map(async (value) => {
        const url = new URL(String(value), self.registration.scope);
        if (url.origin !== self.location.origin) return;
        const request = new Request(url.href, { credentials: 'same-origin' });
        const policy = classifyRequest(request, url);
        const response = await fetch(request);
        await putCache(cacheNameForPolicy(policy), request, response, policy);
      }));
      replyToMessage(event, { type: 'WARM_URLS', ok: true });
      return;
    }

    if (data.type === 'CACHE_STATUS') {
      replyToMessage(event, await cacheStatusPayload());
    }
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isSupportedProtocol(url)) return;
  if (url.origin !== self.location.origin) return;

  if (shouldBypassWorker(request, url)) return;

  if (isRangeRequest(request) || isMediaRequest(request, url)) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith((async () => {
    const resolved = resolveAliasRequest(request, url);
    if (resolved.aliases.length) {
      event.waitUntil(broadcast({
        type: 'ALIAS_HIT',
        from: url.pathname,
        to: resolved.url.pathname,
        aliasIds: resolved.aliases.map(alias => alias.id),
        appVersion: APP_VERSION,
        cacheVersion: CACHE_VERSION
      }));
    }
    const isNavigation = request.mode === 'navigate';
    const policy = isNavigation ? ROUTE_POLICIES.navigation : classifyRequest(resolved.request, resolved.url);
    return respondByPolicy(event, resolved.request, resolved.url, policy, {
      isNavigation,
      skipPreload: resolved.aliases.length > 0
    });
  })());
});
