function hasSignedUrlExpiry(metadata = null) {
  const value = metadata?.signedUrlExpiresAt;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function isSignedSupabaseStorageUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const url = new URL(raw);
    if (!/\/storage\/v\d+\/object\/sign\//i.test(url.pathname)) return false;
    return Array.from(url.searchParams.keys()).some(key => key.toLowerCase() === 'token');
  } catch (_) {
    return false;
  }
}

function asRecords(value) {
  if (value instanceof Map) return Array.from(value.values()).filter(Boolean);
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function collectExperienceReferences(experiences) {
  const references = [];
  for (const experience of asRecords(experiences)) {
    const payload = experience?.payload || experience?.snapshot || experience?.data;
    references.push(...asRecords(payload?.playlist), ...asRecords(payload?.slideshow));
  }
  return references;
}

/** Build a deterministic cleanup plan without changing the supplied media state. */
export function planSignedMediaUrlCleanup(
  { library, playlist, slideshow, experiences } = {},
  { requireExpiry = true } = {}
) {
  const records = [
    ...asRecords(library),
    ...asRecords(playlist),
    ...asRecords(slideshow),
    ...collectExperienceReferences(experiences)
  ];
  const uniqueRecords = Array.from(new Set(records));
  const metadataById = new Map();
  for (const record of uniqueRecords) {
    if (record?.id === undefined || record?.id === null) continue;
    const id = String(record.id);
    const metadata = metadataById.get(id) || [];
    if (record.metadata && typeof record.metadata === 'object') metadata.push(record.metadata);
    metadataById.set(id, metadata);
  }

  const mutations = [];
  const signedUrls = new Set();
  const clearedIds = new Set();
  for (const record of uniqueRecords) {
    const relatedMetadata = metadataById.get(String(record?.id ?? '')) || [];
    const metadataRecords = [record?.metadata, ...relatedMetadata];
    if (requireExpiry && !metadataRecords.some(hasSignedUrlExpiry)) continue;

    const fields = [
      { owner: record, key: 'sourceUrl', clearWith: null },
      { owner: record?.metadata, key: 'sourceUrl', clearWith: undefined },
      { owner: record?.metadata?.socialResolved, key: 'image', clearWith: undefined },
      { owner: record?.handle, key: 'sourceUrl', clearWith: null }
    ];
    let recordChanged = false;
    for (const field of fields) {
      const value = field.owner?.[field.key];
      if (!isSignedSupabaseStorageUrl(value)) continue;
      mutations.push({ owner: field.owner, key: field.key, expectedValue: value, clearWith: field.clearWith });
      signedUrls.add(value);
      recordChanged = true;
    }
    if (recordChanged && record?.id !== undefined && record?.id !== null) clearedIds.add(String(record.id));
  }

  return { mutations, signedUrls, clearedIds };
}

export function applySignedMediaUrlCleanup(plan) {
  let clearedFieldCount = 0;
  for (const mutation of Array.isArray(plan?.mutations) ? plan.mutations : []) {
    if (!mutation?.owner || mutation.owner[mutation.key] !== mutation.expectedValue) continue;
    if (mutation.clearWith === undefined) delete mutation.owner[mutation.key];
    else mutation.owner[mutation.key] = mutation.clearWith;
    clearedFieldCount++;
  }
  return clearedFieldCount;
}

function cloneHandleForPersistence(handle) {
  if (!handle || typeof handle !== 'object') return handle;
  const prototype = Object.getPrototypeOf(handle);
  return prototype === Object.prototype || prototype === null ? { ...handle } : handle;
}

function cloneMediaRecordForPersistence(record) {
  if (!record || typeof record !== 'object') return record;
  const clone = { ...record };
  if (record.metadata && typeof record.metadata === 'object') {
    clone.metadata = { ...record.metadata };
    if (record.metadata.socialResolved && typeof record.metadata.socialResolved === 'object') {
      clone.metadata.socialResolved = { ...record.metadata.socialResolved };
    }
  }
  if (record.handle && typeof record.handle === 'object') clone.handle = cloneHandleForPersistence(record.handle);
  return clone;
}

function cloneListStoreRowForPersistence(record) {
  if (!record || typeof record !== 'object') return record;
  const clone = { ...record };
  if (Array.isArray(record.items)) clone.items = record.items.map(cloneMediaRecordForPersistence);
  return clone;
}

function cloneExperienceForPersistence(record) {
  if (!record || typeof record !== 'object') return record;
  const clone = { ...record };
  const payloadKey = ['payload', 'snapshot', 'data'].find(key => record[key] && typeof record[key] === 'object');
  if (!payloadKey) return clone;
  const payload = { ...record[payloadKey] };
  if (Array.isArray(payload.playlist)) payload.playlist = payload.playlist.map(cloneMediaRecordForPersistence);
  if (Array.isArray(payload.slideshow)) payload.slideshow = payload.slideshow.map(cloneMediaRecordForPersistence);
  clone[payloadKey] = payload;
  return clone;
}

/** Clone IndexedDB snapshot records and remove resolver-issued bearer URLs from the copies. */
export function sanitizeSignedMediaPersistenceSnapshot(recordsByStore = {}) {
  const safeRecordsByStore = { ...recordsByStore };
  if (Array.isArray(recordsByStore.library) || recordsByStore.library instanceof Map) {
    safeRecordsByStore.library = asRecords(recordsByStore.library).map(cloneMediaRecordForPersistence);
  }
  if (Array.isArray(recordsByStore.playlist) || recordsByStore.playlist instanceof Map) {
    safeRecordsByStore.playlist = asRecords(recordsByStore.playlist).map(cloneListStoreRowForPersistence);
  }
  if (Array.isArray(recordsByStore.slideshow) || recordsByStore.slideshow instanceof Map) {
    safeRecordsByStore.slideshow = asRecords(recordsByStore.slideshow).map(cloneListStoreRowForPersistence);
  }
  if (Array.isArray(recordsByStore.experiences) || recordsByStore.experiences instanceof Map) {
    safeRecordsByStore.experiences = asRecords(recordsByStore.experiences).map(cloneExperienceForPersistence);
  }

  const plan = planSignedMediaUrlCleanup({
    library: safeRecordsByStore.library,
    playlist: asRecords(safeRecordsByStore.playlist).flatMap(record => asRecords(record?.items)),
    slideshow: asRecords(safeRecordsByStore.slideshow).flatMap(record => asRecords(record?.items)),
    experiences: safeRecordsByStore.experiences
  }, { requireExpiry: false });
  const clearedFieldCount = applySignedMediaUrlCleanup(plan);
  return { recordsByStore: safeRecordsByStore, clearedFieldCount };
}

function sanitizedErrorName(error) {
  const candidate = typeof error?.name === 'string' ? error.name : 'Error';
  return /^[A-Za-z][A-Za-z0-9]{0,47}$/.test(candidate) ? candidate : 'Error';
}

function reportCleanupError(onCleanupError, operation, error) {
  if (typeof onCleanupError !== 'function') return;
  try {
    onCleanupError({ operation, errorName: sanitizedErrorName(error) });
  } catch (_) {}
}

function callElementCleanup(onCleanupError, operation, callback) {
  try {
    callback();
  } catch (error) {
    reportCleanupError(onCleanupError, operation, error);
  }
}

function elementHasSignedUrl(element, signedUrls) {
  const candidates = [];
  try { candidates.push(element?.currentSrc); } catch (_) {}
  try { candidates.push(element?.getAttribute?.('src')); } catch (_) {}
  try { candidates.push(element?.src); } catch (_) {}
  return candidates.some(value => signedUrls?.has(String(value || '').trim()));
}

/** Clear only media elements whose current URL was present in the cleanup plan. */
export function clearSignedMediaElements(elements, { signedUrls, onCleanupError } = {}) {
  let clearedElementCount = 0;
  for (const element of Array.from(elements || [])) {
    if (!elementHasSignedUrl(element, signedUrls)) continue;
    const tagName = String(element?.tagName || '').toUpperCase();
    if (tagName === 'VIDEO' || tagName === 'AUDIO') {
      callElementCleanup(onCleanupError, 'pause', () => element.pause());
    }
    callElementCleanup(onCleanupError, 'clear_source', () => element.removeAttribute('src'));
    if (tagName === 'VIDEO' || tagName === 'AUDIO') {
      callElementCleanup(onCleanupError, 'reload', () => element.load());
    }
    clearedElementCount++;
  }
  return clearedElementCount;
}
