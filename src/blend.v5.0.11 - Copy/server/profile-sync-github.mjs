import {
  githubExperiencePath,
  normalizeProfileGuid,
  validateExperienceDocument
} from './profile-sync-core.mjs';

export const PROFILE_SYNC_GITHUB_REPOSITORY = 'BlendPlayer/BlendPlayer';
const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const MAX_EXPERIENCE_BYTES = 5 * 1024 * 1024;
const MAX_GITHUB_JSON_BYTES = 7 * 1024 * 1024;

async function readResponseTextLimited(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('response-size');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('response-size');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('response-size');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export class GitHubSyncError extends Error {
  constructor(code, message, status = 502, { conflict = false } = {}) {
    super(message);
    this.name = 'GitHubSyncError';
    this.code = code;
    this.status = status;
    this.conflict = conflict;
  }
}

function responseError(response) {
  if (response.status === 401 || response.status === 403) {
    return new GitHubSyncError('github_permission_denied', 'The GitHub integration could not authorize this operation.', 502);
  }
  if (response.status === 409 || response.status === 422) {
    return new GitHubSyncError('github_revision_conflict', 'The GitHub file changed before this write completed.', 409, { conflict: true });
  }
  return new GitHubSyncError('github_unavailable', 'The GitHub integration is temporarily unavailable.', 502);
}

export function createGitHubExperienceProvider({
  token = '',
  branch = 'main',
  fetchImpl = globalThis.fetch,
  timeoutMs = 12_000
} = {}) {
  const credential = String(token || '').trim();
  const safeBranch = String(branch || 'main').trim();
  if (!/^[A-Za-z0-9._/-]{1,128}$/.test(safeBranch) || safeBranch.includes('..') || safeBranch.startsWith('/')) {
    throw new TypeError('The GitHub branch configuration is invalid.');
  }

  function headers(extra = {}) {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'Blend-Profile-Sync',
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      ...extra
    };
  }

  async function request(url, options = {}) {
    if (!credential) throw new GitHubSyncError('github_not_configured', 'GitHub synchronization is not configured.', 503);
    if (typeof fetchImpl !== 'function') throw new GitHubSyncError('github_unavailable', 'The GitHub integration is unavailable.', 503);
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        redirect: 'error',
        headers: headers(options.headers),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (_) {
      throw new GitHubSyncError('github_unavailable', 'The GitHub integration is temporarily unavailable.', 502);
    }
    return response;
  }

  function fileUrl(guid) {
    const path = githubExperiencePath(guid).split('/').map(encodeURIComponent).join('/');
    const url = new URL(`/repos/${PROFILE_SYNC_GITHUB_REPOSITORY}/contents/${path}`, GITHUB_API);
    url.searchParams.set('ref', safeBranch);
    return url;
  }

  return Object.freeze({
    configured: !!credential,
    repository: PROFILE_SYNC_GITHUB_REPOSITORY,
    branch: safeBranch,

    async health() {
      const response = await request(`${GITHUB_API}/repos/${PROFILE_SYNC_GITHUB_REPOSITORY}`);
      if (!response.ok) throw responseError(response);
      return { ok: true, repository: PROFILE_SYNC_GITHUB_REPOSITORY };
    },

    async getExperience(guid) {
      const id = normalizeProfileGuid(guid);
      const response = await request(fileUrl(id));
      if (response.status === 404) return null;
      if (!response.ok) throw responseError(response);
      let body;
      try { body = JSON.parse(await readResponseTextLimited(response, MAX_GITHUB_JSON_BYTES)); } catch (_) {
        throw new GitHubSyncError('github_response_invalid', 'GitHub returned an invalid file response.', 502);
      }
      if (!body || body.type !== 'file' || !/^[0-9a-f]{40,64}$/i.test(String(body.sha || ''))) {
        throw new GitHubSyncError('github_response_invalid', 'GitHub returned an invalid file response.', 502);
      }
      let experience;
      try {
        let serialized = '';
        if (body.encoding === 'base64' && typeof body.content === 'string') {
          const decoded = Buffer.from(body.content.replace(/\s/g, ''), 'base64');
          if (decoded.byteLength > MAX_EXPERIENCE_BYTES) throw new Error('size');
          serialized = decoded.toString('utf8');
        } else if (typeof body.download_url === 'string') {
          const raw = new URL(body.download_url);
          const expectedPath = `/${PROFILE_SYNC_GITHUB_REPOSITORY}/${safeBranch}/${githubExperiencePath(id)}`;
          if (raw.protocol !== 'https:' || raw.hostname !== 'raw.githubusercontent.com'
              || raw.pathname !== expectedPath || raw.search || raw.hash || raw.username || raw.password) {
            throw new Error('download-url');
          }
          const rawResponse = await fetchImpl(raw, {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs)
          });
          if (!rawResponse.ok) throw new Error('download-response');
          serialized = await readResponseTextLimited(rawResponse, MAX_EXPERIENCE_BYTES);
        } else throw new Error('encoding');
        experience = JSON.parse(serialized);
        experience = validateExperienceDocument(experience);
      } catch (_) {
        throw new GitHubSyncError('github_experience_invalid', 'The public GitHub Experience file is not valid player.blend.experience.v2 JSON.', 502);
      }
      return { sha: body.sha, experience };
    },

    async putExperience(guid, experience, sha = null) {
      const id = normalizeProfileGuid(guid);
      const document = validateExperienceDocument(experience);
      const payload = {
        message: `Sync Blend Experience ${id}`,
        content: Buffer.from(JSON.stringify(document), 'utf8').toString('base64'),
        branch: safeBranch
      };
      if (sha) payload.sha = String(sha);
      const response = await request(fileUrl(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw responseError(response);
      let body;
      try { body = await response.json(); } catch (_) {
        throw new GitHubSyncError('github_response_invalid', 'GitHub did not confirm the Experience commit.', 502);
      }
      const updatedSha = body?.content?.sha;
      if (!/^[0-9a-f]{40,64}$/i.test(String(updatedSha || ''))) {
        throw new GitHubSyncError('github_response_invalid', 'GitHub did not confirm the Experience commit.', 502);
      }
      return { sha: updatedSha };
    },

    async deleteExperience(guid, sha) {
      const id = normalizeProfileGuid(guid);
      const expectedSha = String(sha || '');
      if (!/^[0-9a-f]{40,64}$/i.test(expectedSha)) {
        throw new GitHubSyncError('github_revision_conflict', 'The current GitHub SHA is unavailable for deletion.', 409, { conflict: true });
      }
      const response = await request(fileUrl(id), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Delete Blend Experience ${id}`,
          sha: expectedSha,
          branch: safeBranch
        })
      });
      if (!response.ok) throw responseError(response);
      return { deleted: true };
    }
  });
}
