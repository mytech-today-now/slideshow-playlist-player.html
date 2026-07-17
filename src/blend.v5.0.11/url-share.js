// url-share.js — Experience URL sharing utilities
//
// Provides dependency-free, browser-native gzip + Base64URL compression
// for encoding complete experience objects into shareable URLs. Current
// payloads first use a compact, field-dictionary schema; decompression still
// accepts the gzip-compressed JSON payloads created by earlier releases.
//
// Public API:
//   compressExperience(experience)   → Promise<string>  (Base64URL)
//   decompressExperience(base64Url)  → Promise<object>  (parsed JSON)
//   estimateShareUrlSize(base64Url)  → number           (URL bytes)
//   uint8ToBase64Url(uint8)          → string           (encoding helper)
//   base64UrlToUint8(str)            → Uint8Array       (decoding helper)
//   sanitizeBase64UrlInput(value)    → string           (validation helper)
//   serializeExperienceForShare(obj) → object|array     (compact payload)
//   deserializeExperienceFromShare(x)→ object           (compatibility helper)
//
// Uses CompressionStream / DecompressionStream (available in all modern
// browsers: Chrome 80+, Firefox 113+, Safari 16.4+, Node.js 18+).

export const URL_SHARE_PARAM = 'experience';
export const URL_SHARE_PARAM_ALIAS = 'data';

// Warn (but don't block) if the Base64URL payload exceeds this many bytes.
// Most experiences compress to well under 100 KB; 500 KB is a generous ceiling
// that still fits in any modern browser URL.
export const URL_SHARE_SIZE_LIMIT = 524288; // 500 KiB

// Maximum safe total URL length for cross-browser / cross-server reliability.
// Internally Chrome/Firefox/Edge support ~2 MB URLs, but many HTTP servers
// (Apache/nginx defaults), email clients, messaging apps, and link-shorteners
// truncate at 2048 characters.  We target ≤ 2048 for the *full* URL
// (scheme + host + path + query string), which leaves roughly 2000 chars for
// the ?experience= payload after a typical ~48-char origin + path prefix.
export const URL_MAX_LENGTH = 2048;

// Compact transport schema. The magic/version pair is intentionally an array
// rather than an object so it remains cheap after gzip and Base64URL encoding.
// Known fields are represented by a presence bitmask followed by values in the
// declared field order. This avoids repeating property names for every media
// entry while retaining unknown fields for forward compatibility.
export const COMPACT_SHARE_MAGIC = 'blend-share';
export const COMPACT_SHARE_VERSION = 2;

const ROOT_KEYS = ['version', 'schema', 'type', 'id', 'name', 'project', 'exportedAt', 'settings'];
const LIBRARY_KEYS = ['order'];
const LIST_KEYS = ['version', 'schema', 'type', 'name', 'description', 'createdAt', 'project', 'exportedAt', 'order'];
const LIBRARY_ITEM_KEYS = ['order', 'id', 'path', 'fullPath', 'pathKind', 'name', 'type', 'size', 'duration', 'addedAt', 'stale', 'metadata', 'sourceUrl', 'social'];
const LIST_ITEM_KEYS = ['order', 'id', 'path', 'fullPath', 'pathKind', 'name', 'type', 'size', 'duration', 'addedAt', 'displayDuration', 'includeAudio', 'available', 'sourceUrl', 'metadata', 'social'];

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function bitCount(value) {
  let count = 0;
  let bits = value >>> 0;
  while (bits) {
    bits &= bits - 1;
    count++;
  }
  return count;
}

function packKnownFields(record, keys) {
  if (!isRecord(record)) return [0];
  let mask = 0;
  const values = [];
  const known = new Set(keys);
  keys.forEach((key, index) => {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return;
    mask |= (1 << index);
    values.push(record[key]);
  });
  const extra = {};
  Object.keys(record).forEach(key => {
    if (!known.has(key)) extra[key] = record[key];
  });
  return Object.keys(extra).length ? [mask, ...values, extra] : [mask, ...values];
}

function unpackKnownFields(packed, keys, label) {
  if (!Array.isArray(packed) || !Number.isInteger(packed[0]) || packed[0] < 0) {
    throw new Error(`Compact share payload has an invalid ${label} record`);
  }
  const mask = packed[0];
  if (mask >= 2 ** keys.length) {
    throw new Error(`Compact share payload has an invalid ${label} field mask`);
  }
  const valueCount = bitCount(mask);
  if (packed.length < valueCount + 1 || packed.length > valueCount + 2) {
    throw new Error(`Compact share payload has an invalid ${label} value count`);
  }
  const record = {};
  let cursor = 1;
  keys.forEach((key, index) => {
    if (mask & (1 << index)) record[key] = packed[cursor++];
  });
  if (packed.length === cursor + 1) {
    const extra = packed[cursor];
    if (!isRecord(extra)) throw new Error(`Compact share payload has invalid ${label} extensions`);
    Object.assign(record, extra);
  }
  return record;
}

function compactList(list) {
  if (!isRecord(list) || !Array.isArray(list.items)) return null;
  const { items, ...header } = list;
  return [packKnownFields(header, LIST_KEYS), items.map(item => packKnownFields(item, LIST_ITEM_KEYS))];
}

function expandCompactList(packed, label) {
  if (!Array.isArray(packed) || packed.length !== 2 || !Array.isArray(packed[1])) {
    throw new Error(`Compact share payload has an invalid ${label} list`);
  }
  const header = unpackKnownFields(packed[0], LIST_KEYS, `${label} list`);
  header.items = packed[1].map((item, index) => unpackKnownFields(item, LIST_ITEM_KEYS, `${label} item ${index + 1}`));
  return header;
}

function isCompactableExperience(experience) {
  return isRecord(experience) &&
    isRecord(experience.library) && Array.isArray(experience.library.items) &&
    isRecord(experience.playlist) && Array.isArray(experience.playlist.items) &&
    isRecord(experience.slideshow) && Array.isArray(experience.slideshow.items);
}

/**
 * Convert a standard experience export into the compact URL transport schema.
 * Non-experience objects intentionally pass through unchanged so the public
 * compressor remains a lossless generic JSON utility for integrations.
 */
export function serializeExperienceForShare(experience) {
  if (!isCompactableExperience(experience)) return experience;

  const { library, playlist, slideshow, ...root } = experience;
  const { items: libraryItems, ...libraryHeader } = library;
  return [
    COMPACT_SHARE_MAGIC,
    COMPACT_SHARE_VERSION,
    packKnownFields(root, ROOT_KEYS),
    packKnownFields(libraryHeader, LIBRARY_KEYS),
    libraryItems.map(item => packKnownFields(item, LIBRARY_ITEM_KEYS)),
    compactList(playlist),
    compactList(slideshow)
  ];
}

function isCompactSharePayload(payload) {
  return Array.isArray(payload) &&
    payload[0] === COMPACT_SHARE_MAGIC &&
    payload[1] === COMPACT_SHARE_VERSION;
}

/**
 * Expand a compact URL transport schema into the normal import/export object.
 * Older gzip(JSON) payloads are already in that form and are returned as-is.
 */
export function deserializeExperienceFromShare(payload) {
  if (!isCompactSharePayload(payload)) return payload;
  if (payload.length !== 7 || !Array.isArray(payload[4])) {
    throw new Error('Compact share payload is malformed');
  }
  const root = unpackKnownFields(payload[2], ROOT_KEYS, 'experience');
  const library = unpackKnownFields(payload[3], LIBRARY_KEYS, 'library');
  library.items = payload[4].map((item, index) => unpackKnownFields(item, LIBRARY_ITEM_KEYS, `library item ${index + 1}`));
  root.library = library;
  root.playlist = expandCompactList(payload[5], 'playlist');
  root.slideshow = expandCompactList(payload[6], 'slideshow');
  return root;
}

/**
 * Check whether a fully-formed share URL fits within the safe length limit.
 *
 * @param {string} fullUrl  The complete URL (scheme + host + path + query string)
 * @returns {{ ok: boolean, length: number, limit: number, excess: number, pct: number }}
 */
export function checkUrlLength(fullUrl) {
  const length = typeof fullUrl === 'string' ? fullUrl.length : 0;
  const excess = Math.max(0, length - URL_MAX_LENGTH);
  return {
    ok: length <= URL_MAX_LENGTH,
    length,
    limit: URL_MAX_LENGTH,
    excess,
    // Raw percentage — may exceed 100 for very long URLs (callers clamp for display).
    pct: URL_MAX_LENGTH > 0 ? Math.round((length / URL_MAX_LENGTH) * 100) : 0
  };
}

// Hard upper bound on an incoming payload to prevent decompression bombs.
const DECOMPRESS_INPUT_LIMIT = 4194304; // 4 MiB of Base64URL chars

// Maximum decompressed JSON size (guards against malicious over-expansion).
const DECOMPRESS_OUTPUT_LIMIT = 52428800; // 50 MiB

/**
 * Compress a JSON-serialisable experience object into a Base64URL string
 * suitable for embedding in a URL query parameter.
 *
 * @param {object} experience
 * @returns {Promise<string>} Base64URL-encoded gzip-compressed JSON
 */
export async function compressExperience(experience) {
  if (!experience || typeof experience !== 'object') {
    throw new TypeError('experience must be a non-null object');
  }
  if (typeof CompressionStream === 'undefined') {
    throw new Error('Compression API is not available in this browser. Please use Chrome 80+, Firefox 113+, or Safari 16.4+.');
  }
  const json = JSON.stringify(serializeExperienceForShare(experience));
  const encoded = new TextEncoder().encode(json);
  const compressed = await gzipBytes(encoded);
  return uint8ToBase64Url(compressed);
}

/**
 * Decompress a Base64URL string back into a parsed experience object.
 *
 * @param {string} base64Url
 * @returns {Promise<object>} parsed experience JSON
 */
export async function decompressExperience(base64Url) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Decompression API is not available in this browser. Please use Chrome 80+, Firefox 113+, or Safari 16.4+.');
  }
  const clean = sanitizeBase64UrlInput(base64Url);
  const compressed = base64UrlToUint8(clean);
  let decompressed;
  try {
    decompressed = await gunzipBytes(compressed);
  } catch (_) {
    throw new Error('Share payload is corrupted or not gzip-compressed');
  }
  if (decompressed.length > DECOMPRESS_OUTPUT_LIMIT) {
    throw new Error('Decompressed share payload exceeds the 50 MB safety limit');
  }
  const json = new TextDecoder().decode(decompressed);
  try {
    return deserializeExperienceFromShare(JSON.parse(json));
  } catch (_) {
    throw new Error('Share payload did not decompress to a valid experience');
  }
}

/**
 * Estimate how many URL characters the share parameter will consume.
 * Useful for deciding whether to warn about oversized URLs.
 *
 * @param {string} base64Url
 * @returns {number}
 */
export function estimateShareUrlSize(base64Url) {
  return URL_SHARE_PARAM.length + 1 + (typeof base64Url === 'string' ? base64Url.length : 0);
}

// ---- encoding helpers (exported for unit testing) ---------------------------

/**
 * Encode a Uint8Array as a URL-safe Base64 string (no padding).
 * Uses only btoa + string operations — no browser-specific APIs.
 *
 * @param {Uint8Array} uint8
 * @returns {string}
 */
export function uint8ToBase64Url(uint8) {
  let binary = '';
  const len = uint8.length;
  // Build binary string in chunks to avoid call-stack limits on large arrays.
  const CHUNK = 8192;
  for (let i = 0; i < len; i += CHUNK) {
    binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode a URL-safe Base64 string (with or without padding) to a Uint8Array.
 *
 * @param {string} str
 * @returns {Uint8Array}
 */
export function base64UrlToUint8(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = base64.length % 4;
  const padded = remainder ? base64 + '='.repeat(4 - remainder) : base64;
  const binary = atob(padded);
  const uint8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    uint8[i] = binary.charCodeAt(i);
  }
  return uint8;
}

/**
 * Validate and normalise a Base64URL string before decoding.
 * Strips whitespace, checks character set, enforces size ceiling.
 *
 * @param {string} value
 * @returns {string} cleaned string
 * @throws {TypeError|Error}
 */
export function sanitizeBase64UrlInput(value) {
  if (typeof value !== 'string') throw new TypeError('Share payload must be a string');
  const clean = value.replace(/[\s\r\n\t]/g, '');
  if (!clean) throw new Error('Share payload is empty');
  if (!/^[A-Za-z0-9_\-=]+$/.test(clean)) {
    throw new Error('Share payload contains characters that are not valid Base64URL');
  }
  if (clean.length > DECOMPRESS_INPUT_LIMIT) {
    throw new Error(`Share payload (${Math.round(clean.length / 1024)} KB) exceeds the 4 MB safety limit`);
  }
  return clean;
}

// ---- internal streaming helpers --------------------------------------------

async function gzipBytes(uint8) {
  const cs = new CompressionStream('gzip');
  // Start the reader before writing to avoid backpressure deadlock.
  const readPromise = collectStream(cs.readable);
  const writer = cs.writable.getWriter();
  try {
    await writer.write(uint8);
    await writer.close();
  } catch (err) {
    // Attach a no-op catch to readPromise so the parallel readable-side
    // rejection does not become an unhandled rejection.
    readPromise.catch(() => {});
    throw err;
  }
  return readPromise;
}

async function gunzipBytes(uint8) {
  const ds = new DecompressionStream('gzip');
  // Start the reader before writing to avoid backpressure deadlock.
  const readPromise = collectStream(ds.readable);
  const writer = ds.writable.getWriter();
  try {
    await writer.write(uint8);
    await writer.close();
  } catch (err) {
    // The readable side will also reject when the stream errors.
    // Absorb it silently to prevent an unhandled rejection.
    readPromise.catch(() => {});
    throw err;
  }
  return readPromise;
}

async function collectStream(readable) {
  const reader = readable.getReader();
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const totalLength = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
