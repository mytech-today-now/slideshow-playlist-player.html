const MAX_PROVIDER_PLAYLIST_ITEMS = 5000;
const MAX_PENDING_PROVIDER_URLS = 50;
const PROVIDER_API_TIMEOUT_MS = 90_000;
const PROVIDER_API_PATH = 'api/playlist-import';
const PROVIDER_OAUTH_PENDING_KEY = 'blend-playlist-provider-oauth-pending-v1';

const PROVIDERS = Object.freeze({
  'apple-music': Object.freeze({
    label: 'Apple Music',
    hosts: ['music.apple.com']
  }),
  vimeo: Object.freeze({
    label: 'Vimeo',
    hosts: ['vimeo.com', 'www.vimeo.com']
  }),
  soundcloud: Object.freeze({
    label: 'SoundCloud',
    hosts: ['soundcloud.com', 'www.soundcloud.com']
  }),
  dailymotion: Object.freeze({
    label: 'Dailymotion',
    hosts: ['dailymotion.com', 'www.dailymotion.com']
  })
});

export class OfficialPlaylistImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OfficialPlaylistImportError';
    this.code = code;
  }
}

function parseHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch (_) {
    return null;
  }
}

export function officialPlaylistProviderFromUrl(value) {
  const url = parseHttpUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host === 'music.apple.com'
      && /^\/[a-z]{2}\/playlist\/[^/]+(?:\/[^/]+)?\/?$/i.test(path)) {
    return { provider: 'apple-music', label: PROVIDERS['apple-music'].label };
  }
  if ((host === 'vimeo.com' || host === 'www.vimeo.com')
      && /^\/(?:showcase|albums)\/\d+(?:\/.*)?\/?$/i.test(path)) {
    return { provider: 'vimeo', label: PROVIDERS.vimeo.label };
  }
  if (['soundcloud.com', 'www.soundcloud.com', 'on.soundcloud.com'].includes(host)
      && (host === 'on.soundcloud.com' || /^\/[^/]+\/sets\/[^/]+(?:\/.*)?\/?$/i.test(path))) {
    return { provider: 'soundcloud', label: PROVIDERS.soundcloud.label };
  }
  if (['dailymotion.com', 'www.dailymotion.com'].includes(host)
      && /^\/playlist\/[A-Za-z0-9_-]{2,128}(?:\/.*)?\/?$/i.test(path)) {
    return { provider: 'dailymotion', label: PROVIDERS.dailymotion.label };
  }
  return null;
}

function apiBaseUrl() {
  const configuredBase = String(globalThis.BLEND_PLAYLIST_API_URL || '').trim();
  let baseUrl;
  try {
    baseUrl = configuredBase
      ? new URL(configuredBase)
      : new URL('./', window.location.href);
  } catch (_) {
    throw new OfficialPlaylistImportError('playlist_api_url_invalid', 'The playlist API address is not valid.');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)
      || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new OfficialPlaylistImportError('playlist_api_url_invalid', 'The playlist API address must be an HTTP or HTTPS base URL.');
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '') + '/';
  return baseUrl;
}

function apiEndpoint(suffix = '') {
  return new URL(PROVIDER_API_PATH + suffix, apiBaseUrl());
}

function credentialsMode(endpoint) {
  return endpoint.origin === window.location.origin ? 'same-origin' : 'include';
}

function canonicalPlaylistItemUrl(value, provider) {
  const url = parseHttpUrl(value);
  const providerConfig = PROVIDERS[provider];
  if (!url || url.protocol !== 'https:' || !providerConfig?.hosts.includes(url.hostname.toLowerCase())) return '';
  url.hash = '';
  if (provider !== 'apple-music') {
    url.search = '';
  } else {
    const itemId = url.searchParams.get('i');
    url.search = itemId && /^[0-9]{1,32}$/.test(itemId) ? '?i=' + itemId : '';
  }
  return url.toString();
}

function cleanTitle(value, fallback) {
  const title = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  return title || fallback;
}

async function readBoundedJson(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
    throw new OfficialPlaylistImportError('playlist_api_response_too_large', 'The playlist API returned too much data.');
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 2_000_000) {
      throw new OfficialPlaylistImportError('playlist_api_response_too_large', 'The playlist API returned too much data.');
    }
    try { return JSON.parse(text); } catch (_) {
      throw new OfficialPlaylistImportError('playlist_api_invalid_response', 'The playlist API returned an unreadable response.');
    }
  }

  const decoder = new TextDecoder();
  let text = '';
  let byteCount = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    byteCount += result.value?.byteLength || 0;
    if (byteCount > 2_000_000) {
      try { await reader.cancel(); } catch (_) {}
      throw new OfficialPlaylistImportError('playlist_api_response_too_large', 'The playlist API returned too much data.');
    }
    text += decoder.decode(result.value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text); } catch (_) {
    throw new OfficialPlaylistImportError('playlist_api_invalid_response', 'The playlist API returned an unreadable response.');
  }
}

async function fetchJson(endpoint, options = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutHandle = setTimeout(() => controller?.abort(), PROVIDER_API_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.toString(), {
      mode: 'cors',
      cache: 'no-store',
      ...options,
      credentials: credentialsMode(endpoint),
      headers: { Accept: 'application/json', ...(options.headers || {}) },
      ...(controller ? { signal: controller.signal } : {})
    });
    return { response, payload: await readBoundedJson(response) };
  } catch (error) {
    if (error instanceof OfficialPlaylistImportError) throw error;
    throw new OfficialPlaylistImportError('playlist_api_unavailable', 'Could not reach the configured playlist API service.');
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function fetchOfficialPlaylistCanonicalLinks(playlistUrl) {
  const detected = officialPlaylistProviderFromUrl(playlistUrl);
  if (!detected) {
    throw new OfficialPlaylistImportError('playlist_provider_url_invalid', 'Enter a supported public playlist URL.');
  }
  const endpoint = apiEndpoint();
  const { response, payload } = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: detected.provider, url: String(playlistUrl) })
  });
  if (!response.ok) {
    const code = String(payload?.error?.code || 'playlist_api_failed').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
    const message = String(payload?.error?.message || 'The playlist service could not read this playlist.').slice(0, 240);
    throw new OfficialPlaylistImportError(code || 'playlist_api_failed', message);
  }
  if (!Array.isArray(payload?.items) || payload.items.length > MAX_PROVIDER_PLAYLIST_ITEMS) {
    throw new OfficialPlaylistImportError('playlist_api_invalid_response', 'The playlist service returned an unreadable playlist.');
  }

  const items = [];
  const seen = new Set();
  for (const item of payload.items) {
    const url = canonicalPlaylistItemUrl(item?.url, detected.provider);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({
      url,
      title: cleanTitle(item?.title, url),
      identifier: String(item?.identifier || '').slice(0, 128)
    });
  }
  if (!items.length) {
    throw new OfficialPlaylistImportError('playlist_provider_empty', 'This playlist has no public items available through the provider API.');
  }
  return items;
}

export async function beginProviderPlaylistOAuth({ provider, pendingUrls = [] } = {}) {
  if (!['vimeo', 'soundcloud', 'dailymotion'].includes(provider)) {
    throw new OfficialPlaylistImportError('playlist_provider_auth_unsupported', 'Sign-in is not available for this playlist provider.');
  }
  if (!Array.isArray(pendingUrls) || !pendingUrls.length || pendingUrls.length > MAX_PENDING_PROVIDER_URLS
      || pendingUrls.some(url => typeof url !== 'string' || url.length > 4096)) {
    throw new OfficialPlaylistImportError('playlist_oauth_pending_urls_invalid', 'There are too many URLs to resume after sign-in.');
  }
  const statusEndpoint = apiEndpoint('/oauth/status');
  const { response: statusResponse, payload: statusPayload } = await fetchJson(statusEndpoint, { method: 'GET' });
  if (!statusResponse.ok || !Array.isArray(statusPayload?.oauthProviders)
      || !statusPayload.oauthProviders.includes(provider)) {
    throw new OfficialPlaylistImportError(
      'playlist_provider_not_configured',
      'Sign-in for ' + PROVIDERS[provider].label + ' is not configured on this Blend server.'
    );
  }
  const transaction = { provider, pendingUrls, createdAt: Date.now() };
  try {
    window.sessionStorage.setItem(PROVIDER_OAUTH_PENDING_KEY, JSON.stringify(transaction));
  } catch (_) {
    throw new OfficialPlaylistImportError('playlist_oauth_storage_unavailable', 'Tab storage is unavailable for resuming this playlist import.');
  }
  const startUrl = apiEndpoint('/oauth/' + provider + '/start');
  startUrl.searchParams.set('return_to', window.location.origin + window.location.pathname);
  window.location.assign(startUrl.toString());
  return true;
}

export function consumeProviderPlaylistOAuthCallback() {
  const currentUrl = new URL(window.location.href);
  const result = currentUrl.searchParams.get('playlist_oauth') || '';
  if (!['connected', 'cancelled', 'error'].includes(result)) return null;
  currentUrl.searchParams.delete('playlist_oauth');
  try {
    window.history.replaceState(null, '', currentUrl.pathname + (currentUrl.search || '') + (currentUrl.hash || ''));
  } catch (_) {}
  let transaction = null;
  try {
    const saved = window.sessionStorage.getItem(PROVIDER_OAUTH_PENDING_KEY);
    transaction = saved ? JSON.parse(saved) : null;
    window.sessionStorage.removeItem(PROVIDER_OAUTH_PENDING_KEY);
  } catch (_) {}
  const pendingUrls = Array.isArray(transaction?.pendingUrls)
    && transaction.pendingUrls.length <= MAX_PENDING_PROVIDER_URLS
    ? transaction.pendingUrls.filter(url => typeof url === 'string' && url.length <= 4096)
    : [];
  if (result === 'connected') {
    return {
      success: true,
      pendingUrls,
      message: 'Playlist provider sign-in completed. Resuming the import.'
    };
  }
  return {
    success: false,
    pendingUrls: [],
    message: result === 'cancelled'
      ? 'Playlist provider sign-in was cancelled.'
      : 'Playlist provider sign-in could not be verified or completed.'
  };
}

export async function getProviderPlaylistOAuthStatus() {
  try {
    const endpoint = apiEndpoint('/oauth/status');
    const { response, payload } = await fetchJson(endpoint, { method: 'GET' });
    return response.ok ? payload : null;
  } catch (_) {
    return null;
  }
}

export async function disconnectProviderPlaylistOAuth() {
  try {
    const endpoint = apiEndpoint('/oauth/disconnect');
    const { response } = await fetchJson(endpoint, { method: 'POST' });
    return response.ok;
  } catch (_) {
    return false;
  }
}

export function clearProviderPlaylistOAuthPendingImport() {
  try {
    window.sessionStorage.removeItem(PROVIDER_OAUTH_PENDING_KEY);
    return true;
  } catch (_) {
    return false;
  }
}
