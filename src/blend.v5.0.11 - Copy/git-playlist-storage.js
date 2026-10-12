import { parsePublicPlaylistDocument } from './git-playlist-catalog.js';

const SETTINGS_KEY = 'blend-git-playlist-repository-v1';
const CREDENTIAL_KEY = 'blend-git-playlist-credential-v1';
const MAX_DOCUMENT_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 1_600_000;
const REQUEST_TIMEOUT_MS = 20_000;
const PROVIDERS = new Set(['github', 'bitbucket']);

export class GitPlaylistError extends Error {
  constructor(code) {
    super(code);
    this.name = 'GitPlaylistError';
    this.code = code;
  }
}

function fail(code) {
  throw new GitPlaylistError(code);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return '';
  return text;
}

function looksLikeCredential(value) {
  const text = String(value || '').trim();
  return /^(?:gh[pousr]_|github_pat_|ATATT|ATBB)[A-Za-z0-9_-]{12,}$/i.test(text)
    || /^[A-Za-z0-9_-]{40,}$/.test(text)
    || /^(?:bearer|basic)\s/i.test(text);
}

function validPart(value, maxLength = 100) {
  const part = cleanText(value, maxLength);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && !looksLikeCredential(part) ? part : '';
}

function validBranch(value) {
  const branch = cleanText(value, 120);
  if (!branch || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || looksLikeCredential(branch)) return '';
  if (branch.includes('..') || branch.includes('//') || branch.includes('@{') || branch.endsWith('/')) return '';
  if (branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.toLowerCase().endsWith('.lock'))) return '';
  return branch;
}

function validPlaylistPath(value) {
  const path = cleanText(value, 220);
  if (!path || path.startsWith('/') || path.endsWith('/') || path.includes('\\') || path.includes('%') || path.includes('?') || path.includes('#') || looksLikeCredential(path)) return '';
  if (!path.toLowerCase().endsWith('.json')) return '';
  const parts = path.split('/');
  if (parts.length > 10 || parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part) || part === '.' || part === '..')) return '';
  return path;
}

export function normalizeGitPlaylistSettings(value = {}) {
  const provider = String(value.provider || '').trim().toLowerCase();
  if (!PROVIDERS.has(provider)) fail('invalid_provider');
  const owner = validPart(value.owner ?? value.workspace);
  const repository = validPart(value.repository);
  const branch = validBranch(value.branch);
  const path = validPlaylistPath(value.path);
  if (!owner || !repository || !branch || !path) fail('invalid_repository_settings');
  return Object.freeze({ provider, owner, repository, branch, path });
}

export function gitPlaylistSettingsKey() {
  return SETTINGS_KEY;
}

export function gitPlaylistCredentialKey() {
  return CREDENTIAL_KEY;
}

export function loadGitPlaylistSettings(storage) {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    return raw ? normalizeGitPlaylistSettings(JSON.parse(raw)) : null;
  } catch (_) {
    return null;
  }
}

export function saveGitPlaylistSettings(storage, value) {
  const settings = normalizeGitPlaylistSettings(value);
  if (!storage || typeof storage.setItem !== 'function') fail('settings_unavailable');
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) {
    fail('settings_unavailable');
  }
  return settings;
}

export function removeGitPlaylistSettings(storage) {
  try {
    if (!storage || typeof storage.removeItem !== 'function') return false;
    storage.removeItem(SETTINGS_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

export function inspectRememberedGitPlaylistCredential(storage) {
  if (!storage || typeof storage.getItem !== 'function') return 'unavailable';
  try {
    return storage.getItem(CREDENTIAL_KEY) == null ? 'clear' : 'present';
  } catch (_) {
    return 'unavailable';
  }
}

export function hasRememberedGitPlaylistCredential(storage) {
  try {
    const credential = JSON.parse(storage?.getItem(CREDENTIAL_KEY) || 'null');
    return PROVIDERS.has(credential?.provider) && typeof credential?.token === 'string' && !!credential.token.trim();
  } catch (_) {
    return false;
  }
}

function pathSegments(path) {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function repoBase(settings, provider) {
  if (provider === 'github') {
    return `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repository)}`;
  }
  return `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repository)}`;
}

function githubRefUrl(settings) {
  const ref = `heads/${settings.branch}`;
  return `${repoBase(settings, 'github')}/git/ref/${pathSegments(ref)}`;
}

function githubFileUrl(settings) {
  const url = new URL(`${repoBase(settings, 'github')}/contents/${pathSegments(settings.path)}`);
  url.searchParams.set('ref', settings.branch);
  return url.href;
}

function bitbucketBranchesUrl(settings) {
  const url = new URL(`${repoBase(settings, 'bitbucket')}/refs/branches`);
  url.searchParams.set('q', `name="${settings.branch}"`);
  url.searchParams.set('pagelen', '1');
  return url.href;
}

function bitbucketFileUrl(settings, commit) {
  return `${repoBase(settings, 'bitbucket')}/src/${encodeURIComponent(commit)}/${pathSegments(settings.path)}`;
}

function requestHeaders(provider, token, extra = {}) {
  return {
    Accept: provider === 'github' ? 'application/vnd.github+json' : 'application/json',
    Authorization: `Bearer ${token}`,
    ...extra
  };
}

function classifyHttpError(status) {
  if (status === 404) return 'repository_or_file_not_found';
  if (status === 401) return 'authentication_failed';
  if (status === 403) return 'permission_denied';
  if (status === 409) return 'remote_conflict';
  if (status === 422) return 'provider_rejected_write';
  if (status === 429) return 'rate_limited';
  if (status === 408) return 'request_timeout';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_request_failed';
}

async function requestApi(fetchImpl, provider, url, token, options = {}) {
  if (typeof fetchImpl !== 'function') fail('fetch_unavailable');
  const method = String(options.method || 'GET').toUpperCase();
  const controller = new AbortController();
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, Math.max(1, Number(options.timeoutMs) || REQUEST_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const finish = () => clearTimeout(timer);
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: requestHeaders(provider, token, options.headers),
      ...(options.body === undefined ? {} : { body: options.body }),
      signal: controller.signal
    });
  } catch (_) {
    finish();
    if (options.write) fail('write_outcome_uncertain');
    if (controller.signal.aborted) fail('request_timeout');
    fail('network_or_cors_error');
  }
  if (response?.status === 404 && options.allowNotFound) {
    return Object.freeze({ response, finish, readText: maxBytes => responseTextBounded(response, maxBytes, controller.signal).finally(finish) });
  }
  if (!response?.ok) {
    const status = Number(response?.status) || 0;
    finish();
    {
      const code = classifyHttpError(status);
      if (options.write && status === 0) fail('write_outcome_uncertain');
      if (options.write && ['provider_unavailable', 'request_timeout'].includes(code)) fail('write_outcome_uncertain');
      fail(code);
    }
  }
  return Object.freeze({ response, finish, readText: maxBytes => responseTextBounded(response, maxBytes, controller.signal).finally(finish) });
}

async function responseTextBounded(response, maxBytes = MAX_RESPONSE_BYTES, signal = null) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) fail('response_too_large');
  const reader = response.body?.getReader?.();
  if (!reader) fail('streaming_response_required');
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        fail('response_too_large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof GitPlaylistError) throw error;
    if (signal?.aborted) fail('request_timeout');
    fail('network_or_cors_error');
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch (_) { fail('invalid_utf8'); }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { fail('malformed_provider_response'); }
}

function decodeBase64Utf8(value) {
  const content = String(value || '').replace(/\s+/g, '');
  if (content.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 8
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) fail('malformed_provider_response');
  let binary;
  try { binary = atob(content); } catch (_) { fail('malformed_provider_response'); }
  if (binary.length > MAX_DOCUMENT_BYTES) fail('response_too_large');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch (_) { fail('invalid_utf8'); }
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

function parseGithubFile(text) {
  const result = parseJson(text);
  if (result?.type !== 'file' || result.encoding !== 'base64' || typeof result.content !== 'string'
      || typeof result.sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(result.sha)) fail('malformed_provider_response');
  return { text: decodeBase64Utf8(result.content), sha: result.sha.toLowerCase() };
}

function parseGitHubRef(text, branch) {
  const result = parseJson(text);
  if (result?.ref !== `refs/heads/${branch}` || !/^[a-f0-9]{40,64}$/i.test(String(result?.object?.sha || ''))) fail('branch_not_found');
  return String(result.object.sha).toLowerCase();
}

function parseBitbucketBranchList(text, branch) {
  const result = parseJson(text);
  const found = Array.isArray(result?.values) ? result.values.find(value => value?.name === branch) : null;
  if (!found || !/^[a-f0-9]{40,64}$/i.test(String(found?.target?.hash || ''))) fail('branch_not_found');
  return String(found.target.hash).toLowerCase();
}

function parseRepositoryVisibility(text, provider) {
  const result = parseJson(text);
  if (provider === 'github' && typeof result.private === 'boolean') return result.private ? 'private' : 'public';
  if (provider === 'bitbucket' && typeof result.is_private === 'boolean') return result.is_private ? 'private' : 'public';
  return 'unknown';
}

function parseRemotePlaylist(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) fail('response_too_large');
  try {
    return parsePublicPlaylistDocument(text, { title: 'Remote playlist' });
  } catch (_) {
    fail('invalid_remote_playlist');
  }
}

function safeName(value, fallback) {
  const name = cleanText(value, 260);
  if (!name || /[\\/]/.test(name) || looksLikeCredential(name)) return fallback;
  return name;
}

export function serializeRemotePlaylist(itemsValue, nameValue = 'Blend Playlist') {
  if (!Array.isArray(itemsValue) || !itemsValue.length || itemsValue.length > 10_000) fail('invalid_playlist');
  const items = itemsValue.map((item, index) => {
    const type = item?.type;
    if (type !== 'audio' && type !== 'video') fail('unsafe_playlist_content');
    const sourceUrl = [item?.sourceUrl, item?.url, item?.path].find(value => typeof value === 'string' && value) || '';
    let fallbackName = `Item ${index + 1}`;
    try {
      const segment = new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1);
      if (segment) fallbackName = decodeURIComponent(segment).slice(0, 260) || fallbackName;
    } catch (_) {}
    const name = safeName(item?.name, fallbackName);
    const output = {
      id: `item-${index + 1}`,
      path: sourceUrl,
      sourceUrl,
      pathKind: 'remote',
      name,
      type,
      order: index
    };
    if (item?.includeAudio !== undefined) {
      if (typeof item.includeAudio !== 'boolean') fail('unsafe_playlist_content');
      output.includeAudio = item.includeAudio;
    }
    if (item?.displayDuration !== undefined) {
      if (!Number.isFinite(item.displayDuration) || item.displayDuration < 0 || item.displayDuration > 3600) fail('unsafe_playlist_content');
      output.displayDuration = item.displayDuration;
    }
    return output;
  });
  const playlistName = safeName(nameValue, 'Blend Playlist');
  const payload = {
    schema: 'player.blend.list.v1',
    type: 'playlist',
    name: playlistName,
    description: '',
    order: items.map(item => item.id),
    items
  };
  try { parseRemotePlaylist(JSON.stringify(payload)); }
  catch (_) { fail('unsafe_playlist_content'); }
  const text = JSON.stringify(payload, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) fail('response_too_large');
  return text;
}

function snapshotMatches(provider, before, current) {
  if (before.exists !== current.exists) return false;
  if (provider === 'github') return !before.exists || before.sha === current.sha;
  return before.head === current.head && (!before.exists || before.text === current.text);
}

export function createGitPlaylistClient({ storage = null, fetchImpl = globalThis.fetch } = {}) {
  let sessionCredential = null;
  let activeConnection = null;
  let uncertainSubmission = null;

  function sameSettings(left, right) {
    return !!left && !!right && JSON.stringify(left) === JSON.stringify(right);
  }

  function reconcileUncertainSubmission(settings, remote) {
    if (!uncertainSubmission || !sameSettings(uncertainSubmission.review.settings, settings)) return;
    uncertainSubmission = Object.freeze({
      ...uncertainSubmission,
      reconciled: true,
      matchesReviewedSnapshot: snapshotMatches(settings.provider, uncertainSubmission.review.snapshot, remote),
      matchesOutgoing: !!remote.exists && remote.text === uncertainSubmission.review.text
    });
  }

  function rememberedCredential() {
    try {
      const stored = JSON.parse(storage?.getItem(CREDENTIAL_KEY) || 'null');
      if (!PROVIDERS.has(stored?.provider) || typeof stored?.token !== 'string' || !stored.token.trim()) return null;
      return Object.freeze({ provider: stored.provider, token: stored.token.trim() });
    } catch (_) {
      return null;
    }
  }

  function rememberedToken(provider) {
    const credential = rememberedCredential();
    return credential?.provider === provider ? credential.token : '';
  }

  function sessionToken(provider) {
    return sessionCredential?.provider === provider ? sessionCredential.token : '';
  }

  function hasRememberedCredential(provider = '') {
    const credential = rememberedCredential();
    return !!credential && (!provider || credential.provider === provider);
  }

  function requireConnection(settings) {
    const normalized = normalizeGitPlaylistSettings(settings);
    if (!sessionToken(normalized.provider) || !activeConnection || JSON.stringify(normalized) !== JSON.stringify(activeConnection.settings)) fail('not_connected');
    return normalized;
  }

  async function getBranchHead(settings, token) {
    if (settings.provider === 'github') {
      const request = await requestApi(fetchImpl, settings.provider, githubRefUrl(settings), token, { allowNotFound: true });
      if (request.response.status === 404) {
        request.finish();
        fail('branch_not_found');
      }
      return parseGitHubRef(await request.readText(), settings.branch);
    }
    const request = await requestApi(fetchImpl, settings.provider, bitbucketBranchesUrl(settings), token, { allowNotFound: true });
    if (request.response.status === 404) {
      request.finish();
      fail('branch_not_found');
    }
    return parseBitbucketBranchList(await request.readText(256_000), settings.branch);
  }

  async function getRemoteFile(settings, token, head) {
    const url = settings.provider === 'github' ? githubFileUrl(settings) : bitbucketFileUrl(settings, head);
    const request = await requestApi(fetchImpl, settings.provider, url, token, { allowNotFound: true });
    if (request.response.status === 404) {
      request.finish();
      return { exists: false, sha: null, text: null, head };
    }
    const raw = await request.readText(MAX_RESPONSE_BYTES);
    if (settings.provider === 'github') {
      const file = parseGithubFile(raw);
      if (new TextEncoder().encode(file.text).byteLength > MAX_DOCUMENT_BYTES) fail('response_too_large');
      return { exists: true, sha: file.sha, text: file.text, head };
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_DOCUMENT_BYTES) fail('response_too_large');
    return { exists: true, sha: null, text: raw, head };
  }

  async function currentRemoteState(settings, token) {
    const head = await getBranchHead(settings, token);
    return getRemoteFile(settings, token, head);
  }

  return Object.freeze({
    hasRememberedCredential,

    async connect(settingsValue, tokenValue = '', { remember = false, preserveRememberedCredential = false } = {}) {
      const settings = normalizeGitPlaylistSettings(settingsValue);
      const typedToken = String(tokenValue || '').trim();
      const savedCredential = rememberedCredential();
      const savedToken = rememberedToken(settings.provider);
      const token = typedToken || sessionToken(settings.provider) || savedToken;
      sessionCredential = null;
      activeConnection = null;
      if (!token) fail('token_required');

      const repositoryUrl = `${repoBase(settings, settings.provider)}`;
      const repositoryRequest = await requestApi(fetchImpl, settings.provider, repositoryUrl, token);
      const visibility = parseRepositoryVisibility(await repositoryRequest.readText(128_000), settings.provider);
      const head = await getBranchHead(settings, token);
      sessionCredential = { provider: settings.provider, token };
      activeConnection = { settings, visibility, head };

      let credentialRemembered = false;
      if (remember) {
        try {
          if (!storage || typeof storage.setItem !== 'function') fail('credential_storage_unavailable');
          storage.setItem(CREDENTIAL_KEY, JSON.stringify({ provider: settings.provider, token }));
          credentialRemembered = true;
        } catch (_) {
          credentialRemembered = false;
        }
      } else if (!preserveRememberedCredential && savedCredential?.provider === settings.provider) {
        try { storage?.removeItem?.(CREDENTIAL_KEY); } catch (_) {}
      }
      return Object.freeze({ visibility, readAccess: 'confirmed', writeAccess: 'unverified', credentialRemembered });
    },

    disconnect() {
      sessionCredential = null;
      activeConnection = null;
    },

    forgetCredential() {
      sessionCredential = null;
      activeConnection = null;
      try {
        if (!storage || typeof storage.removeItem !== 'function') return false;
        storage.removeItem(CREDENTIAL_KEY);
        return true;
      } catch (_) {
        return false;
      }
    },

    getConnection() {
      if (!activeConnection) return null;
      return Object.freeze({
        settings: activeConnection.settings,
        visibility: activeConnection.visibility,
        readAccess: 'confirmed',
        writeAccess: 'unverified'
      });
    },

    async readPlaylist(settingsValue) {
      const settings = requireConnection(settingsValue);
      const remote = await currentRemoteState(settings, sessionToken(settings.provider));
      if (!remote.exists) fail('file_not_found');
      const playlist = parseRemotePlaylist(remote.text);
      reconcileUncertainSubmission(settings, remote);
      return Object.freeze({ playlist, text: JSON.stringify(playlist, null, 2), snapshot: Object.freeze(remote) });
    },

    async preparePublish(settingsValue, text) {
      const settings = requireConnection(settingsValue);
      if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) fail('response_too_large');
      let playlist;
      try { playlist = parseRemotePlaylist(text); }
      catch (_) { fail('unsafe_playlist_content'); }
      const canonicalText = JSON.stringify(playlist, null, 2);
      const snapshot = await currentRemoteState(settings, sessionToken(settings.provider));
      if (snapshot.exists) parseRemotePlaylist(snapshot.text);
      reconcileUncertainSubmission(settings, snapshot);
      return Object.freeze({
        text: canonicalText,
        snapshot: Object.freeze(snapshot),
        visibility: activeConnection.visibility,
        settings
      });
    },

    async publish(review) {
      if (!review || typeof review.text !== 'string') fail('invalid_publish_review');
      const settings = requireConnection(review.settings);
      if (uncertainSubmission && sameSettings(uncertainSubmission.review.settings, settings) && !uncertainSubmission.reconciled) {
        fail('remote_reconciliation_required');
      }
      const token = sessionToken(settings.provider);
      const remote = await currentRemoteState(settings, token);
      if (!snapshotMatches(settings.provider, review.snapshot, remote)) fail('remote_conflict');
      if (remote.exists) parseRemotePlaylist(remote.text);
      if (remote.exists && remote.text === review.text) {
        return Object.freeze({ commit: '', provider: settings.provider, alreadyCurrent: true });
      }

      if (settings.provider === 'github') {
        const url = githubFileUrl(settings);
        const body = {
          message: 'Publish Blend playlist',
          content: encodeBase64Utf8(review.text),
          branch: settings.branch,
          ...(review.snapshot.exists ? { sha: review.snapshot.sha } : {})
        };
        try {
          const request = await requestApi(fetchImpl, settings.provider, url, token, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            write: true
          });
          let result;
          try { result = parseJson(await request.readText(128_000)); }
          catch (_) { fail('write_outcome_uncertain'); }
          if (![200, 201].includes(request.response.status) || !/^[a-f0-9]{40,64}$/i.test(String(result?.commit?.sha || ''))
              || !/^[a-f0-9]{40,64}$/i.test(String(result?.content?.sha || ''))) fail('write_outcome_uncertain');
          if (uncertainSubmission && sameSettings(uncertainSubmission.review.settings, settings)) uncertainSubmission = null;
          return Object.freeze({ commit: result.commit.sha.toLowerCase(), provider: 'github' });
        } catch (error) {
          if (error?.code === 'write_outcome_uncertain') {
            uncertainSubmission = Object.freeze({ review, reconciled: false });
          }
          throw error;
        }
      }

      fail('conditional_write_unavailable');
    }
  });
}
