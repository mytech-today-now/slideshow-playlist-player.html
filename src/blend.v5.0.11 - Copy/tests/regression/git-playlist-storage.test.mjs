import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GitPlaylistError,
  createGitPlaylistClient,
  gitPlaylistCredentialKey,
  gitPlaylistSettingsKey,
  hasRememberedGitPlaylistCredential,
  inspectRememberedGitPlaylistCredential,
  loadGitPlaylistSettings,
  normalizeGitPlaylistSettings,
  saveGitPlaylistSettings,
  serializeRemotePlaylist
} from '../../git-playlist-storage.js';
import {
  createSanitizedProviderFetch,
  formatSanitizedProviderDiagnostic
} from '../integration/git-playlist-provider-diagnostics.js';

const TOKEN = 'sentinel-git-token-not-a-real-credential';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

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

test('credential storage inspector fails closed without returning stored values', () => {
  const storage = memoryStorage();
  assert.equal(inspectRememberedGitPlaylistCredential(storage), 'clear');

  storage.setItem(gitPlaylistCredentialKey(), JSON.stringify({
    provider: 'github',
    token: TOKEN
  }));
  assert.equal(inspectRememberedGitPlaylistCredential(storage), 'present');

  storage.setItem(gitPlaylistCredentialKey(), 'malformed sentinel payload');
  assert.equal(inspectRememberedGitPlaylistCredential(storage), 'present');
  assert.equal(inspectRememberedGitPlaylistCredential({ getItem() { throw new Error(TOKEN); } }), 'unavailable');
  assert.equal(inspectRememberedGitPlaylistCredential(null), 'unavailable');
});

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

function bitbucketFetch({ privateRepo = true, fileText = playlistDocument(), head = SHA_A, onPost = null, fileResponse = null } = {}) {
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
      if (fileResponse) return fileResponse({ url, options, calls });
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

test('sanitized provider diagnostics observe status without exposing the secret sentinel or request details', async () => {
  const observed = [];
  const requests = [];
  let nextStatus = 200;
  const fetchImpl = async (url, options) => {
    requests.push({ url: new URL(url), options });
    return new Response('provider body sentinel', { status: nextStatus, headers: { 'x-private-header': TOKEN } });
  };
  const fetchObserved = createSanitizedProviderFetch({
    provider: 'github',
    token: TOKEN,
    fetchImpl,
    onDiagnostic: event => observed.push(event)
  });
  const response = await fetchObserved('https://api.github.com/repos/blend-team/playlists/contents/playlists/ambient.json?ref=main', {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  assert.equal(response.status, 200);
  assert.equal(requests[0].url.origin, 'https://api.github.com');
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(observed, [{
    provider: 'github', operation: 'playlist_read', method: 'GET', status: 200, outcome: 'success'
  }]);
  const diagnosticText = formatSanitizedProviderDiagnostic(observed[0]);
  assert.equal(diagnosticText.includes(TOKEN), false);
  assert.equal(diagnosticText.includes('/repos/'), false);
  assert.equal(diagnosticText.includes('headers'), false);
  assert.equal(JSON.stringify(observed).includes(TOKEN), false);
  assert.equal(JSON.stringify(observed).includes('provider body sentinel'), false);
  assert.equal(requests[0].url.href.includes(TOKEN), false);

  for (const [status, outcome] of [
    [403, 'permission_denied'],
    [409, 'remote_conflict'],
    [429, 'rate_limited']
  ]) {
    nextStatus = status;
    await fetchObserved('https://api.github.com/repos/blend-team/playlists', {
      method: 'GET', headers: { Authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(observed.at(-1).status, status);
    assert.equal(observed.at(-1).outcome, outcome);
  }

  const settingsJson = JSON.stringify(normalizeGitPlaylistSettings(settings()));
  const catalogJson = JSON.stringify({ schema: 'player.blend.catalog.v1', playlists: [{ id: 'ambient', title: 'Ambient' }] });
  const playlistJson = serializeRemotePlaylist([
    { sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Café music', type: 'audio' }
  ]);
  assert.equal(settingsJson.includes(TOKEN), false);
  assert.equal(catalogJson.includes(TOKEN), false);
  assert.equal(playlistJson.includes(TOKEN), false);

  const callsBeforeWrongOrigin = requests.length;
  await assert.rejects(fetchObserved('https://example.invalid/private?token=bad', {
    headers: { Authorization: `Bearer ${TOKEN}` }
  }), error => error.code === 'provider_origin_rejected');
  await assert.rejects(fetchObserved(`https://api.github.com/repos/blend-team/playlists?token=${encodeURIComponent(TOKEN)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  }), error => error.code === 'provider_origin_rejected');
  await assert.rejects(fetchObserved('https://api.github.com/repos/blend-team/playlists', {
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Synthetic-Diagnostic': TOKEN }
  }), error => error.code === 'credential_scope_violation');
  assert.equal(requests.length, callsBeforeWrongOrigin);
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

  const preservedFetch = githubFetch();
  const preserved = createGitPlaylistClient({ storage, fetchImpl: preservedFetch.fetchImpl });
  await preserved.connect(settings(), '', { remember: false, preserveRememberedCredential: true });
  assert.equal(storage.getItem(gitPlaylistCredentialKey()).includes(TOKEN), true);

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

test('Bitbucket denied, missing, malformed, and oversized reads return stable sanitized errors without writes', async () => {
  const deniedCases = [
    { status: 401, code: 'authentication_failed' },
    { status: 403, code: 'permission_denied' },
    { status: 404, code: 'file_not_found' }
  ];
  for (const { status, code } of deniedCases) {
    const sentinel = `private response body ${TOKEN}`;
    const { calls, fetchImpl } = bitbucketFetch({
      fileResponse: () => new Response(sentinel, { status })
    });
    const client = createGitPlaylistClient({ fetchImpl });
    await connectBitbucket(client);
    await assert.rejects(client.readPlaylist(settings('bitbucket')), error => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes(TOKEN), false);
      assert.equal(error.message.includes(sentinel), false);
      return true;
    });
    assert.ok(calls.every(call => call.options.method === 'GET'));
  }

  for (const [fileText, code] of [
    [`malformed private body ${TOKEN}`, 'invalid_remote_playlist'],
    ['x'.repeat(1_000_001), 'response_too_large']
  ]) {
    const { calls, fetchImpl } = bitbucketFetch({ fileText });
    const client = createGitPlaylistClient({ fetchImpl });
    await connectBitbucket(client);
    await assert.rejects(client.readPlaylist(settings('bitbucket')), error => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes(TOKEN), false);
      assert.equal(error.message.includes('malformed private body'), false);
      return true;
    });
    assert.ok(calls.every(call => call.options.method === 'GET'));
  }
});

test('Bitbucket playlist read timeout maps to a stable error without a write request', async () => {
  const { calls, fetchImpl: baseFetch } = bitbucketFetch();
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    if (url.pathname.includes('/src/') && options.method === 'GET') {
      calls.push({ url, options });
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException(`private ${TOKEN}`, 'AbortError')), { once: true });
      });
    }
    return baseFetch(urlValue, options);
  };
  const client = createGitPlaylistClient({ fetchImpl, timeoutMs: 5 });
  await connectBitbucket(client);
  await assert.rejects(client.readPlaylist(settings('bitbucket')), error => {
    assert.equal(error.code, 'request_timeout');
    assert.equal(error.message.includes(TOKEN), false);
    return true;
  });
  assert.ok(calls.every(call => call.options.method === 'GET'));
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

test('GitHub maps stale SHA conflicts and blocks retries after a timeout before response headers', async () => {
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

  const uncertain = githubFetch({ onPut: async () => {
    putCalls += 1;
    const error = new Error('synthetic timeout detail');
    error.name = 'AbortError';
    throw error;
  } });
  const client2 = createGitPlaylistClient({ fetchImpl: uncertain.fetchImpl });
  await connectGithub(client2);
  const review2 = await client2.preparePublish(settings(), serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Café', type: 'audio' }]));
  await assert.rejects(client2.publish(review2), error => error.code === 'write_outcome_uncertain');
  assert.equal(putCalls, 2);
  await assert.rejects(client2.publish(review2), error => error.code === 'remote_reconciliation_required');
  assert.equal(putCalls, 2, 'the client must block a second submission until a remote read compares the review');
  await client2.readPlaylist(settings());
  await assert.rejects(client2.publish(review2), error => error.code === 'write_outcome_uncertain');
  assert.equal(putCalls, 3, 'a second attempt is possible only after the explicit remote read');
});

test('accepted GitHub write with a lost response is reconciled before cleanup and never resubmitted blindly', async () => {
  let remoteText = playlistDocument();
  let remoteSha = SHA_A;
  let putCalls = 0;
  const fallback = githubFetch();
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    if (url.pathname === '/repos/blend-team/playlists/contents/playlists/ambient.json' && options.method === 'GET') {
      return githubContents(remoteText, remoteSha);
    }
    if (url.pathname === '/repos/blend-team/playlists/contents/playlists/ambient.json' && options.method === 'PUT') {
      putCalls += 1;
      remoteText = Buffer.from(JSON.parse(options.body).content, 'base64').toString('utf8');
      remoteSha = putCalls === 1 ? SHA_B : SHA_C;
      if (putCalls === 1) {
        const error = new Error('response lost after provider accepted the write');
        error.name = 'AbortError';
        throw error;
      }
      return new Response(JSON.stringify({ content: { sha: SHA_C }, commit: { sha: SHA_C } }), { status: 200 });
    }
    return fallback.fetchImpl(urlValue, options);
  };

  const client = createGitPlaylistClient({ fetchImpl });
  await connectGithub(client);
  const original = await client.readPlaylist(settings());
  const outgoingText = serializeRemotePlaylist([
    { sourceUrl: 'https://media.example.org/smoke.mp3', name: 'Disposable smoke', type: 'audio' }
  ]);
  const review = await client.preparePublish(settings(), outgoingText);
  await assert.rejects(client.publish(review), error => error.code === 'write_outcome_uncertain');
  assert.equal(putCalls, 1);
  await assert.rejects(client.publish(review), error => error.code === 'remote_reconciliation_required');
  assert.equal(putCalls, 1, 'an uncertain submission must not be blindly retried');

  const observed = await client.readPlaylist(settings());
  assert.equal(observed.playlist.name, JSON.parse(outgoingText).name);
  assert.equal(observed.playlist.items[0].sourceUrl, JSON.parse(outgoingText).items[0].sourceUrl);
  const cleanupReview = await client.preparePublish(settings(), original.text);
  assert.equal(cleanupReview.snapshot.sha, SHA_B);
  const cleanupResult = await client.publish(cleanupReview);
  assert.equal(cleanupResult.commit, SHA_C);
  assert.equal(putCalls, 2, 'a restoration may publish only after the remote state was read and reviewed');
  const restored = await client.readPlaylist(settings());
  assert.equal(restored.playlist.name, original.playlist.name);
  assert.equal(restored.playlist.items[0].sourceUrl, original.playlist.items[0].sourceUrl);
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

test('publishing an exact document already at the reviewed remote path does not create a duplicate commit', async () => {
  let remoteText = playlistDocument();
  let putCalls = 0;
  const base = githubFetch({ onPut: () => {
    putCalls += 1;
    return new Response(JSON.stringify({ content: { sha: SHA_B }, commit: { sha: SHA_B } }), { status: 201 });
  } });
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    if (url.pathname === '/repos/blend-team/playlists/contents/playlists/ambient.json' && options.method === 'GET') {
      return githubContents(remoteText, SHA_A);
    }
    return base.fetchImpl(urlValue, options);
  };
  const client = createGitPlaylistClient({ fetchImpl });
  await connectGithub(client);
  const review = await client.preparePublish(settings(), serializeRemotePlaylist([
    { sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Exact local copy', type: 'audio' }
  ]));
  remoteText = review.text;
  const result = await client.publish(review);
  assert.equal(result.alreadyCurrent, true);
  assert.equal(result.provider, 'github');
  assert.equal(putCalls, 0);
});

test('Bitbucket review stops before POST when the API has no documented conditional write', async () => {
  let posts = 0;
  const { calls, fetchImpl } = bitbucketFetch({ onPost: () => {
    posts += 1;
    return new Response('', { status: 201 });
  } });
  const client = createGitPlaylistClient({ fetchImpl });
  await connectBitbucket(client);
  const document = serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Café', type: 'audio' }], 'Café mix');
  const review = await client.preparePublish(settings('bitbucket'), document);
  const exactReviewedText = review.text;
  await assert.rejects(client.publish(review), error => error.code === 'conditional_write_unavailable');
  assert.equal(review.text, exactReviewedText);
  assert.match(review.text, /Café mix/);
  assert.equal(review.snapshot.head, SHA_A);
  assert.equal(posts, 0);
  assert.equal(calls.some(call => call.options.method === 'POST'), false);
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

test('Bitbucket head movement immediately after preflight cannot produce an unchecked write', async () => {
  let head = SHA_A;
  let branchReads = 0;
  let fileReads = 0;
  let posts = 0;
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    if (url.pathname.endsWith('/repositories/blend-workspace/playlists')) {
      return new Response(JSON.stringify({ is_private: true }), { status: 200 });
    }
    if (url.pathname.endsWith('/refs/branches')) {
      branchReads += 1;
      const observedHead = head;
      const response = new Response(JSON.stringify({ values: [{ name: 'main', target: { hash: observedHead } }] }), { status: 200 });
      if (branchReads === 3) head = SHA_B;
      return response;
    }
    const fileMatch = url.pathname.match(/\/src\/([a-f0-9]{40})\/playlists\/ambient\.json$/);
    if (fileMatch) {
      fileReads += 1;
      const response = new Response(playlistDocument(), { status: 200 });
      if (fileReads === 2) head = SHA_B;
      return response;
    }
    if (url.pathname.endsWith('/src') && options.method === 'POST') {
      posts += 1;
      return new Response('', { status: 201 });
    }
    return new Response('{}', { status: 404 });
  };
  const client = createGitPlaylistClient({ fetchImpl });
  await connectBitbucket(client);
  const outgoing = serializeRemotePlaylist([{ sourceUrl: 'https://media.example.org/cafe.mp3', name: 'Local Café copy', type: 'audio' }]);
  const review = await client.preparePublish(settings('bitbucket'), outgoing);
  const exactReviewedText = review.text;
  assert.equal(review.snapshot.head, SHA_A);
  await assert.rejects(client.publish(review), error => error.code === 'conditional_write_unavailable');
  assert.equal(head, SHA_B, 'the synthetic branch moved after the full preflight snapshot was read');
  assert.equal(branchReads, 3);
  assert.equal(fileReads, 2);
  assert.equal(review.text, exactReviewedText);
  assert.match(review.text, /Local Café copy/);
  assert.equal(review.snapshot.head, SHA_A);
  assert.equal(posts, 0);
});

test('timeout and malformed provider outcomes stay sanitized', async () => {
  const networkClient = createGitPlaylistClient({ fetchImpl: async () => { throw new TypeError('token in provider internals'); } });
  await assert.rejects(networkClient.connect(settings(), TOKEN), error => error.code === 'network_or_cors_error' && !error.message.includes(TOKEN));

  const malformed = createGitPlaylistClient({ fetchImpl: async () => new Response('<html>secret response</html>', { status: 200 }) });
  await assert.rejects(malformed.connect(settings(), TOKEN), error => error.code === 'malformed_provider_response' && !error.message.includes('secret response'));
});
