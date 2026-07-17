import './pwa-config.js';
import { syncAliasManifest } from './alias-sync.js';

const config = globalThis.BlendPwaConfig;

let currentRegistration = null;
let reloadForAppliedUpdate = false;
let lastStatus = {
  supported: false,
  registered: false,
  updateAvailable: false,
  appVersion: config?.APP_VERSION || 'unknown',
  cacheVersion: config?.CACHE_VERSION || 'unknown',
  aliasVersion: 0
};

function $(selector) {
  return document.querySelector(selector);
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

function setPwaStatus(message, options = {}) {
  const panel = $('#pwa-status');
  const text = $('#pwa-status-text');
  const apply = $('#pwa-update-apply');
  const dismiss = $('#pwa-status-dismiss');
  if (!panel || !text) return;
  text.textContent = message || '';
  panel.classList.toggle('hidden', !message);
  panel.dataset.state = options.state || '';
  if (apply) {
    apply.hidden = options.action !== 'update';
    apply.onclick = options.action === 'update' ? () => applyUpdate() : null;
  }
  if (dismiss) {
    dismiss.onclick = () => panel.classList.add('hidden');
  }
}

function notifyUpdateAvailable(showToast) {
  lastStatus = { ...lastStatus, updateAvailable: true };
  setPwaStatus('A Blend update is ready.', { state: 'update', action: 'update' });
  showToast?.('A Blend update is ready.', {
    timeout: 8000,
    action: {
      label: 'Update',
      run: () => applyUpdate()
    }
  });
}

function watchRegistration(registration, options = {}) {
  const showToast = options.showToast;
  if (!registration) return;

  if (registration.waiting && navigator.serviceWorker.controller) {
    notifyUpdateAvailable(showToast);
  }

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        notifyUpdateAvailable(showToast);
      }
    });
  });
}

function setupInstallBanner(options = {}) {
  const showToast = options.showToast;
  const installBannerKey = options.installBannerKey || 'blend-install-banner-hidden-v4';
  const banner = $('#install-banner');
  const help = $('#install-help');
  const primary = $('#install-primary');
  const dismiss = $('#install-dismiss');
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  let deferredInstallPrompt = null;
  let bannerHidden = localStorage.getItem(installBannerKey);

  if (isIos && primary) primary.textContent = 'How to install';

  const showBanner = () => {
    if (!banner || bannerHidden) return;
    banner.classList.remove('hidden');
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    banner?.classList.add('hidden');
    showToast?.('Blend installed');
  });

  primary?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try {
        await deferredInstallPrompt.userChoice;
      } catch (_) {}
      deferredInstallPrompt = null;
      banner?.classList.add('hidden');
      return;
    }
    showToast?.(isIos
      ? 'On iPhone or iPad, use Share > Add to Home Screen.'
      : 'Use the browser menu to install this app on supported devices.', { timeout: 6000 });
  });

  help?.addEventListener('click', () => {
    showToast?.(isIos
      ? 'On iPhone or iPad, tap Share and choose Add to Home Screen.'
      : 'On desktop or Android, use the browser install action or menu.', { timeout: 6000 });
  });

  dismiss?.addEventListener('click', () => {
    banner?.classList.add('hidden');
    bannerHidden = '1';
    localStorage.setItem(installBannerKey, '1');
  });

  if (isIos && !bannerHidden) showBanner();
}

function setupThemeListener(options = {}) {
  const applyThemeMode = options.applyThemeMode;
  const getThemeMode = options.getThemeMode || (() => 'auto');
  if (typeof applyThemeMode !== 'function' || typeof matchMedia !== 'function') return;
  const themeQuery = matchMedia('(prefers-color-scheme: light)');
  const onThemeChange = () => {
    if ((getThemeMode() || 'auto') === 'auto') applyThemeMode('auto');
  };
  if (typeof themeQuery.addEventListener === 'function') themeQuery.addEventListener('change', onThemeChange);
  else if (typeof themeQuery.addListener === 'function') themeQuery.addListener(onThemeChange);
}

function handleWorkerMessage(event, options = {}) {
  const data = event.data || {};
  const log = options.log || console;
  if (data.type === 'PWA_ACTIVATED') {
    lastStatus = {
      ...lastStatus,
      registered: true,
      appVersion: data.appVersion || lastStatus.appVersion,
      cacheVersion: data.cacheVersion || lastStatus.cacheVersion,
      aliasVersion: Number(data.aliasVersion || lastStatus.aliasVersion || 0),
      updateAvailable: false
    };
    setPwaStatus('');
    log?.info?.('service worker activated', data);
  } else if (data.type === 'OFFLINE_FALLBACK_USED') {
    setPwaStatus('Offline shell loaded from cache.', { state: 'offline' });
  } else if (data.type === 'CACHE_STATUS') {
    lastStatus = {
      ...lastStatus,
      cacheVersion: data.cacheVersion || lastStatus.cacheVersion,
      aliasVersion: Number(data.aliasVersion || lastStatus.aliasVersion || 0),
      caches: data.caches || lastStatus.caches
    };
  } else if (data.type === 'ALIAS_HIT') {
    log?.info?.('alias route resolved', data);
  }
}

export async function registerPwa(options = {}) {
  setupThemeListener(options);
  setupInstallBanner(options);

  const log = options.log || console;
  if (location.protocol === 'file:' || !('serviceWorker' in navigator)) {
    lastStatus = { ...lastStatus, supported: false, registered: false };
    return lastStatus;
  }

  lastStatus = { ...lastStatus, supported: true };
  navigator.serviceWorker.addEventListener('message', event => handleWorkerMessage(event, options));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadForAppliedUpdate) window.location.reload();
  });

  try {
    currentRegistration = await navigator.serviceWorker.register(
      options.serviceWorkerUrl || config?.SERVICE_WORKER_URL || './service-worker.js'
    );
    lastStatus = { ...lastStatus, registered: true };
    watchRegistration(currentRegistration, options);

    const ready = await navigator.serviceWorker.ready;
    currentRegistration = ready || currentRegistration;
    await syncAliasManifest({
      log,
      registration: currentRegistration,
      manifestUrl: options.aliasManifestUrl || config?.ALIAS_MANIFEST_URL || './alias-manifest.json'
    });
    await requestCacheStatus();
  } catch (error) {
    log?.warn?.('service worker registration failed', error);
    lastStatus = { ...lastStatus, registered: false, error: error?.message || String(error) };
  }

  return lastStatus;
}

export async function applyUpdate() {
  const waiting = currentRegistration?.waiting;
  if (!waiting) return false;
  reloadForAppliedUpdate = true;
  await postToWorker(waiting, { type: 'SKIP_WAITING' });
  return true;
}

export async function requestCacheStatus() {
  const worker = currentRegistration?.active || navigator.serviceWorker?.controller;
  const response = await postToWorker(worker, { type: 'CACHE_STATUS' });
  if (response?.type === 'CACHE_STATUS') {
    lastStatus = {
      ...lastStatus,
      caches: response.caches,
      aliasVersion: Number(response.aliasVersion || 0),
      cacheVersion: response.cacheVersion || lastStatus.cacheVersion
    };
  }
  return lastStatus;
}

export async function clearRuntimeCaches() {
  const worker = currentRegistration?.active || navigator.serviceWorker?.controller;
  const response = await postToWorker(worker, { type: 'CLEAR_RUNTIME_CACHES' });
  return response?.ok === true;
}

export async function refreshCaches(urls = []) {
  const worker = currentRegistration?.active || navigator.serviceWorker?.controller;
  const response = await postToWorker(worker, { type: 'WARM_URLS', urls });
  return response?.ok === true;
}

export function getPwaStatus() {
  return { ...lastStatus };
}
