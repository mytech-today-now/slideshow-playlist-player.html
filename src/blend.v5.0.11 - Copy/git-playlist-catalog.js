const CONFIG_KEY = 'blend-public-git-catalog-v1';
const PROVIDERS = new Set(['github', 'bitbucket']);
const MAX_API_RESPONSE_BYTES = 1_600_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_INDEX_BYTES = 256_000;
const MAX_PLAYLISTS = 100;
const MAX_PLAYLIST_ITEMS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const GITHUB_API_VERSION = '2026-03-10';

export class GitCatalogError extends Error {
  constructor(code) {
    super(code);
    this.name = 'GitCatalogError';
    this.code = code;
  }
}

function fail(code) {
  throw new GitCatalogError(code);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return '';
  return text;
}

function looksLikeCredential(value) {
  const text = String(value || '').trim();
  return /^(?:gh[pousr]_|github_pat_|ATATT|ATBB|xox[baprs]-|glpat-)[A-Za-z0-9_-]{12,}$/i.test(text)
    || /^[A-Za-z0-9_-]{40,}$/.test(text)
    || /^(?:bearer|basic)\s/i.test(text);
}

function validateRepositoryPart(value) {
  const part = cleanText(value, 100);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && !looksLikeCredential(part) ? part : '';
}

function validateBranch(value) {
  const branch = cleanText(value, 120);
  if (!branch || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || looksLikeCredential(branch)) return '';
  if (branch.includes('..') || branch.includes('//') || branch.includes('@{') || branch.endsWith('/')) return '';
  const segments = branch.split('/');
  if (segments.some(segment => !segment || segment.startsWith('.') || segment.endsWith('.') || segment.toLowerCase().endsWith('.lock'))) return '';
  return branch;
}

function validateCatalogDirectory(value) {
  const directory = cleanText(value, 180);
  if (!directory || looksLikeCredential(directory) || directory.startsWith('/') || directory.endsWith('/') || directory.includes('\\') || directory.includes('%') || directory.includes('?') || directory.includes('#')) return '';
  const segments = directory.split('/');
  if (segments.length > 8 || segments.some(segment => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(segment) || segment === '.' || segment === '..')) return '';
  return directory;
}

export function normalizePublicCatalogSettings(value = {}) {
  const provider = String(value.provider || '').trim().toLowerCase();
  if (!PROVIDERS.has(provider)) fail('invalid_provider');
  const owner = validateRepositoryPart(value.owner);
  const repository = validateRepositoryPart(value.repository);
  const branch = validateBranch(value.branch);
  const directory = validateCatalogDirectory(value.directory);
  if (!owner || !repository || !branch || !directory) fail('invalid_repository_settings');
  return Object.freeze({ provider, owner, repository, branch, directory });
}

export function loadPublicCatalogSettings(storage) {
  try {
    const raw = storage?.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizePublicCatalogSettings(parsed);
  } catch (_) {
    return null;
  }
}

export function savePublicCatalogSettings(storage, value) {
  const settings = normalizePublicCatalogSettings(value);
  if (!storage || typeof storage.setItem !== 'function') fail('settings_unavailable');
  storage.setItem(CONFIG_KEY, JSON.stringify(settings));
  return settings;
}

export function publicCatalogConfigKey() {
  return CONFIG_KEY;
}

export function catalogIndexPath(settingsValue) {
  const settings = normalizePublicCatalogSettings(settingsValue);
  return `${settings.directory}/index.v1.json`;
}

export function catalogPlaylistPath(settingsValue, id) {
  const settings = normalizePublicCatalogSettings(settingsValue);
  const safeId = cleanText(id, 64);
  if (!safeId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(safeId)) fail('unsafe_playlist_id');
  return `${settings.directory}/playlists/${safeId}.json`;
}

function encodePath(path) {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

export function buildPublicFileUrl(settingsValue, pathValue) {
  const settings = normalizePublicCatalogSettings(settingsValue);
  const path = cleanText(pathValue, 512);
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('%') || path.includes('?') || path.includes('#')) fail('unsafe_repository_path');
  const indexPath = `${settings.directory}/index.v1.json`;
  const playlistPrefix = `${settings.directory}/playlists/`;
  if (path !== indexPath && !path.startsWith(playlistPrefix)) fail('unsafe_repository_path');
  const segments = path.split('/');
  if (segments.length > 16 || segments.some(segment => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment) || segment === '.' || segment === '..')) fail('unsafe_repository_path');
  if (path !== indexPath && !/^playlists\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/.test(path.slice(settings.directory.length + 1))) fail('unsafe_repository_path');

  if (settings.provider === 'github') {
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repository)}/contents/${encodePath(path)}`);
    url.searchParams.set('ref', settings.branch);
    return url.href;
  }

  return `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repository)}/src/${encodeURIComponent(settings.branch)}/${encodePath(path)}`;
}

function apiRequestOptions(provider, signal) {
  const headers = provider === 'github'
    ? { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': GITHUB_API_VERSION }
    : { Accept: 'application/json' };
  return {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    headers,
    signal
  };
}

async function responseTextBounded(response, maxBytes) {
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

function classifyHttpError(status, provider) {
  if (status === 404) return 'repository_or_file_not_found';
  if (status === 401) return 'authentication_required';
  if (status === 403 || status === 429) return 'provider_rate_limit_or_access_denied';
  if (status >= 500) return 'provider_unavailable';
  return provider === 'github' || provider === 'bitbucket' ? 'provider_request_failed' : 'invalid_provider';
}

function decodeGitHubContents(responseText) {
  let response;
  try { response = JSON.parse(responseText); } catch (_) { fail('malformed_provider_response'); }
  if (response?.type !== 'file' || response.encoding !== 'base64' || typeof response.content !== 'string') fail('unsupported_file_response');
  const content = response.content.replace(/\s+/g, '');
  if (!content || content.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 8 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) fail('unsupported_file_response');
  let binary;
  try { binary = atob(content); } catch (_) { fail('malformed_provider_response'); }
  if (binary.length > MAX_FILE_BYTES) fail('response_too_large');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch (_) { fail('invalid_utf8'); }
}

export async function fetchPublicRepositoryFile(settingsValue, pathValue, options = {}) {
  const settings = normalizePublicCatalogSettings(settingsValue);
  const url = buildPublicFileUrl(settings, pathValue);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('fetch_unavailable');
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, Math.max(1, Number(options.timeoutMs) || REQUEST_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try { response = await fetchImpl(url, apiRequestOptions(settings.provider, controller.signal)); }
    catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') fail('request_timeout');
      fail('network_or_cors_error');
    }
    if (!response?.ok) fail(classifyHttpError(Number(response?.status) || 0, settings.provider));
    let text;
    try {
      text = await responseTextBounded(response, MAX_API_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof GitCatalogError) throw error;
      if (controller.signal.aborted) fail('request_timeout');
      fail('network_or_cors_error');
    }
    if (settings.provider === 'github') return decodeGitHubContents(text);
    if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) fail('response_too_large');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text, code) {
  try { return JSON.parse(text); } catch (_) { fail(code); }
}

function exactKeys(value, allowed) {
  return Object.keys(value).every(key => allowed.has(key));
}

function validCatalogId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

export function parsePublicCatalogIndex(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_INDEX_BYTES) fail('catalog_index_too_large');
  const index = parseJson(text, 'malformed_catalog_index');
  if (!index || typeof index !== 'object' || Array.isArray(index) || !exactKeys(index, new Set(['schema', 'playlists'])) || index.schema !== 'player.blend.catalog.v1' || !Array.isArray(index.playlists)) fail('unsupported_catalog_schema');
  if (index.playlists.length > MAX_PLAYLISTS) fail('catalog_entry_limit');
  const ids = new Set();
  return index.playlists.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !exactKeys(entry, new Set(['id', 'title'])) || !validCatalogId(entry.id) || ids.has(entry.id)) fail('invalid_catalog_entry');
    const title = cleanText(entry.title, 120);
    if (!title) fail('invalid_catalog_entry');
    ids.add(entry.id);
    return Object.freeze({ id: entry.id, title });
  });
}

function isPublicMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  let url;
  try { url = new URL(value); } catch (_) { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes('.') || hostname === 'localhost' || /\.(?:localhost|local|internal|test|home\.arpa)$/.test(hostname)) return false;
  if (hostname.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); } catch (_) { return false; }
  if (/(?:^|\/)(?:signed|sign|private|token|access_token|signature)(?:\/|$)/i.test(decodedPath)) return false;
  return true;
}

function mediaUrlType(urlValue) {
  const pathname = new URL(urlValue).pathname.toLowerCase();
  const extension = /\.([a-z0-9]+)$/.exec(pathname)?.[1] || '';
  const audio = new Set(['aac', 'aiff', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'wma']);
  const video = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm', 'wmv']);
  if (audio.has(extension)) return 'audio';
  if (video.has(extension)) return 'video';
  return '';
}

export function parsePublicPlaylistDocument(text, catalogEntry) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) fail('playlist_file_too_large');
  const payload = parseJson(text, 'malformed_playlist');
  const listKeys = new Set(['version', 'schema', 'type', 'name', 'description', 'createdAt', 'project', 'exportedAt', 'order', 'items']);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !exactKeys(payload, listKeys) || payload.schema !== 'player.blend.list.v1' || payload.type !== 'playlist' || !Array.isArray(payload.items)) fail('unsupported_playlist_schema');
  if (payload.items.length > MAX_PLAYLIST_ITEMS) fail('playlist_item_limit');
  const ids = new Set();
  const itemKeys = new Set(['id', 'path', 'fullPath', 'sourceUrl', 'pathKind', 'name', 'type', 'order', 'available', 'displayDuration', 'includeAudio', 'size', 'duration', 'addedAt', 'stale']);
  const items = payload.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !exactKeys(item, itemKeys)) fail('disallowed_playlist_fields');
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.id) || ids.has(item.id)) fail('invalid_playlist_item');
    if (item.type !== 'audio' && item.type !== 'video') fail('invalid_playlist_item');
    const name = cleanText(item.name, 260);
    const sourceUrl = typeof item.sourceUrl === 'string' && item.sourceUrl ? item.sourceUrl : item.path;
    if (!name || !isPublicMediaUrl(sourceUrl)) fail('private_or_unsafe_media_reference');
    if (mediaUrlType(sourceUrl) !== item.type) fail('invalid_playlist_item');
    if (item.pathKind && item.pathKind !== 'remote') fail('private_or_unsafe_media_reference');
    if (item.sourceUrl && item.path && item.sourceUrl !== item.path) fail('private_or_unsafe_media_reference');
    if (item.fullPath != null && item.fullPath !== sourceUrl) fail('private_or_unsafe_media_reference');
    if (item.available != null && typeof item.available !== 'boolean') fail('invalid_playlist_item');
    if (item.stale != null && typeof item.stale !== 'boolean') fail('invalid_playlist_item');
    if (item.size != null && (!Number.isSafeInteger(item.size) || item.size < 0)) fail('invalid_playlist_item');
    if (item.duration != null && (!Number.isFinite(item.duration) || item.duration < 0)) fail('invalid_playlist_item');
    if (item.order != null && (!Number.isSafeInteger(item.order) || item.order < 0)) fail('invalid_playlist_item');
    if (item.includeAudio != null && typeof item.includeAudio !== 'boolean') fail('invalid_playlist_item');
    if (item.displayDuration != null && (!Number.isFinite(item.displayDuration) || item.displayDuration < 0 || item.displayDuration > 3600)) fail('invalid_playlist_item');
    ids.add(item.id);
    return {
      id: item.id,
      path: new URL(sourceUrl).href,
      sourceUrl: new URL(sourceUrl).href,
      pathKind: 'remote',
      name,
      type: item.type,
      order: index,
      ...(item.includeAudio == null ? {} : { includeAudio: item.includeAudio }),
      ...(item.displayDuration == null ? {} : { displayDuration: item.displayDuration })
    };
  });
  if (!items.length) fail('empty_playlist');

  let orderedItems = items;
  if (payload.order != null) {
    if (!Array.isArray(payload.order) || payload.order.length > MAX_PLAYLIST_ITEMS || payload.order.some(id => !ids.has(id)) || new Set(payload.order).size !== payload.order.length) fail('invalid_playlist_order');
    const byId = new Map(items.map(item => [item.id, item]));
    const seen = new Set(payload.order);
    orderedItems = payload.order.map(id => byId.get(id)).concat(items.filter(item => !seen.has(item.id)));
  }

  const playlistName = cleanText(payload.name, 120) || catalogEntry?.title || 'Public playlist';
  const description = payload.description == null ? '' : cleanText(payload.description, 500);
  if (payload.description != null && !description && payload.description !== '') fail('invalid_playlist_metadata');
  return {
    schema: 'player.blend.list.v1',
    type: 'playlist',
    name: playlistName,
    description,
    items: orderedItems.map((item, order) => ({ ...item, order }))
  };
}

export async function fetchPublicCatalog(settingsValue, options = {}) {
  const settings = normalizePublicCatalogSettings(settingsValue);
  const text = await fetchPublicRepositoryFile(settings, catalogIndexPath(settings), options);
  return parsePublicCatalogIndex(text);
}
