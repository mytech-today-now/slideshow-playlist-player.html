import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGitHubExperienceProvider,
  GitHubSyncError,
  PROFILE_SYNC_GITHUB_REPOSITORY
} from '../../server/profile-sync-github.mjs';

const GUID = '123e4567-e89b-42d3-a456-426614174000';
const EXPERIENCE = {
  schema: 'player.blend.experience.v2',
  type: 'experience',
  name: 'Provider fixture',
  vendorExtension: { retained: true },
  settings: {},
  library: { items: [] },
  playlist: { items: [] },
  slideshow: { items: [] }
};
const SHA = 'a'.repeat(40);

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('fixes the repository and artifact path to the validated profile GUID', async () => {
  assert.equal(PROFILE_SYNC_GITHUB_REPOSITORY, 'BlendPlayer/BlendPlayer');
  let observed;
  const provider = createGitHubExperienceProvider({
    token: 'synthetic-github-token',
    fetchImpl: async (url, options) => {
      observed = { url: new URL(url), options };
      return jsonResponse(200, {
        type: 'file',
        sha: SHA,
        encoding: 'base64',
        content: Buffer.from(JSON.stringify(EXPERIENCE)).toString('base64')
      });
    }
  });
  const file = await provider.getExperience(GUID);
  assert.deepEqual(file, { sha: SHA, experience: EXPERIENCE });
  assert.equal(observed.url.pathname, `/repos/BlendPlayer/BlendPlayer/contents/experiences/${GUID}/experience.json`);
  assert.equal(observed.url.searchParams.get('ref'), 'main');
  assert.equal(observed.options.headers.Authorization, 'Bearer synthetic-github-token');
  assert.equal(observed.options.redirect, 'error');
  await assert.rejects(provider.getExperience('../other-repo'), { code: 'profile_guid_invalid' });
});

test('reads larger public files from the exact raw file URL without sending credentials', async () => {
  const calls = [];
  const provider = createGitHubExperienceProvider({
    token: 'synthetic-github-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      if (calls.length === 1) {
        return jsonResponse(200, {
          type: 'file', sha: SHA, encoding: 'none', content: '',
          download_url: `https://raw.githubusercontent.com/BlendPlayer/BlendPlayer/main/experiences/${GUID}/experience.json`
        });
      }
      return new Response(JSON.stringify(EXPERIENCE), { status: 200 });
    }
  });
  const file = await provider.getExperience(GUID);
  assert.deepEqual(file.experience, EXPERIENCE);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.hostname, 'raw.githubusercontent.com');
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.signal instanceof AbortSignal, true);
});

test('creates and updates only the fixed Experience file with the observed SHA', async () => {
  const calls = [];
  const provider = createGitHubExperienceProvider({
    token: 'synthetic-github-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return jsonResponse(200, { content: { sha: 'b'.repeat(40) } });
    }
  });
  const updated = await provider.putExperience(GUID, EXPERIENCE, SHA);
  assert.equal(updated.sha, 'b'.repeat(40));
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].url.pathname, `/repos/BlendPlayer/BlendPlayer/contents/experiences/${GUID}/experience.json`);
  assert.equal(body.sha, SHA);
  assert.deepEqual(JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')), EXPERIENCE);
  assert.match(body.message, new RegExp(GUID));
});

test('deletes only the current file using its expected blob SHA and keeps provider history semantics', async () => {
  let call;
  const provider = createGitHubExperienceProvider({
    token: 'synthetic-github-token',
    fetchImpl: async (url, options) => {
      call = { url: new URL(url), options };
      return jsonResponse(200, { commit: { sha: 'c'.repeat(40) } });
    }
  });
  assert.deepEqual(await provider.deleteExperience(GUID, SHA), { deleted: true });
  const body = JSON.parse(call.options.body);
  assert.equal(call.options.method, 'DELETE');
  assert.equal(call.url.pathname, `/repos/BlendPlayer/BlendPlayer/contents/experiences/${GUID}/experience.json`);
  assert.equal(body.sha, SHA);
  assert.match(body.message, /^Delete Blend Experience /);
  await assert.rejects(provider.deleteExperience(GUID, ''), { code: 'github_revision_conflict' });
});

test('maps missing files and provider failures without exposing response content', async () => {
  const missing = createGitHubExperienceProvider({
    token: 'synthetic-github-token',
    fetchImpl: async () => new Response('missing', { status: 404 })
  });
  assert.equal(await missing.getExperience(GUID), null);

  const denied = createGitHubExperienceProvider({
    token: 'synthetic-github-token',
    fetchImpl: async () => new Response('secret response body', { status: 403 })
  });
  await assert.rejects(denied.health(), error => {
    assert.ok(error instanceof GitHubSyncError);
    assert.equal(error.code, 'github_permission_denied');
    assert.equal(error.message.includes('secret'), false);
    return true;
  });

  const unconfigured = createGitHubExperienceProvider({ token: '' });
  await assert.rejects(unconfigured.health(), { code: 'github_not_configured' });
});

test('rejects unsafe branch settings, malformed provider blobs, and file sizes above the server limit', async () => {
  assert.throws(() => createGitHubExperienceProvider({ token: 'x', branch: '../main' }), /branch configuration is invalid/);
  const malformed = createGitHubExperienceProvider({
    token: 'synthetic-github-token',
    fetchImpl: async () => jsonResponse(200, { type: 'file', sha: SHA, encoding: 'base64', content: Buffer.from('{').toString('base64') })
  });
  await assert.rejects(malformed.getExperience(GUID), { code: 'github_experience_invalid' });

  const oversizedJson = JSON.stringify({ ...EXPERIENCE, vendorExtension: 'x'.repeat(5 * 1024 * 1024) });
  let rawRequest;
  const oversized = createGitHubExperienceProvider({
    token: 'synthetic-github-token',
    fetchImpl: async (url, options) => {
      if (new URL(url).hostname === 'api.github.com') {
        return jsonResponse(200, {
          type: 'file', sha: SHA, encoding: 'none', content: '',
          download_url: `https://raw.githubusercontent.com/BlendPlayer/BlendPlayer/main/experiences/${GUID}/experience.json`
        });
      }
      rawRequest = { url: new URL(url), options };
      return new Response(oversizedJson, { status: 200 });
    }
  });
  await assert.rejects(oversized.getExperience(GUID), { code: 'github_experience_invalid' });
  assert.equal(rawRequest.url.hostname, 'raw.githubusercontent.com');
  assert.equal(rawRequest.options.headers, undefined);
});
