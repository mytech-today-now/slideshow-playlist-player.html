import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlendAppPage } from './support/blend-app-page.mjs';

const RESPONSIVE_VIEWPORTS = [
  { label: '4K desktop', width: 3840, height: 2160 },
  { label: 'HD desktop', width: 1920, height: 1080 },
  { label: 'tablet landscape', width: 1024, height: 768 },
  { label: 'tablet portrait', width: 768, height: 1024 },
  { label: 'mobile portrait', width: 390, height: 844 },
  { label: 'mobile landscape', width: 844, height: 390 },
  { label: 'small mobile', width: 360, height: 800 }
];

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
    const makeSixLevelBranch = (name, files) => {
      let subtree = makeDirectory(`${name}-Media`, async function* () { yield* files; });
      for (let depth = 5; depth >= 1; depth -= 1) {
        const child = subtree;
        subtree = makeDirectory(`${name}-Level-${depth}`, async function* () { yield child; });
      }
      return subtree;
    };
    const makeSyntheticFiles = (count, offset = 0) => Array.from({ length: count }, (_, index) =>
      makeFile(`Synthetic-${String(offset + index).padStart(5, '0')}.mp4`, 'synthetic'));

    let root;
    if (scanMode === 'limit-recovery') {
      const importedBranch = makeSixLevelBranch('Imported', makeSyntheticFiles(250));
      const pendingBranch = makeSixLevelBranch('Pending', [makeFile('Synthetic-00250.mp4', 'synthetic')]);
      root = makeDirectory('SyntheticRoot', async function* () {
        yield importedBranch;
        yield pendingBranch;
      });
      const seedRoot = makeDirectory('Seed', async function* () { yield makeFile('Seed.mp4', 'seed'); });
      let pickCount = 0;
      window.__directoryPickerCalls = () => pickCount;
      window.showDirectoryPicker = async () => {
        const currentPick = pickCount++;
        if (currentPick === 0) return seedRoot;
        if (currentPick === 1) return root;
        return pendingBranch;
      };
      return;
    } else if (scanMode.startsWith('broad-load:')) {
      const count = Number(scanMode.slice('broad-load:'.length));
      const branchCount = 10;
      const branchSize = Math.ceil(count / branchCount);
      const branches = [];
      let nextIndex = 0;
      for (let branch = 0; branch < branchCount; branch += 1) {
        const size = Math.min(branchSize, count - nextIndex);
        branches.push(makeSixLevelBranch(`Batch-${branch}`, makeSyntheticFiles(size, nextIndex)));
        nextIndex += size;
      }
      root = makeDirectory('SyntheticRoot', async function* () { yield* branches; });
      window.showDirectoryPicker = async () => root;
      return;
    } else if (scanMode === 'depth-recovery') {
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
    } else if (scanMode === 'depth-empty') {
      let nested = makeDirectory('Level7', async function* () {});
      for (let depth = 6; depth >= 1; depth--) {
        const child = nested;
        nested = makeDirectory(`Level${depth}`, async function* () { yield child; });
      }
      root = makeDirectory('EmptyDepth', async function* () { yield nested; });
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

async function instrumentFolderBenchmark(page) {
  await page.evaluate(() => {
    const benchmark = {
      startedAt: performance.now(),
      firstWriteMs: null,
      currentRetained: 0,
      peakRetained: 0,
      progressUpdateCount: 0,
      lastProgressText: '',
      peakHeapBytes: 0
    };
    window.__folderImportBenchmark = benchmark;
    const recordProgress = value => {
      const text = String(value || '');
      if (text && text !== benchmark.lastProgressText) {
        benchmark.lastProgressText = text;
        benchmark.progressUpdateCount += 1;
      }
    };

    const textContentDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    Object.defineProperty(Node.prototype, 'textContent', {
      configurable: textContentDescriptor.configurable,
      enumerable: textContentDescriptor.enumerable,
      get: textContentDescriptor.get,
      set(value) {
        if (this.parentElement?.classList.contains('toast-directory-scan-progress')) recordProgress(value);
        return textContentDescriptor.set.call(this, value);
      }
    });

    const syntheticHandleCount = values => values.reduce((count, value) =>
      count + (value?.kind === 'file' && value.name?.startsWith('Synthetic-') ? 1 : 0), 0);
    const originalPush = Array.prototype.push;
    Array.prototype.push = function (...values) {
      const added = syntheticHandleCount(values);
      if (added) {
        benchmark.currentRetained += added;
        benchmark.peakRetained = Math.max(benchmark.peakRetained, benchmark.currentRetained);
      }
      return originalPush.apply(this, values);
    };
    const originalSplice = Array.prototype.splice;
    Array.prototype.splice = function (...args) {
      const removed = originalSplice.apply(this, args);
      const released = syntheticHandleCount(removed);
      if (released) benchmark.currentRetained = Math.max(0, benchmark.currentRetained - released);
      return removed;
    };

    for (const method of ['put', 'add']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        if (window.__folderImportBenchmark.firstWriteMs == null) {
          window.__folderImportBenchmark.firstWriteMs = performance.now() - benchmark.startedAt;
        }
        return original.apply(this, args);
      };
    }

    const sample = () => {
      const text = document.querySelector('.toast-directory-scan-progress span')?.textContent || '';
      recordProgress(text);
      benchmark.peakHeapBytes = Math.max(benchmark.peakHeapBytes, performance.memory?.usedJSHeapSize || 0);
    };
    new MutationObserver(sample).observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
    window.__folderImportBenchmarkSampler = setInterval(sample, 40);
  });
}

async function readFolderBenchmark(page) {
  return page.evaluate(() => {
    clearInterval(window.__folderImportBenchmarkSampler);
    const benchmark = window.__folderImportBenchmark;
    const progressCount = benchmark.lastProgressText.match(/(\d+) files? found/);
    return {
      elapsedMs: Math.round(performance.now() - benchmark.startedAt),
      firstWriteMs: benchmark.firstWriteMs == null ? null : Math.round(benchmark.firstWriteMs),
      peakRetained: benchmark.peakRetained,
      progressUpdateCount: benchmark.progressUpdateCount,
      finalProgressCount: progressCount ? Number(progressCount[1]) : null,
      peakHeapBytes: benchmark.peakHeapBytes || null
    };
  });
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
      actionHeight: actionRect.height,
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
  expect(metrics.actionHeight).toBeGreaterThanOrEqual(44);
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

test('a six-level folder at the supported media limit imports every file', async ({ page }) => {
  test.setTimeout(60000);
  await bootApp(page);
  await installDirectoryPicker(page, 'broad-load:250');
  await instrumentFolderBenchmark(page);

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 250);
  await expect(page.locator('#toast-container')).toContainText('Added 250 items from "SyntheticRoot" (0 already present)');
  await expect(page.locator('.toast-directory-scan')).toHaveCount(0);

  const metrics = await readFolderBenchmark(page);
  expect(metrics.peakRetained).toBe(250);
  expect(metrics.finalProgressCount).toBe(250);
  expect(metrics.firstWriteMs).not.toBeNull();
  expect(metrics.progressUpdateCount).toBeLessThanOrEqual(Math.ceil(metrics.elapsedMs / 1000) + 2);
  console.log(`[ISSUE07 CAPPED] ${JSON.stringify({ fixtureFiles: 250, importedFiles: 250, ...metrics })}`);
});

test('a limited scan reports pending files and recovers from a smaller folder without changing selection', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 360, height: 800 });
  await bootApp(page);
  await installDirectoryPicker(page, 'limit-recovery');

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 1);
  const app = new BlendAppPage(page);
  await app.selectLibraryItemsByNames(['Seed.mp4']);
  await app.addSelectedLibraryToList('playlist', 1);
  const beforeScan = await page.evaluate(() => ({
    activeList: window.Blend.state.ui.activeList,
    selectedLibrary: Array.from(window.Blend.state.ui.selectedLibrary),
    listSelection: Array.from(window.Blend.state.ui.listSelection),
    playlistIds: window.Blend.state.playlist.map(item => item.id),
    slideshowIds: window.Blend.state.slideshow.map(item => item.id)
  }));
  await instrumentFolderBenchmark(page);

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 251);
  const status = page.locator('#config-panel > .toast-directory-scan');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toContainText('Folder scan paused after the supported import limit. The files already added are safe; choose a smaller folder or continue with another folder.');
  await expect(status).toContainText('251 supported media files found; 250 added, 0 skipped (0 already present), 1 pending.');
  await expect(status.getByRole('button', { name: 'Choose smaller folder' })).toHaveCount(1);

  const importedBeforeRecovery = await page.evaluate(() => Array.from(window.Blend.state.library.values())
    .filter(item => item.name.startsWith('Synthetic-'))
    .map(item => ({ id: item.id, name: item.name, directoryId: item.directoryId })));
  expect(importedBeforeRecovery).toHaveLength(250);
  const idsBeforeRecovery = new Map(importedBeforeRecovery.map(item => [item.name, item.id]));
  const metrics = await readFolderBenchmark(page);
  expect(metrics.peakRetained).toBe(250);
  expect(metrics.finalProgressCount).toBe(251);
  expect(metrics.progressUpdateCount).toBeLessThanOrEqual(Math.ceil(metrics.elapsedMs / 1000) + 2);

  for (const viewport of RESPONSIVE_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expectDirectoryToastFits(page, status);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expectDirectoryToastFits(page, status);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

  const chooseSmaller = status.getByRole('button', { name: 'Choose smaller folder' });
  await page.locator('#close-config').focus();
  await page.keyboard.press('Tab');
  await expect(chooseSmaller).toBeFocused();
  const focus = await chooseSmaller.evaluate(node => ({
    focusVisible: node.matches(':focus-visible'),
    outlineStyle: getComputedStyle(node).outlineStyle,
    outlineWidth: getComputedStyle(node).outlineWidth
  }));
  expect(focus).toEqual({ focusVisible: true, outlineStyle: 'solid', outlineWidth: '2px' });
  await page.keyboard.press('Enter');

  await page.waitForFunction(() => window.Blend?.state?.library?.size === 252);
  await expect(page.locator('#toast-container')).toContainText('Added 1 item from "Pending-Level-1" (0 already present)');
  const afterRecovery = await page.evaluate(() => ({
    state: {
      activeList: window.Blend.state.ui.activeList,
      selectedLibrary: Array.from(window.Blend.state.ui.selectedLibrary),
      listSelection: Array.from(window.Blend.state.ui.listSelection),
      playlistIds: window.Blend.state.playlist.map(item => item.id),
      slideshowIds: window.Blend.state.slideshow.map(item => item.id)
    },
    library: Array.from(window.Blend.state.library.values())
      .filter(item => item.name.startsWith('Synthetic-'))
      .map(item => ({ id: item.id, name: item.name, directoryId: item.directoryId }))
  }));
  expect(afterRecovery.state).toEqual(beforeScan);
  expect(afterRecovery.library).toHaveLength(251);
  expect(new Set(afterRecovery.library.map(item => item.id)).size).toBe(251);
  for (const [name, id] of idsBeforeRecovery) {
    expect(afterRecovery.library.find(item => item.name === name)?.id).toBe(id);
  }
  const pendingItem = afterRecovery.library.find(item => item.name === 'Synthetic-00250.mp4');
  expect(pendingItem?.directoryId).not.toBe(importedBeforeRecovery[0].directoryId);
  expect(await page.evaluate(() => window.__directoryPickerCalls())).toBe(3);

  const persisted = await readPersistedFolderImport(page);
  expect(persisted.library).toHaveLength(252);
  expect(persisted.directories).toHaveLength(3);
  expect(new Set(persisted.library.map(item => item.id)).size).toBe(252);
});

for (const count of [1_000, 10_000]) {
  test(`a broad six-level folder imports only the limit and reports every pending file (${count})`, async ({ page }) => {
    test.setTimeout(120000);
    await bootApp(page);
    await installDirectoryPicker(page, `broad-load:${count}`);
    await instrumentFolderBenchmark(page);

    await page.locator('#add-folder').click();
    await page.waitForFunction(() => window.Blend?.state?.library?.size === 250);
    const status = page.locator('.toast-directory-scan');
    await expect(status).toContainText(`${count} supported media files found; 250 added, 0 skipped (0 already present), ${count - 250} pending.`, { timeout: 30000 });
    const metrics = await readFolderBenchmark(page);
    expect(metrics.peakRetained).toBe(250);
    expect(metrics.finalProgressCount).toBe(count);
    expect(250 + 0 + (count - 250)).toBe(count);
    expect(metrics.firstWriteMs).not.toBeNull();
    expect(metrics.firstWriteMs).toBeLessThan(10000);
    expect(metrics.progressUpdateCount).toBeLessThanOrEqual(Math.ceil(metrics.elapsedMs / 1000) + 2);
    console.log(`[ISSUE07 CAPPED] ${JSON.stringify({ fixtureFiles: count, importedFiles: 250, pendingFiles: count - 250, ...metrics })}`);
  });
}

test('directory-input folder fallback retains only the limit and offers a smaller-folder recovery', async ({ page }) => {
  test.setTimeout(60000);
  await bootApp(page);
  await page.evaluate(() => { window.showDirectoryPicker = undefined; });
  const tempRoot = await mkdtemp(join(tmpdir(), 'blend-issue07-folder-'));
  try {
    const importedFolder = join(tempRoot, 'A-Imported');
    const pendingFolder = join(tempRoot, 'Z-Pending');
    await mkdir(importedFolder);
    await mkdir(pendingFolder);
    for (let index = 0; index < 250; index += 1) {
      await writeFile(join(importedFolder, `Synthetic-${String(index).padStart(5, '0')}.mp4`), 'synthetic');
    }
    await writeFile(join(pendingFolder, 'Synthetic-00250.mp4'), 'synthetic');

    const firstChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#add-folder').click();
    const firstChooser = await firstChooserPromise;
    await firstChooser.setFiles(tempRoot);
    await page.waitForFunction(() => window.Blend?.state?.library?.size === 250);
    const status = page.locator('.toast-directory-scan');
    await expect(status).toContainText('251 supported media files found; 250 added, 0 skipped (0 already present), 1 pending.');
    await expect(status.getByRole('button', { name: 'Choose smaller folder' })).toHaveCount(1);
    const ids = await page.evaluate(() => Array.from(window.Blend.state.library.keys()));
    expect(ids).toHaveLength(250);
    expect(new Set(ids).size).toBe(250);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
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

test('a depth-truncated scan with no discovered media reports partial instead of empty', async ({ page }) => {
  await bootApp(page);
  await installDirectoryPicker(page, 'depth-empty');

  await page.locator('#add-folder').click();

  const status = page.locator('#config-panel > .toast-directory-scan');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toContainText('Folder scan stopped at the six-level limit. Select a deeper folder directly to include its media.');
  await expect(status).toContainText('1 folder was skipped at the limit.');
  await expect(status).toContainText('0 media files found; 0 added, 0 already present.');
  await expect(status.getByRole('button', { name: 'Choose deeper folder' })).toHaveCount(1);
  await expect(page.getByText('No supported media found in that folder', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Folder scan complete.', { exact: false })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.Blend.state.library.size)).toBe(0);
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
