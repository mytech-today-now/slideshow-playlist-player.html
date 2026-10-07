import './pwa-config.js';
import {
  compactAliasSnapshot,
  emptyAliasManifest,
  readAliasSnapshot,
  replaceAliasManifest,
  seedAliasManifest,
  validateAliasManifestForStore
} from './alias-store.js';

const config = globalThis.BlendPwaConfig;

function getBaseUrl() {
  return globalThis.location?.href || 'https://blend.local/';
}

async function fetchJsonManifest(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-cache',
    credentials: 'same-origin',
    headers: options.etag ? { 'If-None-Match': options.etag } : undefined
  });
  if (response.status === 304) return null;
  if (!response.ok) throw new Error(`Alias manifest fetch failed (${response.status}).`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/json|manifest/i.test(contentType)) {
    throw new Error(`Alias manifest has unexpected content type: ${contentType}`);
  }
  return response.json();
}

function postToWorker(worker, message) {
  if (!worker?.postMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
    const timeout = setTimeout(() => resolve(null), 2500);
    if (channel) {
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(event.data || null);
      };
      worker.postMessage(message, [channel.port2]);
    } else {
      worker.postMessage(message);
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

export async function sendAliasSnapshotToWorker(registration, manifest, options = {}) {
  const snapshot = compactAliasSnapshot(manifest);
  const worker = options.worker ||
    registration?.active ||
    registration?.waiting ||
    registration?.installing ||
    globalThis.navigator?.serviceWorker?.controller;
  await postToWorker(worker, {
    type: 'REFRESH_ALIAS_SNAPSHOT',
    manifest: snapshot
  });
  return snapshot;
}

export async function syncAliasManifest(options = {}) {
  const manifestUrl = options.manifestUrl || config?.ALIAS_MANIFEST_URL || './alias-manifest.json';
  const log = options.log || console;
  const baseUrl = options.baseUrl || getBaseUrl();
  let manifest = null;

  try {
    const fetched = await fetchJsonManifest(manifestUrl, options);
    if (fetched) {
      manifest = await replaceAliasManifest(fetched, {
        baseUrl,
        allowDowngrade: options.allowDowngrade === true,
        allowedOrigins: options.allowedOrigins || []
      });
    }
  } catch (error) {
    log?.warn?.('alias manifest fetch/apply failed', error);
  }

  if (!manifest) {
    try {
      manifest = await readAliasSnapshot({
        baseUrl,
        allowedOrigins: options.allowedOrigins || []
      });
    } catch (error) {
      log?.warn?.('alias snapshot read failed', error);
      manifest = emptyAliasManifest();
    }
  }

  if (options.registration || globalThis.navigator?.serviceWorker?.controller) {
    await sendAliasSnapshotToWorker(options.registration, manifest, options).catch(error => {
      log?.warn?.('alias snapshot worker sync failed', error);
    });
  }

  return manifest;
}

export async function seedAliasesFromManifest(manifest, options = {}) {
  const normalized = validateAliasManifestForStore(manifest, {
    baseUrl: options.baseUrl || getBaseUrl(),
    allowDowngrade: options.allowDowngrade === true,
    allowedOrigins: options.allowedOrigins || []
  });
  return seedAliasManifest(normalized, options);
}
