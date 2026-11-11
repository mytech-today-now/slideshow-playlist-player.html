const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function parseAllowedHttpUrl(value, baseUrl) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, baseUrl);
    return HTTP_PROTOCOLS.has(url.protocol) ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

export function resolveHttpShareUrl(value, baseUrl, fallback = '') {
  return parseAllowedHttpUrl(value, baseUrl) || parseAllowedHttpUrl(fallback, baseUrl);
}

export function isUnsupportedImportScheme(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return false;

  const normalized = raw.replace(/\\/g, '/');
  if (/^[a-z]:\//i.test(normalized)) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (/^(?:supabase|storage|ipfs):\/\//i.test(normalized)) return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(raw);
}

export function resolvePlatformShareUrl(value, platformId, baseUrl) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, baseUrl);
    if (HTTP_PROTOCOLS.has(url.protocol)) return url.toString();
    if (String(platformId || '').trim().toLowerCase() === 'email' && url.protocol === 'mailto:') {
      return url.toString();
    }
  } catch (_) {}
  return '';
}
