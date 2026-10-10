(function attachBlendPwaConfig(root) {
  'use strict';

  const APP_VERSION = '5.0.11';
  const ASSET_VERSION = '20261010-v5.0.11-indexeddb-manifest-paths';
  const CACHE_VERSION = '20261010-v5.0.11-indexeddb-manifest-paths';
  const DB_NAME = 'player-blend-v1';
  const DB_VERSION = 5;
  const ALIAS_SCHEMA = 'blend.aliases.v1';
  const ALIAS_STORE = 'aliases';
  const ALIAS_META_STORE = 'aliasMeta';

  const CACHE_NAMES = Object.freeze({
    shell: `blend-shell-${CACHE_VERSION}`,
    static: `blend-static-${CACHE_VERSION}`,
    docs: `blend-docs-${CACHE_VERSION}`,
    api: `blend-api-${CACHE_VERSION}`,
    aliases: `blend-alias-${CACHE_VERSION}`
  });

  const CACHE_PREFIXES = Object.freeze([
    'blend-shell-',
    'blend-static-',
    'blend-docs-',
    'blend-api-',
    'blend-alias-',
    'blend-player'
  ]);

  const asset = (path) => `${path}?v=${ASSET_VERSION}`;

  const PRECACHE_REQUIRED = Object.freeze([
    './',
    './index.html',
    './slideshow-playlist-player.html',
    asset('./styles.css'),
    asset('./app.js'),
    asset('./indexeddb-open.js'),
    './resume-on-load.js?v=20260927-v5.0.11-resume',
    asset('./experience-persistence.js'),
    asset('./local-import-limits.js'),
    asset('./save-state.js'),
    asset('./logger.js'),
    asset('./drag-sort.js'),
    asset('./list-reorder.js'),
    asset('./media-relink.js'),
    asset('./supabase-config.js'),
    asset('./supabase-auth.js'),
    asset('./storage-url-resolver.js'),
    asset('./transition-manager.js'),
    asset('./playback-clock.js'),
    './playback-mode.js',
    asset('./markdown.js'),
    asset('./readme-fetcher.js'),
    asset('./url-share.js'),
    asset('./url-share-diagnostics.js'),
    asset('./timeline-analysis.js'),
    asset('./analytics-consent.js'),
    asset('./analytics-event-params.js'),
    asset('./experience-load-progress.js'),
    asset('./shared-experience-download.js'),
    './pwa-config.js',
    './pwa-client.js',
    './alias-router.js',
    './alias-store.js',
    './alias-sync.js',
    './offline.html',
    './alias-manifest.json',
    asset('./manifest.webmanifest'),
    asset('./icon.svg'),
    asset('./icon-maskable.svg')
  ]);

  const PRECACHE_OPTIONAL = Object.freeze([
    './README.md',
    './manifest.json',
    './about-hero-dark-full.png'
  ]);

  const ROUTE_POLICIES = Object.freeze({
    navigation: Object.freeze({
      cacheName: 'shell',
      strategy: 'networkFirst',
      fallback: './index.html',
      offlineFallback: './offline.html',
      maxEntries: 12,
      maxAgeSeconds: 7 * 24 * 60 * 60
    }),
    static: Object.freeze({
      cacheName: 'static',
      strategy: 'staleWhileRevalidate',
      maxEntries: 96,
      maxAgeSeconds: 30 * 24 * 60 * 60
    }),
    immutable: Object.freeze({
      cacheName: 'static',
      strategy: 'cacheFirst',
      maxEntries: 64,
      maxAgeSeconds: 180 * 24 * 60 * 60
    }),
    docs: Object.freeze({
      cacheName: 'docs',
      strategy: 'staleWhileRevalidate',
      maxEntries: 24,
      maxAgeSeconds: 7 * 24 * 60 * 60
    }),
    aliasManifest: Object.freeze({
      cacheName: 'aliases',
      strategy: 'networkFirst',
      maxEntries: 8,
      maxAgeSeconds: 7 * 24 * 60 * 60
    }),
    api: Object.freeze({
      cacheName: 'api',
      strategy: 'networkFirst',
      maxEntries: 32,
      maxAgeSeconds: 6 * 60 * 60
    }),
    networkOnly: Object.freeze({
      cacheName: null,
      strategy: 'networkOnly'
    })
  });

  const config = Object.freeze({
    APP_VERSION,
    ASSET_VERSION,
    CACHE_VERSION,
    DB_NAME,
    DB_VERSION,
    ALIAS_SCHEMA,
    ALIAS_STORE,
    ALIAS_META_STORE,
    CACHE_NAMES,
    CACHE_PREFIXES,
    PRECACHE_REQUIRED,
    PRECACHE_OPTIONAL,
    ROUTE_POLICIES,
    SERVICE_WORKER_URL: './service-worker.js',
    MANIFEST_URL: asset('./manifest.webmanifest'),
    ALIAS_MANIFEST_URL: './alias-manifest.json',
    OFFLINE_URL: './offline.html',
    asset,
    isBlendCacheName(name) {
      return CACHE_PREFIXES.some(prefix => String(name || '').startsWith(prefix));
    }
  });

  root.BlendPwaConfig = config;
})(typeof globalThis !== 'undefined' ? globalThis : self);
