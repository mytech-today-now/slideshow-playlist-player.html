export function normalizeRelinkPath(path) {
  const raw = String(path ?? '').trim().replace(/^['"`]|['"`]$/g, '');
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';

  const slashed = raw.replace(/\\/g, '/');
  if (/^(?:[a-z]:\/|\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(slashed)) return '';

  const segments = slashed.split('/').filter(segment => segment && segment !== '.');
  if (segments.some(segment => segment === '..')) return '';
  return segments.join('/').toLowerCase();
}

function stableLibraryPath(pathHint, name) {
  const normalizedPath = normalizeRelinkPath(pathHint);
  const normalizedName = normalizeRelinkPath(name);
  if (!normalizedPath || !normalizedName || normalizedPath === normalizedName) return '';
  return normalizedPath;
}

export function hasSameLibraryMediaIdentity(existing, candidate, normalizeSourceUrl = value => String(value || '')) {
  if (!existing || !candidate) return false;

  const sourceUrl = normalizeSourceUrl(candidate.sourceUrl || '');
  if (sourceUrl) return normalizeSourceUrl(existing.sourceUrl || '') === sourceUrl;

  const candidatePath = stableLibraryPath(candidate.pathHint, candidate.name);
  if (!candidatePath) return false;
  const existingPath = stableLibraryPath(existing.pathHint, existing.name);
  return !!existingPath && existingPath === candidatePath;
}

function normalizeRelinkBasename(value) {
  const basename = String(value || '')
    .trim()
    .replace(/^['"`]|['"`]$/g, '')
    .replace(/[\\/]+$/g, '')
    .split(/[\\/]/)
    .pop() || '';
  return normalizeRelinkPath(basename);
}

function appendCandidate(index, key, candidate) {
  if (!key) return;
  const candidates = index.get(key) || [];
  candidates.push(candidate);
  index.set(key, candidates);
}

export function indexRelinkCandidates(candidates) {
  const byPath = new Map();
  const byBasename = new Map();

  for (const candidate of candidates || []) {
    const name = candidate?.name || candidate?.handle?.name || '';
    const pathHint = candidate?.pathHint || candidate?.handle?.pathHint || name;
    appendCandidate(byPath, normalizeRelinkPath(pathHint), candidate);
    appendCandidate(byBasename, normalizeRelinkBasename(name || pathHint), candidate);
  }

  return { byPath, byBasename };
}

export function findRelinkCandidates(index, missingEntry = {}) {
  const pathMatch = normalizeRelinkPath(missingEntry.relinkPath || missingEntry.path || '');
  const exactCandidates = pathMatch ? index?.byPath?.get(pathMatch) : null;
  if (exactCandidates?.length) {
    return { matchType: 'path', candidates: exactCandidates.slice() };
  }

  const basename = normalizeRelinkBasename(
    missingEntry.basename || missingEntry.path || missingEntry.name || ''
  );
  const nameCandidates = basename ? index?.byBasename?.get(basename) : null;
  return { matchType: 'basename', candidates: nameCandidates?.slice() || [] };
}
