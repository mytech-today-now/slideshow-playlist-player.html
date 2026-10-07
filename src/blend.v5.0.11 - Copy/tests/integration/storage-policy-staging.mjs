import { createStorageUrlResolver } from '../../storage-url-resolver.js';

const CONFIRMATION = 'I_CONFIRM_DISPOSABLE_STAGING_ONLY';
const PATH_PREFIX = 'codex-policy-check/';

class MatrixFailure extends Error {}

function fail(message) {
  throw new MatrixFailure(message);
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) fail(`Required staging setting is missing: ${name}.`);
  return value;
}

function decodeJwtClaims(token) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function validateUserToken(token, label) {
  const claims = decodeJwtClaims(token);
  if (!claims || claims.role !== 'authenticated' || !String(claims.sub || '').trim()
      || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) * 1000 <= Date.now()) {
    fail(`${label} must be an unexpired user JWT with role authenticated and a subject claim.`);
  }
  return String(claims.sub);
}

function validateSyntheticPath(path, label) {
  if (!path.startsWith(PATH_PREFIX)
      || path.split('/').some(segment => !segment || segment === '.' || segment === '..')
      || /[?#%\\]/.test(path)) {
    fail(`${label} must be a literal object path under ${PATH_PREFIX}.`);
  }
  return path;
}

function encodeObjectPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function objectUrl(baseUrl, bucket, path, visibility = '') {
  const route = visibility ? `/${visibility}` : '';
  return `${baseUrl}/storage/v1/object${route}/${encodeURIComponent(bucket)}/${encodeObjectPath(path)}`;
}

async function responseStatus(url, { anonKey, accessToken = '', signed = false } = {}) {
  const headers = { Range: 'bytes=0-0' };
  if (!signed) {
    headers.apikey = anonKey;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  }
  let response;
  try {
    response = await fetch(url, { method: 'GET', headers });
  } catch (_) {
    fail('A staging Storage request failed before returning an HTTP response.');
  }
  const result = { ok: response.ok, status: response.status };
  try { await response.body?.cancel(); } catch (_) {}
  return result;
}

function resolverFor({ baseUrl, anonKey, privateBucket, publicBucket, accessToken }) {
  return createStorageUrlResolver({
    config: {
      supabaseUrl: baseUrl,
      supabaseAnonKey: anonKey,
      defaultBucket: privateBucket,
      publicBucketAllowList: [publicBucket],
      signedUrlTtlSeconds: 60
    },
    authClient: { getAccessToken: () => accessToken },
    fetchImpl: globalThis.fetch.bind(globalThis),
    requestTimeoutMs: 15_000
  });
}

function checked(condition, message) {
  if (!condition) fail(message);
}

function isPrivateReadDeniedStatus(status) {
  // 400 is accepted only alongside the owner's successful read, for providers
  // that mask an RLS denial as an object-not-found response.
  return [400, 401, 403, 404].includes(status);
}

function isAuthenticatedReadDeniedStatus(status) {
  // A 401 for user B means the fixture principal itself was not authenticated.
  return [400, 403, 404].includes(status);
}

async function main() {
  if (process.env.BLEND_STORAGE_STAGING_CONFIRM !== CONFIRMATION) {
    console.log('SKIP: no requests sent. Set BLEND_STORAGE_STAGING_CONFIRM to opt into the disposable staging matrix.');
    return;
  }

  const baseUrl = required('BLEND_STORAGE_STAGING_SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = required('BLEND_STORAGE_STAGING_ANON_KEY');
  const privateBucket = required('BLEND_STORAGE_STAGING_PRIVATE_BUCKET');
  const privatePath = validateSyntheticPath(required('BLEND_STORAGE_STAGING_PRIVATE_PATH'), 'Private fixture');
  const ownerToken = required('BLEND_STORAGE_STAGING_OWNER_ACCESS_TOKEN');
  const otherToken = required('BLEND_STORAGE_STAGING_OTHER_ACCESS_TOKEN');
  const publicBucket = required('BLEND_STORAGE_STAGING_PUBLIC_BUCKET');
  const publicPath = validateSyntheticPath(required('BLEND_STORAGE_STAGING_PUBLIC_PATH'), 'Public fixture');

  let parsedBase;
  try { parsedBase = new URL(baseUrl); } catch (_) { fail('Staging Supabase URL must be an absolute URL.'); }
  if (parsedBase.protocol !== 'https:' || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
    fail('Staging Supabase URL must use HTTPS and contain no embedded credentials or query data.');
  }
  if (privateBucket === publicBucket) fail('Use separate private and public fixture buckets.');
  if (anonKey.startsWith('sb_secret_') || decodeJwtClaims(anonKey)?.role === 'service_role') {
    fail('The staging API key must be a public anon/publishable key, never a service key.');
  }

  const ownerId = validateUserToken(ownerToken, 'Owner A token');
  const otherId = validateUserToken(otherToken, 'Unrelated user B token');
  if (ownerToken === otherToken || ownerId === otherId) {
    fail('Owner A and unrelated user B must be distinct authenticated principals.');
  }

  const privateObject = objectUrl(baseUrl, privateBucket, privatePath);
  const anonymousPrivate = await responseStatus(privateObject, { anonKey });
  checked(isPrivateReadDeniedStatus(anonymousPrivate.status), 'Anonymous private request did not return a denial status.');
  const anonymousResolver = resolverFor({ baseUrl, anonKey, privateBucket, publicBucket, accessToken: '' });
  let anonymousError = null;
  try {
    await anonymousResolver.resolve(`supabase://${privateBucket}/${privatePath}`);
    fail('The app resolver returned a private URL to an anonymous principal.');
  } catch (error) {
    if (error instanceof MatrixFailure) throw error;
    anonymousError = error;
  }
  checked(anonymousError?.code === 'auth_required', 'Anonymous resolver failure was not the expected local auth gate.');
  console.log(`PASS anonymous private read denied (HTTP ${anonymousPrivate.status}); resolver returned no URL`);

  const ownerDirect = await responseStatus(privateObject, { anonKey, accessToken: ownerToken });
  checked(ownerDirect.ok, `Owner A could not read the synthetic private object (HTTP ${ownerDirect.status}).`);
  const ownerResolver = resolverFor({ baseUrl, anonKey, privateBucket, publicBucket, accessToken: ownerToken });
  let ownerResult;
  try { ownerResult = await ownerResolver.resolve(`supabase://${privateBucket}/${privatePath}`); }
  catch (_) { fail('Owner A could not resolve the synthetic private object through the app resolver.'); }
  checked(ownerResult?.signed === true, 'Owner A resolution did not return a signed private URL.');
  let signedOrigin;
  try { signedOrigin = new URL(ownerResult.url).origin; } catch (_) { fail('Owner A resolver returned an invalid signed URL.'); }
  checked(signedOrigin === parsedBase.origin, 'Owner A resolver returned a URL outside the staging project.');
  const ownerSigned = await responseStatus(ownerResult.url, { anonKey, signed: true });
  checked(ownerSigned.ok, `Owner A signed URL could not read the synthetic private object (HTTP ${ownerSigned.status}).`);
  console.log(`PASS owner A private read allowed (direct HTTP ${ownerDirect.status}; signed HTTP ${ownerSigned.status})`);

  const otherDirect = await responseStatus(privateObject, { anonKey, accessToken: otherToken });
  checked(isAuthenticatedReadDeniedStatus(otherDirect.status), 'Unrelated user B private request did not return a denial status.');
  const otherResolver = resolverFor({ baseUrl, anonKey, privateBucket, publicBucket, accessToken: otherToken });
  let otherResult = null;
  let otherError = null;
  try { otherResult = await otherResolver.resolve(`supabase://${privateBucket}/${privatePath}`); }
  catch (error) { otherError = error; }
  if (!otherResult) {
    checked(isAuthenticatedReadDeniedStatus(Number(otherError?.status)), 'Unrelated user B resolver request did not return a policy denial status.');
  }
  let otherSigned = null;
  if (otherResult) {
    checked(otherResult.signed === true && !!otherResult.url, 'Unrelated user B resolver treated the private fixture as public.');
    let otherOrigin;
    try { otherOrigin = new URL(otherResult.url).origin; } catch (_) { fail('Unrelated user B received an invalid signed URL.'); }
    checked(otherOrigin === parsedBase.origin, 'Unrelated user B resolver returned a URL outside the staging project.');
    otherSigned = await responseStatus(otherResult.url, { anonKey, signed: true });
  }
  if (otherSigned) checked(isAuthenticatedReadDeniedStatus(otherSigned.status), 'Unrelated user B resolved request did not return a denial status.');
  console.log(`PASS unrelated user B private read denied (direct HTTP ${otherDirect.status}${otherSigned ? `; resolved HTTP ${otherSigned.status}` : '; resolver returned no URL'})`);

  const publicObject = objectUrl(baseUrl, publicBucket, publicPath, 'public');
  async function checkPublicObject(principal, accessToken) {
    const direct = await responseStatus(publicObject, { anonKey, accessToken });
    checked(direct.ok, `${principal} could not read the allowlisted public object directly (HTTP ${direct.status}).`);

    const resolver = resolverFor({ baseUrl, anonKey, privateBucket, publicBucket, accessToken });
    let resolved;
    try { resolved = await resolver.resolve(`supabase://${publicBucket}/${publicPath}`); }
    catch (_) { fail(`${principal} could not resolve the allowlisted public object through the app.`); }
    checked(resolved?.signed === false && resolved.visibility === 'public', `${principal} resolver did not use the public allowlist.`);
    let resolvedOrigin;
    try { resolvedOrigin = new URL(resolved.url).origin; } catch (_) { fail(`${principal} public resolver returned an invalid URL.`); }
    checked(resolvedOrigin === parsedBase.origin, `${principal} public resolver returned a URL outside the staging project.`);

    // Public resolution must remain readable without attaching a user token.
    const throughResolver = await responseStatus(resolved.url, { anonKey });
    checked(throughResolver.ok, `${principal} could not read the resolved public object (HTTP ${throughResolver.status}).`);
    console.log(`PASS ${principal} public read allowed (direct HTTP ${direct.status}; resolver HTTP ${throughResolver.status})`);
  }

  await checkPublicObject('anonymous', '');
  await checkPublicObject('owner A', ownerToken);
  await checkPublicObject('unrelated user B', otherToken);
}

main().catch(error => {
  console.error(`FAIL: ${error instanceof MatrixFailure ? error.message : 'Unexpected staging matrix error; request details were suppressed.'}`);
  process.exitCode = 1;
});
