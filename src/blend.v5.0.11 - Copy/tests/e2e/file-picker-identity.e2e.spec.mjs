import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

async function addSyntheticMedia(page, content, expectedCount) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#add-files').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'duplicate.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from(content)
  });
  await page.waitForFunction(count => window.Blend?.state?.library?.size === count, expectedCount);
}

test('separate same-name same-size picker files remain selectable, exportable, and saved', async ({ page }, testInfo) => {
  const app = new BlendAppPage(page);
  await app.boot('/index.html');
  await app.openConfig();

  await addSyntheticMedia(page, 'AAAA', 1);
  await addSyntheticMedia(page, 'BBBB', 2);

  const added = await page.evaluate(async () => {
    const items = Array.from(window.Blend.state.library.values());
    return Promise.all(items.map(async item => ({
      id: item.id,
      name: item.name,
      size: item.size,
      pathHint: item.pathHint,
      sourceUrl: item.sourceUrl,
      content: await (await item.handle.getFile()).text()
    })));
  });
  expect(added).toHaveLength(2);
  expect(added.map(item => item.name)).toEqual(['duplicate.mp4', 'duplicate.mp4']);
  expect(added.map(item => item.size)).toEqual([4, 4]);
  expect(added.map(item => item.pathHint)).toEqual(['./duplicate.mp4', './duplicate.mp4']);
  expect(added.map(item => item.content)).toEqual(['AAAA', 'BBBB']);
  expect(added.map(item => item.sourceUrl)).toEqual([null, null]);
  expect(new Set(added.map(item => item.id)).size).toBe(2);
  await expect(page.locator('#library-grid .lib-card')).toHaveCount(2);

  await page.locator(`#library-grid .lib-card[data-id="${added[0].id}"]`).click();
  await page.locator(`#library-grid .lib-card[data-id="${added[1].id}"]`).click({ modifiers: ['Control'] });
  await expect.poll(() => page.evaluate(() => window.Blend.state.ui.selectedLibrary.size)).toBe(2);
  await page.locator('#add-selected-playlist').click();
  await expect.poll(() => page.evaluate(() => window.Blend.state.playlist.map(ref => ref.id)))
    .toEqual(added.map(item => item.id));
  await expect(page.locator('#save-status')).toHaveText('All changes saved', { timeout: 10000 });

  const exportPromise = page.waitForEvent('download');
  await page.locator('#list-export').click();
  await page.getByRole('menuitem', { name: 'Export Media Library JSON' }).click();
  const download = await exportPromise;
  const exportPath = testInfo.outputPath('same-name-library.json');
  await download.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, 'utf8'));
  expect(exported.items.map(item => item.id).sort()).toEqual(added.map(item => item.id).sort());

  await page.reload();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 2 && window.Blend?.state?.playlist?.length === 2);
  const reloaded = await page.evaluate(async () => {
    const state = window.Blend.state;
    return {
      itemIds: Array.from(state.library.keys()).sort(),
      playlistIds: state.playlist.map(ref => ref.id),
      contents: await Promise.all(Array.from(state.library.values(), async item =>
        (await item.handle.getFile()).text()
      ))
    };
  });
  expect(reloaded.itemIds).toEqual(added.map(item => item.id).sort());
  expect(reloaded.playlistIds).toEqual(added.map(item => item.id));
  expect(reloaded.contents.sort()).toEqual(['AAAA', 'BBBB']);
});

test('folder path hints keep same-name files separate and both playlist handles resolvable', async ({ page }) => {
  const app = new BlendAppPage(page);
  await app.boot('/index.html');
  await app.openConfig();
  await page.evaluate(() => {
    function makeDirectory(name, entries) {
      const directory = Object.create({
        async *values() {
          for (const entry of entries) yield entry;
        }
      });
      directory.kind = 'directory';
      directory.name = name;
      return directory;
    }
    function makeFile(name, content) {
      const file = new File([content], name, { type: 'video/mp4' });
      const handle = Object.create({ getFile: async () => file });
      Object.assign(handle, { kind: 'file', name, transient: true, file });
      return handle;
    }
    const root = makeDirectory('Assets', [
      makeDirectory('A', [makeFile('clip.mp4', 'AAAA')]),
      makeDirectory('B', [makeFile('clip.mp4', 'BBBB')])
    ]);
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => root, configurable: true });
  });

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 2);
  const added = await page.evaluate(async () => Promise.all(Array.from(window.Blend.state.library.values(), async item => ({
    id: item.id,
    name: item.name,
    size: item.size,
    pathHint: item.pathHint,
    content: await (await item.handle.getFile()).text()
  }))));
  expect(added.map(item => item.name)).toEqual(['clip.mp4', 'clip.mp4']);
  expect(added.map(item => item.size)).toEqual([4, 4]);
  expect(added.map(item => item.pathHint)).toEqual(['Assets/A/clip.mp4', 'Assets/B/clip.mp4']);
  expect(added.map(item => item.content)).toEqual(['AAAA', 'BBBB']);
  expect(new Set(added.map(item => item.id)).size).toBe(2);

  await page.locator(`#library-grid .lib-card[data-id="${added[0].id}"]`).click();
  await page.locator(`#library-grid .lib-card[data-id="${added[1].id}"]`).click({ modifiers: ['Control'] });
  await page.locator('#add-selected-playlist').click();
  await expect.poll(() => page.evaluate(() => window.Blend.state.playlist.map(ref => ref.id)))
    .toEqual(added.map(item => item.id));
  await expect(page.locator('#save-status')).toHaveText('All changes saved', { timeout: 10000 });

  await page.reload();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 2 && window.Blend?.state?.playlist?.length === 2);
  const restored = await page.evaluate(async () => {
    const state = window.Blend.state;
    return Promise.all(state.playlist.map(async ref => {
      const item = state.library.get(ref.id);
      return {
        id: ref.id,
        pathHint: item.pathHint,
        content: await (await item.handle.getFile()).text()
      };
    }));
  });
  expect(restored.map(item => item.id)).toEqual(added.map(item => item.id));
  expect(restored.map(item => item.pathHint)).toEqual(['Assets/A/clip.mp4', 'Assets/B/clip.mp4']);
  expect(restored.map(item => item.content)).toEqual(['AAAA', 'BBBB']);
});
