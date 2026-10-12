import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GitPlaylistError,
  createGitPlaylistClient,
  gitPlaylistCredentialKey,
  gitPlaylistSettingsKey,
  hasRememberedGitPlaylistCredential,
  loadGitPlaylistSettings,
  normalizeGitPlaylistSettings,
  saveGitPlaylistSettings,
  serializeRemotePlaylist
} from '../../git-playlist-storage.js';

const TOKEN = 'sentinel-git-token-not-a-real-credential';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const settings = (provider = 'github', extra = {}) => ({
  provider,
  owner: provider === 'github' ? 'blend-team' : 'blend-workspace',
  repository: 'playlists',
  branch: 'main',
  path: 'playlists/ambient.json',
  ...extra
});

function playlistDocument(overrides = {}) {
  return JSON.stringify({
    schema: 'player.blend.list.v1',
    type: 'playlist',
    name: 'Café playlist',
    description: 'Safe remote list',
    order: ['track-a'],
    items: [{
      id: 'track-a',
      path: 'https://media.example.org/cafe.mp3',
      sourceUrl: 'https://media.example.org/cafe.mp3',
      pathKind: 'remote',
      name: 'Café music',
      type: 'audio',
      order: 0,
      metadata: undefined
    }],
    ...overrides
  });
}

function githubContents(text, sha = SHA_A) {
  return new Response(JSON.stringify({
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(text, 'utf8').toString('base64'),
    sha
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function githubFetch({ privateRepo = false, fileText = playlistDocument(), fileSha = SHA_A, onPut = null, refSha = SHA_A } = {}) {
  const calls = [];
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    calls.push({ url, options });
    if (url.origin !== 'https://api.github.com') return new Response('wrong host', { status: 500 });
    if (url.pathname === '/repos/blend-team/playlists') {
      return new Response(JSON.stringify({ private: privateRepo, full_name: 'blend-team/playlists' }), { status: 200 });
    }
    if (url.pathname === '/repos/blend-team/playlists/git/ref/heads/main') {
      return new Response(JSON.stringify({ ref: 'refs/heads/main', object: { sha: refSha, type: 'commit' } }), { status: 200 });
    }
    if (url.pathname === '/repos/blend-team/playlists/contents/playlists/ambient.json') {
      if (options.method === 'PUT') return onPut ? onPut({ url, options, calls }) : new Response(JSON.stringify({ content: { sha: SHA_B }, commit: { sha: SHA_B } }), { status: 201 });
      return fileText == null ? new Response('provider detail stays hidden', { status: 404 }) : githubContents(fileText, fileSha);
    }
    return new Response('provider detail stays hidden', { status: 404 });
  };
  return { calls, fetchImpl };
}

function bitbucketFetch({ privateRepo = true, fileText = playlistDocument(), head = SHA_A, onPost = null } = {}) {
  const calls = [];
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    calls.push({ url, options });
    if (url.origin !== 'https://api.bitbucket.org') return new Response('wrong host', { status: 500 });
    if (url.pathname === '/2.0/repositories/blend-workspace/playlists') {
      return new Response(JSON.stringify({ is_private: privateRepo }), { status: 200 });
    }
    if (url.pathname === '/2.0/repositories/blend-workspace/playlists/refs/branches') {
      return new Response(JSON.stringify({ values: [{ name: 'main', target: { hash: head } }] }), { status: 200 });
    }
    if (url.pathname === `/2.0/repositories/blend-workspace/playlists/src/${head}/playlists/ambient.json` && options.method === 'GET') {
      return fileText == null ? new Response('not found', { status: 404 }) : new Response(fileText, { status: 200 });
    }
    if (url.pathname === '/2.0/repositories/blend-workspace/playlists/src' && options.method === 'POST') {
      return onPost ? onPost({ url, options, calls }) : new Response('', { status: 201 });
    }
    return new Response('provider detail stays hidden', { status: 404 });
  };
  return { calls, fetchImpl };
}

async function connectGithub(client, value = settings(), token = TOKEN) {
  return client.connect(value, token);
}

async function connectBitbucket(client, value = settings('bitbucket'), token = TOKEN) {
  return client.connect(value, token);
}

function assertApiOptions(call, token = TOKEN) {
  assert.equal(call.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(call.options.headers['X-GitHub-Api-Version'], undefined);
  assert.equal(call.options.credentials, 'omit');
  assert.equal(call.options.cache, 'no-store');
  assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.mode, 'cors');
  assert.ok(!call.url.href.includes(token));
}

test('validates fixed-provider coordinates and keeps repository settings separate from credentials', () => {
  assert.deepEqual(normalizeGitPlaylistSettings(settings()), settings());
  assert.throws(() => normalizeGitPlaylistSettings({}), error => error.code === 'invalid_provider');
  for (const invalid of [
    settings('github', { owner: '../other' }),
    settings('github', { repository: 'repo?token=secret' }),
    settings('github', { branch: 'main?token=secret' }),
    settings('github', { path: '../private.json' }),
    settings('github', { path: 'folder/list.txt' }),
    settings('github', { path: 'folder/%2e%2e/private.json' }),
    settings('gitlab')
  ]) assert.throws(() => normalizeGitPlaylistSettings(invalid));

  const storage = memoryStorage();
  const saved = saveGitPlaylistSettings(storage, { ...settings(), token: TOKEN, clientSecret: TOKEN });
  assert.deepEqual(saved, settings());
  assert.equal(loadGitPlaylistSettings(storage).path, 'playlists/ambient.json');
  assert.equal(storage.getItem(gitPlaylistSettingsKey()).includes(TOKEN), false);
  assert.equal(storage.getItem(gitPlaylistCredentialKey()), null);
});

test('serializes only a validated playlist allowlist and rejects private, signed, local, and malformed media', () => {
  const text = serializeRemotePlaylist([{
    id: 'local-path-id-is-not-published',
    path: 'C:\\Users\\private\\song.mp3',
    sourceUrl: 'https://media.example.org/cafe.mp3',
    name: 'Café music',
    type: 'audio',
    includeAudio: false,
    displayDuration: 12
  }], 'Café mix');
  const payload = JSON.parse(text);
  assert.equal(payload.schema, 'player.blend.list.v1');
  assert.equal(payload.name, 'Café mix');
  assert.equal(payload.items[0].id, 'item-1');
  assert.equal(payload.items[0].path, 'https://media.example.org/cafe.mp3');
  assert.equal(payload.items[0].sourceUrl, 'https://media.example.org/cafe.mp3');
  assert.equal(payload.items[0].includeAudio, false);
  assert.equal(payload.items[0].displayDuration, 12);
  assert.equal('metadata' in payload.items[0], false);
  assert.equal('project' in payload, false);
  assert.equal('id' in payload.items[0] && payload.items[0].id.includes('local-path'), false);

  for (const sourceUrl of [
    'C:\\Users\\private\\song.mp3',
    'https://media.example.org/song.mp3?token=private',
    'https://media.example.org/storage/sign/song.mp3',
    'https://127.0.0.1/song.mp3',
    'https://media.local/song.mp3',
    'https://media.example.org/song.txt'
  ]) {
    assert.throws(() => serializeRemotePlaylist([{ sourceUrl, name: 'song', type: 'audio' }]), error => error.code === 'unsafe_playlist_content');
  }
  assert.throws(() => serializeRemotePlaylist([], 'Empty'), error => error.code === 'invalid_playlist');
  assert.throws(() => serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/song.mp3', type: 'video', name: 'song' }]), error => error.code === 'unsafe_playlist_content');
});

test('connect confirms repository and branch read access with GET only and reports unknown visibility safely', async () => {
  const { calls, fetchImpl } = githubFetch({ privateRepo: false });
  const client = createGitPlaylistClient({ fetchImpl });
  const result = await connectGithub(client);
  assert.equal(result.visibility, 'public');
  assert.equal(result.readAccess, 'confirmed');
  assert.equal(result.writeAccess, 'unverified');
  assert.equal(calls.every(call => call.options.method === 'GET'), true);
  assert.equal(calls.some(call => call.url.pathname.endsWith('/git/ref/heads/main')), true);
  for (const call of calls) assertApiOptions(call);

  const unknownFetch = async url => new URL(url).pathname === '/repos/blend-team/playlists'
    ? new Response(JSON.stringify({ full_name: 'blend-team/playlists' }), { status: 200 })
    : new Response(JSON.stringify({ ref: 'refs/heads/main', object: { sha: SHA_A } }), { status: 200 });
  const unknown = createGitPlaylistClient({ fetchImpl: unknownFetch });
  const unknownResult = await connectGithub(unknown);
  assert.equal(unknownResult.visibility, 'unknown');
});

test('connect distinguishes denied access and never exposes provider response bodies', async () => {
  for (const [status, code] of [[401, 'authentication_failed'], [403, 'permission_denied'], [429, 'rate_limited']]) {
    const client = createGitPlaylistClient({ fetchImpl: async () => new Response('private provider diagnostic sentinel', { status }) });
    await assert.rejects(client.connect(settings(), TOKEN), error => {
      assert.ok(error instanceof GitPlaylistError);
      assert.equal(error.code, code);
      assert.equal(error.message.includes('private provider diagnostic sentinel'), false);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });
  }
});

test('session credentials default to memory, explicit remembering is separate, disconnect clears memory, and forget removes storage', async () => {
  const storage = memoryStorage();
  const firstFetch = githubFetch();
  const first = createGitPlaylistClient({ storage, fetchImpl: firstFetch.fetchImpl });
  await connectGithub(first);
  assert.equal(storage.getItem(gitPlaylistCredentialKey()), null);
  assert.equal(first.getConnection().writeAccess, 'unverified');
  assert.equal(JSON.stringify(first.getConnection()).includes(TOKEN), false);
  first.disconnect();
  assert.equal(first.getConnection(), null);
  await assert.rejects(first.readPlaylist(settings()), error => error.code === 'not_connected');

  const rememberedFetch = githubFetch();
  const remembered = createGitPlaylistClient({ storage, fetchImpl: rememberedFetch.fetchImpl });
  const result = await remembered.connect(settings(), TOKEN, { remember: true });
  assert.equal(result.credentialRemembered, true);
  assert.deepEqual(JSON.parse(storage.getItem(gitPlaylistCredentialKey())), { provider: 'github', token: TOKEN });
  assert.equal(remembered.hasRememberedCredential('github'), true);
  assert.equal(remembered.hasRememberedCredential('bitbucket'), false);
  assert.equal(hasRememberedGitPlaylistCredential(storage), true);

  const wrongProviderFetch = bitbucketFetch();
  const wrongProvider = createGitPlaylistClient({ storage, fetchImpl: wrongProviderFetch.fetchImpl });
  await assert.rejects(wrongProvider.connect(settings('bitbucket'), ''), error => error.code === 'token_required');
  assert.equal(wrongProviderFetch.calls.length, 0);

  await assert.rejects(remembered.connect(settings('bitbucket'), ''), error => error.code === 'token_required');
  assert.equal(firstFetch.calls.length, 2);

  const restoredFetch = githubFetch();
  const restored = createGitPlaylistClient({ storage, fetchImpl: restoredFetch.fetchImpl });
  const restoredResult = await restored.connect(settings(), '', { remember: true });
  assert.equal(restoredResult.credentialRemembered, true);
  assert.equal(restoredFetch.calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);

  const optedOutFetch = githubFetch();
  const optedOut = createGitPlaylistClient({ storage, fetchImpl: optedOutFetch.fetchImpl });
  const optedOutResult = await optedOut.connect(settings(), '', { remember: false });
  assert.equal(optedOutResult.credentialRemembered, false);
  assert.equal(optedOutFetch.calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(storage.getItem(gitPlaylistCredentialKey()), null);
  assert.equal(optedOut.hasRememberedCredential(), false);

  await remembered.connect(settings(), TOKEN, { remember: true });
  assert.equal(restored.forgetCredential(), true);
  assert.equal(storage.getItem(gitPlaylistCredentialKey()), null);
  assert.equal(restored.getConnection(), null);
});

test('GitHub reads decode UTF-8 and validate the playlist before returning it', async () => {
  const document = playlistDocument();
  const { calls, fetchImpl } = githubFetch({ fileText: document });
  const client = createGitPlaylistClient({ fetchImpl });
  await connectGithub(client);
  const result = await client.readPlaylist(settings());
  assert.equal(result.playlist.name, 'Café playlist');
  assert.equal(result.playlist.items[0].name, 'Café music');
  assert.equal(JSON.parse(result.text).items[0].metadata, undefined);
  const fileRead = calls.find(call => call.url.pathname.endsWith('/contents/playlists/ambient.json'));
  assert.equal(fileRead.url.searchParams.get('ref'), 'main');
  assertApiOptions(fileRead);
});

test('Bitbucket reads use the filtered branch head and raw UTF-8 source endpoint', async () => {
  const { calls, fetchImpl } = bitbucketFetch({ fileText: playlistDocument() });
  const client = createGitPlaylistClient({ fetchImpl });
  const connection = await connectBitbucket(client);
  assert.equal(connection.visibility, 'private');
  const result = await client.readPlaylist(settings('bitbucket'));
  assert.equal(result.playlist.name, 'Café playlist');
  const branch = calls.find(call => call.url.pathname.endsWith('/refs/branches'));
  assert.equal(branch.url.searchParams.get('q'), 'name="main"');
  const file = calls.find(call => call.url.pathname.includes(`/src/${SHA_A}/`));
  assert.ok(file);
  assertApiOptions(file);
});

test('remote reads reject malformed and oversized files without exposing raw content', async () => {
  for (const fileText of [
    '{malformed secret}',
    JSON.stringify({ schema: 'player.blend.experience.v2', type: 'experience', items: [] }),
    'x'.repeat(1_000_001)
  ]) {
    const { fetchImpl } = githubFetch({ fileText });
    const client = createGitPlaylistClient({ fetchImpl });
    await connectGithub(client);
    await assert.rejects(client.readPlaylist(settings()), error => {
      assert.ok(error instanceof GitPlaylistError);
      assert.equal(error.message.includes('malformed secret'), false);
      return true;
    });
  }
});

test('GitHub publication reviews the exact UTF-8 document and includes existing blob SHA', async () => {
  let sentBody;
  let sentHeaders;
  const { calls, fetchImpl } = githubFetch({ onPut: ({ options }) => {
    sentBody = JSON.parse(options.body);
    sentHeaders = options.headers;
    return new Response(JSON.stringify({ content: { sha: SHA_B }, commit: { sha: SHA_B } }), { status: 200 });
  } });
  const client = createGitPlaylistClient({ fetchImpl });
  await connectGithub(client);
  const document = serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Café music', type: 'audio' }], 'Café mix');
  const review = await client.preparePublish(settings(), document);
  assert.equal(review.snapshot.sha, SHA_A);
  assert.equal(review.text.includes('Café mix'), true);
  const published = await client.publish(review);
  assert.equal(published.commit, SHA_B);
  assert.equal(sentBody.sha, SHA_A);
  assert.equal(sentBody.branch, 'main');
  assert.equal(sentBody.message, 'Publish Blend playlist');
  assert.equal(Buffer.from(sentBody.content, 'base64').toString('utf8'), review.text);
  assert.equal(sentHeaders.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls.filter(call => call.options.method === 'PUT').length, 1);
});

test('GitHub detects remote changes before publish and does not overwrite or retry', async () => {
  let fileCalls = 0;
  let putCalls = 0;
  const { fetchImpl } = githubFetch({ onPut: () => { putCalls += 1; return new Response('{}', { status: 201 }); } });
  const wrappedFetch = async (url, options) => {
    if (new URL(url).pathname.endsWith('/contents/playlists/ambient.json') && options.method === 'GET') {
      fileCalls += 1;
      return githubContents(playlistDocument(), fileCalls <= 1 ? SHA_A : SHA_B);
    }
    return fetchImpl(url, options);
  };
  const client = createGitPlaylistClient({ fetchImpl: wrappedFetch });
  await connectGithub(client);
  const review = await client.preparePublish(settings(), serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Café', type: 'audio' }]));
  await assert.rejects(client.publish(review), error => error.code === 'remote_conflict');
  assert.equal(putCalls, 0);
});

test('GitHub maps stale SHA conflicts and uncertain write transport without retries', async () => {
  let putCalls = 0;
  const { fetchImpl } = githubFetch({ onPut: () => {
    putCalls += 1;
    return new Response('private provider conflict body', { status: 409 });
  } });
  const client = createGitPlaylistClient({ fetchImpl });
  await connectGithub(client);
  const review = await client.preparePublish(settings(), serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Café', type: 'audio' }]));
  await assert.rejects(client.publish(review), error => error.code === 'remote_conflict' && !error.message.includes('private provider conflict body'));
  assert.equal(putCalls, 1);

  const uncertain = githubFetch({ onPut: async () => { putCalls += 1; throw new TypeError('transport detail'); } });
  const client2 = createGitPlaylistClient({ fetchImpl: uncertain.fetchImpl });
  await connectGithub(client2);
  const review2 = await client2.preparePublish(settings(), serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Café', type: 'audio' }]));
  await assert.rejects(client2.publish(review2), error => error.code === 'write_outcome_uncertain');
  assert.equal(putCalls, 2);
});

test('GitHub creates a missing playlist without a stale SHA', async () => {
  let sentBody;
  const { fetchImpl } = githubFetch({ fileText: null, onPut: ({ options }) => {
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ content: { sha: SHA_B }, commit: { sha: SHA_B } }), { status: 201 });
  } });
  const client = createGitPlaylistClient({ fetchImpl });
  await connectGithub(client);
  const review = await client.preparePublish(settings(), serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Café', type: 'audio' }]));
  assert.equal(review.snapshot.exists, false);
  await client.publish(review);
  assert.equal('sha' in sentBody, false);
});

test('Bitbucket publication uses multipart path, branch, and reviewed parent and accepts documented 201', async () => {
  let uploaded;
  let requestOptions;
  const { calls, fetchImpl } = bitbucketFetch({ onPost: ({ options }) => {
    requestOptions = options;
    uploaded = options.body.get('/playlists/ambient.json');
    return new Response('', { status: 201 });
  } });
  const client = createGitPlaylistClient({ fetchImpl });
  await connectBitbucket(client);
  const document = serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Café', type: 'audio' }], 'Café mix');
  const review = await client.preparePublish(settings('bitbucket'), document);
  const result = await client.publish(review);
  assert.equal(result.provider, 'bitbucket');
  assert.equal(result.confirmed, true);
  assert.equal(uploaded.name, 'ambient.json');
  assert.equal(await uploaded.text(), review.text);
  assert.equal(requestOptions.body.get('branch'), 'main');
  assert.equal(requestOptions.body.get('parents'), SHA_A);
  assert.equal(requestOptions.body.get('message'), 'Publish Blend playlist');
  const post = calls.find(call => call.options.method === 'POST');
  assert.equal(post.url.pathname, '/2.0/repositories/blend-workspace/playlists/src');
  assertApiOptions(post);
  assert.equal('Content-Type' in post.options.headers, false, 'the browser must set the multipart boundary for FormData');
});

test('Bitbucket branch movement is surfaced before POST and concurrent writes are not retried', async () => {
  let head = SHA_A;
  let posts = 0;
  const calls = [];
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    calls.push({ url, options });
    if (url.pathname.endsWith('/repositories/blend-workspace/playlists')) return new Response(JSON.stringify({ is_private: true }), { status: 200 });
    if (url.pathname.endsWith('/refs/branches')) return new Response(JSON.stringify({ values: [{ name: 'main', target: { hash: head } }] }), { status: 200 });
    const fileMatch = url.pathname.match(/\/src\/([a-f0-9]{40})\/playlists\/ambient\.json$/);
    if (fileMatch) return new Response(playlistDocument(), { status: 200 });
    if (url.pathname.endsWith('/src') && options.method === 'POST') { posts += 1; return new Response('', { status: 201 }); }
    return new Response('{}', { status: 404 });
  };
  const client = createGitPlaylistClient({ fetchImpl });
  await connectBitbucket(client);
  const review = await client.preparePublish(settings('bitbucket'), serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Café', type: 'audio' }]));
  head = SHA_B;
  await assert.rejects(client.publish(review), error => error.code === 'remote_conflict');
  assert.equal(posts, 0);
});

test('timeout and malformed provider outcomes stay sanitized', async () => {
  const networkClient = createGitPlaylistClient({ fetchImpl: async () => { throw new TypeError('token in provider internals'); } });
  await assert.rejects(networkClient.connect(settings(), TOKEN), error => error.code === 'network_or_cors_error' && !error.message.includes(TOKEN));

  const malformed = createGitPlaylistClient({ fetchImpl: async () => new Response('<html>secret response</html>', { status: 200 }) });
  await assert.rejects(malformed.connect(settings(), TOKEN), error => error.code === 'malformed_provider_response' && !error.message.includes('secret response'));
});
