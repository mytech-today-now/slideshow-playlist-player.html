const CLIENT_ID_STORAGE_KEY = 'blend-spotify-client-id-v1';
const TOKEN_SESSION_STORAGE_KEY = 'blend-spotify-session-v1';
const OAUTH_TRANSACTION_SESSION_STORAGE_KEY = 'blend-spotify-oauth-transaction-v1';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const API_PLAYLIST_ITEMS_ENDPOINT = 'https://api.spotify.com/v1/playlists';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PLAYLIST_ITEMS = 5_000;
const MAX_PENDING_URLS = 50;
const OAUTH_SCOPES = ['playlist-read-private', 'playlist-read-collaborative'];

export const SPOTIFY_CLIENT_ID_STORAGE_KEY = CLIENT_ID_STORAGE_KEY;
export const SPOTIFY_TOKEN_SESSION_STORAGE_KEY = TOKEN_SESSION_STORAGE_KEY;
export const SPOTIFY_OAUTH_TRANSACTION_SESSION_STORAGE_KEY = OAUTH_TRANSACTION_SESSION_STORAGE_KEY;

export class SpotifyPlaylistImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpotifyPlaylistImportError';
    this.code = code;
  }
}

function randomUrlSafeString(byteCount = 48) {
  const bytes = new Uint8Array(byteCount);
  window.crypto.getRandomValues(bytes);
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function getSpotifyRedirectUri(locationLike = window.location) {
  if (!locationLike?.origin || !locationLike?.pathname) {
    throw new SpotifyPlaylistImportError('spotify_redirect_unavailable', 'Spotify sign-in needs a hosted Blend page.');
  }
  if (locationLike.protocol !== 'https:' && locationLike.hostname !== 'localhost' && locationLike.hostname !== '127.0.0.1') {
    throw new SpotifyPlaylistImportError('spotify_redirect_insecure', 'Spotify sign-in requires HTTPS or localhost.');
  }
  return `${locationLike.origin}${locationLike.pathname}`;
}

function cleanCurrentUrl() {
  try {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash || ''}`);
  } catch (_) {}
}

function normalizeClientId(value) {
  const clientId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientId)) {
    throw new SpotifyPlaylistImportError('spotify_client_id_invalid', 'Enter the Spotify app client ID in Configuration.');
  }
  return clientId;
}

export function readSpotifyClientId() {
  try {
    return normalizeClientId(window.localStorage.getItem(CLIENT_ID_STORAGE_KEY) || '');
  } catch (_) {
    return '';
  }
}

export function saveSpotifyClientId(value) {
  const clientId = normalizeClientId(value);
  try {
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    return true;
  } catch (_) {
    throw new SpotifyPlaylistImportError('spotify_storage_unavailable', 'The Spotify client ID could not be saved in this browser.');
  }
}

export function removeSpotifyClientId() {
  try {
    window.localStorage.removeItem(CLIENT_ID_STORAGE_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

function readSessionJson(key) {
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch (_) {
    return null;
  }
}

function writeSessionJson(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    throw new SpotifyPlaylistImportError('spotify_storage_unavailable', 'Tab storage is unavailable for Spotify sign-in.');
  }
}

function clearSessionKey(key) {
  try {
    window.sessionStorage.removeItem(key);
    return true;
  } catch (_) {
    return false;
  }
}

export function clearSpotifySession() {
  const tokenCleared = clearSessionKey(TOKEN_SESSION_STORAGE_KEY);
  const transactionCleared = clearSessionKey(OAUTH_TRANSACTION_SESSION_STORAGE_KEY);
  return tokenCleared && transactionCleared;
}

export function getSpotifySessionStatus() {
  const session = readSessionJson(TOKEN_SESSION_STORAGE_KEY);
  if (!session || typeof session.accessToken !== 'string' || !session.accessToken) return 'disconnected';
  return Number(session.expiresAt) > Date.now() ? 'connected' : 'expired';
}

export function isSpotifyPlaylistUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password
      && ['open.spotify.com', 'www.open.spotify.com'].includes(url.hostname.toLowerCase())
      && /^\/playlist\/[A-Za-z0-9]{10,64}\/?$/.test(url.pathname);
  } catch (_) {
    return false;
  }
}

export function spotifyPlaylistIdFromUrl(value) {
  if (!isSpotifyPlaylistUrl(value)) {
    throw new SpotifyPlaylistImportError('spotify_invalid_playlist_url', 'Enter a valid Spotify playlist URL.');
  }
  return new URL(String(value)).pathname.split('/').filter(Boolean)[1];
}

export async function beginSpotifyAuthorization({ clientId, pendingUrls = [] } = {}) {
  const validClientId = normalizeClientId(clientId);
  const redirectUri = getSpotifyRedirectUri();
  if (!Array.isArray(pendingUrls) || pendingUrls.length > MAX_PENDING_URLS
      || pendingUrls.some(url => typeof url !== 'string' || url.length > 4096)) {
    throw new SpotifyPlaylistImportError('spotify_pending_urls_invalid', 'There are too many URLs to resume after Spotify sign-in.');
  }
  if (!window.crypto?.subtle || typeof window.crypto.getRandomValues !== 'function') {
    throw new SpotifyPlaylistImportError('spotify_crypto_unavailable', 'This browser cannot start secure Spotify sign-in.');
  }

  const verifier = randomUrlSafeString(64);
  const state = randomUrlSafeString(32);
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let challenge = '';
  for (const byte of new Uint8Array(digest)) challenge += String.fromCharCode(byte);
  challenge = btoa(challenge).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  writeSessionJson(OAUTH_TRANSACTION_SESSION_STORAGE_KEY, {
    clientId: validClientId,
    redirectUri,
    state,
    verifier,
    pendingUrls
  });

  const authorizationUrl = new URL('https://accounts.spotify.com/authorize');
  authorizationUrl.search = new URLSearchParams({
    client_id: validClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: OAUTH_SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge
  }).toString();
  window.location.assign(authorizationUrl.toString());
}

async function fetchJsonWithTimeout(url, options, codePrefix) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutHandle = 0;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller?.abort();
      reject(new SpotifyPlaylistImportError(`${codePrefix}_timeout`, 'Spotify did not respond in time. Try again.'));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    const request = (async () => {
      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        ...options,
        ...(controller ? { signal: controller.signal } : {})
      });
      let payload = null;
      try { payload = await response.json(); } catch (_) {}
      return { response, payload };
    })();
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (error instanceof SpotifyPlaylistImportError) throw error;
    throw new SpotifyPlaylistImportError(`${codePrefix}_unavailable`, 'Could not reach Spotify from this browser.');
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function tokenRecordFromResponse(payload, previous = null, clientId = '') {
  const accessToken = String(payload?.access_token || '').trim();
  const expiresIn = Number(payload?.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 86_400) {
    throw new SpotifyPlaylistImportError('spotify_token_invalid', 'Spotify returned an invalid sign-in response.');
  }
  return {
    accessToken,
    refreshToken: String(payload?.refresh_token || previous?.refreshToken || ''),
    expiresAt: Date.now() + expiresIn * 1000,
    scope: String(payload?.scope || previous?.scope || ''),
    clientId: String(clientId || previous?.clientId || '')
  };
}

export async function consumeSpotifyAuthorizationCallback() {
  const query = new URLSearchParams(window.location.search);
  const code = query.get('code') || '';
  const state = query.get('state') || '';
  const providerError = query.get('error') || '';
  if (!code && !providerError) return null;

  const transaction = readSessionJson(OAUTH_TRANSACTION_SESSION_STORAGE_KEY);
  if (!transaction) return null;
  clearSessionKey(OAUTH_TRANSACTION_SESSION_STORAGE_KEY);
  cleanCurrentUrl();

  if (!state || state !== transaction.state) {
    return { success: false, message: 'Spotify sign-in could not be verified. Start the connection again.' };
  }
  if (providerError) {
    return { success: false, message: providerError === 'access_denied'
      ? 'Spotify sign-in was cancelled.'
      : 'Spotify sign-in was not completed.' };
  }
  if (!code || !transaction.verifier || !transaction.clientId || !transaction.redirectUri) {
    return { success: false, message: 'Spotify sign-in returned incomplete information. Start the connection again.' };
  }

  const { response, payload } = await fetchJsonWithTimeout(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: transaction.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: transaction.redirectUri,
      code_verifier: transaction.verifier
    })
  }, 'spotify_token');
  if (!response.ok) {
    return { success: false, message: 'Spotify could not finish sign-in. Check the app client ID and registered redirect URL.' };
  }

  const token = tokenRecordFromResponse(payload, null, transaction.clientId);
  writeSessionJson(TOKEN_SESSION_STORAGE_KEY, token);
  return {
    success: true,
    message: 'Spotify is connected in this tab.',
    pendingUrls: Array.isArray(transaction.pendingUrls) ? transaction.pendingUrls : []
  };
}

async function refreshSpotifyToken(clientId, currentToken) {
  if (!currentToken?.refreshToken) return null;
  const { response, payload } = await fetchJsonWithTimeout(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: currentToken.refreshToken
    })
  }, 'spotify_refresh');
  if (!response.ok) {
    clearSessionKey(TOKEN_SESSION_STORAGE_KEY);
    return null;
  }
  const token = tokenRecordFromResponse(payload, currentToken, clientId);
  writeSessionJson(TOKEN_SESSION_STORAGE_KEY, token);
  return token;
}

export async function getSpotifyAccessToken(clientId) {
  const validClientId = normalizeClientId(clientId);
  const currentToken = readSessionJson(TOKEN_SESSION_STORAGE_KEY);
  if (!currentToken?.accessToken) return '';
  if (currentToken.clientId && currentToken.clientId !== validClientId) {
    clearSessionKey(TOKEN_SESSION_STORAGE_KEY);
    return '';
  }
  if (Number(currentToken.expiresAt) > Date.now() + 30_000) return currentToken.accessToken;
  const refreshed = await refreshSpotifyToken(validClientId, currentToken);
  return refreshed?.accessToken || '';
}

function spotifyErrorMessage(response) {
  if (response.status === 401) return 'Spotify sign-in expired. Connect Spotify again and retry.';
  if (response.status === 403) return 'Spotify only exposes playlist items to the playlist owner or a collaborator for this API. Check the playlist access and connected account.';
  if (response.status === 404) return 'Spotify could not find this playlist or its contents.';
  if (response.status === 429) return 'Spotify is temporarily rate limiting playlist imports. Wait a little and try again.';
  return 'Spotify playlist lookup failed. Check the playlist URL and connection, then try again.';
}

export async function fetchSpotifyPlaylistCanonicalLinks(playlistUrl, { clientId } = {}) {
  const playlistId = spotifyPlaylistIdFromUrl(playlistUrl);
  const accessToken = await getSpotifyAccessToken(clientId);
  if (!accessToken) {
    throw new SpotifyPlaylistImportError('spotify_auth_required', 'Connect Spotify in Configuration before importing this playlist.');
  }

  const endpoint = new URL(`${API_PLAYLIST_ITEMS_ENDPOINT}/${encodeURIComponent(playlistId)}/items`);
  endpoint.searchParams.set('limit', '50');
  endpoint.searchParams.set('additional_types', 'track,episode');
  const links = [];
  const seen = new Set();
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    endpoint.searchParams.set('offset', String(offset));
    const request = () => fetchJsonWithTimeout(endpoint.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    }, 'spotify_playlist');
    let { response, payload } = await request();
    if (response.status === 401) {
      const refreshedToken = await refreshSpotifyToken(normalizeClientId(clientId), readSessionJson(TOKEN_SESSION_STORAGE_KEY));
      if (refreshedToken) {
        ({ response, payload } = await fetchJsonWithTimeout(endpoint.toString(), {
          headers: { Authorization: `Bearer ${refreshedToken.accessToken}`, Accept: 'application/json' }
        }, 'spotify_playlist'));
      }
    }
    if (!response.ok || !Array.isArray(payload?.items)) {
      throw new SpotifyPlaylistImportError(`spotify_playlist_http_${response.status}`, spotifyErrorMessage(response));
    }
    total = Number(payload.total);
    if (!Number.isFinite(total) || total < 0) {
      throw new SpotifyPlaylistImportError('spotify_playlist_invalid_response', 'Spotify returned an unreadable playlist.');
    }
    if (total > MAX_PLAYLIST_ITEMS) {
      throw new SpotifyPlaylistImportError('spotify_playlist_too_large', `This playlist exceeds the ${MAX_PLAYLIST_ITEMS.toLocaleString()} item import limit.`);
    }
    for (const entry of payload.items) {
      const item = entry?.item || entry?.track || entry?.episode || null;
      const type = String(item?.type || '').toLowerCase();
      const itemId = String(item?.id || '').trim();
      if (!['track', 'episode'].includes(type) || !/^[A-Za-z0-9]{10,64}$/.test(itemId)) continue;
      const key = `${type}:${itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        url: `https://open.spotify.com/${type}/${itemId}`,
        title: String(item?.name || '').trim(),
        type: type === 'episode' ? 'audio' : 'audio',
        provider: 'spotify',
        providerLabel: 'Spotify',
        itemId,
        itemType: type,
        playlistId
      });
    }
    if (!payload.items.length) break;
    offset += payload.items.length;
  }
  if (!links.length) {
    throw new SpotifyPlaylistImportError('spotify_playlist_empty', 'Spotify returned no shareable tracks or episodes for this playlist.');
  }
  return links;
}
