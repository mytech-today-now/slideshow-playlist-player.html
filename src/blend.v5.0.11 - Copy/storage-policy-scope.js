// Source-controlled Storage authorization scope for this build.
// Owner evidence and an independently reviewed current policy revision are
// absent, so keep both values empty until a separate reviewed release change.
export const TRUSTED_STORAGE_POLICY_SCOPE = null;
export const CURRENT_STORAGE_POLICY_REVISION = '';

export const PRIVATE_STORAGE_SIGNING_UNAVAILABLE_MESSAGE = 'Private Storage signing is unavailable until the project owner records a reviewed policy revision. You can play local files and direct public media URLs, and you can export JSON.';

/**
 * Check an immutable release scope against the configured project, current
 * policy revision, and optionally the requested Storage bucket.
 */
export function hasVerifiedStoragePolicyScope(scope, {
  projectUrl = '',
  policyRevision = '',
  bucket = undefined
} = {}) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || !Array.isArray(scope.shareableBuckets)) {
    return false;
  }

  const approvedProject = normalizeProjectUrl(scope.projectUrl);
  const currentProject = normalizeProjectUrl(projectUrl);
  const approvedRevision = typeof scope.policyRevision === 'string' ? scope.policyRevision.trim() : '';
  const currentRevision = typeof policyRevision === 'string' ? policyRevision.trim() : '';
  const buckets = scope.shareableBuckets.map(value => String(value || '').trim().toLowerCase());
  const hasValidBuckets = buckets.length > 0
    && buckets.every(value => /^[a-z0-9][a-z0-9._-]{1,62}$/.test(value));
  const requestedBucket = bucket === undefined ? '' : String(bucket || '').trim().toLowerCase();
  const bucketMatches = bucket === undefined
    || (!!requestedBucket && /^[a-z0-9][a-z0-9._-]{1,62}$/.test(requestedBucket) && buckets.includes(requestedBucket));

  return !!approvedProject && approvedProject === currentProject
    && !!approvedRevision && approvedRevision === currentRevision
    && hasValidBuckets && bucketMatches;
}

function normalizeProjectUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin.toLowerCase()}${path}`;
  } catch (_) {
    return '';
  }
}
