const PROVIDER_ORIGINS = Object.freeze({
  github: 'https://api.github.com',
  bitbucket: 'https://api.bitbucket.org'
});
const OPERATIONS = new Set(['repository_access_check', 'branch_read', 'playlist_read', 'playlist_publish', 'other_provider_request']);
const OUTCOMES = new Set([
  'success', 'authentication_failed', 'permission_denied', 'request_timeout', 'remote_conflict',
  'rate_limited', 'provider_unavailable', 'provider_rejected_write', 'provider_request_failed',
  'repository_or_file_not_found', 'network_or_cors_error'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function operationFor(provider, method, url) {
  const segments = url.pathname.split('/').filter(Boolean);
  if (provider === 'github') {
    if (segments.length === 3 && segments[0] === 'repos' && method === 'GET') return 'repository_access_check';
    if (segments[0] === 'repos' && segments.includes('git') && segments.includes('ref') && method === 'GET') return 'branch_read';
    if (segments[0] === 'repos' && segments.includes('contents')) {
      if (method === 'GET') return 'playlist_read';
      if (method === 'PUT') return 'playlist_publish';
    }
  }
  if (provider === 'bitbucket') {
    if (segments.length === 3 && segments[0] === '2.0' && segments[1] === 'repositories' && method === 'GET') return 'repository_access_check';
    if (segments[0] === '2.0' && segments.includes('refs') && segments.includes('branches') && method === 'GET') return 'branch_read';
    if (segments[0] === '2.0' && segments.includes('src') && method === 'GET') return 'playlist_read';
  }
  return 'other_provider_request';
}

function outcomeFor(status) {
  if (status >= 200 && status < 300) return 'success';
  if (status === 404) return 'repository_or_file_not_found';
  if (status === 401) return 'authentication_failed';
  if (status === 403) return 'permission_denied';
  if (status === 408) return 'request_timeout';
  if (status === 409) return 'remote_conflict';
  if (status === 422) return 'provider_rejected_write';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_request_failed';
}

function safeRecord(onDiagnostic, value) {
  try {
    onDiagnostic?.(Object.freeze({
      provider: value.provider,
      operation: value.operation,
      method: value.method,
      status: value.status,
      outcome: value.outcome
    }));
  } catch (_) {
    // Diagnostics must never change the provider operation.
  }
}

export function createSanitizedProviderFetch({ provider, token, fetchImpl = globalThis.fetch, onDiagnostic = null } = {}) {
  const origin = PROVIDER_ORIGINS[provider];
  const credential = String(token || '');
  if (!origin) fail('invalid_provider');
  if (!credential) fail('token_required');
  if (typeof fetchImpl !== 'function') fail('fetch_unavailable');

  return async function fetchProvider(input, options = {}) {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url); }
    catch (_) { fail('provider_url_rejected'); }
    let decodedUrl = url.href;
    try { decodedUrl = decodeURIComponent(url.href); } catch (_) {}
    if (url.origin !== origin || url.href.includes(credential) || decodedUrl.includes(credential)) fail('provider_origin_rejected');

    const headers = new Headers(options.headers || (typeof input === 'object' ? input.headers : undefined));
    if (headers.get('authorization') !== `Bearer ${credential}`) fail('provider_authorization_rejected');
    for (const [name, value] of headers.entries()) {
      if (name !== 'authorization' && value.includes(credential)) fail('credential_scope_violation');
    }
    const safeOptions = { ...options, headers: undefined };
    if (JSON.stringify(safeOptions).includes(credential)) fail('credential_scope_violation');

    const method = String(options.method || 'GET').toUpperCase();
    const operation = operationFor(provider, method, url);
    try {
      const response = await fetchImpl(input, options);
      const status = Number(response?.status);
      const observedStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
      safeRecord(onDiagnostic, {
        provider,
        operation,
        method,
        status: observedStatus,
        outcome: observedStatus == null ? 'network_or_cors_error' : outcomeFor(observedStatus)
      });
      return response;
    } catch (_) {
      const outcome = options.signal?.aborted ? 'request_timeout' : 'network_or_cors_error';
      safeRecord(onDiagnostic, { provider, operation, method, status: null, outcome });
      const error = new Error(outcome);
      error.code = outcome;
      throw error;
    }
  };
}

export function formatSanitizedProviderDiagnostic(value) {
  const status = Number(value?.status);
  const safe = {
    provider: Object.hasOwn(PROVIDER_ORIGINS, value?.provider) ? value.provider : 'unknown',
    operation: OPERATIONS.has(value?.operation) ? value.operation : 'other_provider_request',
    method: ['GET', 'PUT', 'POST'].includes(value?.method) ? value.method : 'UNKNOWN',
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    outcome: OUTCOMES.has(value?.outcome) ? value.outcome : 'provider_request_failed'
  };
  return JSON.stringify(safe);
}

