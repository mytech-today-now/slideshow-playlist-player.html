const DEFAULT_STORAGE_KEY = 'blend-supabase-auth-session-v1';
const REFRESH_BUFFER_SECONDS = 75;

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

export function createSupabaseAuthClient({
  supabaseUrl,
  supabaseAnonKey,
  authRedirectUrl = '',
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storageKey = DEFAULT_STORAGE_KEY,
  logger = null
} = {}) {
  const listeners = new Set();
  let session = null;
  let bootstrapPromise = null;
  let refreshTimer = null;

  function emit(event) {
    for (const listener of listeners) {
      try { listener({ event, session }); } catch (_) {}
    }
  }

  function logDebug(message, context = null) {
    if (!logger?.info) return;
    logger.info(message, context || {});
  }

  function clearRefreshTimer() {
    if (!refreshTimer) return;
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function persistSession(nextSession) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      if (!nextSession) storage.removeItem(storageKey);
      else storage.setItem(storageKey, JSON.stringify(nextSession));
    } catch (_) {}
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    if (!session?.refresh_token || !session?.expires_at) return;
    const delayMs = Math.max(1000, (session.expires_at - nowInSeconds() - REFRESH_BUFFER_SECONDS) * 1000);
    refreshTimer = setTimeout(() => {
      void refreshSession().catch(error => {
        logDebug('[auth] refresh failed', { code: error?.code || 'unknown' });
      });
    }, delayMs);
  }

  function setSession(nextSession, { persist = true, event = 'SESSION_UPDATED' } = {}) {
    session = normalizeSession(nextSession);
    if (persist) persistSession(session);
    scheduleRefresh();
    emit(event);
    return session;
  }

  function clearSession({ persist = true, event = 'SIGNED_OUT' } = {}) {
    session = null;
    clearRefreshTimer();
    if (persist) persistSession(null);
    emit(event);
  }

  function readStoredSession() {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return null;
      return normalizeSession(JSON.parse(raw));
    } catch (_) {
      return null;
    }
  }

  async function requestJson(url, init = {}, friendlyCode = 'auth_request_failed') {
    if (typeof fetchImpl !== 'function') {
      throw new SupabaseAuthError('Fetch is not available in this environment.', {
        code: 'fetch_unavailable',
        retryable: false
      });
    }
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (cause) {
      throw new SupabaseAuthError('Unable to reach Supabase Auth.', {
        code: 'auth_network_error',
        retryable: true,
        cause
      });
    }
    const text = await response.text().catch(() => '');
    const payload = text ? (() => {
      try { return JSON.parse(text); } catch (_) { return null; }
    })() : null;
    if (!response.ok) {
      const message = payload?.msg || payload?.error_description || payload?.error || `Supabase Auth request failed (${response.status})`;
      throw new SupabaseAuthError(message, {
        code: friendlyCode,
        status: response.status,
        retryable: response.status >= 500 || response.status === 429
      });
    }
    return payload || {};
  }

  async function bootstrap() {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      const hashSession = parseAuthHash(globalThis.location?.hash || '');
      if (hashSession) {
        setSession(hashSession, { event: 'SIGNED_IN' });
        removeSensitiveAuthHash();
        return session;
      }

      const fromStorage = readStoredSession();
      if (!fromStorage) {
        clearSession({ persist: false, event: 'INITIAL_SESSION' });
        return null;
      }

      setSession(fromStorage, { persist: false, event: 'INITIAL_SESSION' });
      if (isSessionExpiring(session) && session.refresh_token) {
        try {
          await refreshSession();
        } catch (error) {
          logDebug('[auth] bootstrap refresh failed', { code: error?.code || 'unknown' });
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

  async function signInWithPassword({ email, password }) {
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
    return setSession(normalized, { event: 'SIGNED_IN' });
  }

  async function refreshSession() {
    if (!session?.refresh_token) {
      throw new SupabaseAuthError('No refresh token is available.', {
        code: 'auth_refresh_unavailable',
        retryable: false
      });
    }
    const url = `${String(supabaseUrl || '').replace(/\/+$/, '')}/auth/v1/token?grant_type=refresh_token`;
    const payload = await requestJson(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey
      },
      body: JSON.stringify({
        refresh_token: session.refresh_token
      })
    }, 'auth_refresh_failed');
    const normalized = normalizeSession(payload);
    if (!normalized) {
      throw new SupabaseAuthError('Supabase Auth returned an invalid refresh response.', {
        code: 'auth_invalid_refresh',
        retryable: false
      });
    }
    return setSession(normalized, { event: 'TOKEN_REFRESHED' });
  }

  async function signOut() {
    const token = session?.access_token || '';
    const url = `${String(supabaseUrl || '').replace(/\/+$/, '')}/auth/v1/logout`;
    if (token) {
      try {
        await requestJson(url, {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`
          }
        }, 'auth_sign_out_failed');
      } catch (error) {
        if (error instanceof SupabaseAuthError && error.status >= 500) throw error;
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

  function getSession() {
    return session ? { ...session } : null;
  }

  function getAccessToken() {
    return session?.access_token || '';
  }

  function getRefreshToken() {
    return session?.refresh_token || '';
  }

  function getRedirectUrl() {
    return authRedirectUrl;
  }

  function shutdown() {
    clearRefreshTimer();
  }

  return {
    bootstrap,
    signInWithPassword,
    refreshSession,
    signOut,
    onAuthStateChange,
    isAuthenticated,
    getSession,
    getAccessToken,
    getRefreshToken,
    getRedirectUrl,
    clearSession,
    shutdown
  };
}
