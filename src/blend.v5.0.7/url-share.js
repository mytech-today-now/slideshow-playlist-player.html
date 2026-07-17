// url-share.js — Experience URL sharing utilities (v5.0.7)
//
// Provides dependency-free, browser-native gzip + Base64URL compression
// for encoding complete experience objects into shareable URLs.
//
// Public API:
//   compressExperience(experience)   → Promise<string>  (Base64URL)
//   decompressExperience(base64Url)  → Promise<object>  (parsed JSON)
//   estimateShareUrlSize(base64Url)  → number           (URL bytes)
//   uint8ToBase64Url(uint8)          → string           (encoding helper)
//   base64UrlToUint8(str)            → Uint8Array       (decoding helper)
//   sanitizeBase64UrlInput(value)    → string           (validation helper)
//
// Uses CompressionStream / DecompressionStream (available in all modern
// browsers: Chrome 80+, Firefox 113+, Safari 16.4+, Node.js 18+).

export const URL_SHARE_PARAM = 'experience';
export const URL_SHARE_PARAM_ALIAS = 'data';

// Warn (but don't block) if the Base64URL payload exceeds this many bytes.
// Most experiences compress to well under 100 KB; 500 KB is a generous ceiling
// that still fits in any modern browser URL.
export const URL_SHARE_SIZE_LIMIT = 524288; // 500 KiB

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
  const json = JSON.stringify(experience);
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
    return JSON.parse(json);
  } catch (_) {
    throw new Error('Share payload did not decompress to valid JSON');
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
