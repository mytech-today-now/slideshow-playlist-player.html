import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  availablePlaylistProviders,
  exchangeProviderOAuthCode,
  fetchPlaylistItems,
  PlaylistProviderError,
  providerOAuthCredentials
} from './providers.mjs';
import { createProfileSyncApi } from './profile-sync.mjs';

const { Pool } = pg;

const serverDirectory = fileURLToPath(new URL('.', import.meta.url));
const distDirectory = resolve(serverDirectory, '..', 'dist');
const MAX_BODY_BYTES = 8192;
const REQUESTS_PER_WINDOW = 30;
const RATE_WINDOW_MS = 60_000;
const rateLimits = new Map();
const rawBasePath = String(process.env.BLEND_BASE_PATH || '').trim().replace(/\/+$/, '');
if (rawBasePath && (!rawBasePath.startsWith('/') || rawBasePath.includes('..') || rawBasePath.includes('\\'))) {
  throw new Error('BLEND_BASE_PATH must be a safe absolute URL path.');
}
const BASE_PATH = rawBasePath;
const API_PATH = BASE_PATH + '/api/playlist-import';
const OAUTH_PATH = API_PATH + '/oauth';
const ROUTE_API_PATH = '/api/playlist-import';
const ROUTE_OAUTH_PATH = ROUTE_API_PATH + '/oauth';
const SESSION_COOKIE = 'blend_playlist_session_v1';
const STATE_COOKIE = 'blend_playlist_oauth_state_v1';
const configuredOrigins = new Set(
  `${process.env.BLEND_PLAYLIST_ALLOWED_ORIGINS || ''},${process.env.BLEND_PROFILE_SYNC_ALLOWED_ORIGINS || ''}`
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const profileSyncPool = process.env.DATABASE_URL
  ? new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    application_name: 'blend-profile-sync'
  })
  : null;
const profileSyncApi = createProfileSyncApi({ pool: profileSyncPool });
const contentTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
});

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sameOriginForRequest(request) {
  const host = String(request.headers.host || '');
  if (!host || /[\s/\\]/.test(host)) return '';
  const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const protocol = forwardedProtocol === 'https' ? 'https' : 'http';
  return protocol + '://' + host.toLowerCase();
}

function validateOrigin(request) {
  const origin = String(request.headers.origin || '').trim();
  if (!origin) return { ok: true, headers: {} };
  let parsed;
  try { parsed = new URL(origin); } catch (_) { return { ok: false, headers: {} }; }
  if (parsed.origin !== origin || !['https:', 'http:'].includes(parsed.protocol)) {
    return { ok: false, headers: {} };
  }
  const sameOrigin = origin === sameOriginForRequest(request);
  if (!sameOrigin && !configuredOrigins.has(origin)) return { ok: false, headers: {} };
  if (sameOrigin) return { ok: true, headers: {} };
  return {
    ok: true,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, LOCK, UNLOCK, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, Lock-Token, X-Blend-CSRF',
      'Access-Control-Expose-Headers': 'DAV, Lock-Token, Timeout',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin'
    }
  };
}

function clientAddress(request) {
  if (process.env.BLEND_PLAYLIST_TRUST_PROXY === '1') {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded && forwarded.length <= 128) return forwarded;
  }
  return String(request.socket.remoteAddress || 'unknown').slice(0, 128);
}

function checkRateLimit(request) {
  const now = Date.now();
  const address = clientAddress(request);
  const current = rateLimits.get(address);
  if (!current || current.expiresAt <= now) {
    rateLimits.set(address, { count: 1, expiresAt: now + RATE_WINDOW_MS });
    if (rateLimits.size > 20_000) {
      for (const [key, value] of rateLimits) {
        if (value.expiresAt <= now) rateLimits.delete(key);
      }
    }
    return true;
  }
  if (current.count >= REQUESTS_PER_WINDOW) return false;
  current.count++;
  return true;
}

function sessionKey() {
  const secret = String(process.env.BLEND_PLAYLIST_SESSION_SECRET || '');
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new PlaylistProviderError(
      'playlist_session_secret_missing',
      'Playlist account sign-in is not configured on this Blend server.',
      503
    );
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

function seal(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final()
  ]);
  return 'v1.' + iv.toString('base64url') + '.'
    + cipher.getAuthTag().toString('base64url') + '.'
    + encrypted.toString('base64url');
}

function unseal(value) {
  try {
    const parts = String(value || '').split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      sessionKey(),
      Buffer.from(parts[1], 'base64url')
    );
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    const clear = Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64url')),
      decipher.final()
    ]).toString('utf8');
    return JSON.parse(clear);
  } catch (_) {
    return null;
  }
}

function requestCookies(request) {
  const parsed = new Map();
  for (const part of String(request.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    parsed.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return parsed;
}

function cookieHeader(name, value, request, path, maxAge) {
  const secure = sameOriginForRequest(request).startsWith('https://');
  const attributes = [
    name + '=' + value,
    'HttpOnly',
    'Path=' + path,
    'SameSite=' + (secure ? 'None' : 'Lax')
  ];
  if (secure) attributes.push('Secure');
  if (Number.isFinite(maxAge)) attributes.push('Max-Age=' + String(Math.max(0, Math.floor(maxAge))));
  return attributes.join('; ');
}

function clearCookieHeader(name, request, path) {
  return cookieHeader(name, '', request, path, 0);
}

function getProtectedCookie(request, name) {
  const value = requestCookies(request).get(name);
  return value ? unseal(value) : null;
}

function requestPath(request) {
  let pathname;
  try {
    pathname = typeof request === 'string'
      ? new URL(request, 'http://localhost').pathname
      : new URL(request.url || '/', 'http://localhost').pathname;
  } catch (_) { return null; }
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH || pathname === BASE_PATH + '/') return '/';
  if (!pathname.startsWith(BASE_PATH + '/')) return null;
  return pathname.slice(BASE_PATH.length);
}

function safeReturnUrl(value, request) {
  const raw = String(value || '');
  if (!raw || raw.length > 2048 || raw.includes('\\') || /(?:^|\/)\.\.(?:\/|$)/.test(raw)) return '';
  let target;
  try { target = new URL(raw); } catch (_) { return ''; }
  if (!['https:', 'http:'].includes(target.protocol)
      || target.username || target.password || target.search || target.hash) return '';
  const sameOrigin = target.origin === sameOriginForRequest(request);
  if (!sameOrigin && !configuredOrigins.has(target.origin)) return '';
  return target.origin + target.pathname;
}

function returnUrlWithStatus(returnUrl, status) {
  const target = new URL(returnUrl);
  target.searchParams.set('playlist_oauth', status);
  return target.toString();
}

function appendCookies(response, cookies) {
  response.setHeader('Set-Cookie', cookies);
}

function oauthProviderIsConfigured(provider) {
  const credentials = providerOAuthCredentials(provider);
  return !!(credentials.clientId && credentials.clientSecret
    && Buffer.byteLength(String(process.env.BLEND_PLAYLIST_SESSION_SECRET || ''), 'utf8') >= 32);
}

function oauthCallbackUrl(request, provider) {
  return sameOriginForRequest(request) + OAUTH_PATH + '/' + provider + '/callback';
}

function oauthAuthorizationUrl(provider, credentials, redirectUri, state, verifier) {
  if (provider === 'vimeo') {
    const target = new URL('https://api.vimeo.com/oauth/authorize');
    target.search = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      state,
      scope: 'public private'
    }).toString();
    return target.toString();
  }
  if (provider === 'soundcloud') {
    const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
    const target = new URL('https://secure.soundcloud.com/authorize');
    target.search = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state
    }).toString();
    return target.toString();
  }
  if (provider === 'dailymotion') {
    const target = new URL('https://api.dailymotion.com/oauth/authorize');
    target.search = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      scope: 'playlist.read',
      state
    }).toString();
    return target.toString();
  }
  return '';
}

function redirectResponse(response, target, cookies = []) {
  response.writeHead(302, {
    'Cache-Control': 'no-store',
    Location: target,
    ...(cookies.length ? { 'Set-Cookie': cookies } : {})
  });
  response.end();
}

async function startOAuth(request, response, provider, requestUrl) {
  if (!oauthProviderIsConfigured(provider)) {
    sendJson(response, 503, { error: { code: 'playlist_provider_not_configured', message: 'This provider sign-in is not configured on the Blend server.' } });
    return;
  }
  const returnTo = safeReturnUrl(requestUrl.searchParams.get('return_to'), request);
  if (!returnTo) {
    sendJson(response, 400, { error: { code: 'playlist_oauth_return_url_invalid', message: 'The playlist sign-in return address is not allowed.' } });
    return;
  }
  const credentials = providerOAuthCredentials(provider);
  const redirectUri = oauthCallbackUrl(request, provider);
  const state = randomBytes(32).toString('base64url');
  const verifier = provider === 'soundcloud' ? randomBytes(48).toString('base64url') : '';
  const authorizationUrl = oauthAuthorizationUrl(provider, credentials, redirectUri, state, verifier);
  if (!authorizationUrl) {
    sendJson(response, 400, { error: { code: 'playlist_provider_not_supported', message: 'This provider sign-in is not supported.' } });
    return;
  }
  const transaction = seal({ provider, state, verifier, redirectUri, returnTo, issuedAt: Date.now() });
  redirectResponse(response, authorizationUrl, [
    cookieHeader(STATE_COOKIE, transaction, request, OAUTH_PATH, 600)
  ]);
}

async function finishOAuth(request, response, provider, requestUrl) {
  const transaction = getProtectedCookie(request, STATE_COOKIE);
  const state = String(requestUrl.searchParams.get('state') || '');
  const code = String(requestUrl.searchParams.get('code') || '');
  const providerError = String(requestUrl.searchParams.get('error') || '');
  const clearState = clearCookieHeader(STATE_COOKIE, request, OAUTH_PATH);
  if (!transaction || transaction.provider !== provider
      || !transaction.state || transaction.state !== state
      || Date.now() - Number(transaction.issuedAt || 0) > 10 * 60_000) {
    const returnTo = safeReturnUrl(transaction?.returnTo, request);
    if (returnTo) {
      redirectResponse(response, returnUrlWithStatus(returnTo, 'error'), [clearState]);
      return;
    }
    sendJson(response, 400, { error: { code: 'playlist_oauth_state_invalid', message: 'Playlist provider sign-in could not be verified.' } }, { 'Set-Cookie': clearState });
    return;
  }
  if (providerError || !code) {
    redirectResponse(response, returnUrlWithStatus(transaction.returnTo, 'cancelled'), [clearState]);
    return;
  }

  try {
    const token = await exchangeProviderOAuthCode(
      provider,
      code,
      transaction.redirectUri,
      transaction.verifier
    );
    const session = {
      provider,
      accessToken: token.accessToken,
      expiresAt: Date.now() + token.expiresIn * 1000
    };
    const encryptedSession = seal(session);
    redirectResponse(response, returnUrlWithStatus(transaction.returnTo, 'connected'), [
      clearState,
      cookieHeader(SESSION_COOKIE, encryptedSession, request, API_PATH)
    ]);
  } catch (error) {
    const returnTo = safeReturnUrl(transaction.returnTo, request);
    if (returnTo) {
      redirectResponse(response, returnUrlWithStatus(returnTo, 'error'), [clearState]);
      return;
    }
    const providerErrorResult = error instanceof PlaylistProviderError
      ? error
      : new PlaylistProviderError('playlist_oauth_failed', 'Playlist provider sign-in could not be completed.', 502);
    sendJson(response, providerErrorResult.status, {
      error: { code: providerErrorResult.code, message: providerErrorResult.message }
    }, { 'Set-Cookie': clearState });
  }
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new PlaylistProviderError('playlist_request_too_large', 'The playlist request is too large.', 413);
  }
  const chunks = [];
  let byteCount = 0;
  for await (const chunk of request) {
    byteCount += chunk.length;
    if (byteCount > MAX_BODY_BYTES) {
      throw new PlaylistProviderError('playlist_request_too_large', 'The playlist request is too large.', 413);
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {
    throw new PlaylistProviderError('playlist_request_invalid', 'The playlist request must contain valid JSON.', 400);
  }
}

async function serveStatic(request, response, pathname) {
  let relativePath;
  try { relativePath = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch (_) {
    response.writeHead(400);
    response.end();
    return;
  }
  if (!relativePath) relativePath = 'index.html';
  if (relativePath.endsWith('/')) relativePath += 'index.html';
  const filePath = resolve(distDirectory, relativePath);
  if (filePath !== distDirectory && !filePath.startsWith(distDirectory + sep)) {
    response.writeHead(404);
    response.end();
    return;
  }

  try {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error('not-file');
    const contentType = contentTypes[extname(filePath).toLowerCase()];
    if (!contentType) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': fileInfo.size,
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch (_) {
    if (response.headersSent) return;
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

async function handleOAuthRoute(request, response, pathname, requestUrl, originHeaders) {
  if (pathname === ROUTE_OAUTH_PATH + '/status' && request.method === 'GET') {
    const session = getProtectedCookie(request, SESSION_COOKIE);
    const connectedProvider = session?.accessToken && Number(session.expiresAt) > Date.now()
      ? String(session.provider || '')
      : '';
    sendJson(response, 200, {
      configured: availablePlaylistProviders(),
      oauthProviders: ['vimeo', 'soundcloud', 'dailymotion'].filter(oauthProviderIsConfigured),
      connectedProvider
    }, originHeaders);
    return true;
  }
  if (pathname === ROUTE_OAUTH_PATH + '/disconnect' && request.method === 'POST') {
    sendJson(response, 200, { ok: true }, {
      ...originHeaders,
      'Set-Cookie': clearCookieHeader(SESSION_COOKIE, request, API_PATH)
    });
    return true;
  }

  const route = pathname.match(/^\/api\/playlist-import\/oauth\/(vimeo|soundcloud|dailymotion)\/(start|callback)$/);
  if (!route) return false;
  const provider = route[1];
  if (route[2] === 'start' && request.method === 'GET') {
    await startOAuth(request, response, provider, requestUrl);
    return true;
  }
  if (route[2] === 'callback' && request.method === 'GET') {
    await finishOAuth(request, response, provider, requestUrl);
    return true;
  }
  sendJson(response, 405, { error: { code: 'playlist_oauth_method_invalid', message: 'This playlist sign-in route does not accept that method.' } }, { Allow: 'GET' });
  return true;
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url || '/', 'http://localhost');
  if (requestUrl.pathname === '/healthz' || requestPath(request) === '/healthz') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    sendJson(response, 200, { ok: true, ...profileSyncApi.health() });
    return;
  }
  const pathname = requestPath(request);
  if (pathname == null) {
    response.writeHead(404);
    response.end();
    return;
  }

  if (pathname.startsWith('/api/')) {
    const origin = validateOrigin(request);
    if (!origin.ok) {
      sendJson(response, 403, { error: { code: 'origin_not_allowed', message: 'This app origin is not allowed to use the playlist API.' } });
      return;
    }
    if (origin.headers.Vary) response.setHeader('Vary', origin.headers.Vary);
    for (const [name, value] of Object.entries(origin.headers)) response.setHeader(name, value);
    if (await profileSyncApi.route(request, response, pathname)) return;
    if (request.method === 'OPTIONS') {
      response.writeHead(204, origin.headers);
      response.end();
      return;
    }
    if (await handleOAuthRoute(request, response, pathname, requestUrl, origin.headers)) return;

    if (pathname === ROUTE_API_PATH + '/providers' && request.method === 'GET') {
      sendJson(response, 200, { providers: availablePlaylistProviders() }, origin.headers);
      return;
    }
    if (pathname !== ROUTE_API_PATH || request.method !== 'POST') {
      sendJson(response, 404, { error: { code: 'api_route_not_found', message: 'The playlist API route was not found.' } }, origin.headers);
      return;
    }
    if (!checkRateLimit(request)) {
      sendJson(response, 429, { error: { code: 'playlist_rate_limited', message: 'The playlist import service is temporarily rate limited. Try again shortly.' } }, origin.headers);
      return;
    }
    const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      sendJson(response, 415, { error: { code: 'playlist_content_type_invalid', message: 'The playlist API accepts JSON requests only.' } }, origin.headers);
      return;
    }
    try {
      const body = await readJsonBody(request);
      const provider = String(body?.provider || '');
      const url = String(body?.url || '');
      const encryptedSession = getProtectedCookie(request, SESSION_COOKIE);
      const accessToken = encryptedSession?.provider === provider
        && Number(encryptedSession.expiresAt) > Date.now()
        ? String(encryptedSession.accessToken || '')
        : '';
      const items = await fetchPlaylistItems(provider, url, accessToken);
      sendJson(response, 200, { items }, origin.headers);
    } catch (error) {
      const providerError = error instanceof PlaylistProviderError
        ? error
        : new PlaylistProviderError('playlist_provider_unavailable', 'The playlist provider could not be reached.', 502);
      console.warn('Playlist provider import failed: ' + providerError.code);
      sendJson(response, providerError.status, {
        error: { code: providerError.code, message: providerError.message }
      }, origin.headers);
    }
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  await serveStatic(request, response, pathname);
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, 500, { error: { code: 'server_error', message: 'The Blend server could not complete this request.' } });
  });
});

server.requestTimeout = 20_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
const port = Number(process.env.PORT || 4173);
server.listen(port, '0.0.0.0', () => {
  console.log('Blend server listening on port ' + port);
});
const profileSyncRetryTimer = setInterval(() => {
  void profileSyncApi.processDueOutbox().catch(() => {});
}, 15_000);
profileSyncRetryTimer.unref();
