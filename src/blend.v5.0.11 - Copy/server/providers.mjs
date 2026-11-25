import { createPrivateKey, sign } from 'node:crypto';

const MAX_ITEMS = 5000;
const MAX_PAGES = 60;
const MAX_RESPONSE_BYTES = 2_000_000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const IMPORT_DEADLINE_MS = 75_000;
const VIMEO_API = 'https://api.vimeo.com';
const SOUNDCLOUD_API = 'https://api.soundcloud.com';
const APPLE_MUSIC_API = 'https://api.music.apple.com';
const DAILYMOTION_API = 'https://api.dailymotion.com';
const API_HOSTS = new Set([
  'api.vimeo.com',
  'api.soundcloud.com',
  'api.music.apple.com',
  'api.dailymotion.com',
  'secure.soundcloud.com'
]);
const tokenCache = new Map();
let cachedAppleToken = null;

export class PlaylistProviderError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'PlaylistProviderError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new PlaylistProviderError(code, message, status);
}

function providerConfigPresent(provider) {
  if (provider === 'apple-music') {
    return !!(process.env.APPLE_MUSIC_ISSUER_ID
      && process.env.APPLE_MUSIC_KEY_ID
      && process.env.APPLE_MUSIC_PRIVATE_KEY_PEM);
  }
  if (provider === 'vimeo') {
    return !!(process.env.VIMEO_CLIENT_ID && process.env.VIMEO_CLIENT_SECRET
      && Buffer.byteLength(String(process.env.BLEND_PLAYLIST_SESSION_SECRET || ''), 'utf8') >= 32);
  }
  if (provider === 'soundcloud') {
    return !!(process.env.SOUNDCLOUD_CLIENT_ID && process.env.SOUNDCLOUD_CLIENT_SECRET);
  }
  if (provider === 'dailymotion') {
    return !!(process.env.DAILYMOTION_CLIENT_ID && process.env.DAILYMOTION_CLIENT_SECRET
      && Buffer.byteLength(String(process.env.BLEND_PLAYLIST_SESSION_SECRET || ''), 'utf8') >= 32);
  }
  return false;
}

export function availablePlaylistProviders() {
  return ['apple-music', 'vimeo', 'soundcloud', 'dailymotion'].filter(providerConfigPresent);
}

function parseSource(provider, value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 4096) fail('playlist_provider_url_invalid', 'Enter a valid playlist URL.', 400);
  let url;
  try { url = new URL(raw); } catch (_) {
    fail('playlist_provider_url_invalid', 'Enter a valid playlist URL.', 400);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    fail('playlist_provider_url_invalid', 'Playlist URLs must use HTTP or HTTPS and cannot contain credentials.', 400);
  }

  if (provider === 'apple-music'
      && url.hostname.toLowerCase() === 'music.apple.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const storefront = parts[0] || '';
    const playlistIndex = parts.indexOf('playlist');
    const playlistId = parts.at(-1) || '';
    if (/^[a-z]{2}$/i.test(storefront)
        && playlistIndex === 1
        && /^[A-Za-z0-9.-]{3,128}$/.test(playlistId)
        && parts.length >= 3) {
      return { url, storefront: storefront.toLowerCase(), playlistId };
    }
  }

  if (provider === 'vimeo'
      && ['vimeo.com', 'www.vimeo.com'].includes(url.hostname.toLowerCase())) {
    const match = url.pathname.match(/^\/(?:showcase|albums)\/([0-9]+)(?:\/.*)?\/?$/i);
    if (match) return { url, playlistId: match[1] };
  }

  if (provider === 'soundcloud'
      && ['soundcloud.com', 'www.soundcloud.com', 'on.soundcloud.com'].includes(url.hostname.toLowerCase())) {
    const isShortLink = url.hostname.toLowerCase() === 'on.soundcloud.com'
      && /^\/[A-Za-z0-9_-]{4,128}\/?$/.test(url.pathname);
    const isPlaylist = /^\/[^/]+\/sets\/[^/]+(?:\/.*)?\/?$/i.test(url.pathname);
    if (isShortLink || isPlaylist) return { url, playlistUrl: url.toString() };
  }

  if (provider === 'dailymotion'
      && ['dailymotion.com', 'www.dailymotion.com'].includes(url.hostname.toLowerCase())) {
    const match = url.pathname.match(/^\/playlist\/([A-Za-z0-9_-]{2,128})(?:\/.*)?\/?$/i);
    if (match) return { url, playlistId: match[1] };
  }

  fail('playlist_provider_url_invalid', 'This URL is not a supported public playlist for the selected provider.', 400);
}

async function readJsonResponse(response, provider) {
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? response.status : 502;
    fail('playlist_provider_upstream_error', provider + ' could not read this playlist.', status);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    fail('playlist_provider_response_too_large', provider + ' returned too much playlist data.', 502);
  }

  const reader = response.body?.getReader?.();
  let text = '';
  if (!reader) {
    text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      fail('playlist_provider_response_too_large', provider + ' returned too much playlist data.', 502);
    }
  } else {
    const decoder = new TextDecoder();
    let byteCount = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      byteCount += part.value?.byteLength || 0;
      if (byteCount > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch (_) {}
        fail('playlist_provider_response_too_large', provider + ' returned too much playlist data.', 502);
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  }
  try { return JSON.parse(text); } catch (_) {
    fail('playlist_provider_invalid_response', provider + ' returned an unreadable response.', 502);
  }
}

async function fetchProviderJson(value, provider, options = {}) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !API_HOSTS.has(url.hostname.toLowerCase())
      || url.username || url.password) {
    fail('playlist_provider_upstream_url_invalid', 'The provider returned an invalid API address.', 502);
  }
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      redirect: 'error',
      cache: 'no-store',
      ...options,
      signal: controller.signal
    });
    return await readJsonResponse(response, provider);
  } catch (error) {
    if (error instanceof PlaylistProviderError) throw error;
    fail('playlist_provider_unavailable', provider + ' is temporarily unavailable.', 502);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function basicAuthorization(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(String(clientId) + ':' + String(clientSecret)).toString('base64');
}

async function getOAuthClientToken(provider, clientId, clientSecret, endpoint, body, accept) {
  const cacheKey = provider + ':' + clientId;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.accessToken;

  const headers = {
    Authorization: basicAuthorization(clientId, clientSecret),
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: accept || 'application/json'
  };
  const payload = await fetchProviderJson(endpoint, provider, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body)
  });
  const accessToken = String(payload?.access_token || '');
  const expiresIn = Number(payload?.expires_in || (provider === 'Vimeo' ? 3600 : 0));
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 86_400) {
    fail('playlist_provider_auth_invalid', provider + ' returned an invalid API authorization response.', 502);
  }
  tokenCache.set(cacheKey, { accessToken, expiresAt: Date.now() + expiresIn * 1000 });
  return accessToken;
}

async function getSoundCloudToken() {
  const clientId = String(process.env.SOUNDCLOUD_CLIENT_ID || '');
  const clientSecret = String(process.env.SOUNDCLOUD_CLIENT_SECRET || '');
  if (!clientId || !clientSecret) {
    fail('playlist_provider_not_configured', 'SoundCloud public playlist import is not configured on this Blend server.', 503);
  }
  return getOAuthClientToken(
    'SoundCloud',
    clientId,
    clientSecret,
    'https://secure.soundcloud.com/oauth/token',
    { grant_type: 'client_credentials' }
  );
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function getAppleMusicDeveloperToken() {
  const issuerId = String(process.env.APPLE_MUSIC_ISSUER_ID || '').trim();
  const keyId = String(process.env.APPLE_MUSIC_KEY_ID || '').trim();
  const privateKeyPem = String(process.env.APPLE_MUSIC_PRIVATE_KEY_PEM || '').replace(/\\n/g, '\n');
  if (!issuerId || !keyId || !privateKeyPem) {
    fail('playlist_provider_not_configured', 'Apple Music public playlist import is not configured on this Blend server.', 503);
  }
  if (cachedAppleToken && cachedAppleToken.expiresAt > Date.now() + 30_000) {
    return cachedAppleToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned = base64UrlJson({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    + '.'
    + base64UrlJson({ iss: issuerId, iat: now, exp: now + 900 });
  let signature;
  try {
    signature = sign('sha256', Buffer.from(unsigned), {
      key: createPrivateKey(privateKeyPem),
      dsaEncoding: 'ieee-p1363'
    }).toString('base64url');
  } catch (_) {
    fail('playlist_provider_credentials_invalid', 'Apple Music server credentials could not create a developer token.', 503);
  }
  const token = unsigned + '.' + signature;
  cachedAppleToken = { token, expiresAt: Date.now() + 840_000 };
  return token;
}

function cleanTitle(value, fallback) {
  const title = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return title || fallback;
}

function addUnique(items, seen, candidate) {
  if (!candidate || !candidate.url || seen.has(candidate.url)) return;
  if (items.length >= MAX_ITEMS) {
    fail('playlist_provider_too_many_items', 'This playlist exceeds the 5,000 item import limit.', 413);
  }
  seen.add(candidate.url);
  items.push(candidate);
}

function checkedNextPage(value, provider, pathPrefix) {
  if (!value) return '';
  let next;
  try {
    const base = provider === 'Apple Music'
      ? APPLE_MUSIC_API
      : provider === 'Vimeo'
        ? VIMEO_API
        : provider === 'SoundCloud'
          ? SOUNDCLOUD_API
          : DAILYMOTION_API;
    next = new URL(value, base);
  }
  catch (_) { fail('playlist_provider_invalid_pagination', provider + ' returned an invalid playlist page link.', 502); }
  const apiHost = provider === 'Apple Music'
    ? 'api.music.apple.com'
    : provider === 'Vimeo'
      ? 'api.vimeo.com'
      : provider === 'SoundCloud'
        ? 'api.soundcloud.com'
        : 'api.dailymotion.com';
  if (next.protocol !== 'https:' || next.hostname.toLowerCase() !== apiHost
      || !next.pathname.startsWith(pathPrefix) || next.username || next.password) {
    fail('playlist_provider_invalid_pagination', provider + ' returned an invalid playlist page link.', 502);
  }
  return next.toString();
}

async function importAppleMusic(source) {
  const token = getAppleMusicDeveloperToken();
  const pathPrefix = '/v1/catalog/' + source.storefront + '/playlists/' + source.playlistId + '/tracks';
  let pageUrl = APPLE_MUSIC_API + pathPrefix + '?limit=100&offset=0';
  const items = [];
  const seen = new Set();
  const startedAt = Date.now();
  for (let page = 0; page < MAX_PAGES && pageUrl; page++) {
    if (Date.now() - startedAt > IMPORT_DEADLINE_MS) {
      fail('playlist_provider_timeout', 'Apple Music playlist import reached its time limit.', 504);
    }
    const payload = await fetchProviderJson(pageUrl, 'Apple Music', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
    if (!Array.isArray(payload?.data)) {
      fail('playlist_provider_invalid_response', 'Apple Music returned an unreadable playlist.', 502);
    }
    for (const track of payload.data) {
      const attributes = track?.attributes || {};
      let canonicalUrl = String(attributes.url || '');
      if (!canonicalUrl && /^[A-Za-z0-9.-]{3,128}$/.test(String(track?.id || ''))) {
        const type = track.type === 'music-videos' ? 'music-video' : 'song';
        canonicalUrl = 'https://music.apple.com/' + source.storefront + '/' + type + '/' + encodeURIComponent(track.id);
      }
      let parsed;
      try { parsed = new URL(canonicalUrl); } catch (_) { continue; }
      if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'music.apple.com') continue;
      parsed.hash = '';
      const itemId = parsed.searchParams.get('i');
      parsed.search = itemId && /^[0-9]{1,32}$/.test(itemId) ? '?i=' + itemId : '';
      addUnique(items, seen, {
        url: parsed.toString(),
        title: cleanTitle(attributes.name, String(track?.id || 'Apple Music item')),
        identifier: String(track?.id || '').slice(0, 128)
      });
    }
    pageUrl = checkedNextPage(payload.next || '', 'Apple Music', pathPrefix);
  }
  if (pageUrl) fail('playlist_provider_too_many_pages', 'Apple Music playlist has more pages than Blend can safely import.', 413);
  if (!items.length) fail('playlist_provider_empty', 'This Apple Music playlist has no public catalog items.', 404);
  return items;
}

function failIfNoUserToken(accessToken, provider) {
  if (!accessToken) {
    fail('playlist_provider_auth_required', 'Sign in to ' + provider + ' to import this account playlist.', 401);
  }
}

async function importVimeoWithUserToken(source, accessToken) {
  failIfNoUserToken(accessToken, 'Vimeo');
  const pathPrefix = '/me/albums/' + source.playlistId + '/videos';
  let pageUrl = VIMEO_API + pathPrefix + '?per_page=100&page=1&fields=uri,name,link,privacy.view';
  const items = [];
  const seen = new Set();
  const startedAt = Date.now();
  for (let page = 0; page < MAX_PAGES && pageUrl; page++) {
    if (Date.now() - startedAt > IMPORT_DEADLINE_MS) {
      fail('playlist_provider_timeout', 'Vimeo playlist import reached its time limit.', 504);
    }
    const payload = await fetchProviderJson(pageUrl, 'Vimeo', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/vnd.vimeo.*+json;version=3.4'
      }
    });
    if (!Array.isArray(payload?.data)) {
      fail('playlist_provider_invalid_response', 'Vimeo returned an unreadable showcase.', 502);
    }
    for (const video of payload.data) {
      const videoId = String(video?.uri || '').match(/^\/videos\/([0-9]+)$/)?.[1] || '';
      if (!videoId) continue;
      addUnique(items, seen, {
        url: 'https://vimeo.com/' + videoId,
        title: cleanTitle(video.name, 'Vimeo video ' + videoId),
        identifier: videoId
      });
    }
    pageUrl = checkedNextPage(payload.paging?.next || '', 'Vimeo', pathPrefix);
  }
  if (pageUrl) fail('playlist_provider_too_many_pages', 'Vimeo showcase has more pages than Blend can safely import.', 413);
  if (!items.length) fail('playlist_provider_empty', 'This Vimeo showcase has no public videos available.', 404);
  return items;
}

function canonicalSoundCloudTrack(track) {
  if (track?.sharing && String(track.sharing).toLowerCase() !== 'public') return null;
  let url;
  try { url = new URL(String(track?.permalink_url || track?.url || '')); } catch (_) { return null; }
  if (url.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname.toLowerCase())) return null;
  url.search = '';
  url.hash = '';
  return {
    url: url.toString(),
    title: cleanTitle(track.title, 'SoundCloud track ' + String(track.id || '')),
    identifier: String(track.urn || track.id || '').slice(0, 128)
  };
}

async function importSoundCloud(source, userToken = '') {
  const token = userToken || await getSoundCloudToken();
  const resolveUrl = new URL(SOUNDCLOUD_API + '/resolve');
  resolveUrl.searchParams.set('url', source.playlistUrl);
  let resolved;
  try {
    resolved = await fetchProviderJson(resolveUrl.toString(), 'SoundCloud', {
      headers: { Authorization: 'OAuth ' + token, Accept: 'application/json' }
    });
  } catch (error) {
    if (!userToken && (error.status === 401 || error.status === 403)) {
      fail('playlist_provider_auth_required', 'Sign in to SoundCloud to import this account playlist.', 401);
    }
    throw error;
  }
  if (resolved?.sharing && String(resolved.sharing).toLowerCase() !== 'public' && !userToken) {
    fail('playlist_provider_auth_required', 'Sign in to SoundCloud to import this account playlist.', 401);
  }
  const playlistId = String(resolved?.urn || resolved?.id || '');
  if (!playlistId || !/^[A-Za-z0-9:_-]{1,128}$/.test(playlistId)) {
    fail('playlist_provider_not_found', 'SoundCloud could not resolve this public playlist.', 404);
  }
  const pathPrefix = '/playlists/' + encodeURIComponent(playlistId) + '/tracks';
  const firstPage = new URL(SOUNDCLOUD_API + pathPrefix);
  firstPage.searchParams.set('limit', '200');
  firstPage.searchParams.set('linked_partitioning', 'true');
  let pageUrl = firstPage.toString();
  const items = [];
  const seen = new Set();
  const startedAt = Date.now();
  for (let page = 0; page < MAX_PAGES && pageUrl; page++) {
    if (Date.now() - startedAt > IMPORT_DEADLINE_MS) {
      fail('playlist_provider_timeout', 'SoundCloud playlist import reached its time limit.', 504);
    }
    let payload;
    try {
      payload = await fetchProviderJson(pageUrl, 'SoundCloud', {
        headers: { Authorization: 'OAuth ' + token, Accept: 'application/json' }
      });
    } catch (error) {
      if (!userToken && (error.status === 401 || error.status === 403)) {
        fail('playlist_provider_auth_required', 'Sign in to SoundCloud to import this account playlist.', 401);
      }
      throw error;
    }
    const tracks = Array.isArray(payload) ? payload : payload.collection || payload.data;
    if (!Array.isArray(tracks)) {
      fail('playlist_provider_invalid_response', 'SoundCloud returned an unreadable playlist.', 502);
    }
    for (const track of tracks) addUnique(items, seen, canonicalSoundCloudTrack(track));
    pageUrl = checkedNextPage(payload.next_href || payload.next || '', 'SoundCloud', pathPrefix);
  }
  if (pageUrl) fail('playlist_provider_too_many_pages', 'SoundCloud playlist has more pages than Blend can safely import.', 413);
  if (!items.length) fail('playlist_provider_empty', 'This SoundCloud playlist has no public tracks available.', 404);
  return items;
}

function canonicalDailymotionVideo(video) {
  const suppliedUrl = String(video?.video_url || '');
  let videoId = String(video?.video_id || '');
  let parsed = null;
  try { parsed = new URL(suppliedUrl); } catch (_) {}
  if (parsed) {
    if (parsed.protocol !== 'https:'
        || !['dailymotion.com', 'www.dailymotion.com'].includes(parsed.hostname.toLowerCase())) return null;
    const match = parsed.pathname.match(/^\/video\/([A-Za-z0-9_-]{2,128})(?:_.*)?\/?$/i);
    if (match) videoId = match[1];
  }
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(videoId)) return null;
  return {
    url: 'https://www.dailymotion.com/video/' + videoId,
    title: cleanTitle(video?.title, 'Dailymotion video ' + videoId),
    identifier: videoId
  };
}

async function importDailymotion(source, accessToken = '') {
  failIfNoUserToken(accessToken, 'Dailymotion');
  const pathPrefix = '/v2/playlists/' + encodeURIComponent(source.playlistId) + '/videos';
  const firstPage = new URL(DAILYMOTION_API + pathPrefix);
  firstPage.searchParams.set('page_size', '100');
  firstPage.searchParams.set('page', '1');
  firstPage.searchParams.set('fields', 'video_id,video_url,title');
  let pageUrl = firstPage.toString();
  const items = [];
  const seen = new Set();
  const startedAt = Date.now();
  for (let page = 0; page < MAX_PAGES && pageUrl; page++) {
    if (Date.now() - startedAt > IMPORT_DEADLINE_MS) {
      fail('playlist_provider_timeout', 'Dailymotion playlist import reached its time limit.', 504);
    }
    const payload = await fetchProviderJson(pageUrl, 'Dailymotion', {
      headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' }
    });
    if (!Array.isArray(payload?.data)) {
      fail('playlist_provider_invalid_response', 'Dailymotion returned an unreadable playlist.', 502);
    }
    for (const video of payload.data) addUnique(items, seen, canonicalDailymotionVideo(video));
    pageUrl = checkedNextPage(payload.pagination?.next || payload.next || '', 'Dailymotion', pathPrefix);
  }
  if (pageUrl) fail('playlist_provider_too_many_pages', 'Dailymotion playlist has more pages than Blend can safely import.', 413);
  if (!items.length) fail('playlist_provider_empty', 'This Dailymotion playlist has no available videos.', 404);
  return items;
}

export function providerOAuthCredentials(provider) {
  if (provider === 'vimeo') {
    return {
      clientId: String(process.env.VIMEO_CLIENT_ID || ''),
      clientSecret: String(process.env.VIMEO_CLIENT_SECRET || '')
    };
  }
  if (provider === 'soundcloud') {
    return {
      clientId: String(process.env.SOUNDCLOUD_CLIENT_ID || ''),
      clientSecret: String(process.env.SOUNDCLOUD_CLIENT_SECRET || '')
    };
  }
  if (provider === 'dailymotion') {
    return {
      clientId: String(process.env.DAILYMOTION_CLIENT_ID || ''),
      clientSecret: String(process.env.DAILYMOTION_CLIENT_SECRET || '')
    };
  }
  return { clientId: '', clientSecret: '' };
}

export async function exchangeProviderOAuthCode(provider, code, redirectUri, codeVerifier = '') {
  const credentials = providerOAuthCredentials(provider);
  if (!credentials.clientId || !credentials.clientSecret) {
    fail('playlist_provider_not_configured', 'This provider sign-in is not configured on the Blend server.', 503);
  }
  let endpoint = '';
  let headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const body = {
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: String(redirectUri || '')
  };
  if (provider === 'vimeo') {
    endpoint = VIMEO_API + '/oauth/access_token';
    headers.Authorization = basicAuthorization(credentials.clientId, credentials.clientSecret);
    headers.Accept = 'application/vnd.vimeo.*+json;version=3.4';
  } else if (provider === 'soundcloud') {
    endpoint = 'https://secure.soundcloud.com/oauth/token';
    body.client_id = credentials.clientId;
    body.client_secret = credentials.clientSecret;
    body.code_verifier = String(codeVerifier || '');
  } else if (provider === 'dailymotion') {
    endpoint = DAILYMOTION_API + '/oauth/token';
    body.client_id = credentials.clientId;
    body.client_secret = credentials.clientSecret;
  } else {
    fail('playlist_provider_not_supported', 'This provider sign-in is not supported.', 400);
  }
  const payload = await fetchProviderJson(endpoint, provider, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body)
  });
  const accessToken = String(payload?.access_token || '');
  const expiresIn = Number(payload?.expires_in || (provider === 'vimeo' ? 86_400 : 0));
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 31_536_000) {
    fail('playlist_provider_auth_invalid', provider + ' returned an invalid sign-in response.', 502);
  }
  return { accessToken, expiresIn };
}

export async function fetchPlaylistItems(provider, value, accessToken = '') {
  if (!['apple-music', 'vimeo', 'soundcloud', 'dailymotion'].includes(provider)) {
    fail('playlist_provider_not_supported', 'This provider does not have a public playlist importer in this Blend server.', 400);
  }
  const source = parseSource(provider, value);
  if (!providerConfigPresent(provider)) {
    const label = provider === 'apple-music' ? 'Apple Music' : provider === 'vimeo' ? 'Vimeo' : provider === 'dailymotion' ? 'Dailymotion' : 'SoundCloud';
    fail('playlist_provider_not_configured', label + ' public playlist import is not configured on this Blend server.', 503);
  }
  if (provider === 'apple-music') return importAppleMusic(source);
  if (provider === 'vimeo') return importVimeoWithUserToken(source, accessToken);
  if (provider === 'soundcloud') return importSoundCloud(source, accessToken);
  return importDailymotion(source, accessToken);
}
