import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

async function bootApp(page) {
  const app = new BlendAppPage(page);
  await app.boot('/index.html');
  await app.openConfig();
}

async function installDirectoryPicker(page, mode) {
  await page.evaluate(async scanMode => {
    const makeFile = (name, contents) => {
      const type = contents instanceof Blob && contents.type ? contents.type : 'video/mp4';
      const file = new File([contents], name, { type });
      const handle = Object.create({ getFile: async () => file });
      Object.assign(handle, { kind: 'file', name, file, transient: true });
      return handle;
    };
    const makeDirectory = (name, values) => {
      const handle = Object.create({ values });
      Object.assign(handle, { kind: 'directory', name });
      return handle;
    };

    let root;
    if (scanMode === 'depth-recovery') {
      const sample = await fetch('/samples/nyc-01.mp4');
      const playableVideo = await sample.blob();
      const deepMedia = makeFile('deep.mp4', playableVideo);
      const level7 = makeDirectory('Level7', async function* () { yield deepMedia; });
      const level6 = makeDirectory('Level6', async function* () {
        yield makeFile('boundary-6.mp4', 'boundary-six');
        yield level7;
      });
      const level5 = makeDirectory('Level5', async function* () {
        yield makeFile('boundary-5.mp4', 'boundary-five');
        yield level6;
      });
      let nested = level5;
      for (let depth = 4; depth >= 1; depth--) {
        const child = nested;
        nested = makeDirectory(`Level${depth}`, async function* () { yield child; });
      }
      root = makeDirectory('Assets', async function* () { yield nested; });
      let pickCount = 0;
      window.__directoryPickerCalls = () => pickCount;
      window.showDirectoryPicker = async () => (pickCount++ === 0 ? root : level7);
      return;
    } else if (scanMode === 'partial-retry') {
      const before = makeFile('before.mp4', 'before');
      const middle = makeFile('middle.mp4', 'middle');
      const after = makeFile('after.mp4', 'after');
      const recovered = makeFile('recovered.mp4', 'recovered');
      let failingBranchReads = 0;
      const failingBranch = makeDirectory('Unreadable', async function* () {
        yield middle;
        if (failingBranchReads++ === 0) throw new DOMException('simulated read failure', 'NotReadableError');
        yield recovered;
      });
      const laterBranch = makeDirectory('Later', async function* () { yield after; });
      root = makeDirectory('Assets', async function* () {
        yield before;
        yield failingBranch;
        yield laterBranch;
      });
    } else if (scanMode === 'cancelled') {
      const file = makeFile('kept.mp4', 'kept');
      root = makeDirectory('Canceled', async function* () {
        yield file;
        throw new DOMException('simulated cancellation', 'AbortError');
      });
    } else if (scanMode === 'empty') {
      root = makeDirectory('Empty', async function* () {});
    } else {
      const file = makeFile('complete.mp4', 'complete');
      root = makeDirectory('Complete', async function* () { yield file; });
    }

    window.showDirectoryPicker = async () => root;
  }, mode);
}

async function readPersistedFolderImport(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1');
    request.onerror = () => reject(request.error || new Error('Could not open the Blend database'));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['library', 'dirHandles'], 'readonly');
      const libraryRequest = transaction.objectStore('library').getAll();
      const directoryRequest = transaction.objectStore('dirHandles').getAll();
      let library = [];
      let directories = [];
      libraryRequest.onsuccess = () => { library = libraryRequest.result; };
      directoryRequest.onsuccess = () => { directories = directoryRequest.result; };
      transaction.oncomplete = () => {
        resolve({
          library: library.map(record => ({
            id: record.id,
            name: record.name,
            directoryId: record.directoryId || null,
            fileSize: record.file?.size || 0,
            hasFile: record.file instanceof File
          })),
          directories: directories.map(record => ({ id: record.id, name: record.name }))
        });
        db.close();
      };
      transaction.onerror = () => reject(transaction.error || new Error('Could not read persisted folder state'));
    };
  }));
}

async function expectDirectoryToastFits(page, status) {
  const metrics = await status.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const label = node.querySelector('span');
    const labelRect = label.getBoundingClientRect();
    const actionRect = node.querySelector('button').getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      labelHeight: labelRect.height,
      labelLineHeight: Number.parseFloat(getComputedStyle(label).lineHeight),
      actionTop: actionRect.top,
      labelBottom: labelRect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      pageWidth: document.documentElement.scrollWidth
    };
  });

  expect(metrics.left).toBeGreaterThanOrEqual(-1);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.top).toBeGreaterThanOrEqual(-1);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
  expect(metrics.labelHeight).toBeGreaterThan(metrics.labelLineHeight);
  expect(metrics.actionTop).toBeGreaterThanOrEqual(metrics.labelBottom - 1);
}

test('partial folder scan keeps found files, reports the skipped branch, and retries without duplicates', async ({ page }) => {
  await bootApp(page);
  await installDirectoryPicker(page, 'partial-retry');

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 3);
  const partialNotice = page.locator('.toast-directory-scan');
  await expect(partialNotice).toContainText('Folder scan was partial: 1 folder could not be read.');
  await expect(partialNotice).toContainText('3 media files found; 3 added, 0 already present.');

  await partialNotice.getByRole('button', { name: 'Retry scan' }).click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 4);
  await expect(page.locator('.toast-directory-scan')).toContainText('Folder scan complete.');

  const library = await page.evaluate(async () => Promise.all(Array.from(window.Blend.state.library.values(), async item => ({
    pathHint: item.pathHint,
    content: await (await item.handle.getFile()).text()
  }))));
  expect(library).toHaveLength(4);
  expect(library.map(item => item.pathHint).sort()).toEqual([
    'Assets/Later/after.mp4',
    'Assets/Unreadable/middle.mp4',
    'Assets/Unreadable/recovered.mp4',
    'Assets/before.mp4'
  ]);
  expect(library.map(item => item.content).sort()).toEqual(['after', 'before', 'middle', 'recovered']);
});

test('a complete folder scan keeps its existing success message', async ({ page }) => {
  await bootApp(page);
  await installDirectoryPicker(page, 'complete');

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 1);
  await expect(page.locator('.toast').filter({ hasText: 'Added 1 item from "Complete" (0 already present)' })).toBeVisible();
});

test('depth-limit scans report truncation and recover from a deeper folder without duplicates', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await bootApp(page);
  await installDirectoryPicker(page, 'depth-recovery');

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 2);

  const status = page.locator('#config-panel > .toast-directory-scan');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toContainText('Folder scan stopped at the six-level limit. Select a deeper folder directly to include its media.');
  await expect(status).toContainText('1 folder was skipped at the limit.');
  await expect(status).toContainText('2 media files found; 2 added, 0 already present.');
  await expect(status).not.toContainText('could not be read');
  await expect(status.getByRole('button', { name: 'Choose deeper folder' })).toHaveCount(1);
  await expect(page.locator('.toast-directory-scan')).toHaveCount(1);
  await expect(page.getByText('Folder scan complete.', { exact: false })).toHaveCount(0);
  await expect(page.locator('#toast-container').getByText('Added 2 items from "Assets"', { exact: false })).toHaveCount(0);

  const foundBefore = await page.evaluate(async () => Promise.all(
    Array.from(window.Blend.state.library.values(), async item => ({
      id: item.id,
      name: item.name,
      pathHint: item.pathHint,
      content: await (await item.handle.getFile()).text()
    }))
  ));
  expect(foundBefore).toHaveLength(2);
  expect(foundBefore.map(item => item.name).sort()).toEqual(['boundary-5.mp4', 'boundary-6.mp4']);
  const foundBeforeIds = new Map(foundBefore.map(item => [item.name, item.id]));

  await expectDirectoryToastFits(page, status);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectDirectoryToastFits(page, status);

  const chooseDeeper = status.getByRole('button', { name: 'Choose deeper folder' });
  await page.locator('#close-config').focus();
  await page.keyboard.press('Tab');
  await expect(chooseDeeper).toBeFocused();
  const keyboardFocus = await chooseDeeper.evaluate(node => ({
    focusVisible: node.matches(':focus-visible'),
    outlineStyle: getComputedStyle(node).outlineStyle,
    outlineWidth: getComputedStyle(node).outlineWidth
  }));
  expect(keyboardFocus).toEqual({ focusVisible: true, outlineStyle: 'solid', outlineWidth: '2px' });
  await page.keyboard.press('Enter');

  await page.waitForFunction(() => window.Blend?.state?.library?.size === 3);
  await expect(page.locator('#toast-container')).toContainText('Added 1 item from "Level7" (0 already present)');
  const recovered = await page.evaluate(() => Array.from(window.Blend.state.library.values(), item => ({
    id: item.id,
    name: item.name,
    pathHint: item.pathHint
  })));
  expect(recovered).toHaveLength(3);
  expect(recovered.filter(item => item.name === 'deep.mp4')).toHaveLength(1);
  expect(recovered.find(item => item.name === 'boundary-5.mp4')?.id).toBe(foundBeforeIds.get('boundary-5.mp4'));
  expect(recovered.find(item => item.name === 'boundary-6.mp4')?.id).toBe(foundBeforeIds.get('boundary-6.mp4'));
  expect(new Set(recovered.map(item => item.id)).size).toBe(3);
  expect(await page.evaluate(() => window.__directoryPickerCalls())).toBe(2);

  const persistedBeforeReload = await readPersistedFolderImport(page);
  expect(persistedBeforeReload.library).toHaveLength(3);
  expect(persistedBeforeReload.directories).toHaveLength(2);
  const persistedDeepMedia = persistedBeforeReload.library.filter(item => item.name === 'deep.mp4');
  expect(persistedDeepMedia).toHaveLength(1);
  expect(persistedDeepMedia[0].hasFile).toBe(true);
  expect(persistedDeepMedia[0].fileSize).toBeGreaterThan(0);
  expect(new Set(persistedBeforeReload.library.map(item => item.id)).size).toBe(3);

  await page.reload();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 3);
  const persistedAfterReload = await readPersistedFolderImport(page);
  expect(persistedAfterReload.library).toHaveLength(3);
  expect(persistedAfterReload.directories).toHaveLength(2);
  expect(persistedAfterReload.library.filter(item => item.name === 'deep.mp4')).toHaveLength(1);

  const app = new BlendAppPage(page);
  await app.openConfig();
  await app.selectLibraryItemsByNames(['deep.mp4']);
  await app.addSelectedLibraryToList('playlist', 1);
  await app.closeConfig();
  await page.locator('#btn-play').click();
  await page.waitForFunction(() => {
    const video = document.querySelector('#playlist-layer video');
    return !!video && video.readyState >= 2 && video.videoWidth > 0 && !video.paused;
  }, undefined, { timeout: 20000 });
});

test('an empty complete folder scan explains that no supported media was found', async ({ page }) => {
  await bootApp(page);
  await installDirectoryPicker(page, 'empty');

  await page.locator('#add-folder').click();
  await expect(page.locator('.toast-directory-scan')).toHaveText('No supported media found in that folder');
  await expect.poll(() => page.evaluate(() => window.Blend.state.library.size)).toBe(0);
});

test('canceled folder scans retain discovered files without showing a success message', async ({ page }) => {
  await bootApp(page);
  await installDirectoryPicker(page, 'cancelled');

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 1);
  await expect(page.locator('.toast-directory-scan')).toHaveText('Folder scan canceled. 1 media file found so far was kept.');
  await expect(page.locator('.toast').filter({ hasText: 'Added 1 item from "Canceled"' })).toHaveCount(0);
});
