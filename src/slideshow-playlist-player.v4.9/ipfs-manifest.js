import { sanitizeCid, validateCid } from './ipfs-service.js';

export const IPFS_EXPERIENCE_SCHEMA = 'player.blend.ipfs-experience.v1';
export const IPFS_EXPERIENCE_SCHEMA_VERSION = 1;

const ALLOWED_ITEM_TYPES = new Set(['video', 'audio', 'image']);
const ALLOWED_MIME_PREFIXES = ['video/', 'audio/', 'image/'];
const MAX_MANIFEST_ITEMS = 10000;
const MAX_TEXT = 260;
const DEFAULT_MAX_ITEM_BYTES = 2 * 1024 * 1024 * 1024;

const PRIVATE_METADATA_KEYS = new Set([
  'path',
  'fullpath',
  'filepath',
  'localpath',
  'absolutepath',
  'directory',
  'directoryid',
  'handle',
  'filehandle',
  'filesystemhandle',
  'nativepath',
  'sourcepath',
  'sourceurl',
  'originurl',
  'downloadurl',
  'ipfs',
  'webkitrelativepath',
  'signature',
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'authorization'
]);

function sanitizeText(value, maxLength = MAX_TEXT) {
  const clean = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, Math.max(1, maxLength | 0));
}

function publicBasenameIfPathLike(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const last = url.pathname.split('/').filter(Boolean).pop();
      return last || url.hostname || raw;
    } catch (_) {
      return raw;
    }
  }
  if (!/^[a-z]:[\\/]/i.test(raw) && !/^\\\\/.test(raw) && !raw.startsWith('/') && !raw.includes('\\')) {
    return raw;
  }
  return raw.split(/[\\/]+/).filter(Boolean).pop() || raw;
}

function sanitizePublicLabel(value, maxLength = MAX_TEXT) {
  return sanitizeText(publicBasenameIfPathLike(value), maxLength);
}

function numberOrNull(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
}

function sanitizeMetadata(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 3) return undefined;
  if (Array.isArray(value)) {
    const arr = value
      .slice(0, 50)
      .map(item => {
        if (item == null) return null;
        if (typeof item === 'string') return sanitizeText(item, 400);
        if (typeof item === 'number' || typeof item === 'boolean') return item;
        return sanitizeMetadata(item, depth + 1);
      })
      .filter(item => item != null);
    return arr.length ? arr : undefined;
  }
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const cleanKey = sanitizeText(key, 80);
    if (!cleanKey || PRIVATE_METADATA_KEYS.has(cleanKey.toLowerCase())) continue;
    if (/(token|secret|password|api[-_]?key|authorization)/i.test(cleanKey)) continue;
    if (raw == null || typeof raw === 'function' || typeof raw === 'symbol') continue;
    if (typeof raw === 'string') {
      const lower = cleanKey.toLowerCase();
      if ((lower.includes('path') || lower.includes('directory')) && /^[a-z]:[\\/]|^\/|^\\\\/i.test(raw)) continue;
      out[cleanKey] = sanitizeText(raw, 600);
    } else if (typeof raw === 'number') {
      if (Number.isFinite(raw)) out[cleanKey] = raw;
    } else if (typeof raw === 'boolean') {
      out[cleanKey] = raw;
    } else if (typeof raw === 'object') {
      const nested = sanitizeMetadata(raw, depth + 1);
      if (nested !== undefined) out[cleanKey] = nested;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const allowed = [
    'defaultImageDuration',
    'effectIntensity',
    'playlistVolume',
    'slideshowVolume',
    'masterVolume',
    'playbackModePlaylist',
    'playbackModeSlideshow',
    'opacity',
    'themeMode'
  ];
  const out = {};
  for (const key of allowed) {
    if (source[key] == null) continue;
    if (typeof source[key] === 'string') out[key] = sanitizeText(source[key], 80);
    else if (typeof source[key] === 'number' && Number.isFinite(source[key])) out[key] = source[key];
    else if (typeof source[key] === 'boolean') out[key] = source[key];
  }
  out.resumeOnLoad = false;
  return out;
}

function sanitizeListMeta(which, meta = {}) {
  const fallbackName = which === 'playlist' ? 'Playlist' : 'Slideshow';
  return {
    name: sanitizeText(meta?.name || fallbackName, 140) || fallbackName,
    description: sanitizeText(meta?.description || '', 400),
    createdAt: normalizeDate(meta?.createdAt) || new Date().toISOString()
  };
}

function normalizeDate(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function itemKey(id, cid) {
  return `${String(id || '').trim()}|${String(cid || '').trim()}`;
}

function manifestItemFromUpload(upload) {
  const cid = sanitizeCid(upload?.cid);
  const type = sanitizeText(upload?.type, 24).toLowerCase();
  if (!cid || !ALLOWED_ITEM_TYPES.has(type)) return null;
  const mimeType = sanitizeText(upload?.mimeType || '', 120).toLowerCase();
  return {
    itemId: sanitizeText(upload.itemId || upload.id || cid, 160) || cid,
    cid,
    type,
    mimeType,
    byteSize: numberOrNull(upload.byteSize ?? upload.size, 0),
    name: sanitizePublicLabel(upload.name || upload.filename || '', 180),
    title: sanitizePublicLabel(upload.title || upload.name || upload.filename || '', 180),
    duration: numberOrNull(upload.duration, 0, 7 * 24 * 60 * 60),
    addedAt: normalizeDate(upload.addedAt) || undefined,
    uploadedAt: normalizeDate(upload.uploadedAt || upload.timestamp) || undefined,
    integrity: upload.integrity && typeof upload.integrity === 'object'
      ? sanitizeMetadata(upload.integrity)
      : undefined,
    metadata: sanitizeMetadata(upload.metadata)
  };
}

function listEntriesFor(which, refs = [], uploadsById = new Map()) {
  return (Array.isArray(refs) ? refs : []).map((ref, index) => {
    const upload = uploadsById.get(String(ref?.id || ''));
    if (!upload) return null;
    const entry = {
      order: index,
      itemId: upload.itemId || upload.id || String(ref.id),
      cid: upload.cid,
      type: upload.type,
      title: sanitizePublicLabel(ref?.name || upload.title || upload.name || '', 180),
      addedAt: normalizeDate(ref?.addedAt) || undefined,
      metadata: sanitizeMetadata(ref?.metadata)
    };
    if (which === 'slideshow') {
      if (upload.type === 'image') entry.displayDuration = numberOrNull(ref?.displayDuration, 0.5, 300);
      if (upload.type === 'video') entry.includeAudio = !!ref?.includeAudio;
    }
    return entry;
  }).filter(Boolean);
}

export function createExperienceManifest(input = {}) {
  const uploadedItems = Array.isArray(input.uploadedItems)
    ? input.uploadedItems
    : Array.from(input.uploadedItems?.values?.() || []);
  const items = [];
  const uploadsById = new Map();
  const seen = new Set();
  for (const raw of uploadedItems) {
    const item = manifestItemFromUpload(raw);
    if (!item) continue;
    const key = itemKey(item.itemId, item.cid);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    uploadsById.set(String(item.itemId), item);
    if (raw?.id && !uploadsById.has(String(raw.id))) uploadsById.set(String(raw.id), item);
  }

  const playlistItems = listEntriesFor('playlist', input.playlist, uploadsById);
  const slideshowItems = listEntriesFor('slideshow', input.slideshow, uploadsById);
  const createdAt = normalizeDate(input.createdAt) || new Date().toISOString();
  return {
    schema: IPFS_EXPERIENCE_SCHEMA,
    schemaVersion: IPFS_EXPERIENCE_SCHEMA_VERSION,
    createdAt,
    appVersion: sanitizeText(input.appVersion || '', 40),
    experienceId: sanitizeText(input.experienceId || '', 160),
    experienceTitle: sanitizeText(input.experienceTitle || input.title || 'Shared Blend Experience', 180) || 'Shared Blend Experience',
    items,
    playbackSettings: sanitizeSettings(input.settings),
    lists: {
      playlist: {
        ...sanitizeListMeta('playlist', input.listMeta?.playlist),
        order: playlistItems.map(item => item.itemId),
        items: playlistItems
      },
      slideshow: {
        ...sanitizeListMeta('slideshow', input.listMeta?.slideshow),
        order: slideshowItems.map(item => item.itemId),
        items: slideshowItems
      }
    },
    migration: {
      sourceSchema: input.sourceSchema || 'player.blend.experience.v2',
      notes: 'IPFS manifest contains public CIDs and safe playback metadata only.'
    }
  };
}

function validateMime(type, mimeType) {
  if (!mimeType) return true;
  if (!ALLOWED_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))) return false;
  if (type === 'image') return mimeType.startsWith('image/');
  if (type === 'audio') return mimeType.startsWith('audio/');
  if (type === 'video') return mimeType.startsWith('video/');
  return false;
}

export function validateExperienceManifest(manifest, options = {}) {
  const errors = [];
  const maxItems = Number(options.maxItems) || MAX_MANIFEST_ITEMS;
  const maxItemBytes = Number(options.maxItemBytes) || DEFAULT_MAX_ITEM_BYTES;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['Manifest must be a JSON object'], manifest: null };
  }
  if (manifest.schema !== IPFS_EXPERIENCE_SCHEMA) errors.push('Unsupported IPFS experience schema');
  if (manifest.schemaVersion !== IPFS_EXPERIENCE_SCHEMA_VERSION) errors.push('Unsupported IPFS experience schemaVersion');
  if (!Array.isArray(manifest.items)) errors.push('Manifest items must be an array');
  if (Array.isArray(manifest.items) && manifest.items.length > maxItems) errors.push('Manifest has too many items');
  if (!manifest.lists || typeof manifest.lists !== 'object') errors.push('Manifest lists are missing');

  const normalizedItems = [];
  const itemsById = new Map();
  const itemsByCid = new Map();
  for (const [index, item] of (Array.isArray(manifest.items) ? manifest.items : []).entries()) {
    if (!item || typeof item !== 'object') {
      errors.push(`Item ${index + 1} is not an object`);
      continue;
    }
    const cid = sanitizeCid(item.cid);
    const type = sanitizeText(item.type, 24).toLowerCase();
    const mimeType = sanitizeText(item.mimeType || '', 120).toLowerCase();
    if (!cid) errors.push(`Item ${index + 1} has an invalid CID`);
    if (!ALLOWED_ITEM_TYPES.has(type)) errors.push(`Item ${index + 1} has an unsupported type`);
    if (!validateMime(type, mimeType)) errors.push(`Item ${index + 1} has an unsafe MIME type`);
    const rawByteSize = item.byteSize == null ? null : Number(item.byteSize);
    const byteSize = rawByteSize == null || !Number.isFinite(rawByteSize) ? null : Math.max(0, Math.floor(rawByteSize));
    if (item.byteSize != null && (!Number.isFinite(rawByteSize) || rawByteSize < 0)) errors.push(`Item ${index + 1} has an invalid byte size`);
    if (Number.isFinite(rawByteSize) && rawByteSize > maxItemBytes) errors.push(`Item ${index + 1} exceeds the configured item size limit`);
    const normalized = {
      itemId: sanitizeText(item.itemId || item.id || cid, 160) || cid,
      cid,
      type,
      mimeType,
      byteSize,
      name: sanitizePublicLabel(item.name || item.title || `ipfs-${cid}`, 180) || `ipfs-${cid}`,
      title: sanitizePublicLabel(item.title || item.name || `ipfs-${cid}`, 180) || `ipfs-${cid}`,
      duration: numberOrNull(item.duration, 0, 7 * 24 * 60 * 60),
      addedAt: normalizeDate(item.addedAt) || undefined,
      uploadedAt: normalizeDate(item.uploadedAt) || undefined,
      metadata: sanitizeMetadata(item.metadata)
    };
    if (itemsById.has(normalized.itemId)) errors.push(`Item ${index + 1} duplicates itemId ${normalized.itemId}`);
    normalizedItems.push(normalized);
    itemsById.set(normalized.itemId, normalized);
    itemsByCid.set(normalized.cid, normalized);
  }

  function normalizeList(which) {
    const list = manifest.lists?.[which];
    if (!list || typeof list !== 'object') {
      errors.push(`${which} list is missing`);
      return { name: which, description: '', createdAt: new Date().toISOString(), order: [], items: [] };
    }
    const entries = Array.isArray(list.items) ? list.items : [];
    const normalizedEntries = [];
    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== 'object') {
        errors.push(`${which} entry ${index + 1} is not an object`);
        continue;
      }
      const cid = sanitizeCid(entry.cid);
      const entryItemId = sanitizeText(entry.itemId, 160);
      const referencedById = entryItemId ? itemsById.get(entryItemId) : null;
      const referencedByCid = cid ? itemsByCid.get(cid) : null;
      const referenced = referencedByCid || referencedById;
      if (!cid || !validateCid(cid)) errors.push(`${which} entry ${index + 1} has an invalid CID`);
      if (!referencedByCid) errors.push(`${which} entry ${index + 1} references an unknown item CID`);
      if (referencedById && referencedByCid && referencedById.cid !== referencedByCid.cid) {
        errors.push(`${which} entry ${index + 1} itemId does not match its CID`);
      }
      const declaredType = sanitizeText(entry.type || '', 24).toLowerCase();
      if (declaredType && referenced && declaredType !== referenced.type) {
        errors.push(`${which} entry ${index + 1} type does not match its referenced item`);
      }
      const type = referenced?.type || declaredType;
      if (which === 'playlist' && type !== 'video' && type !== 'audio') errors.push(`Playlist entry ${index + 1} is not video or audio`);
      if (which === 'slideshow' && type !== 'video' && type !== 'image') errors.push(`Slideshow entry ${index + 1} is not video or image`);
      normalizedEntries.push({
        order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : index,
        itemId: referenced?.itemId || entryItemId || cid,
        cid,
        type,
        title: sanitizePublicLabel(entry.title || referenced?.title || referenced?.name || '', 180),
        displayDuration: which === 'slideshow' ? numberOrNull(entry.displayDuration, 0.5, 300) : undefined,
        includeAudio: which === 'slideshow' ? !!entry.includeAudio : undefined,
        addedAt: normalizeDate(entry.addedAt) || undefined,
        metadata: sanitizeMetadata(entry.metadata)
      });
    }
    normalizedEntries.sort((a, b) => a.order - b.order);
    return {
      ...sanitizeListMeta(which, list),
      order: normalizedEntries.map(entry => entry.itemId),
      items: normalizedEntries
    };
  }

  const normalized = {
    schema: IPFS_EXPERIENCE_SCHEMA,
    schemaVersion: IPFS_EXPERIENCE_SCHEMA_VERSION,
    createdAt: normalizeDate(manifest.createdAt) || new Date().toISOString(),
    appVersion: sanitizeText(manifest.appVersion || '', 40),
    experienceId: sanitizeText(manifest.experienceId || '', 160),
    experienceTitle: sanitizeText(manifest.experienceTitle || manifest.title || 'Shared Blend Experience', 180) || 'Shared Blend Experience',
    items: normalizedItems,
    playbackSettings: sanitizeSettings(manifest.playbackSettings || manifest.settings),
    lists: {
      playlist: normalizeList('playlist'),
      slideshow: normalizeList('slideshow')
    },
    migration: manifest.migration && typeof manifest.migration === 'object' ? sanitizeMetadata(manifest.migration) : undefined
  };

  return { ok: errors.length === 0, errors, manifest: errors.length ? null : normalized };
}

export function manifestToImportPayload(manifest) {
  const validated = validateExperienceManifest(manifest);
  if (!validated.ok) {
    throw new Error(validated.errors.join('; '));
  }
  const safe = validated.manifest;
  const itemByCid = new Map(safe.items.map(item => [item.cid, item]));
  const libraryItems = safe.items.map(item => ({
    id: `ipfs-${item.cid}`,
    cid: item.cid,
    name: item.name || item.title || `ipfs-${item.cid}`,
    type: item.type,
    size: item.byteSize || 0,
    duration: item.duration,
    mimeType: item.mimeType,
    pathHint: `ipfs://${item.cid}`,
    sourceUrl: `ipfs://${item.cid}`,
    metadata: {
      ...(item.metadata || {}),
      ipfs: {
        cid: item.cid,
        mimeType: item.mimeType || undefined,
        byteSize: item.byteSize || undefined
      }
    }
  }));

  function entries(which) {
    return safe.lists[which].items.map(entry => {
      const item = itemByCid.get(entry.cid);
      return {
        id: item ? `ipfs-${item.cid}` : `ipfs-${entry.cid}`,
        cid: entry.cid,
        path: `ipfs://${entry.cid}`,
        sourceUrl: `ipfs://${entry.cid}`,
        name: entry.title || item?.title || item?.name || `ipfs-${entry.cid}`,
        type: entry.type || item?.type,
        displayDuration: entry.displayDuration,
        includeAudio: entry.includeAudio,
        metadata: {
          ...(item?.metadata || {}),
          ...(entry.metadata || {}),
          ipfs: {
            cid: entry.cid,
            mimeType: item?.mimeType || undefined,
            byteSize: item?.byteSize || undefined
          }
        }
      };
    });
  }

  return {
    name: safe.experienceTitle,
    settings: safe.playbackSettings,
    playlistEntries: entries('playlist'),
    slideshowEntries: entries('slideshow'),
    playlistMeta: safe.lists.playlist,
    slideshowMeta: safe.lists.slideshow,
    libraryItems,
    manifest: safe
  };
}
