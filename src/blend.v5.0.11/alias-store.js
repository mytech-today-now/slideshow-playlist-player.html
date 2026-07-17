import './pwa-config.js';
import './alias-router.js';

const config = globalThis.BlendPwaConfig;
const router = globalThis.BlendAliasRouter;

const ALIAS_STORE = config?.ALIAS_STORE || 'aliases';
const ALIAS_META_STORE = config?.ALIAS_META_STORE || 'aliasMeta';
const DB_NAME = config?.DB_NAME || 'player-blend-v1';
const DB_VERSION = config?.DB_VERSION || 5;
const MANIFEST_META_KEY = 'manifest';

export function ensureAliasObjectStores(database) {
  if (!database?.objectStoreNames) return;
  if (!database.objectStoreNames.contains(ALIAS_STORE)) {
    database.createObjectStore(ALIAS_STORE, { keyPath: 'id' });
  }
  if (!database.objectStoreNames.contains(ALIAS_META_STORE)) {
    database.createObjectStore(ALIAS_META_STORE, { keyPath: 'key' });
  }
}

export function validateAliasManifestForStore(manifest, options = {}) {
  const normalized = router.normalizeAliasManifest(manifest, {
    baseUrl: options.baseUrl || globalThis.location?.href || 'https://blend.local/',
    allowedOrigins: options.allowedOrigins || []
  });

  if (
    !options.allowDowngrade &&
    Number.isInteger(options.currentVersion) &&
    normalized.version < options.currentVersion
  ) {
    throw new router.AliasValidationError('Alias manifest downgrade rejected.', 'alias_version_downgrade');
  }

  return normalized;
}

export async function openAliasDatabase() {
  if (!globalThis.indexedDB) {
    throw new Error('IndexedDB is not available.');
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => ensureAliasObjectStores(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withAliasDb(callback) {
  const database = await openAliasDatabase();
  try {
    return await callback(database);
  } finally {
    try { database.close(); } catch (_) {}
  }
}

export async function readAliasMeta() {
  return withAliasDb(async (database) => {
    if (!database.objectStoreNames.contains(ALIAS_META_STORE)) return null;
    const tx = database.transaction(ALIAS_META_STORE, 'readonly');
    const done = txDone(tx);
    const result = await requestResult(tx.objectStore(ALIAS_META_STORE).get(MANIFEST_META_KEY));
    await done;
    return result || null;
  });
}

export async function readAliasSnapshot(options = {}) {
  return withAliasDb(async (database) => {
    if (!database.objectStoreNames.contains(ALIAS_STORE)) {
      return emptyAliasManifest();
    }
    const storeNames = database.objectStoreNames.contains(ALIAS_META_STORE)
      ? [ALIAS_STORE, ALIAS_META_STORE]
      : [ALIAS_STORE];
    const tx = database.transaction(storeNames, 'readonly');
    const done = txDone(tx);
    const aliasesRequest = tx.objectStore(ALIAS_STORE).getAll();
    const metaRequest = database.objectStoreNames.contains(ALIAS_META_STORE)
      ? tx.objectStore(ALIAS_META_STORE).get(MANIFEST_META_KEY)
      : null;
    const aliases = await requestResult(aliasesRequest);
    const meta = metaRequest ? await requestResult(metaRequest) : null;
    await done;
    return router.normalizeAliasManifest({
      schema: router.DEFAULT_SCHEMA,
      version: Number(meta?.version || 0),
      generatedAt: meta?.generatedAt || new Date(0).toISOString(),
      aliases: aliases || []
    }, {
      baseUrl: options.baseUrl || globalThis.location?.href || 'https://blend.local/',
      allowedOrigins: options.allowedOrigins || []
    });
  });
}

export async function replaceAliasManifest(manifest, options = {}) {
  const currentMeta = await readAliasMeta().catch(() => null);
  const normalized = validateAliasManifestForStore(manifest, {
    ...options,
    currentVersion: currentMeta?.version
  });

  await withAliasDb(async (database) => {
    const tx = database.transaction([ALIAS_STORE, ALIAS_META_STORE], 'readwrite');
    const done = txDone(tx);
    const aliasStore = tx.objectStore(ALIAS_STORE);
    aliasStore.clear();
    for (const entry of normalized.aliases) {
      aliasStore.put({ ...entry });
    }
    tx.objectStore(ALIAS_META_STORE).put({
      key: MANIFEST_META_KEY,
      schema: normalized.schema,
      version: normalized.version,
      generatedAt: normalized.generatedAt,
      updatedAt: new Date().toISOString(),
      aliasCount: normalized.aliases.length
    });
    await done;
  });

  return normalized;
}

export async function seedAliasManifest(manifest, options = {}) {
  const current = await readAliasMeta().catch(() => null);
  if (current && Number(current.version) > Number(manifest?.version || 0) && !options.allowDowngrade) {
    return readAliasSnapshot(options);
  }
  return replaceAliasManifest(manifest, options);
}

export function compactAliasSnapshot(manifest) {
  const normalized = validateAliasManifestForStore(manifest, { allowDowngrade: true });
  return {
    schema: normalized.schema,
    version: normalized.version,
    generatedAt: normalized.generatedAt,
    aliases: normalized.aliases.map(entry => ({ ...entry }))
  };
}

export function emptyAliasManifest() {
  return {
    schema: router.DEFAULT_SCHEMA,
    version: 0,
    generatedAt: new Date(0).toISOString(),
    aliases: []
  };
}

export {
  ALIAS_STORE,
  ALIAS_META_STORE,
  MANIFEST_META_KEY
};
