import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BlendAppPage } from './support/blend-app-page.mjs';

const listDocument = {
  schema: 'player.blend.list.v1',
  type: 'playlist',
  name: 'Public E2E playlist',
  description: '',
  order: ['track-a'],
  items: [
    {
      id: 'track-a',
      path: 'https://media.example.org/short-tone.mp3',
      sourceUrl: 'https://media.example.org/short-tone.mp3',
      pathKind: 'remote',
      name: 'short-tone.mp3',
      type: 'audio',
      order: 0
    }
  ]
};

function githubFile(text) {
  return {
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(text, 'utf8').toString('base64')
  };
}

test('fetches a configured public catalog and imports a sanitized playlist locally', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const mediaBytes = await readFile(new URL('./fixtures/short-tone.mp3', import.meta.url));
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/blend-catalog/index.v1.json')) {
      return route.fulfill({ status: 200, contentType: 'application/json', json: githubFile(JSON.stringify({
        schema: 'player.blend.catalog.v1',
        playlists: [{ id: 'ambient', title: 'Ambient' }]
      })) });
    }
    if (url.pathname.endsWith('/blend-catalog/playlists/ambient.json')) {
      return route.fulfill({ status: 200, contentType: 'application/json', json: githubFile(JSON.stringify(listDocument)) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"not found"}' });
  });
  await page.route('https://media.example.org/**', route => route.fulfill({
    status: 200,
    contentType: 'audio/mpeg',
    body: mediaBytes
  }));

  const app = new BlendAppPage(page);
  await app.boot();
  await app.openConfig();

  await page.getByLabel('Provider').selectOption('github');
  await page.getByLabel('Owner or workspace').fill('blend-team');
  await page.getByLabel('Repository').fill('public-playlists');
  await page.getByLabel('Branch').fill('main');
  await page.getByLabel('Catalog directory').fill('blend-catalog');
  await page.locator('#git-catalog-fetch').click();

  await expect(page.locator('#git-catalog-status')).toContainText('Loaded 1 public playlist');
  await expect(page.getByRole('button', { name: 'Import Ambient to Playlist' })).toBeVisible();
  await page.getByRole('button', { name: 'Import Ambient to Playlist' }).click();
  await expect(page.locator('#pl-count')).toContainText('(1)');
  await expect(page.locator('#git-catalog-status')).toContainText('The public repository was not changed.');

  const storageState = await page.evaluate(() => ({
    catalog: JSON.parse(localStorage.getItem('blend-public-git-catalog-v1') || '{}'),
    runtime: localStorage.getItem('blend-runtime-config-v1') || ''
  }));
  expect(storageState.catalog).toEqual({
    provider: 'github', owner: 'blend-team', repository: 'public-playlists', branch: 'main', directory: 'blend-catalog'
  });
  expect(storageState.runtime).not.toContain('github');
  expect(storageState.runtime).not.toContain('token');
  expect(pageErrors).toEqual([]);
});
