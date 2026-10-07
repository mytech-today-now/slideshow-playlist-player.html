import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BlendAppPage } from './support/blend-app-page.mjs';

const CONFLICT_MESSAGE = 'This experience changed in another tab. Reload or export a backup before saving.';

function syntheticLibraryItem(id) {
  return {
    id,
    handle: null,
    name: `${id}.jpg`,
    size: 17,
    type: 'image',
    duration: null,
    pathHint: `${id}.jpg`,
    sourceUrl: null,
    directoryId: null,
    metadata: null,
    addedAt: 1,
    lastVerified: 1,
    stale: true
  };
}

async function addSyntheticLibraryItem(page, id) {
  await page.evaluate(({ item }) => {
    window.Blend.state.settings.autoVerifyOnStartup = false;
    window.Blend.state.library.set(item.id, item);
  }, { item: syntheticLibraryItem(id) });
}

async function installSaveGate(page) {
  await page.evaluate(() => {
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    window.__blendSnapshotGate = {
      started: false,
      wait,
      release: () => release()
    };
    window.__BLEND_TEST_HOOKS__ = {
      beforeSnapshotPersist: async () => {
        window.__blendSnapshotGate.started = true;
        await window.__blendSnapshotGate.wait;
      }
    };
  });
}

async function releaseSaveGate(page) {
  await page.evaluate(() => window.__blendSnapshotGate.release());
}

async function readPersistedLibraryIds(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onerror = () => reject(request.error || new Error('Could not open Blend database'));
    request.onsuccess = () => {
      const connection = request.result;
      const transaction = connection.transaction('library', 'readonly');
      const records = transaction.objectStore('library').getAll();
      transaction.oncomplete = () => {
        connection.close();
        resolve(records.result.map(record => record.id));
      };
      transaction.onerror = () => {
        connection.close();
        reject(transaction.error || new Error('Could not read Blend library'));
      };
    };
  }));
}

async function readPersistedStores(page, storeNames) {
  return page.evaluate(names => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onerror = () => reject(request.error || new Error('Could not open Blend database'));
    request.onsuccess = () => {
      const connection = request.result;
      const transaction = connection.transaction(names, 'readonly');
      const result = {};
      for (const name of names) {
        const records = transaction.objectStore(name).getAll();
        records.onsuccess = () => { result[name] = records.result || []; };
      }
      transaction.oncomplete = () => {
        connection.close();
        resolve(result);
      };
      transaction.onerror = () => {
        connection.close();
        reject(transaction.error || new Error('Could not read Blend snapshot'));
      };
    };
  }), storeNames);
}

test('stale page save merges independent library additions instead of deleting the newer record', async ({ page, context }) => {
  const pageA = new BlendAppPage(page);
  await pageA.boot('/index.html');

  const secondPage = await context.newPage();
  const pageB = new BlendAppPage(secondPage);
  await pageB.boot('/index.html');

  await addSyntheticLibraryItem(page, 'concurrent-tab-a');
  await addSyntheticLibraryItem(secondPage, 'concurrent-tab-b');
  await installSaveGate(page);
  await installSaveGate(secondPage);

  const saveA = page.evaluate(() => window.Blend.saveStateNow());
  const saveB = secondPage.evaluate(() => window.Blend.saveStateNow());
  await expect.poll(() => page.evaluate(() => window.__blendSnapshotGate.started)).toBe(true);
  await expect.poll(() => secondPage.evaluate(() => window.__blendSnapshotGate.started)).toBe(true);

  await releaseSaveGate(page);
  expect(await saveA).toBe(true);
  await releaseSaveGate(secondPage);
  expect(await saveB).toBe(true);
  const mergedInMemoryIds = await secondPage.evaluate(() => Array.from(window.Blend.state.library.keys()).sort());
  expect(mergedInMemoryIds).toEqual(['concurrent-tab-a', 'concurrent-tab-b']);

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  const persistedIds = await readPersistedLibraryIds(page);
  expect(persistedIds.sort()).toEqual(['concurrent-tab-a', 'concurrent-tab-b']);
  await secondPage.close();
});

test('conflicting list edits are announced and keep the stale tab playback context and export backup', async ({ page, context }) => {
  const pageA = new BlendAppPage(page);
  await pageA.boot('/index.html');
  const secondPage = await context.newPage();
  const pageB = new BlendAppPage(secondPage);
  await pageB.boot('/index.html');

  for (const [target, prefix] of [[page, 'list-tab-a'], [secondPage, 'list-tab-b']]) {
    await target.evaluate(({ itemPrefix }) => {
      const state = window.Blend.state;
      state.settings.autoVerifyOnStartup = false;
      for (const suffix of ['one', 'two']) {
        const id = `${itemPrefix}-${suffix}`;
        state.library.set(id, {
          id,
          handle: null,
          name: `${id}.jpg`,
          size: 18,
          type: 'image',
          pathHint: `${id}.jpg`,
          sourceUrl: null,
          addedAt: 1,
          lastVerified: 1,
          stale: true
        });
      }
      state.playlist = [
        { id: `${itemPrefix}-two`, addedAt: 2 },
        { id: `${itemPrefix}-one`, addedAt: 1 }
      ];
      state.runtime.playlistIndex = 1;
      state.runtime.isPlaying = true;
      state.runtime.historyPlaylist = [0];
    }, { itemPrefix: prefix });
  }

  await installSaveGate(page);
  await installSaveGate(secondPage);
  const saveA = page.evaluate(() => window.Blend.saveStateNow());
  const saveB = secondPage.evaluate(() => window.Blend.saveStateNow());
  await expect.poll(() => page.evaluate(() => window.__blendSnapshotGate.started)).toBe(true);
  await expect.poll(() => secondPage.evaluate(() => window.__blendSnapshotGate.started)).toBe(true);

  await releaseSaveGate(page);
  expect(await saveA).toBe(true);
  const staleStateBeforeSave = await secondPage.evaluate(() => ({
    playlist: window.Blend.state.playlist.map(item => item.id),
    runtime: {
      playlistIndex: window.Blend.state.runtime.playlistIndex,
      isPlaying: window.Blend.state.runtime.isPlaying,
      historyPlaylist: window.Blend.state.runtime.historyPlaylist.slice()
    }
  }));

  await releaseSaveGate(secondPage);
  expect(await saveB).toBe(false);
  const conflict = secondPage.locator('#toast-container .toast-save-conflict');
  await expect(conflict).toHaveAttribute('role', 'alert');
  await expect(conflict).toContainText(CONFLICT_MESSAGE);
  const backupButton = conflict.getByRole('button', { name: 'Export Backup' });
  await expect(backupButton).toBeVisible();
  await expect(backupButton).toHaveAttribute('type', 'button');

  const staleStateAfterSave = await secondPage.evaluate(() => ({
    playlist: window.Blend.state.playlist.map(item => item.id),
    runtime: {
      playlistIndex: window.Blend.state.runtime.playlistIndex,
      isPlaying: window.Blend.state.runtime.isPlaying,
      historyPlaylist: window.Blend.state.runtime.historyPlaylist.slice()
    }
  }));
  expect(staleStateAfterSave).toEqual(staleStateBeforeSave);

  const downloadPromise = secondPage.waitForEvent('download');
  await backupButton.focus();
  await secondPage.keyboard.press('Enter');
  const backup = await downloadPromise;
  expect(backup.suggestedFilename()).toMatch(/\.json$/i);
  const backupPath = await backup.path();
  const backupPayload = JSON.parse(await readFile(backupPath, 'utf8'));
  expect(backupPayload.playlist.order).toEqual(staleStateBeforeSave.playlist);

  const persisted = await readPersistedStores(page, ['library', 'playlist']);
  expect(persisted.library.map(record => record.id).sort()).toEqual(['list-tab-a-one', 'list-tab-a-two']);
  expect(persisted.playlist[0].items.map(item => item.id)).toEqual(['list-tab-a-two', 'list-tab-a-one']);
  await secondPage.close();
});

test('single-tab debounced edits restore the latest library and active experience', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');

  await page.evaluate(() => {
    const state = window.Blend.state;
    state.settings.autoVerifyOnStartup = false;
    state.projectName = 'Debounced snapshot latest';
    state.library.set('debounced-library-item', {
      id: 'debounced-library-item',
      handle: null,
      name: 'debounced-library-item.jpg',
      size: 19,
      type: 'image',
      pathHint: 'debounced-library-item.jpg',
      sourceUrl: null,
      addedAt: 1,
      lastVerified: 1,
      stale: true
    });
    state.playlist = [{ id: 'debounced-library-item', addedAt: 1 }];
    const masterVolume = document.querySelector('#vol-master');
    masterVolume.value = '0.35';
    masterVolume.dispatchEvent(new Event('input', { bubbles: true }));
    masterVolume.value = '0.8';
    masterVolume.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  const restored = await page.evaluate(() => ({
    hasLibraryItem: window.Blend.state.library.has('debounced-library-item'),
    projectName: window.Blend.state.projectName,
    masterVolume: window.Blend.state.settings.masterVolume,
    playlist: window.Blend.state.playlist.map(item => item.id),
    activeExperienceId: window.Blend.state.activeExperienceId,
    activeExperienceName: window.Blend.state.experiences.find(
      record => record.id === window.Blend.state.activeExperienceId
    )?.name || ''
  }));

  expect(restored).toMatchObject({
    hasLibraryItem: true,
    projectName: 'Debounced snapshot latest',
    masterVolume: 0.8,
    playlist: ['debounced-library-item'],
    activeExperienceName: 'Debounced snapshot latest'
  });
  expect(restored.activeExperienceId).toBeTruthy();
});
