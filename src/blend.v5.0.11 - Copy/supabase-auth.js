const DEFAULT_STORAGE_KEY = 'blend-supabase-auth-session-v2';
const LEGACY_STORAGE_KEY = 'blend-supabase-auth-session-v1';
const LOCAL_RESET_CHANNEL_NAME = 'blend-supabase-auth-local-reset-v1';
const LOCAL_RESET_DISCOVERY_WINDOW_MS = 100;
const LOCAL_RESET_ACK_TIMEOUT_MS = 1500;
const REFRESH_BUFFER_SECONDS = 75;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REFRESH_RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000, 8_000, 16_000]);

export class SupabaseAuthError extends Error {
  constructor(message, { code = 'auth_error', status = 0, retryable = false, cause = null } = {}) {
    super(message || 'Authentication failed');
    this.name = 'SupabaseAuthError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

function createLocalNonce() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch (_) {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeSession(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const accessToken = String(payload.access_token || payload.accessToken || '').trim();
  const refreshToken = String(payload.refresh_token || payload.refreshToken || '').trim();
  const expiresIn = Number(payload.expires_in || payload.expiresIn || 0);
  const expiresAt = Number(payload.expires_at || payload.expiresAt || 0);
  const computedExpiresAt = Number.isFinite(expiresAt) && expiresAt > 0
    ? Math.floor(expiresAt)
    : (Number.isFinite(expiresIn) && expiresIn > 0 ? nowInSeconds() + Math.floor(expiresIn) : 0);
  if (!accessToken) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: String(payload.token_type || payload.tokenType || 'bearer'),
    expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? Math.floor(expiresIn) : Math.max(1, computedExpiresAt - nowInSeconds()),
    expires_at: computedExpiresAt,
    user: payload.user && typeof payload.user === 'object' ? payload.user : null
  };
}

function parseAuthHash(hash = '') {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (!params.has('access_token')) return null;
  const session = normalizeSession({
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
    expires_in: params.get('expires_in'),
    token_type: params.get('token_type')
  });
  return session;
}

function removeSensitiveAuthHash() {
  if (!globalThis.history?.replaceState || !globalThis.location) return;
  try {
    const current = new URL(globalThis.location.href);
    current.hash = '';
    globalThis.history.replaceState(globalThis.history.state, '', current.toString());
  } catch (_) {}
}

function isSessionExpiring(session, bufferSeconds = REFRESH_BUFFER_SECONDS) {
  if (!session?.expires_at) return false;
  return session.expires_at <= (nowInSeconds() + Math.max(0, Number(bufferSeconds) || 0));
}

function describeAuthFailure(payload, status, friendlyCode) {
  if (friendlyCode === 'auth_sign_in_failed') {
    const errorCode = String(payload?.error_code || '').toLowerCase();
    const providerMessage = String(payload?.msg || payload?.error_description || payload?.error || '');
    if (errorCode === 'invalid_credentials' || /invalid login credentials/i.test(providerMessage)) {
      return 'Invalid login credentials. Use an email/password Auth user from this project (Supabase Authentication > Users).';
    }
  }
  if (friendlyCode === 'auth_refresh_failed') return `Supabase Auth refresh failed (HTTP ${status}).`;
  return `Supabase Auth request failed (HTTP ${status}).`;
}

function isTerminalRefreshRejection(payload, status) {
  if (status !== 400) return false;
  const errorCode = String(payload?.error_code || payload?.code || payload?.error || '').trim().toLowerCase();
  if (['refresh_token_not_found', 'refresh_token_already_used'].includes(errorCode)) {
    return true;
  }
  const providerMessage = String(payload?.msg || payload?.error_description || payload?.message || '');
  return /invalid refresh token|refresh token (?:not found|already used|revoked|invalid)/i.test(providerMessage);
}

function decodeBase64Url(value = '') {
  const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLen = raw.length % 4 === 0 ? 0 : (4 - (raw.length % 4));
  const padded = raw + '='.repeat(padLen);
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(padded);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  return '';
}

function parseJwtClaims(token = '') {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = decodeBase64Url(parts[1]);
    if (!payload) return null;
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function createSupabaseAuthClient({
  supabaseUrl,
  supabaseAnonKey,
  authRedirectUrl = '',
  storage,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storageKey = DEFAULT_STORAGE_KEY,
  logger = null,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  refreshRetryDelaysMs = DEFAULT_REFRESH_RETRY_DELAYS_MS,
  setTimeoutImpl = globalThis.setTimeout.bind(globalThis),
  clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis),
  broadcastChannelImpl = typeof globalThis.window === 'object' ? globalThis.BroadcastChannel : null
} = {}) {
  const listeners = new Set();
  let session = null;
  let persistenceEnabled = false;
  let bootstrapPromise = null;
  let refreshTimer = null;
  let refreshPromise = null;
  let refreshRequestController = null;
  let sessionGeneration = 0;
  let retryAttempt = 0;
  let authStatus = { state: 'signed-out', code: 'auth_signed_out' };
  const tabNonce = createLocalNonce();
  const peerTabNonces = new Set();
  const pendingLocalResets = new Map();
  let localResetChannel = null;
  let authLifecycleListenersBound = false;

  function getStorage() {
    if (storage !== undefined) return storage;
    try { return globalThis.localStorage || null; } catch (_) { return null; }
  }

  function emit(event) {
    for (const listener of listeners) {
      try { listener({ event, session, status: { ...authStatus } }); } catch (_) {}
    }
  }

  function setAuthStatus(state, code) {
    authStatus = { state, code };
    emit('AUTH_STATUS_CHANGED');
  }

  function logDebug(message, context = null) {
    if (!logger?.info) return;
    logger.info(message, context || {});
  }

  function clearRefreshTimer() {
    if (refreshTimer === null) return;
    clearTimeoutImpl(refreshTimer);
    refreshTimer = null;
  }

  function abortRefreshRequest() {
    const controller = refreshRequestController;
    refreshRequestController = null;
    try { controller?.abort(); } catch (_) {}
  }

  function refreshRetryDelays() {
    if (!Array.isArray(refreshRetryDelaysMs)) return DEFAULT_REFRESH_RETRY_DELAYS_MS;
    return refreshRetryDelaysMs
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 0);
  }

  function safeErrorCode(error) {
    const candidate = String(error?.code || 'auth_refresh_unexpected');
    return /^[a-z][a-z0-9_]{1,63}$/i.test(candidate) ? candidate : 'auth_refresh_unexpected';
  }

  function scheduleRetryRefresh(generation) {
    const delays = refreshRetryDelays();
    if (!session?.refresh_token || generation !== sessionGeneration || retryAttempt >= delays.length) return;
    clearRefreshTimer();
    const delayMs = Math.min(30_000, delays[retryAttempt++]);
    refreshTimer = setTimeoutImpl(() => {
      refreshTimer = null;
      if (generation !== sessionGeneration || !session?.refresh_token) return;
      void refreshSession({ automatic: true }).catch(error => {
        logDebug('[auth] refresh failed', { code: safeErrorCode(error) });
      });
    }, delayMs);
  }

  function storageFailure(message = 'Could not update the saved Supabase session in this browser.') {
    return new SupabaseAuthError(message, {
      code: 'auth_session_storage_failed',
      retryable: false
    });
  }

  function persistSession(nextSession) {
    const target = getStorage();
    if (!target) {
      if (!nextSession) return true;
      throw storageFailure('Could not save the Supabase session in this browser.');
    }
    if (typeof target.removeItem !== 'function' || (nextSession && typeof target.setItem !== 'function')) {
      throw storageFailure(nextSession
        ? 'Could not save the Supabase session in this browser.'
        : 'Could not remove the saved Supabase session from this browser.');
    }
    try {
      // Clear any earlier entry before writing so a failed write cannot leave an
      // old refresh token available for restoration on a later reload.
      target.removeItem(storageKey);
      target.removeItem(LEGACY_STORAGE_KEY);
      if (nextSession) {
        target.setItem(storageKey, JSON.stringify({
          access_token: nextSession.access_token,
          refresh_token: nextSession.refresh_token,
          expires_at: nextSession.expires_at
        }));
      }
      return true;
    } catch (_) {
      throw storageFailure(nextSession
        ? 'Could not save the Supabase session in this browser.'
        : 'Could not remove the saved Supabase session from this browser.');
    }
  }

  function clearLegacySession() {
    const target = getStorage();
    if (!target || typeof target.removeItem !== 'function') return false;
    try {
      target.removeItem(LEGACY_STORAGE_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    if (!session?.refresh_token || !session?.expires_at) return;
    const delayMs = Math.max(1000, (session.expires_at - nowInSeconds() - REFRESH_BUFFER_SECONDS) * 1000);
    const generation = sessionGeneration;
    refreshTimer = setTimeoutImpl(() => {
      refreshTimer = null;
      if (generation !== sessionGeneration || !session?.refresh_token) return;
      void refreshSession().catch(error => {
        logDebug('[auth] refresh failed', { code: safeErrorCode(error) });
      });
    }, delayMs);
  }

  function setSession(nextSession, { persist = persistenceEnabled, event = 'SESSION_UPDATED' } = {}) {
    abortRefreshRequest();
    const normalized = normalizeSession(nextSession);
    if (persist) {
      try {
        persistSession(normalized);
      } catch (error) {
        session = null;
        sessionGeneration += 1;
        retryAttempt = 0;
        persistenceEnabled = false;
        clearRefreshTimer();
        try { persistSession(null); } catch (_) {}
        authStatus = { state: 'signed-out', code: 'auth_signed_out' };
        emit('SIGNED_OUT');
        throw error;
      }
    }
    session = normalized;
    sessionGeneration += 1;
    retryAttempt = 0;
    authStatus = normalized
      ? { state: 'ready', code: 'auth_session_ready' }
      : { state: 'signed-out', code: 'auth_signed_out' };
    scheduleRefresh();
    emit(event);
    return session;
  }

  function clearSession({ persist = persistenceEnabled, event = 'SIGNED_OUT' } = {}) {
    abortRefreshRequest();
    session = null;
    sessionGeneration += 1;
    retryAttempt = 0;
    clearRefreshTimer();
    if (persist) {
      try { persistSession(null); } catch (_) {}
    }
    persistenceEnabled = false;
    authStatus = { state: 'signed-out', code: 'auth_signed_out' };
    emit(event);
  }

  function clearLocalSession() {
    abortRefreshRequest();
    session = null;
    sessionGeneration += 1;
    retryAttempt = 0;
    clearRefreshTimer();

    let storageError = null;
    const target = getStorage();
    try {
      if (!target) {
        if (persistenceEnabled) throw new Error('Storage is unavailable');
      } else if (typeof target.removeItem !== 'function') {
        throw new Error('Storage removal is unavailable');
      } else {
        target.removeItem(storageKey);
        target.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch (_) {
      storageError = true;
    }

    persistenceEnabled = false;
    authStatus = { state: 'signed-out', code: 'auth_signed_out' };
    emit('SIGNED_OUT');
    if (storageError) {
      throw new SupabaseAuthError('Could not remove the saved Supabase session from this browser.', {
        code: 'auth_local_clear_failed',
        retryable: false
      });
    }
    return true;
  }

  function postAuthTabMessage(type, nonce) {
    if (!localResetChannel) return false;
    try {
      localResetChannel.postMessage({ type, nonce: String(nonce || '') });
      return true;
    } catch (_) {
      return false;
    }
  }

  function finishPendingLocalReset(nonce, confirmed) {
    const pending = pendingLocalResets.get(nonce);
    if (!pending || pending.settled) return;
    pending.settled = true;
    if (pending.timer !== null) clearTimeoutImpl(pending.timer);
    if (pending.discoveryTimer !== null) clearTimeoutImpl(pending.discoveryTimer);
    const resolveDiscovery = pending.resolveDiscovery;
    pending.resolveDiscovery = null;
    resolveDiscovery?.();
    pendingLocalResets.delete(nonce);
    pending.resolve({
      confirmed,
      expectedPeerCount: pending.expectedPeers.size,
      acknowledgedPeerCount: pending.acknowledgedPeers.size
    });
  }

  function maybeFinishPendingLocalReset(nonce) {
    const pending = pendingLocalResets.get(nonce);
    if (!pending || pending.phase !== 'resetting') return;
    if (pending.acknowledgedPeers.size >= pending.expectedPeers.size) {
      finishPendingLocalReset(nonce, true);
    }
  }

  function handleAuthTabMessage(event) {
    const message = event?.data;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const keys = Object.keys(message);
    if (keys.length !== 2 || !keys.includes('type') || !keys.includes('nonce')) return;
    const type = String(message.type || '');
    const nonce = String(message.nonce || '');
    if (!nonce || nonce.length > 256) return;

    if (type === 'tab-open') {
      if (nonce === tabNonce || peerTabNonces.has(nonce)) return;
      peerTabNonces.add(nonce);
      postAuthTabMessage('tab-open', tabNonce);
      for (const [resetNonce, pending] of pendingLocalResets) {
        pending.expectedPeers.add(nonce);
        if (pending.phase === 'resetting') postAuthTabMessage('local-reset', resetNonce);
      }
      return;
    }

    if (type === 'tab-close') {
      peerTabNonces.delete(nonce);
      for (const [resetNonce, pending] of pendingLocalResets) {
        pending.expectedPeers.delete(nonce);
        maybeFinishPendingLocalReset(resetNonce);
      }
      return;
    }

    if (type === 'local-reset') {
      try {
        clearLocalSession();
      } catch (_) {
        return;
      }
      postAuthTabMessage('local-reset-ack', `${nonce}:${tabNonce}`);
      return;
    }

    if (type === 'tab-probe') {
      postAuthTabMessage('tab-probe-ack', `${nonce}:${tabNonce}`);
      return;
    }

    if (type === 'tab-probe-ack') {
      for (const [resetNonce, pending] of pendingLocalResets) {
        const prefix = `${resetNonce}:`;
        if (!nonce.startsWith(prefix)) continue;
        const peerNonce = nonce.slice(prefix.length);
        if (peerNonce && peerNonce !== tabNonce) {
          peerTabNonces.add(peerNonce);
          pending.expectedPeers.add(peerNonce);
        }
        return;
      }
      return;
    }

    if (type !== 'local-reset-ack') return;
    for (const [resetNonce, pending] of pendingLocalResets) {
      const prefix = `${resetNonce}:`;
      if (!nonce.startsWith(prefix)) continue;
      const peerNonce = nonce.slice(prefix.length);
      if (pending.expectedPeers.has(peerNonce)) pending.acknowledgedPeers.add(peerNonce);
      maybeFinishPendingLocalReset(resetNonce);
      return;
    }
  }

  function startAuthCoordination() {
    if (localResetChannel) return true;
    if (typeof broadcastChannelImpl !== 'function') return false;

    let channel = null;
    try {
      channel = new broadcastChannelImpl(`${LOCAL_RESET_CHANNEL_NAME}:${storageKey}`);
      if (typeof channel.addEventListener === 'function') {
        channel.addEventListener('message', handleAuthTabMessage);
      } else {
        channel.onmessage = handleAuthTabMessage;
      }
      localResetChannel = channel;
      if (!postAuthTabMessage('tab-open', tabNonce)) throw new Error('Could not announce this tab.');
      if (!authLifecycleListenersBound && typeof globalThis.addEventListener === 'function') {
        globalThis.addEventListener('pagehide', handleAuthPageHide);
        globalThis.addEventListener('pageshow', handleAuthPageShow);
        authLifecycleListenersBound = true;
      }
      return true;
    } catch (_) {
      try { channel?.close?.(); } catch (_) {}
      if (localResetChannel === channel) localResetChannel = null;
      return false;
    }
  }

  function handleAuthPageHide(event) {
    // A page in the back/forward cache can resume with its in-memory session.
    // Keep it counted as a peer so another tab's reset fails closed while it is suspended.
    shutdown({ announceDeparture: event?.persisted !== true });
  }

  function handleAuthPageShow() {
    startAuthCoordination();
    if (session?.refresh_token) scheduleRefresh();
  }

  async function clearLocalSessionAcrossTabs({ timeoutMs = LOCAL_RESET_ACK_TIMEOUT_MS } = {}) {
    let localClearError = null;
    try {
      clearLocalSession();
    } catch (error) {
      localClearError = error;
    }

    if (!startAuthCoordination()) {
      return { confirmed: false, expectedPeerCount: peerTabNonces.size, acknowledgedPeerCount: 0 };
    }

    const nonce = createLocalNonce();
    const pending = {
      expectedPeers: new Set(peerTabNonces),
      acknowledgedPeers: new Set(),
      phase: 'probing',
      discoveryTimer: null,
      resolveDiscovery: null,
      timer: null,
      settled: false,
      resolve: null
    };
    const resultPromise = new Promise(resolve => { pending.resolve = resolve; });
    pendingLocalResets.set(nonce, pending);

    if (!postAuthTabMessage('tab-probe', nonce)) {
      finishPendingLocalReset(nonce, false);
    } else {
      await new Promise(resolve => {
        pending.resolveDiscovery = resolve;
        pending.discoveryTimer = setTimeoutImpl(() => {
          pending.discoveryTimer = null;
          pending.resolveDiscovery = null;
          resolve();
        }, LOCAL_RESET_DISCOVERY_WINDOW_MS);
      });
    }

    if (pending.settled) return resultPromise;

    const requestedTimeout = Number(timeoutMs);
    const boundedTimeout = Number.isFinite(requestedTimeout)
      ? Math.max(0, Math.min(5000, requestedTimeout))
      : LOCAL_RESET_ACK_TIMEOUT_MS;
    pending.phase = 'resetting';
    pending.timer = setTimeoutImpl(() => finishPendingLocalReset(nonce, false), boundedTimeout);
    if (!postAuthTabMessage('local-reset', nonce)) {
      finishPendingLocalReset(nonce, false);
    } else {
      maybeFinishPendingLocalReset(nonce);
    }

    const result = await resultPromise;
    if (result.confirmed && localClearError) throw localClearError;
    return result;
  }

  function readStoredSession() {
    const target = getStorage();
    if (!target) return { session: null, unavailable: true };
    if (typeof target.getItem !== 'function') return { session: null, invalid: true };
    try {
      const raw = target.getItem(storageKey);
      if (!raw) return { session: null };
      const parsed = JSON.parse(raw);
      const normalized = normalizeSession(parsed);
      return normalized ? { session: normalized } : { session: null, invalid: true };
    } catch (_) {
      return { session: null, invalid: true };
    }
  }

  async function requestJson(url, init = {}, friendlyCode = 'auth_request_failed') {
    if (typeof fetchImpl !== 'function') {
      throw new SupabaseAuthError('Fetch is not available in this environment.', {
        code: 'fetch_unavailable',
        retryable: false
      });
    }
    const callerSignal = init.signal || null;
    if (callerSignal?.aborted) {
      throw new SupabaseAuthError('Supabase Auth request was cancelled.', {
        code: 'auth_request_cancelled',
        retryable: false
      });
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    let cancelled = false;
    let rejectTimeout;
    let rejectCancellation;
    const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
    const cancellationPromise = new Promise((_, reject) => { rejectCancellation = reject; });
    const timeoutMs = Math.max(1, Number(requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
    const cancellationError = new SupabaseAuthError('Supabase Auth request was cancelled.', {
      code: 'auth_request_cancelled',
      retryable: false
    });
    const onCallerAbort = () => {
      if (cancelled || timedOut) return;
      cancelled = true;
      try { controller?.abort(); } catch (_) {}
      rejectCancellation(cancellationError);
    };
    callerSignal?.addEventListener?.('abort', onCallerAbort, { once: true });
    const timeoutHandle = setTimeoutImpl(() => {
      if (cancelled || timedOut) return;
      timedOut = true;
      try { controller?.abort(); } catch (_) {}
      rejectTimeout(new SupabaseAuthError('Supabase Auth request timed out.', {
        code: 'auth_timeout',
        retryable: true
      }));
    }, timeoutMs);
    try {
      const requestInit = { ...init };
      if (controller) requestInit.signal = controller.signal;
      const response = await Promise.race([fetchImpl(url, requestInit), timeoutPromise, cancellationPromise]);
      if (!response || typeof response.text !== 'function' || typeof response.ok !== 'boolean') {
        throw new SupabaseAuthError('Supabase Auth returned an unexpected response.', {
          code: 'auth_unexpected_response',
          retryable: false
        });
      }
      const text = await Promise.race([
        Promise.resolve().then(() => response.text()).catch(() => ''),
        timeoutPromise,
        cancellationPromise
      ]);
      const payload = text ? (() => {
        try { return JSON.parse(text); } catch (_) { return null; }
      })() : null;
      if (!response.ok) {
        const terminal = friendlyCode === 'auth_refresh_failed' && isTerminalRefreshRejection(payload, response.status);
        const message = terminal
          ? 'The saved Supabase refresh token was rejected.'
          : describeAuthFailure(payload, response.status, friendlyCode);
        throw new SupabaseAuthError(message, {
          code: terminal ? 'auth_refresh_rejected' : friendlyCode,
          status: response.status,
          retryable: response.status >= 500 || response.status === 429
        });
      }
      return payload || {};
    } catch (cause) {
      if (cause instanceof SupabaseAuthError) throw cause;
      if (cancelled || callerSignal?.aborted) {
        throw cancellationError;
      }
      if (timedOut) {
        throw new SupabaseAuthError('Supabase Auth request timed out.', {
          code: 'auth_timeout',
          retryable: true,
          cause
        });
      }
      throw new SupabaseAuthError('Unable to reach Supabase Auth.', {
        code: 'auth_network_error',
        retryable: true,
        cause
      });
    } finally {
      clearTimeoutImpl(timeoutHandle);
      callerSignal?.removeEventListener?.('abort', onCallerAbort);
    }
  }

  async function bootstrap() {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      // Sessions written by the previous default-persistent version were not
      // an informed opt-in, so never restore them.
      clearLegacySession();

      const hashSession = parseAuthHash(globalThis.location?.hash || '');
      if (hashSession) {
        try {
          persistSession(null);
          persistenceEnabled = false;
          setSession(hashSession, { persist: false, event: 'SIGNED_IN' });
        } catch (_) {
          clearSession({ persist: false, event: 'INITIAL_SESSION' });
        }
        removeSensitiveAuthHash();
        return session;
      }

      const stored = readStoredSession();
      if (stored.invalid) {
        try { persistSession(null); } catch (_) {}
        clearSession({ persist: false, event: 'INITIAL_SESSION' });
        return null;
      }
      if (!stored.session) {
        clearSession({ persist: false, event: 'INITIAL_SESSION' });
        return null;
      }

      persistenceEnabled = true;
      setSession(stored.session, { persist: false, event: 'INITIAL_SESSION' });
      if (isSessionExpiring(session)) {
        if (session.refresh_token) {
          try {
            await refreshSession({ automatic: true });
          } catch (error) {
            logDebug('[auth] bootstrap refresh failed', { code: safeErrorCode(error) });
          }
        } else {
          clearSession({ persist: true, event: 'SIGNED_OUT' });
        }
      }
      return session;
    })();

    try {
      return await bootstrapPromise;
    } finally {
      bootstrapPromise = null;
    }
  }

  async function signInWithPassword({ email, password, persist = false, signal } = {}) {
    const cleanEmail = String(email || '').trim();
    const cleanPassword = String(password || '');
    if (!cleanEmail || !cleanPassword) {
      throw new SupabaseAuthError('Email and password are required.', {
        code: 'auth_invalid_credentials',
        retryable: false
      });
    }
    const url = `${String(supabaseUrl || '').replace(/\/+$/, '')}/auth/v1/token?grant_type=password`;
    const payload = await requestJson(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey
      },
      body: JSON.stringify({
        email: cleanEmail,
        password: cleanPassword
      })
    }, 'auth_sign_in_failed');
    const normalized = normalizeSession(payload);
    if (!normalized) {
      throw new SupabaseAuthError('Supabase Auth did not return a valid session.', {
        code: 'auth_invalid_session',
        retryable: false
      });
    }
    return activateSession(normalized, { persist, event: 'SIGNED_IN' });
  }

  function activateSession(nextSession, { persist = false, event = 'SIGNED_IN' } = {}) {
    persistenceEnabled = persist === true;
    if (!persistenceEnabled) {
      try {
        persistSession(null);
      } catch (error) {
        session = null;
        sessionGeneration += 1;
        retryAttempt = 0;
        clearRefreshTimer();
        persistenceEnabled = false;
        authStatus = { state: 'signed-out', code: 'auth_signed_out' };
        emit('SIGNED_OUT');
        throw error;
      }
    }
    return setSession(nextSession, { persist: persistenceEnabled, event });
  }

  async function signInWithApiToken({
    accessToken,
    refreshToken = '',
    expiresAt = 0,
    expiresIn = 0,
    persist = false
  } = {}) {
    const rawToken = String(accessToken || '').trim();
    const cleanToken = rawToken.replace(/^bearer\s+/i, '').trim();
    if (!cleanToken) {
      throw new SupabaseAuthError('API token is required.', {
        code: 'auth_invalid_token',
        retryable: false
      });
    }

    const claims = parseJwtClaims(cleanToken);
    const now = nowInSeconds();
    const parsedExpiresAt = Number(expiresAt);
    const parsedExpiresIn = Number(expiresIn);
    const claimExp = Number(claims?.exp || 0);
    const computedExpiresAt = Number.isFinite(parsedExpiresAt) && parsedExpiresAt > 0
      ? Math.floor(parsedExpiresAt)
      : (Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0
        ? now + Math.floor(parsedExpiresIn)
        : (Number.isFinite(claimExp) && claimExp > 0 ? Math.floor(claimExp) : 0));
    const normalized = normalizeSession({
      access_token: cleanToken,
      refresh_token: String(refreshToken || '').trim(),
      token_type: 'bearer',
      expires_at: computedExpiresAt || 0,
      expires_in: computedExpiresAt > 0 ? Math.max(1, computedExpiresAt - now) : 0,
      user: claims?.sub
        ? {
            id: String(claims.sub),
            email: String(claims.email || '').trim() || null
          }
        : null
    });
    if (!normalized) {
      throw new SupabaseAuthError('API token is invalid.', {
        code: 'auth_invalid_token',
        retryable: false
      });
    }
    return activateSession(normalized, { persist, event: 'SIGNED_IN' });
  }

  function refreshSession({ automatic = false, signal } = {}) {
    if (refreshPromise) return refreshPromise;
    if (!session?.refresh_token) {
      return Promise.reject(new SupabaseAuthError('No refresh token is available.', {
        code: 'auth_refresh_unavailable',
        retryable: false
      }));
    }
    if (!automatic) {
      clearRefreshTimer();
      retryAttempt = 0;
    }
    const generation = sessionGeneration;
    const previousStatus = { ...authStatus };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const onCallerAbort = () => {
      try { controller?.abort(); } catch (_) {}
    };
    if (signal?.aborted) onCallerAbort();
    else signal?.addEventListener?.('abort', onCallerAbort, { once: true });
    refreshRequestController = controller;
    setAuthStatus('refreshing', 'auth_refreshing');
    const url = `${String(supabaseUrl || '').replace(/\/+$/, '')}/auth/v1/token?grant_type=refresh_token`;
    const operation = (async () => {
      try {
        const payload = await requestJson(url, {
          method: 'POST',
          signal: controller?.signal || signal,
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey
          },
          body: JSON.stringify({
            refresh_token: session.refresh_token
          })
        }, 'auth_refresh_failed');
        if (generation !== sessionGeneration || !session?.refresh_token) return session;
        const normalized = normalizeSession(payload);
        if (!normalized) {
          throw new SupabaseAuthError('Supabase Auth returned an invalid refresh response.', {
            code: 'auth_invalid_refresh',
            retryable: false
          });
        }
        return setSession(normalized, { event: 'TOKEN_REFRESHED' });
      } catch (caught) {
        if (generation !== sessionGeneration || !session) return session;
        const error = caught instanceof SupabaseAuthError
          ? caught
          : new SupabaseAuthError('Supabase refresh could not be completed.', {
              code: 'auth_refresh_unexpected',
              retryable: false
            });
        if (error.code === 'auth_request_cancelled') {
          setAuthStatus(previousStatus.state, previousStatus.code);
        } else if (error.code === 'auth_refresh_rejected') {
          clearSession({ persist: true, event: 'SIGNED_OUT' });
        } else if (error.retryable) {
          setAuthStatus('temporarily-unavailable', safeErrorCode(error));
          scheduleRetryRefresh(generation);
        } else {
          setAuthStatus('error', safeErrorCode(error));
        }
        throw error;
      }
    })();
    const wrapped = operation.finally(() => {
      signal?.removeEventListener?.('abort', onCallerAbort);
      if (refreshRequestController === controller) refreshRequestController = null;
      if (refreshPromise === wrapped) refreshPromise = null;
    });
    refreshPromise = wrapped;
    return wrapped;
  }

  async function signOut({ signal } = {}) {
    clearRefreshTimer();
    retryAttempt = 0;
    sessionGeneration += 1;
    abortRefreshRequest();
    const token = session?.access_token || '';
    const url = `${String(supabaseUrl || '').replace(/\/+$/, '')}/auth/v1/logout`;
    if (token) {
      try {
        await requestJson(url, {
          method: 'POST',
          signal,
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`
          }
        }, 'auth_sign_out_failed');
      } catch (error) {
        if (error instanceof SupabaseAuthError && error.status >= 500) {
          scheduleRefresh();
          throw error;
        }
      }
    }
    clearSession({ persist: true, event: 'SIGNED_OUT' });
    return true;
  }

  function onAuthStateChange(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function isAuthenticated() {
    return !!session?.access_token && !isSessionExpiring(session, 0);
  }

  function getStatus() {
    return { ...authStatus };
  }

  function getSession() {
    return session ? { ...session } : null;
  }

  function getAccessToken() {
    return isAuthenticated() ? session.access_token : '';
  }

  function getRefreshToken() {
    return session?.refresh_token || '';
  }

  function getRedirectUrl() {
    return authRedirectUrl;
  }

  function shutdown({ announceDeparture = true } = {}) {
    clearRefreshTimer();
    abortRefreshRequest();
    sessionGeneration += 1;
    if (localResetChannel) {
      const channel = localResetChannel;
      if (announceDeparture) postAuthTabMessage('tab-close', tabNonce);
      try { channel.removeEventListener?.('message', handleAuthTabMessage); } catch (_) {}
      try { channel.close?.(); } catch (_) {}
      localResetChannel = null;
    }
    peerTabNonces.clear();
    for (const nonce of Array.from(pendingLocalResets.keys())) {
      finishPendingLocalReset(nonce, false);
    }
  }

  startAuthCoordination();

  return {
    bootstrap,
    signInWithApiToken,
    signInWithPassword,
    refreshSession,
    signOut,
    onAuthStateChange,
    isAuthenticated,
    getStatus,
    getSession,
    getAccessToken,
    getRefreshToken,
    getRedirectUrl,
    clearSession,
    clearLocalSession,
    clearLocalSessionAcrossTabs,
    shutdown
  };
}
