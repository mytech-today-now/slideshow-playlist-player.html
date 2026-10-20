import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BlendAppPage } from './support/blend-app-page.mjs';

const TOKEN = 'synthetic-git-provider-token-for-e2e-only';
const FILE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const COMMIT_SHA = 'c'.repeat(40);
const playlistDocument = {
  schema: 'player.blend.list.v1',
  type: 'playlist',
  name: 'Café Ambient',
  description: '',
  order: ['track-a'],
  items: [{
    id: 'track-a',
    path: 'https://media.example.org/cafe.mp3',
    sourceUrl: 'https://media.example.org/cafe.mp3',
    pathKind: 'remote',
    name: 'Café music.mp3',
    type: 'audio',
    order: 0
  }]
};

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type'
};

async function fulfillJson(route, payload, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: corsHeaders,
    body: JSON.stringify(payload)
  });
}

async function fulfillPreflight(route) {
  await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
}

async function captureReviewScreenshot(page, filename) {
  const directory = process.env.BLEND_E2E_SCREENSHOT_DIR;
  if (!directory) return;
  await expect(page.locator('#toast-container .toast').last()).toBeHidden({ timeout: 5000 });
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, filename) });
}

function githubContents(text = JSON.stringify(playlistDocument), sha = FILE_SHA) {
  return {
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(text, 'utf8').toString('base64'),
    sha
  };
}

test('GitHub connect, read, explicit import, and confirmed publish stay separate', async ({ page }) => {
  const pageErrors = [];
  const calls = [];
  let putBody = null;
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('https://api.github.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({
      method,
      url: url.href,
      authorization: request.headers().authorization || '',
      preflightHeaders: request.headers()['access-control-request-headers'] || ''
    });
    if (method === 'OPTIONS') return fulfillPreflight(route);
    if (url.pathname === '/repos/blend-team/playlists' && method === 'GET') {
      return fulfillJson(route, { private: false, full_name: 'blend-team/playlists' });
    }
    if (url.pathname === '/repos/blend-team/playlists/git/ref/heads/main' && method === 'GET') {
      return fulfillJson(route, { ref: 'refs/heads/main', object: { sha: HEAD_SHA, type: 'commit' } });
    }
    if (url.pathname === '/repos/blend-team/playlists/contents/playlists/ambient.json') {
      if (method === 'GET') return fulfillJson(route, githubContents());
      if (method === 'PUT') {
        putBody = request.postDataJSON();
        return fulfillJson(route, { content: { sha: COMMIT_SHA }, commit: { sha: COMMIT_SHA } });
      }
    }
    return fulfillJson(route, { message: 'not found' }, 404);
  });

  const app = new BlendAppPage(page);
  await app.boot();
  await app.openConfig();

  const token = page.locator('#git-playlist-token');
  await expect(token).toHaveAttribute('type', 'password');
  await expect(page.locator('#git-playlist-remember')).not.toBeChecked();
  await page.locator('#git-playlist-provider').selectOption('github');
  await page.locator('#git-playlist-owner').fill('blend-team');
  await page.locator('#git-playlist-repository').fill('playlists');
  await page.locator('#git-playlist-branch').fill('main');
  await page.locator('#git-playlist-path').fill('playlists/ambient.json');
  await token.fill(TOKEN);
  await page.locator('#git-playlist-connect').click();

  await expect(page.locator('#git-playlist-connection')).toContainText('Connected to GitHub blend-team/playlists');
  await expect(token).toHaveValue('');
  await expect(page.locator('#git-playlist-read')).toBeEnabled();
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(0);
  for (const call of calls) expect(call.authorization).toBe(`Bearer ${TOKEN}`);
  for (const call of calls.filter(call => call.method === 'OPTIONS')) {
    expect(call.preflightHeaders).not.toContain('x-github-api-version');
  }

  await page.locator('#git-playlist-read').click();
  await expect(page.locator('#git-playlist-read-result')).toBeVisible();
  await expect(page.locator('#git-playlist-read-data')).toContainText('Café Ambient');
  await expect(page.locator('#pl-count')).toContainText('(0)');
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(0);

  await page.locator('#git-playlist-import-read').click();
  await expect(page.locator('#pl-count')).toContainText('(1)');
  await expect(page.locator('#git-playlist-connection')).toContainText('repository was not changed');
  await page.locator('#git-playlist-review').click();
  await expect(page.locator('#git-playlist-publish-review')).toBeVisible();
  await expect(page.locator('#git-playlist-publish-title')).toBeInViewport({ ratio: 1 });
  expect(await page.locator('.git-playlist-setting').evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.querySelector('#git-playlist-publish-title').getBoundingClientRect().top
    > document.querySelector('.config-sticky-controls').getBoundingClientRect().bottom)).toBe(true);
  await expect(page.locator('#git-playlist-publish-data')).toContainText('cafe.mp3');
  await expect(page.locator('#git-playlist-public-warning')).toBeVisible();
  await expect(page.locator('#git-playlist-publish')).toBeDisabled();
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(0);
  await captureReviewScreenshot(page, 'git-playlist-github-review.png');

  const browserStorage = await page.evaluate(() => ({
    settings: localStorage.getItem('blend-git-playlist-repository-v1') || '',
    credential: localStorage.getItem('blend-git-playlist-credential-v1'),
    catalog: localStorage.getItem('blend-public-git-catalog-v1') || '',
    runtime: localStorage.getItem('blend-runtime-config-v1') || '',
    url: location.href
  }));
  expect(browserStorage.settings).not.toContain(TOKEN);
  expect(browserStorage.credential).toBeNull();
  expect(browserStorage.catalog).not.toContain(TOKEN);
  expect(browserStorage.runtime).not.toContain(TOKEN);
  expect(browserStorage.url).not.toContain(TOKEN);

  await page.locator('#git-playlist-confirm-publish').check();
  await expect(page.locator('#git-playlist-publish')).toBeEnabled();
  await page.locator('#git-playlist-publish').click();
  await expect(page.locator('#git-playlist-connection')).toContainText('Published playlist successfully');
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  expect(putBody.sha).toBe(FILE_SHA);
  expect(putBody.branch).toBe('main');
  expect(Buffer.from(putBody.content, 'base64').toString('utf8')).toContain('Café Ambient');
  await expect(page.locator('#git-playlist-publish-review')).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test('accepted GitHub write with a lost response retains the review and waits for a remote comparison', async ({ page }) => {
  const calls = [];
  let remoteText = JSON.stringify(playlistDocument);
  let remoteSha = FILE_SHA;
  let branchHead = HEAD_SHA;
  let putCount = 0;
  let downloadCount = 0;
  page.on('download', () => { downloadCount += 1; });
  await page.route('https://api.github.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({ method, path: url.pathname });
    if (method === 'OPTIONS') return fulfillPreflight(route);
    if (url.pathname === '/repos/blend-team/playlists' && method === 'GET') {
      return fulfillJson(route, { private: true, full_name: 'blend-team/playlists' });
    }
    if (url.pathname === '/repos/blend-team/playlists/git/ref/heads/main' && method === 'GET') {
      return fulfillJson(route, { ref: 'refs/heads/main', object: { sha: branchHead, type: 'commit' } });
    }
    if (url.pathname === '/repos/blend-team/playlists/contents/playlists/ambient.json') {
      if (method === 'PUT') {
        putCount += 1;
        const body = request.postDataJSON();
        remoteText = Buffer.from(body.content, 'base64').toString('utf8');
        remoteSha = COMMIT_SHA;
        branchHead = COMMIT_SHA;
        return route.abort('failed');
      }
      return fulfillJson(route, githubContents(remoteText, remoteSha));
    }
    return fulfillJson(route, { message: 'not found' }, 404);
  });

  const app = new BlendAppPage(page);
  await app.boot();
  await app.importList('playlist', {
    name: 'local-playlist.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      schema: 'player.blend.list.v1',
      type: 'playlist',
      name: 'Reviewed local copy',
      items: [{
        id: 'local-track',
        path: 'https://media.example.org/local.mp3',
        sourceUrl: 'https://media.example.org/local.mp3',
        pathKind: 'remote',
        name: 'Local track',
        type: 'audio',
        order: 0
      }]
    }))
  });
  await app.openConfig();
  await page.locator('#git-playlist-provider').selectOption('github');
  await page.locator('#git-playlist-owner').fill('blend-team');
  await page.locator('#git-playlist-repository').fill('playlists');
  await page.locator('#git-playlist-branch').fill('main');
  await page.locator('#git-playlist-path').fill('playlists/ambient.json');
  await page.locator('#git-playlist-token').fill(TOKEN);
  await page.locator('#git-playlist-connect').click();
  await page.locator('#git-playlist-review').click();
  await expect(page.locator('#git-playlist-publish-review')).toBeVisible();
  const reviewedJson = await page.locator('#git-playlist-publish-data').textContent();
  await expect(page.locator('#git-playlist-publish-revision')).toContainText(`Observed GitHub branch revision: ${HEAD_SHA}`);

  const localState = await page.evaluate(() => window.Blend.state.playlist.map(({ id, sourceUrl, name }) => ({ id, sourceUrl, name })));
  await page.locator('#git-playlist-confirm-publish').check();
  await page.locator('#git-playlist-publish').click();
  await expect(page.locator('#git-playlist-connection')).toContainText('may have accepted this playlist');
  expect(putCount).toBe(1);
  expect(downloadCount).toBe(0);
  await expect(page.locator('#git-playlist-publish-review')).toBeVisible();
  await expect(page.locator('#git-playlist-publish-data')).toHaveText(reviewedJson);
  await expect(page.locator('#git-playlist-publish-revision')).toContainText(`reviewed file SHA: ${FILE_SHA}`);
  await expect(page.locator('#git-playlist-confirm-publish')).toBeDisabled();
  await expect(page.locator('#git-playlist-publish')).toBeDisabled();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#git-playlist-download-review').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('utf8')).toBe(reviewedJson);
  expect(Buffer.concat(chunks).toString('utf8')).not.toContain(TOKEN);
  expect(downloadCount).toBe(1);

  await page.locator('#git-playlist-read').click();
  await expect(page.locator('#git-playlist-connection')).toContainText('newest remote playlist exactly matches the reviewed JSON');
  await expect(page.locator('#git-playlist-read-data')).toHaveText(reviewedJson);
  await expect(page.locator('#git-playlist-read-revision')).toContainText(`Observed GitHub branch revision: ${COMMIT_SHA}`);
  await expect(page.locator('#git-playlist-publish-review')).toBeVisible();
  await expect(page.locator('#git-playlist-publish-data')).toHaveText(reviewedJson);
  await expect(page.locator('#git-playlist-publish')).toBeDisabled();
  expect(putCount).toBe(1, 'a lost response must not trigger an automatic retry');
  expect(await page.evaluate(() => window.Blend.state.playlist.map(({ id, sourceUrl, name }) => ({ id, sourceUrl, name })))).toEqual(localState);
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1);

  await page.locator('#git-playlist-review').click();
  await expect(page.locator('#git-playlist-connection')).toContainText('already matches this exact review');
  await expect(page.locator('#git-playlist-confirm-publish')).toBeDisabled();
  expect(putCount).toBe(1, 'a fresh review of content already present remotely must not create a duplicate commit');
});

test('remembered credentials stay scoped to their provider and do not trigger startup requests', async ({ page }) => {
  const calls = [];
  await page.addInitScript(() => localStorage.setItem('blend-git-playlist-credential-v1', JSON.stringify({
    provider: 'github',
    token: 'synthetic-remembered-github-token-for-e2e'
  })));
  for (const origin of ['https://api.github.com/**', 'https://api.bitbucket.org/**']) {
    await page.route(origin, async route => {
      calls.push({ url: route.request().url(), method: route.request().method() });
      return fulfillJson(route, { message: 'unexpected provider request' }, 500);
    });
  }

  const app = new BlendAppPage(page);
  await app.boot();
  await app.openConfig();
  await expect(page.locator('#git-playlist-remember')).toBeChecked();
  expect(calls).toHaveLength(0);

  await page.locator('#git-playlist-provider').selectOption('bitbucket');
  await expect(page.locator('#git-playlist-remember')).not.toBeChecked();
  await page.locator('#git-playlist-owner').fill('blend-workspace');
  await page.locator('#git-playlist-repository').fill('playlists');
  await page.locator('#git-playlist-branch').fill('main');
  await page.locator('#git-playlist-path').fill('playlists/ambient.json');
  await page.locator('#git-playlist-connect').click();

  await expect(page.locator('#git-playlist-connection')).toContainText('saved for this provider');
  expect(calls).toHaveLength(0);
  await page.locator('#git-playlist-provider').selectOption('github');
  await expect(page.locator('#git-playlist-remember')).toBeChecked();
});

test('remote read denial and stale publish review preserve the local playlist and playback indices', async ({ page }) => {
  const calls = [];
  let downloads = 0;
  let fileMode = 'denied';
  let fileGets = 0;
  let writes = 0;
  await page.route('https://api.github.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({ method, path: url.pathname });
    if (method === 'OPTIONS') return fulfillPreflight(route);
    if (url.pathname === '/repos/blend-team/playlists' && method === 'GET') {
      return fulfillJson(route, { private: true, full_name: 'blend-team/playlists' });
    }
    if (url.pathname === '/repos/blend-team/playlists/git/ref/heads/main' && method === 'GET') {
      return fulfillJson(route, { ref: 'refs/heads/main', object: { sha: HEAD_SHA, type: 'commit' } });
    }
    if (url.pathname === '/repos/blend-team/playlists/contents/playlists/ambient.json') {
      if (method === 'PUT') {
        writes += 1;
        return fulfillJson(route, { content: { sha: COMMIT_SHA }, commit: { sha: COMMIT_SHA } });
      }
      if (fileMode === 'denied') return fulfillJson(route, { message: 'private provider diagnostic' }, 403);
      fileGets += 1;
      return fulfillJson(route, githubContents(JSON.stringify(playlistDocument), fileGets === 1 ? FILE_SHA : COMMIT_SHA));
    }
    return fulfillJson(route, { message: 'not found' }, 404);
  });

  const app = new BlendAppPage(page);
  await app.boot();
  page.on('download', () => { downloads += 1; });
  await app.importList('playlist', {
    name: 'local-playlist.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      schema: 'player.blend.list.v1',
      type: 'playlist',
      name: 'Local playlist',
      items: [{
        id: 'local-track',
        path: 'https://media.example.org/local.mp3',
        sourceUrl: 'https://media.example.org/local.mp3',
        pathKind: 'remote',
        name: 'Local track',
        type: 'audio',
        order: 0
      }]
    }))
  });
  await app.openConfig();
  await page.locator('#git-playlist-provider').selectOption('github');
  await page.locator('#git-playlist-owner').fill('blend-team');
  await page.locator('#git-playlist-repository').fill('playlists');
  await page.locator('#git-playlist-branch').fill('main');
  await page.locator('#git-playlist-path').fill('playlists/ambient.json');
  await page.locator('#git-playlist-token').fill(TOKEN);
  await page.locator('#git-playlist-connect').click();
  await expect(page.locator('#git-playlist-read')).toBeEnabled();

  const snapshotLocalState = () => page.evaluate(() => ({
    playlist: window.Blend.state.playlist.map(({ id, path, sourceUrl, name }) => ({ id, path, sourceUrl, name })),
    playlistIndex: window.Blend.state.runtime.playlistIndex,
    slideshowIndex: window.Blend.state.runtime.slideshowIndex
  }));
  const before = await snapshotLocalState();
  await page.locator('#git-playlist-read').click();
  await expect(page.locator('#git-playlist-connection')).toHaveText('The remote playlist could not be read. Check the repository and read permission, then retry.');
  expect(await snapshotLocalState()).toEqual(before);

  fileMode = 'conflict';
  await page.locator('#git-playlist-review').click();
  await expect(page.locator('#git-playlist-publish-review')).toBeVisible();
  await page.locator('#git-playlist-confirm-publish').check();
  await page.locator('#git-playlist-publish').click();
  await expect(page.locator('#git-playlist-connection')).toHaveText('The remote playlist changed while you were publishing. Your local copy is unchanged. Review the newest remote version and choose which version to publish.');
  await expect(page.locator('#git-playlist-publish-review')).toBeVisible();
  await expect(page.locator('#git-playlist-publish-revision')).toContainText(`reviewed file SHA: ${FILE_SHA}`);
  await expect(page.locator('#git-playlist-publish-data')).toContainText('local.mp3');
  await expect(page.locator('#git-playlist-confirm-publish')).toBeDisabled();
  expect(downloads).toBe(0, 'a conflict must not download the outgoing copy without user action');
  const reviewedJson = await page.locator('#git-playlist-publish-data').textContent();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#git-playlist-download-review').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('utf8')).toBe(reviewedJson);
  expect(Buffer.concat(chunks).toString('utf8')).not.toContain(TOKEN);
  expect(downloads).toBe(1);
  await page.locator('#git-playlist-read').click();
  await expect(page.locator('#git-playlist-read-result')).toBeVisible();
  await expect(page.locator('#git-playlist-read-revision')).toContainText(`current file SHA: ${COMMIT_SHA}`);
  await expect(page.locator('#git-playlist-publish-review')).toBeVisible();
  await expect(page.locator('#git-playlist-publish-data')).toHaveText(reviewedJson);
  expect(await snapshotLocalState()).toEqual(before);
  expect(writes).toBe(0);
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(0);
});

test('Bitbucket read and review remain available while unsafe branch writes are disabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = [];
  await page.route('https://api.bitbucket.org/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({
      method,
      url: url.href,
      authorization: request.headers().authorization || '',
      preflightHeaders: request.headers()['access-control-request-headers'] || ''
    });
    if (method === 'OPTIONS') return fulfillPreflight(route);
    if (url.pathname === '/2.0/repositories/blend-workspace/playlists' && method === 'GET') {
      return fulfillJson(route, { is_private: true, full_name: 'blend-workspace/playlists' });
    }
    if (url.pathname === '/2.0/repositories/blend-workspace/playlists/refs/branches' && method === 'GET') {
      return fulfillJson(route, { values: [{ name: 'main', target: { hash: HEAD_SHA } }] });
    }
    if (url.pathname === `/2.0/repositories/blend-workspace/playlists/src/${HEAD_SHA}/playlists/ambient.json` && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', headers: corsHeaders, body: JSON.stringify(playlistDocument) });
    }
    if (url.pathname === '/2.0/repositories/blend-workspace/playlists/src' && method === 'POST') {
      return route.fulfill({ status: 201, headers: corsHeaders, body: '' });
    }
    return fulfillJson(route, { error: { message: 'not found' } }, 404);
  });

  const app = new BlendAppPage(page);
  await app.boot();
  await app.openConfig();
  await page.locator('#git-playlist-provider').selectOption('bitbucket');
  await page.locator('#git-playlist-owner').fill('blend-workspace');
  await page.locator('#git-playlist-repository').fill('playlists');
  await page.locator('#git-playlist-branch').fill('main');
  await page.locator('#git-playlist-path').fill('playlists/ambient.json');
  await page.locator('#git-playlist-token').fill(TOKEN);
  await page.locator('#git-playlist-connect').click();

  await expect(page.locator('#git-playlist-connection')).toContainText('Connected to Bitbucket Cloud blend-workspace/playlists');
  await expect(page.locator('#git-playlist-connection')).toContainText('currently private');
  await page.locator('#git-playlist-read').click();
  await expect(page.locator('#git-playlist-read-result')).toBeVisible();
  await page.locator('#git-playlist-import-read').click();
  await expect(page.locator('#pl-count')).toContainText('(1)');
  await page.locator('#git-playlist-review').click();
  await expect(page.locator('#git-playlist-publish-review')).toBeVisible();
  await expect(page.locator('#git-playlist-publish-title')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.querySelector('#git-playlist-publish-title').getBoundingClientRect().top
    > document.querySelector('.config-sticky-controls').getBoundingClientRect().bottom)).toBe(true);
  expect(await page.locator('#git-playlist-publish-data').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(page.locator('#git-playlist-public-warning')).toBeHidden();
  await expect(page.locator('#git-playlist-bitbucket-race')).toBeVisible();
  await expect(page.locator('#git-playlist-bitbucket-race')).toContainText('Blend does not send a branch write');
  await expect(page.locator('#git-playlist-publish-revision')).toContainText(`Observed Bitbucket branch revision: ${HEAD_SHA}`);
  await expect(page.locator('#git-playlist-confirm-publish')).toBeDisabled();
  await expect(page.locator('#git-playlist-publish')).toBeDisabled();
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(0);
  for (const call of calls) expect(call.authorization).toBe(`Bearer ${TOKEN}`);
  await captureReviewScreenshot(page, 'git-playlist-bitbucket-review.png');

  const reviewedJson = await page.locator('#git-playlist-publish-data').textContent();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#git-playlist-download-review').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('utf8')).toBe(reviewedJson);
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(0);
});

test('Bitbucket read failures keep the local playlist and expose a safe retry path', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = [];
  let fileMode = 'valid';
  const responseSentinel = `private provider body ${TOKEN} blend-workspace/playlists/playlists/ambient.json`;
  await page.route('https://api.bitbucket.org/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push(method);
    if (method === 'OPTIONS') return fulfillPreflight(route);
    if (url.pathname === '/2.0/repositories/blend-workspace/playlists' && method === 'GET') {
      return fulfillJson(route, { is_private: true, full_name: 'blend-workspace/playlists' });
    }
    if (url.pathname === '/2.0/repositories/blend-workspace/playlists/refs/branches' && method === 'GET') {
      return fulfillJson(route, { values: [{ name: 'main', target: { hash: HEAD_SHA } }] });
    }
    if (url.pathname === `/2.0/repositories/blend-workspace/playlists/src/${HEAD_SHA}/playlists/ambient.json` && method === 'GET') {
      if (fileMode === 'timeout') {
        await new Promise(resolve => setTimeout(resolve, 21_000));
        try {
          return await route.fulfill({
            status: 200,
            contentType: 'text/plain; charset=utf-8',
            headers: corsHeaders,
            body: JSON.stringify(playlistDocument)
          });
        } catch (_) {
          return;
        }
      }
      if (fileMode === 'unauthorized' || fileMode === 'missing') {
        return route.fulfill({
          status: fileMode === 'unauthorized' ? 401 : 404,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: { message: responseSentinel } })
        });
      }
      if (fileMode === 'malformed') {
        return route.fulfill({ status: 200, contentType: 'text/plain', headers: corsHeaders, body: `{${responseSentinel}` });
      }
      if (fileMode === 'oversized') {
        return route.fulfill({
          status: 200,
          contentType: 'text/plain',
          headers: corsHeaders,
          body: `${'x'.repeat(1_000_001)}${responseSentinel}`
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        headers: corsHeaders,
        body: JSON.stringify(playlistDocument)
      });
    }
    return fulfillJson(route, { error: { message: 'not found' } }, 404);
  });

  const app = new BlendAppPage(page);
  await app.boot();
  await app.importList('playlist', {
    name: 'local-playlist.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      schema: 'player.blend.list.v1',
      type: 'playlist',
      name: 'Local playlist remains',
      items: [{
        id: 'local-item',
        path: 'https://media.example.org/local.mp3',
        sourceUrl: 'https://media.example.org/local.mp3',
        pathKind: 'remote',
        name: 'Local item',
        type: 'audio',
        order: 0
      }]
    }))
  });
  await app.openConfig();
  await page.locator('#git-playlist-provider').selectOption('bitbucket');
  await page.locator('#git-playlist-owner').fill('blend-workspace');
  await page.locator('#git-playlist-repository').fill('playlists');
  await page.locator('#git-playlist-branch').fill('main');
  await page.locator('#git-playlist-path').fill('playlists/ambient.json');
  await page.locator('#git-playlist-token').fill(TOKEN);
  await page.locator('#git-playlist-connect').click();
  await expect(page.locator('#git-playlist-read')).toBeEnabled();

  const localState = () => page.evaluate(() => ({
    playlist: window.Blend.state.playlist.map(({ id, path, sourceUrl, name }) => ({ id, path, sourceUrl, name })),
    playlistIndex: window.Blend.state.runtime.playlistIndex,
    slideshowIndex: window.Blend.state.runtime.slideshowIndex
  }));
  const before = await localState();
  const status = page.locator('#git-playlist-connection');
  const fallbackCopy = 'The remote playlist could not be read. Check the repository and read permission, then retry.';
  await expect(status).toHaveAttribute('aria-live', 'polite');

  for (const mode of ['unauthorized', 'missing', 'malformed', 'oversized', 'timeout']) {
    fileMode = mode;
    await page.locator('#git-playlist-read').click();
    await expect(status).toHaveText(fallbackCopy, { timeout: mode === 'timeout' ? 25_000 : 10_000 });
    await expect(status).toBeVisible();
    await expect(page.locator('#git-playlist-read-result')).toBeHidden();
    await expect(page.locator('#git-playlist-read')).toBeEnabled();
    await expect(page.locator('#git-playlist-read')).toBeFocused();
    expect(await localState()).toEqual(before);
    const logText = await page.evaluate(() => localStorage.getItem('blend-debug-log-v1') || '');
    for (const secret of [TOKEN, responseSentinel, 'playlists/ambient.json', 'blend-workspace/playlists']) {
      expect(logText).not.toContain(secret);
    }
    const statusMetrics = await status.evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }));
    expect(statusMetrics.scrollWidth).toBeLessThanOrEqual(statusMetrics.width);
  }

  await page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
  const zoomedStatusMetrics = await status.evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }));
  expect(zoomedStatusMetrics.scrollWidth).toBeLessThanOrEqual(zoomedStatusMetrics.width);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });

  fileMode = 'valid';
  await page.locator('#git-playlist-read').click();
  await expect(page.locator('#git-playlist-read-result')).toBeVisible();
  await expect(page.locator('#git-playlist-read-data')).toContainText('Café Ambient');
  expect(await localState()).toEqual(before);
  expect(calls.every(method => method === 'GET' || method === 'OPTIONS')).toBe(true);
});
