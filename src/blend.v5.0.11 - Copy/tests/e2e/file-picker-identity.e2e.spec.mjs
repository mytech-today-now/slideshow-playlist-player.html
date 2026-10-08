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

test('same-named folder roots retain separate identities, contents, and playlist references after reload', async ({ page }, testInfo) => {
  const consoleMessages = [];
  page.on('console', message => consoleMessages.push(message.text()));
  const app = new BlendAppPage(page);
  await app.boot('/index.html');
  await app.openConfig();
  await page.evaluate(() => {
    function makeFile(name, content) {
      const file = new File([content], name, { type: 'video/mp4' });
      const handle = Object.create({ getFile: async () => file });
      Object.assign(handle, { kind: 'file', name, transient: true, file });
      return handle;
    }
    function makeDirectory(name, entries) {
      const handle = Object.create({
        async *values() {
          for (const entry of entries) yield entry;
        }
      });
      Object.assign(handle, { kind: 'directory', name });
      return handle;
    }

    const roots = [
      makeDirectory('Assets', [makeDirectory('A', [makeFile('clip.mp4', 'AAAA')])]),
      makeDirectory('Assets', [makeDirectory('A', [makeFile('clip.mp4', 'BBBB')])])
    ];
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: async () => roots.shift(),
      configurable: true
    });
  });

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 1);
  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 2);

  const warning = page.locator('#config-panel .toast-duplicate-warning');
  await expect(warning).toHaveText('This file may duplicate an existing item. Both copies were kept so you can choose safely.');
  const added = await page.evaluate(async () => {
    const state = window.Blend.state;
    const items = await Promise.all(Array.from(state.library.values(), async item => ({
      id: item.id,
      directoryId: item.directoryId,
      name: item.name,
      pathHint: item.pathHint,
      metadata: item.metadata,
      content: await (await item.handle.getFile()).text()
    })));
    return {
      items,
      directoryIds: Array.from(state.directoryHandles.keys()),
      href: location.href
    };
  });
  expect(added.items).toHaveLength(2);
  expect(added.items.map(item => item.name)).toEqual(['clip.mp4', 'clip.mp4']);
  expect(added.items.map(item => item.pathHint)).toEqual(['Assets/A/clip.mp4', 'Assets/A/clip.mp4']);
  expect(added.items.map(item => item.content)).toEqual(['AAAA', 'BBBB']);
  expect(new Set(added.items.map(item => item.id)).size).toBe(2);
  expect(new Set(added.items.map(item => item.directoryId)).size).toBe(2);
  expect(added.items.every(item => /^dir-/.test(item.directoryId))).toBeTruthy();
  expect(added.directoryIds).toEqual(added.items.map(item => item.directoryId));
  expect(JSON.stringify(added.items.map(item => item.metadata || {}))).not.toMatch(/[A-Z]:\\|\\\\/);
  expect(added.href).not.toMatch(/[A-Z]:\\|\\\\/);

  const tabStop = await page.evaluate(() => {
    const notice = document.querySelector('.toast-duplicate-warning');
    if (!notice || notice.tabIndex !== 0) return false;
    const isVisible = element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
    };
    const focusable = Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'))
      .filter(element => element.tabIndex >= 0 && isVisible(element) && !element.disabled);
    const index = focusable.indexOf(notice);
    if (index < 1) return false;
    focusable[index - 1].focus();
    return true;
  });
  expect(tabStop).toBeTruthy();
  await page.keyboard.press('Tab');
  await expect(warning).toBeFocused();

  const viewportMatrix = [
    { width: 3840, height: 2160 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 360, height: 800 }
  ];
  for (const viewport of viewportMatrix) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const notice = document.querySelector('.toast-duplicate-warning');
      const toast = notice.getBoundingClientRect();
      const label = notice.querySelector('span');
      const panel = document.querySelector('#config-panel');
      const grid = document.querySelector('#library-grid');
      const canScrollToCards = panel.scrollHeight > panel.clientHeight || grid.scrollHeight > grid.clientHeight;
      const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight) || 16;
      const cards = Array.from(document.querySelectorAll('#library-grid .lib-card')).map(card => {
        const rect = card.getBoundingClientRect();
        const style = getComputedStyle(card);
        const inViewport = rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0;
        return {
          visibleOrScrollable: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
            && Number(style.opacity) > 0 && (inViewport || canScrollToCards),
          overlapsNotice: rect.left < toast.right && rect.right > toast.left && rect.top < toast.bottom && rect.bottom > toast.top
        };
      });
      return {
        wraps: label.getBoundingClientRect().height > lineHeight * 1.5,
        toastFits: toast.left >= 0 && toast.right <= innerWidth && toast.top >= 0 && toast.bottom <= innerHeight,
        cards
      };
    });
    expect(layout.wraps, `${viewport.width}x${viewport.height}: explanation should wrap: ${JSON.stringify(layout)}`).toBeTruthy();
    expect(layout.toastFits, `${viewport.width}x${viewport.height}: explanation should remain in viewport`).toBeTruthy();
    expect(layout.cards).toHaveLength(2);
    expect(layout.cards.every(card => card.visibleOrScrollable && !card.overlapsNotice), `${viewport.width}x${viewport.height}: both cards should remain reachable outside the explanation: ${JSON.stringify(layout)}`).toBeTruthy();
  }

  await page.setViewportSize({ width: 844, height: 390 });
  for (const item of added.items) {
    const card = page.locator(`#library-grid .lib-card[data-id="${item.id}"]`);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeInViewport();
  }

  for (const [index, item] of added.items.entries()) {
    const card = page.locator(`#library-grid .lib-card[data-id="${item.id}"]`);
    if (index) await card.click({ modifiers: ['Control'] });
    else await card.click();
  }
  await expect.poll(() => page.evaluate(() => window.Blend.state.ui.selectedLibrary.size)).toBe(2);
  await page.locator('#add-selected-playlist').click();
  await expect.poll(() => page.evaluate(() => window.Blend.state.playlist.map(ref => ref.id)))
    .toEqual(added.items.map(item => item.id));
  await expect(page.locator('#save-status')).toHaveText('All changes saved', { timeout: 10000 });

  const exportPromise = page.waitForEvent('download');
  await page.locator('#list-export').click();
  await page.getByRole('menuitem', { name: 'Export Media Library JSON' }).click();
  const download = await exportPromise;
  const exportPath = testInfo.outputPath('same-named-root-library.json');
  await download.saveAs(exportPath);
  const exportedText = await readFile(exportPath, 'utf8');
  const exported = JSON.parse(exportedText);
  expect(exported.items.map(item => item.id).sort()).toEqual(added.items.map(item => item.id).sort());
  expect(exported.items.every(item => !Object.hasOwn(item, 'directoryId'))).toBeTruthy();
  expect(exported.items.every(item => item.path === 'Assets/A/clip.mp4')).toBeTruthy();
  expect(exportedText).not.toMatch(/[A-Z]:\\|\\\\/);
  expect(consoleMessages.join('\n')).not.toMatch(/[A-Z]:\\|\\\\/);

  await page.reload();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 2 && window.Blend?.state?.playlist?.length === 2);
  const restored = await page.evaluate(async () => {
    const state = window.Blend.state;
    return Promise.all(state.playlist.map(async ref => {
      const item = state.library.get(ref.id);
      return {
        id: ref.id,
        directoryId: item.directoryId,
        pathHint: item.pathHint,
        available: ref.available,
        hasHandle: !!item.handle,
        content: await (await item.handle.getFile()).text()
      };
    }));
  });
  expect(restored.map(item => item.id)).toEqual(added.items.map(item => item.id));
  expect(restored.map(item => item.directoryId)).toEqual(added.items.map(item => item.directoryId));
  expect(restored.map(item => item.pathHint)).toEqual(['Assets/A/clip.mp4', 'Assets/A/clip.mp4']);
  expect(restored.every(item => item.available === true && item.hasHandle)).toBeTruthy();
  expect(restored.map(item => item.content)).toEqual(['AAAA', 'BBBB']);
});

test('a proven same folder root and repeated source URLs still deduplicate', async ({ page }) => {
  const app = new BlendAppPage(page);
  await page.route('https://example.invalid/**', route => route.abort());
  await app.boot('/index.html');
  await app.openConfig();
  await page.evaluate(() => {
    function makeFile(name, content) {
      const file = new File([content], name, { type: 'video/mp4' });
      const handle = Object.create({ getFile: async () => file });
      Object.assign(handle, { kind: 'file', name, transient: true, file });
      return handle;
    }
    function makeRoot(rootKey) {
      const file = makeFile('clip.mp4', 'SAME');
      const root = Object.create({
        async *values() { yield file; },
        async isSameEntry(other) { return other?.rootKey === this.rootKey; }
      });
      Object.assign(root, { kind: 'directory', name: 'Assets', rootKey });
      return root;
    }

    const roots = [makeRoot('same-root'), makeRoot('same-root')];
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: async () => roots.shift(),
      configurable: true
    });
  });

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 1);
  const firstId = await page.evaluate(() => Array.from(window.Blend.state.library.keys())[0]);
  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.directoryHandles?.size === 1);
  await expect(page.locator('.toast').filter({ hasText: 'Added 0 items from "Assets" (1 already present)' })).toBeVisible();
  expect(await page.evaluate(() => Array.from(window.Blend.state.library.keys()))).toEqual([firstId]);

  await page.locator('#add-url').click();
  await expect(page.locator('#experience-modal')).toBeVisible();
  await page.locator('#experience-modal-input').fill('https://example.invalid/clip.mp4 https://example.invalid/clip.mp4');
  await page.locator('#experience-modal-ok').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 2);
  await expect(page.locator('.toast').filter({ hasText: 'Added 1 URL item (1 already present)' })).toBeVisible();
  expect(await page.evaluate(() => Array.from(window.Blend.state.library.values())
    .filter(item => item.sourceUrl === 'https://example.invalid/clip.mp4').length)).toBe(1);
});

test('legacy path-only media remains playable and exportable without a root identity', async ({ page }, testInfo) => {
  const app = new BlendAppPage(page);
  await app.boot('/index.html');
  await app.openConfig();

  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#add-files').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('LEGA')
  });
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 1);
  const legacyId = await page.evaluate(async () => {
    const item = Array.from(window.Blend.state.library.values())[0];
    item.pathHint = 'Legacy/A/clip.mp4';
    await window.Blend.saveStateNow();
    return item.id;
  });

  const legacy = {
    schema: 'player.blend.experience.v2',
    type: 'experience',
    name: 'Legacy path-only media',
    settings: {},
    library: {
      order: [legacyId],
      items: [{
        id: legacyId,
        name: 'clip.mp4',
        path: 'Legacy/A/clip.mp4',
        pathKind: 'relative',
        pathHint: 'Legacy/A/clip.mp4',
        type: 'video',
        size: 4
      }]
    },
    playlist: {
      type: 'playlist',
      items: [{ id: legacyId, name: 'clip.mp4', path: 'Legacy/A/clip.mp4', pathKind: 'relative', type: 'video' }]
    },
    slideshow: { type: 'slideshow', items: [] }
  };
  const importPromise = page.waitForEvent('filechooser');
  await page.locator('#experience-import').click();
  const experienceChooser = await importPromise;
  await experienceChooser.setFiles({
    name: 'legacy-path-only-experience.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy))
  });
  await page.waitForFunction(() => window.Blend?.state?.projectName === 'Legacy path-only media');

  const imported = await page.evaluate(async importedId => {
    const state = window.Blend.state;
    const item = state.library.get(importedId);
    const ref = state.playlist.find(entry => entry.id === importedId);
    return {
      directoryId: item?.directoryId,
      pathHint: item?.pathHint,
      stale: item?.stale,
      available: ref?.available,
      playlistId: ref?.id,
      content: item?.handle ? await (await item.handle.getFile()).text() : null
    };
  }, legacyId);
  expect(imported.directoryId).toBeUndefined();
  expect(imported.pathHint).toBe('Legacy/A/clip.mp4');
  expect(imported.stale).toBe(false);
  expect(imported.available).toBe(true);
  expect(imported.playlistId).toBe(legacyId);
  expect(imported.content).toBe('LEGA');
  const exportPromise = page.waitForEvent('download');
  await page.locator('#experience-export').click();
  const download = await exportPromise;
  const exportPath = testInfo.outputPath('legacy-path-only-roundtrip.json');
  await download.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, 'utf8'));
  const exportedItem = exported.library.items.find(item => item.id === legacyId);
  expect(exportedItem.path).toBe('Legacy/A/clip.mp4');
  expect(exportedItem.pathKind).toBe('relative');
  expect(exportedItem.sourceUrl).toBeUndefined();
  expect(exportedItem.directoryId).toBeUndefined();
  expect(JSON.stringify(exported)).not.toMatch(/[A-Z]:\\|\\\\/);

  await app.importExperience(exportPath);
  const reimported = await page.evaluate(async importedId => {
    const item = window.Blend.state.library.get(importedId);
    return {
      directoryId: item?.directoryId,
      pathHint: item?.pathHint,
      content: item?.handle ? await (await item.handle.getFile()).text() : null
    };
  }, legacyId);
  expect(reimported.directoryId).toBeUndefined();
  expect(reimported.pathHint).toBe('Legacy/A/clip.mp4');
  expect(reimported.content).toBe('LEGA');
});
