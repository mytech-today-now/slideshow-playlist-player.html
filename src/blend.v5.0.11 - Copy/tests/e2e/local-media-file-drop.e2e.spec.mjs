import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import { createRunSuffix } from './support/experience-lifecycle-utils.mjs';

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqu8AAAAASUVORK5CYII=';

async function dispatchLocalFileDrop(page, selector, { name, type, base64 }) {
  await page.locator(selector).evaluate((target, payload) => {
    const bytes = Uint8Array.from(atob(payload.base64), character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], payload.name, { type: payload.type }));

    const itemPrototype = Object.getPrototypeOf(transfer.items[0]);
    const originalMethod = Object.getOwnPropertyDescriptor(itemPrototype, 'getAsFileSystemHandle');
    Object.defineProperty(itemPrototype, 'getAsFileSystemHandle', {
      configurable: true,
      value: async () => {
        window.__localFileDropHandleCalls = (window.__localFileDropHandleCalls || 0) + 1;
        return null;
      }
    });

    try {
      const eventOptions = { bubbles: true, cancelable: true, dataTransfer: transfer };
      target.dispatchEvent(new DragEvent('dragenter', eventOptions));
      target.dispatchEvent(new DragEvent('dragover', eventOptions));
      target.dispatchEvent(new DragEvent('drop', eventOptions));
    } finally {
      if (originalMethod) Object.defineProperty(itemPrototype, 'getAsFileSystemHandle', originalMethod);
      else delete itemPrototype.getAsFileSystemHandle;
    }
  }, { name, type, base64 });
}

async function hasLibraryFile(page, name) {
  return page.evaluate(filename => Array.from(window.Blend?.state?.library?.values() || [])
    .some(item => item.name === filename), name);
}

async function hasListFile(page, layer, name) {
  return page.evaluate(({ which, filename }) => {
    const state = window.Blend?.state;
    return !!state && state[which].some(ref => state.library.get(ref.id)?.name === filename);
  }, { which: layer, filename: name });
}

test('dropping local files imports into the library, playlist, and slideshow without a file handle', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = new BlendAppPage(page);
  const browserErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push({ text: message.text(), ...message.location() });
  });
  page.on('pageerror', error => browserErrors.push(error.message));

  await blendPage.boot('/index.html');
  expect(new URL(page.url()).pathname).toBe('/index.html');
  expect(await page.title()).toMatch(/Blend/);
  await expect(page.locator('#playlist-layer video').first()).toBeAttached();
  await blendPage.createExperience(`Local File Drop ${createRunSuffix(testInfo)}`);
  await blendPage.openConfig();

  await page.evaluate(() => { window.__localFileDropHandleCalls = 0; });
  await dispatchLocalFileDrop(page, '#library-grid', {
    name: 'dropped-library.png',
    type: 'image/png',
    base64: ONE_PIXEL_PNG
  });
  await expect.poll(() => hasLibraryFile(page, 'dropped-library.png')).toBe(true);

  const audio = (await readFile(new URL('./fixtures/short-tone.mp3', import.meta.url))).toString('base64');
  await blendPage.switchListTab('playlist');
  await dispatchLocalFileDrop(page, '#list-editor', {
    name: 'dropped-playlist.mp3',
    type: 'audio/mpeg',
    base64: audio
  });
  await expect.poll(() => hasListFile(page, 'playlist', 'dropped-playlist.mp3')).toBe(true);

  await blendPage.switchListTab('slideshow');
  await dispatchLocalFileDrop(page, '#list-editor', {
    name: 'dropped-slideshow.png',
    type: 'image/png',
    base64: ONE_PIXEL_PNG
  });
  await expect.poll(() => hasListFile(page, 'slideshow', 'dropped-slideshow.png')).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__localFileDropHandleCalls)).toBe(3);

  const saved = await page.evaluate(() => window.Blend.flushSaveState());
  expect(saved).toBe(true);
  if (process.env.BLEND_CAPTURE_LOCAL_DROP_SCREENSHOT === '1') {
    await page.screenshot({ path: testInfo.outputPath('local-file-drop.png') });
  }

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await expect.poll(() => hasLibraryFile(page, 'dropped-library.png')).toBe(true);
  await expect.poll(() => hasListFile(page, 'playlist', 'dropped-playlist.mp3')).toBe(true);
  await expect.poll(() => hasListFile(page, 'slideshow', 'dropped-slideshow.png')).toBe(true);
  // The fixture has no optional OAuth status route; fail on every other browser error.
  expect(browserErrors.filter(error =>
    !error?.url?.endsWith('/api/playlist-import/oauth/status')
  )).toEqual([]);
});
