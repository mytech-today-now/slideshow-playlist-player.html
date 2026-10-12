import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GitCatalogError,
  buildPublicFileUrl,
  catalogIndexPath,
  catalogPlaylistPath,
  fetchPublicCatalog,
  fetchPublicRepositoryFile,
  loadPublicCatalogSettings,
  normalizePublicCatalogSettings,
  parsePublicCatalogIndex,
  parsePublicPlaylistDocument,
  publicCatalogConfigKey,
  savePublicCatalogSettings
} from '../../git-playlist-catalog.js';

const settings = (provider = 'github', extra = {}) => ({
  provider,
  owner: 'blend-team',
  repository: 'public-playlists',
  branch: 'main',
  directory: 'blend-catalog',
  ...extra
});

function githubFileResponse(text, status = 200) {
  const content = Buffer.from(text, 'utf8').toString('base64');
  return new Response(JSON.stringify({ type: 'file', encoding: 'base64', content }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function publicPlaylist(overrides = {}) {
  return JSON.stringify({
    version: '5.0.11',
    schema: 'player.blend.list.v1',
    type: 'playlist',
    name: 'Public music',
    description: 'Curated audio',
    project: 'Private app project name is stripped',
    exportedAt: '2026-10-11T00:00:00.000Z',
    order: ['track-a', 'track-b'],
    items: [
      { id: 'track-a', path: 'https://media.example.org/a.mp3', sourceUrl: 'https://media.example.org/a.mp3', pathKind: 'remote', name: 'A', type: 'audio', order: 0, size: 12, stale: false },
      { id: 'track-b', path: 'https://media.example.org/b.mp3', sourceUrl: 'https://media.example.org/b.mp3', pathKind: 'remote', name: 'B', type: 'audio', order: 1, size: 18, stale: false }
    ],
    ...overrides
  });
}

function assertCatalogError(error, code) {
  assert.ok(error instanceof GitCatalogError);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
}

test('requires an explicit provider and validates repository settings', () => {
  assert.throws(() => normalizePublicCatalogSettings({}), error => error.code === 'invalid_provider');
  assert.deepEqual(normalizePublicCatalogSettings(settings()), {
    provider: 'github', owner: 'blend-team', repository: 'public-playlists', branch: 'main', directory: 'blend-catalog'
  });
  assert.throws(() => normalizePublicCatalogSettings(settings('github', { owner: '../other' })), error => error.code === 'invalid_repository_settings');
  assert.throws(() => normalizePublicCatalogSettings(settings('github', { branch: 'main?token=x' })), error => error.code === 'invalid_repository_settings');
  assert.throws(() => normalizePublicCatalogSettings(settings('github', { directory: '../private' })), error => error.code === 'invalid_repository_settings');
  assert.throws(() => normalizePublicCatalogSettings(settings('github', { owner: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890' })), error => error.code === 'invalid_repository_settings');
  assert.throws(() => normalizePublicCatalogSettings(settings('bitbucket', { repository: 'ATBB0123456789abcdefghijklmnopqrstuvwxyz' })), error => error.code === 'invalid_repository_settings');
  assert.throws(() => normalizePublicCatalogSettings(settings('bitbucket', { provider: 'gitlab' })), error => error.code === 'invalid_provider');
});

test('persists only public catalog coordinates and never credentials', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); }
  };
  const saved = savePublicCatalogSettings(storage, { ...settings(), token: 'not-persisted', clientSecret: 'not-persisted' });
  assert.deepEqual(saved, { provider: 'github', owner: 'blend-team', repository: 'public-playlists', branch: 'main', directory: 'blend-catalog' });
  assert.equal(publicCatalogConfigKey(), 'blend-public-git-catalog-v1');
  const stored = values.get(publicCatalogConfigKey());
  assert.equal(stored.includes('not-persisted'), false);
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ['branch', 'directory', 'owner', 'provider', 'repository']);
  assert.deepEqual(loadPublicCatalogSettings(storage), saved);
});

test('builds fixed provider URLs with validated, encoded paths', () => {
  const github = settings('github', { owner: 'team name' });
  assert.throws(() => buildPublicFileUrl(github, catalogIndexPath(github)), error => error.code === 'invalid_repository_settings');
  const gh = settings('github', { branch: 'release/v1' });
  assert.equal(catalogIndexPath(gh), 'blend-catalog/index.v1.json');
  assert.equal(catalogPlaylistPath(gh, 'ambient_1'), 'blend-catalog/playlists/ambient_1.json');
  const githubUrl = new URL(buildPublicFileUrl(gh, catalogIndexPath(gh)));
  assert.equal(githubUrl.origin, 'https://api.github.com');
  assert.equal(githubUrl.pathname, '/repos/blend-team/public-playlists/contents/blend-catalog/index.v1.json');
  assert.equal(githubUrl.searchParams.get('ref'), 'release/v1');
  const bitbucketUrl = new URL(buildPublicFileUrl(settings('bitbucket'), catalogIndexPath(settings('bitbucket'))));
  assert.equal(bitbucketUrl.origin, 'https://api.bitbucket.org');
  assert.equal(bitbucketUrl.pathname, '/2.0/repositories/blend-team/public-playlists/src/main/blend-catalog/index.v1.json');
  assert.throws(() => buildPublicFileUrl(gh, 'blend-catalog/../secrets.json'), error => error.code === 'unsafe_repository_path');
  assert.throws(() => buildPublicFileUrl(gh, 'other-repo/private.json'), error => error.code === 'unsafe_repository_path');
  assert.throws(() => catalogPlaylistPath(gh, '../other'), error => error.code === 'unsafe_playlist_id');
});

test('GitHub public file reads decode bounded Contents API base64 without credentials or cache', async () => {
  const requestLog = [];
  const text = '{"hello":"Blend"}';
  const result = await fetchPublicRepositoryFile(settings('github'), catalogIndexPath(settings('github')), {
    fetchImpl: async (url, options) => {
      requestLog.push({ url, options });
      return githubFileResponse(text);
    }
  });
  assert.equal(result, text);
  assert.equal(requestLog.length, 1);
  assert.equal(new URL(requestLog[0].url).origin, 'https://api.github.com');
  assert.equal(requestLog[0].options.method, 'GET');
  assert.equal(requestLog[0].options.credentials, 'omit');
  assert.equal(requestLog[0].options.cache, 'no-store');
  assert.equal(requestLog[0].options.redirect, 'error');
  assert.equal('Authorization' in requestLog[0].options.headers, false);
  assert.equal(requestLog[0].options.headers['X-GitHub-Api-Version'], '2026-03-10');
});

test('Bitbucket Cloud public file reads use the fixed source endpoint with no credential headers', async () => {
  const requestLog = [];
  const text = '{"schema":"player.blend.catalog.v1","playlists":[]}';
  const result = await fetchPublicRepositoryFile(settings('bitbucket'), catalogIndexPath(settings('bitbucket')), {
    fetchImpl: async (url, options) => {
      requestLog.push({ url, options });
      return new Response(text, { status: 200 });
    }
  });
  assert.equal(result, text);
  assert.equal(new URL(requestLog[0].url).origin, 'https://api.bitbucket.org');
  assert.equal(requestLog[0].options.credentials, 'omit');
  assert.equal(requestLog[0].options.cache, 'no-store');
  assert.equal(requestLog[0].options.redirect, 'error');
  assert.equal('Authorization' in requestLog[0].options.headers, false);
});

test('fetches and validates a catalog index on GitHub', async () => {
  const index = JSON.stringify({ schema: 'player.blend.catalog.v1', playlists: [{ id: 'ambient', title: 'Ambient' }] });
  const playlists = await fetchPublicCatalog(settings(), { fetchImpl: async () => githubFileResponse(index) });
  assert.deepEqual(playlists, [{ id: 'ambient', title: 'Ambient' }]);
});

test('fetches and validates a catalog index on Bitbucket Cloud', async () => {
  const index = JSON.stringify({ schema: 'player.blend.catalog.v1', playlists: [{ id: 'ambient', title: 'Ambient' }] });
  const playlists = await fetchPublicCatalog(settings('bitbucket'), {
    fetchImpl: async () => new Response(index, { status: 200 })
  });
  assert.deepEqual(playlists, [{ id: 'ambient', title: 'Ambient' }]);
});

test('catalog index rejects malformed, unsupported, duplicate, unsafe, and oversized entries', () => {
  assert.throws(() => parsePublicCatalogIndex('{'), error => error.code === 'malformed_catalog_index');
  assert.throws(() => parsePublicCatalogIndex('{"schema":"v2","playlists":[]}'), error => error.code === 'unsupported_catalog_schema');
  assert.throws(() => parsePublicCatalogIndex(JSON.stringify({ schema: 'player.blend.catalog.v1', playlists: [{ id: 'x', title: 'X', path: '../../secret' }] })), error => error.code === 'invalid_catalog_entry');
  assert.throws(() => parsePublicCatalogIndex(JSON.stringify({ schema: 'player.blend.catalog.v1', playlists: [{ id: 'same', title: 'One' }, { id: 'same', title: 'Two' }] })), error => error.code === 'invalid_catalog_entry');
  assert.throws(() => parsePublicCatalogIndex(' '.repeat(256_001)), error => error.code === 'catalog_index_too_large');
});

test('sanitizes a public player.blend.list.v1 playlist and honors stable order', () => {
  const normalized = parsePublicPlaylistDocument(publicPlaylist(), { id: 'music', title: 'Catalog title' });
  assert.equal(normalized.schema, 'player.blend.list.v1');
  assert.equal(normalized.name, 'Public music');
  assert.deepEqual(normalized.items.map(item => item.id), ['track-a', 'track-b']);
  assert.equal(normalized.project, undefined);
  assert.equal(normalized.exportedAt, undefined);
  assert.equal(normalized.items[0].metadata, undefined);
  assert.equal(normalized.items[0].sourceUrl, 'https://media.example.org/a.mp3');
});

test('public playlist validation rejects local paths, signed URLs, private fields, and unsupported schemas', () => {
  const winPath = JSON.parse(publicPlaylist());
  winPath.items[0].path = 'C:\\Users\\private\\song.mp3';
  winPath.items[0].sourceUrl = '';
  assert.throws(() => parsePublicPlaylistDocument(JSON.stringify(winPath), { id: 'music', title: 'Music' }), error => error.code === 'private_or_unsafe_media_reference');

  const signed = JSON.parse(publicPlaylist());
  signed.items[0].path = 'https://media.example.org/song.mp3?token=secret';
  signed.items[0].sourceUrl = signed.items[0].path;
  assert.throws(() => parsePublicPlaylistDocument(JSON.stringify(signed), { id: 'music', title: 'Music' }), error => error.code === 'private_or_unsafe_media_reference');

  const privateHost = JSON.parse(publicPlaylist());
  privateHost.items[0].path = 'https://127.0.0.1/private.mp3';
  privateHost.items[0].sourceUrl = privateHost.items[0].path;
  assert.throws(() => parsePublicPlaylistDocument(JSON.stringify(privateHost), { id: 'music', title: 'Music' }), error => error.code === 'private_or_unsafe_media_reference');

  const localDomain = JSON.parse(publicPlaylist());
  localDomain.items[0].path = 'https://internal.localhost/private.mp3';
  localDomain.items[0].sourceUrl = localDomain.items[0].path;
  assert.throws(() => parsePublicPlaylistDocument(JSON.stringify(localDomain), { id: 'music', title: 'Music' }), error => error.code === 'private_or_unsafe_media_reference');

  const privateField = JSON.parse(publicPlaylist());
  privateField.items[0].metadata = { storageReference: 'private' };
  assert.throws(() => parsePublicPlaylistDocument(JSON.stringify(privateField), { id: 'music', title: 'Music' }), error => error.code === 'disallowed_playlist_fields');

  const experience = JSON.parse(publicPlaylist());
  experience.schema = 'player.blend.experience.v2';
  experience.type = 'experience';
  assert.throws(() => parsePublicPlaylistDocument(JSON.stringify(experience), { id: 'music', title: 'Music' }), error => error.code === 'unsupported_playlist_schema');
});

test('playlist validation rejects signed path markers, mismatched types, and invalid order', () => {
  const signedPath = JSON.parse(publicPlaylist());
  signedPath.items[0].path = 'https://media.example.org/storage/sign/song.mp3';
  signedPath.items[0].sourceUrl = signedPath.items[0].path;
  assert.throws(() => parsePublicPlaylistDocument(JSON.stringify(signedPath), { id: 'music', title: 'Music' }), error => error.code === 'private_or_unsafe_media_reference');

  const mismatched = JSON.parse(publicPlaylist());
  mismatched.items[0].type = 'video';
  assert.throws(() => parsePublicPlaylistDocument(JSON.stringify(mismatched), { id: 'music', title: 'Music' }), error => error.code === 'invalid_playlist_item');

  const wrongOrder = JSON.parse(publicPlaylist());
  wrongOrder.order = ['track-a', 'track-a'];
  assert.throws(() => parsePublicPlaylistDocument(JSON.stringify(wrongOrder), { id: 'music', title: 'Music' }), error => error.code === 'invalid_playlist_order');
});

test('maps provider errors without exposing response bodies and rejects oversized files', async () => {
  await assert.rejects(fetchPublicRepositoryFile(settings(), catalogIndexPath(settings()), {
    fetchImpl: async () => new Response('private provider error body', { status: 404 })
  }), error => { assertCatalogError(error, 'repository_or_file_not_found'); return true; });
  await assert.rejects(fetchPublicRepositoryFile(settings(), catalogIndexPath(settings()), {
    fetchImpl: async () => new Response('secret body', { status: 403 })
  }), error => { assertCatalogError(error, 'provider_rate_limit_or_access_denied'); return true; });
  await assert.rejects(fetchPublicRepositoryFile(settings('bitbucket'), catalogIndexPath(settings('bitbucket')), {
    fetchImpl: async () => new Response('rate limited body', { status: 429 })
  }), error => { assertCatalogError(error, 'provider_rate_limit_or_access_denied'); return true; });
  await assert.rejects(fetchPublicRepositoryFile(settings('bitbucket'), catalogIndexPath(settings('bitbucket')), {
    fetchImpl: async () => new Response('x'.repeat(1_000_001), { status: 200 })
  }), error => error.code === 'response_too_large');
});

test('maps network/CORS failures and request timeouts to stable errors', async () => {
  await assert.rejects(fetchPublicRepositoryFile(settings(), catalogIndexPath(settings()), {
    fetchImpl: async () => { throw new TypeError('origin-specific private detail'); }
  }), error => { assertCatalogError(error, 'network_or_cors_error'); return true; });

  await assert.rejects(fetchPublicRepositoryFile(settings(), catalogIndexPath(settings()), {
    timeoutMs: 5,
    fetchImpl: (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true });
    })
  }), error => { assertCatalogError(error, 'request_timeout'); return true; });
});
