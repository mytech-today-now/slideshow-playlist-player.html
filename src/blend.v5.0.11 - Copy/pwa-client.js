import './pwa-config.js';
import { syncAliasManifest } from './alias-sync.js';

const config = globalThis.BlendPwaConfig;

let blendRegistration = null;
let blendRegistrationIdentity = null;
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

function resolveRegistrationIdentity(serviceWorkerUrl, baseUrl = document.baseURI) {
  const scriptUrl = new URL(serviceWorkerUrl, baseUrl).href;
  return {
    scriptUrl,
    scope: new URL('./', scriptUrl).href
  };
}

function registrationWorkerScriptUrls(registration) {
  return [registration?.active, registration?.waiting, registration?.installing]
    .map(worker => worker?.scriptURL)
    .filter(Boolean);
}

function isBlendRegistration(registration, identity) {
  if (!registration || !identity || registration.scope !== identity.scope) return false;
  return registrationWorkerScriptUrls(registration).includes(identity.scriptUrl);
}

function getBlendRegistration() {
  return isBlendRegistration(blendRegistration, blendRegistrationIdentity)
    ? blendRegistration
    : null;
}

function getBlendActiveWorker() {
  const registration = getBlendRegistration();
  const identity = blendRegistrationIdentity;
  if (!registration || !identity) return null;
  if (registration.active?.scriptURL === identity.scriptUrl) {
    return registration.active;
  }
  const controller = navigator.serviceWorker?.controller;
  return controller?.scriptURL === identity.scriptUrl ? controller : null;
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
  if (location.protocol === 'file:' || !navigator.serviceWorker || typeof navigator.serviceWorker.register !== 'function') {
    lastStatus = { ...lastStatus, supported: false, registered: false };
    setPwaStatus(
      location.protocol === 'file:'
        ? 'Offline shell caching requires Blend to be served over HTTP or HTTPS.'
        : 'Offline shell caching is unavailable in this browser.',
      { state: 'unavailable' }
    );
    return lastStatus;
  }

  lastStatus = { ...lastStatus, supported: true };
  navigator.serviceWorker.addEventListener('message', event => handleWorkerMessage(event, options));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadForAppliedUpdate) window.location.reload();
  });

  try {
    const serviceWorkerUrl = options.serviceWorkerUrl || config?.SERVICE_WORKER_URL || './service-worker.js';
    blendRegistrationIdentity = resolveRegistrationIdentity(serviceWorkerUrl);
    blendRegistration = await navigator.serviceWorker.register(serviceWorkerUrl);
    lastStatus = { ...lastStatus, registered: true };
    watchRegistration(blendRegistration, options);

    const ready = await navigator.serviceWorker.ready;
    if (isBlendRegistration(ready, blendRegistrationIdentity)) {
      blendRegistration = ready;
    }
    await syncAliasManifest({
      log,
      registration: blendRegistration,
      manifestUrl: options.aliasManifestUrl || config?.ALIAS_MANIFEST_URL || './alias-manifest.json'
    });
    await requestCacheStatus();
  } catch (error) {
    log?.warn?.('service worker registration failed', error);
    lastStatus = { ...lastStatus, registered: false, error: error?.message || String(error) };
    setPwaStatus('Offline shell caching could not be enabled. Core playback remains available online.', {
      state: 'unavailable'
    });
  }

  return lastStatus;
}

export async function unregisterBlendServiceWorker() {
  const container = globalThis.navigator?.serviceWorker;
  if (!container) return { ok: true, status: 'unsupported', scope: null };

  try {
    const identity = blendRegistrationIdentity || resolveRegistrationIdentity(
      config?.SERVICE_WORKER_URL || './service-worker.js'
    );
    let registration = blendRegistration;

    if (!isBlendRegistration(registration, identity)) {
      registration = typeof container.getRegistration === 'function'
        ? await container.getRegistration(identity.scope)
        : null;
    }

    if (!registration || registration.scope !== identity.scope) {
      return { ok: true, status: 'not-owned', scope: identity.scope };
    }
    const workerScriptUrls = registrationWorkerScriptUrls(registration);
    if (!workerScriptUrls.length) {
      return { ok: false, status: 'identity-unverifiable', scope: identity.scope };
    }
    if (!workerScriptUrls.includes(identity.scriptUrl)) {
      return { ok: true, status: 'not-owned', scope: identity.scope };
    }

    const unregistered = await registration.unregister();
    if (unregistered !== true) {
      return { ok: false, status: 'unregister-failed', scope: identity.scope };
    }

    if (blendRegistration === registration) blendRegistration = null;
    return { ok: true, status: 'unregistered', scope: identity.scope };
  } catch (_) {
    return {
      ok: false,
      status: 'unregister-failed',
      scope: blendRegistrationIdentity?.scope || null
    };
  }
}

export async function applyUpdate() {
  const registration = getBlendRegistration();
  const waiting = registration?.waiting?.scriptURL === blendRegistrationIdentity?.scriptUrl
    ? registration.waiting
    : null;
  if (!waiting) return false;
  reloadForAppliedUpdate = true;
  await postToWorker(waiting, { type: 'SKIP_WAITING' });
  return true;
}

export async function requestCacheStatus() {
  const response = await postToWorker(getBlendActiveWorker(), { type: 'CACHE_STATUS' });
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
  const response = await postToWorker(getBlendActiveWorker(), { type: 'CLEAR_RUNTIME_CACHES' });
  return response?.ok === true;
}

export async function refreshCaches(urls = []) {
  const response = await postToWorker(getBlendActiveWorker(), { type: 'WARM_URLS', urls });
  return response?.ok === true;
}

export function getPwaStatus() {
  return { ...lastStatus };
}
