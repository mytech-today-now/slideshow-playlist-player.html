export const SHARED_EXPERIENCE_DOWNLOAD_TIMEOUT_MS = 15_000;
export const SHARED_EXPERIENCE_MAX_BYTES = 10 * 1024 * 1024;
export const SHARED_EXPERIENCE_LIMIT_MESSAGE = 'The shared experience could not be downloaded within the supported time or size limit. Try again or import a local JSON file.';

const DOWNLOAD_ERROR_MESSAGES = Object.freeze({
  timeout: SHARED_EXPERIENCE_LIMIT_MESSAGE,
  size_limit: SHARED_EXPERIENCE_LIMIT_MESSAGE,
  aborted: 'Shared experience download was cancelled.',
  http_error: 'Shared experience download failed.',
  invalid_content_type: 'Shared experience response is not JSON.',
  missing_body: 'Shared experience response has no body.',
  invalid_encoding: 'Shared experience response is not valid UTF-8.',
  invalid_json: 'Shared experience response is not valid JSON.',
  invalid_schema: 'Shared experience response has an unsupported schema.',
  network_error: 'Shared experience download failed.'
});

export class SharedExperienceDownloadError extends Error {
  constructor(code, { status = 0 } = {}) {
    super(DOWNLOAD_ERROR_MESSAGES[code] || DOWNLOAD_ERROR_MESSAGES.network_error);
    this.name = 'SharedExperienceDownloadError';
    this.code = code;
    this.status = Number.isFinite(Number(status)) ? Number(status) : 0;
  }
}

function isJsonContentType(value) {
  const mediaType = String(value || '').split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(mediaType);
}

function isSupportedExperiencePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (payload.type === 'experience') return true;
  const schema = typeof payload.schema === 'string' ? payload.schema.trim() : '';
  return /^player\.blend\.(?:ipfs-)?experience\.v\d+$/i.test(schema);
}

/**
 * Fetch and validate a shared experience without buffering an unbounded body.
 * Content-Length is deliberately ignored: it may be absent or inaccurate, so
 * the streamed byte count is the sole size authority.
 *
 * @param {string} url
 * @param {{controller?: AbortController, fetchImpl?: typeof fetch, timeoutMs?: number,
 *   maxBytes?: number, onProgress?: (progress: {bytesRead: number, maxBytes: number}) => void}} [options]
 * @returns {Promise<{text: string, payload: object, bytesRead: number}>}
 */
export async function fetchSharedExperienceJson(url, options = {}) {
  const controller = options.controller || new AbortController();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : SHARED_EXPERIENCE_DOWNLOAD_TIMEOUT_MS;
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : SHARED_EXPERIENCE_MAX_BYTES;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  if (typeof fetchImpl !== 'function') throw new SharedExperienceDownloadError('network_error');
  if (controller.signal.aborted) throw new SharedExperienceDownloadError('aborted');

  let response = null;
  let reader = null;
  let timedOut = false;
  let timeoutId = null;

  const cancelBody = reason => {
    try {
      if (reader) {
        void reader.cancel(reason).catch(() => {});
      } else if (response?.body && !response.body.locked) {
        void response.body.cancel(reason).catch(() => {});
      }
    } catch (_) {}
  };
  const abortDownload = reason => {
    try {
      if (!controller.signal.aborted) controller.abort(reason);
    } catch (_) {}
    cancelBody(reason);
  };
  const reject = (code, details) => {
    const error = new SharedExperienceDownloadError(code, details);
    abortDownload(error);
    throw error;
  };

  timeoutId = setTimeout(() => {
    timedOut = true;
    const error = new SharedExperienceDownloadError('timeout');
    abortDownload(error);
  }, timeoutMs);

  try {
    try {
      response = await fetchImpl(String(url || ''), {
        method: 'GET',
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store'
      });
    } catch (error) {
      if (timedOut) throw new SharedExperienceDownloadError('timeout');
      if (controller.signal.aborted) throw new SharedExperienceDownloadError('aborted');
      throw new SharedExperienceDownloadError('network_error');
    }

    if (timedOut) throw new SharedExperienceDownloadError('timeout');
    if (controller.signal.aborted) throw new SharedExperienceDownloadError('aborted');
    if (!response?.ok) reject('http_error', { status: Number(response?.status) || 0 });
    if (!isJsonContentType(response.headers?.get?.('content-type'))) reject('invalid_content_type');
    if (!response.body || typeof response.body.getReader !== 'function') reject('missing_body');

    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytesRead = 0;

    while (true) {
      let result;
      try {
        result = await reader.read();
      } catch (_) {
        if (timedOut) throw new SharedExperienceDownloadError('timeout');
        if (controller.signal.aborted) throw new SharedExperienceDownloadError('aborted');
        throw new SharedExperienceDownloadError('network_error');
      }

      if (timedOut) throw new SharedExperienceDownloadError('timeout');
      if (controller.signal.aborted) throw new SharedExperienceDownloadError('aborted');
      if (result.done) break;

      const chunk = result.value instanceof Uint8Array
        ? result.value
        : new Uint8Array(result.value?.buffer || result.value || []);
      if (bytesRead + chunk.byteLength > maxBytes) reject('size_limit');

      bytesRead += chunk.byteLength;
      try {
        text += decoder.decode(chunk, { stream: true });
      } catch (_) {
        reject('invalid_encoding');
      }

      try { onProgress?.({ bytesRead, maxBytes }); } catch (_) {}
    }

    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;

    try {
      text += decoder.decode();
    } catch (_) {
      throw new SharedExperienceDownloadError('invalid_encoding');
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new SharedExperienceDownloadError('invalid_json');
    }
    if (!isSupportedExperiencePayload(payload)) {
      throw new SharedExperienceDownloadError('invalid_schema');
    }

    return { text, payload, bytesRead };
  } catch (error) {
    if (error instanceof SharedExperienceDownloadError) throw error;
    if (timedOut) throw new SharedExperienceDownloadError('timeout');
    if (controller.signal.aborted) throw new SharedExperienceDownloadError('aborted');
    throw new SharedExperienceDownloadError('network_error');
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
