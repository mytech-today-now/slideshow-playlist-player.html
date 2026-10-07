import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const IMPORT_FAILURE_MESSAGE = 'The import could not be completed. Your previous experience is still available; export a backup before retrying.';
const FAULT_SENTINEL = 'private/path?token=issue05-secret';

function makeImportPayload(origin, name = 'Issue 05 Imported') {
  const remoteImage = `${origin}/samples/IL.jpeg`;
  return {
    schema: 'player.blend.experience.v2',
    type: 'experience',
    name,
    settings: { defaultImageDuration: 7.5, opacity: 0.37, playbackModePlaylist: 'sequential' },
    library: {
      items: [{
        id: 'issue05-remote-image',
        name: 'IL.jpeg',
        path: remoteImage,
        sourceUrl: remoteImage,
        type: 'image',
        metadata: { storageReference: remoteImage }
      }]
    },
    playlist: {
      type: 'playlist',
      description: 'Imported playlist order',
      items: [
        { id: 'missing-audio', name: 'Track A.mp3', path: 'missing/Track A.mp3', type: 'audio' },
        { id: 'missing-audio', name: 'Track A.mp3', path: 'missing/Track A.mp3', type: 'audio' }
      ]
    },
    slideshow: {
      type: 'slideshow',
      description: 'Imported slideshow order',
      items: [
        { id: 'issue05-remote-image', name: 'IL.jpeg', path: remoteImage, sourceUrl: remoteImage, type: 'image' },
        { id: 'missing-image', name: 'Missing B.png', path: 'missing/Missing B.png', type: 'image' },
        { id: 'missing-image', name: 'Missing B.png', path: 'missing/Missing B.png', type: 'image' }
      ]
    }
  };
}

async function chooseExperienceFile(page, content) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#experience-import').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'issue05-experience.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content))
  });
}

async function seedPreviousExperience(blendPage, page) {
  await blendPage.boot('/index.html');
  await blendPage.createExperience('Issue 05 Previous');
  await page.evaluate(async () => {
    const state = window.Blend.state;
    const previous = {
      id: 'issue05-previous-item',
      name: 'Previous.png',
      size: 0,
      type: 'image',
      duration: null,
      pathHint: 'Previous.png',
      sourceUrl: null,
      directoryId: null,
      metadata: {},
      addedAt: 1,
      lastVerified: 1,
      stale: true,
      handle: null
    };
    state.settings.autoVerifyOnStartup = false;
    state.settings.opacity = 0.43;
    state.settings.defaultImageDuration = 4.25;
    state.library.set(previous.id, previous);
    state.playlist = [{ id: 'previous-playlist-ref', path: 'previous/track.mp3', name: 'Previous track.mp3', type: 'audio', available: false, reason: 'missing' }];
    state.slideshow = [{ id: previous.id, path: previous.pathHint, name: previous.name, type: 'image', available: false, reason: 'missing' }];
    state.listMeta.playlist.description = 'Previous playlist';
    state.listMeta.slideshow.description = 'Previous slideshow';
    await window.Blend.saveStateNow();
  });
  return captureState(page);
}

function captureState(page) {
  return page.evaluate(() => ({
    activeId: window.Blend.state.activeExperienceId,
    activeName: window.Blend.state.projectName,
    experienceIds: window.Blend.state.experiences.map(record => record.id),
    experienceNames: window.Blend.state.experiences.map(record => record.name),
    library: Array.from(window.Blend.state.library.values()).map(item => ({ id: item.id, name: item.name })),
    playlist: window.Blend.state.playlist.map(item => ({ id: item.id, available: item.available, name: item.name })),
    slideshow: window.Blend.state.slideshow.map(item => ({ id: item.id, available: item.available, name: item.name })),
    opacity: window.Blend.state.settings.opacity,
    defaultImageDuration: window.Blend.state.settings.defaultImageDuration,
    playlistDescription: window.Blend.state.listMeta.playlist.description,
    slideshowDescription: window.Blend.state.listMeta.slideshow.description,
    activeMarker: localStorage.getItem('blend-active-experience-id')
  }));
}

async function installPersistenceFault(page, mode) {
  await page.evaluate(({ faultMode, sentinel, activeId }) => {
    if (faultMode === 'active-marker' || faultMode === 'rollback-fails') {
      window.__issue05MarkerFailed = false;
      window.__issue05OriginalStorageSetItem = Storage.prototype.setItem;
      let failed = false;
      Storage.prototype.setItem = function (key, value) {
        if (!failed && key === 'blend-active-experience-id' && value !== activeId) {
          failed = true;
          window.__issue05MarkerFailed = true;
          throw Object.assign(new Error(sentinel), { name: 'QuotaExceededError' });
        }
        return window.__issue05OriginalStorageSetItem.call(this, key, value);
      };
      if (faultMode === 'rollback-fails') {
        window.__BLEND_TEST_HOOKS__ = {
          afterSnapshotWriteQueued() {
            if (window.__issue05MarkerFailed) {
              throw Object.assign(new Error(sentinel), { name: 'QuotaExceededError' });
            }
          }
        };
      }
      return;
    }
    window.__BLEND_TEST_HOOKS__ = faultMode === 'before-transaction'
      ? {
          beforeSnapshotPersist() {
            throw Object.assign(new Error(sentinel), { name: 'QuotaExceededError' });
          }
        }
      : {
          afterSnapshotWriteQueued({ storeName, operation }) {
            if (storeName === 'library' && operation === 'put') {
              throw Object.assign(new Error(sentinel), { name: 'QuotaExceededError' });
            }
          }
        };
  }, { faultMode: mode, sentinel: FAULT_SENTINEL, activeId: await page.evaluate(() => window.Blend.state.activeExperienceId) });
}

for (const fault of [
  { mode: 'before-transaction', title: 'rejects before the import transaction starts' },
  { mode: 'queued-write', title: 'aborts after a staged library write is queued' },
  { mode: 'active-marker', title: 'rolls back when the active experience marker cannot be saved' },
  { mode: 'rollback-fails', title: 'reports the catalog and library left by a failed rollback' }
]) {
  test(`experience import ${fault.title} without changing live or reloaded state`, async ({ page }) => {
    const blendPage = new BlendAppPage(page);
    const before = await seedPreviousExperience(blendPage, page);
    const origin = new URL(page.url()).origin;
    await blendPage.openConfig();
    await installPersistenceFault(page, fault.mode);
    await chooseExperienceFile(page, makeImportPayload(origin));

    const toast = page.locator('#toast-container .toast-import-failure');
    const partialMessage = `${IMPORT_FAILURE_MESSAGE} The imported experience and library entries remain available in the catalog and library.`;
    await expect(toast.locator('span')).toHaveText(fault.mode === 'rollback-fails' ? partialMessage : IMPORT_FAILURE_MESSAGE);
    await expect(page.locator('#experience-import')).toBeFocused();
    const afterFailure = await captureState(page);
    if (fault.mode === 'rollback-fails') {
      expect(afterFailure.activeId).toBe(before.activeId);
      expect(afterFailure.activeName).toBe(before.activeName);
      expect(afterFailure.playlist).toEqual(before.playlist);
      expect(afterFailure.slideshow).toEqual(before.slideshow);
      expect(afterFailure.experienceNames).toContain('Issue 05 Imported');
      expect(afterFailure.library.filter(item => item.name === 'IL.jpeg')).toHaveLength(1);
    } else {
      expect(afterFailure).toEqual(before);
    }
    const logs = await page.evaluate(() => window.Blend.log.exportJson());
    expect(logs).not.toContain(FAULT_SENTINEL);
    expect(logs).not.toContain('issue05-experience.json');
    await expect(toast.getByRole('button', { name: 'Export Backup' })).toBeVisible();

    await page.evaluate(() => {
      delete window.__BLEND_TEST_HOOKS__;
      if (window.__issue05OriginalStorageSetItem) {
        Storage.prototype.setItem = window.__issue05OriginalStorageSetItem;
        delete window.__issue05OriginalStorageSetItem;
      }
    });
    await page.reload();
    await page.waitForFunction(() => !!window.Blend?.state);
    const restored = await captureState(page);
    if (fault.mode === 'rollback-fails') {
      expect(restored.activeId).toBe(before.activeId);
      expect(restored.activeName).toBe(before.activeName);
      expect(restored.playlist).toEqual(before.playlist);
      expect(restored.slideshow).toEqual(before.slideshow);
      expect(restored.experienceNames).toContain('Issue 05 Imported');
      expect(restored.library.filter(item => item.name === 'IL.jpeg')).toHaveLength(1);
      return;
    }
    expect(restored).toEqual(before);

    await blendPage.openConfig();
    await chooseExperienceFile(page, makeImportPayload(origin));
    await expect.poll(() => blendPage.activeExperienceName()).toBe('Issue 05 Imported');
    const retried = await captureState(page);
    expect(retried.experienceNames.filter(name => name === 'Issue 05 Imported')).toHaveLength(1);
    expect(retried.library.filter(item => item.name === 'IL.jpeg')).toHaveLength(1);
  });
}

test('malformed experience import leaves state unchanged and missing references stay as placeholders', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  const before = await seedPreviousExperience(blendPage, page);
  await blendPage.openConfig();
  await chooseExperienceFile(page, `{ "name": "${FAULT_SENTINEL}"`);
  await expect(page.locator('#toast-container .toast-import-failure span')).toHaveText(IMPORT_FAILURE_MESSAGE);
  expect(await captureState(page)).toEqual(before);
  const logs = await page.evaluate(() => window.Blend.log.exportJson());
  expect(logs).not.toContain(FAULT_SENTINEL);

  await chooseExperienceFile(page, makeImportPayload(new URL(page.url()).origin, 'Issue 05 Previous'));
  await expect.poll(() => blendPage.activeExperienceName()).toBe('Issue 05 Previous (2)');
  const importedId = await page.evaluate(() => window.Blend.state.activeExperienceId);
  const imported = await page.evaluate(() => ({
    libraryNames: Array.from(window.Blend.state.library.values()).map(item => item.name),
    playlist: window.Blend.state.playlist.map(item => ({ id: item.id, available: item.available, name: item.name })),
    slideshow: window.Blend.state.slideshow.map(item => ({ id: item.id, available: item.available, name: item.name })),
    opacity: window.Blend.state.settings.opacity,
    defaultImageDuration: window.Blend.state.settings.defaultImageDuration,
    playlistDescription: window.Blend.state.listMeta.playlist.description,
    slideshowDescription: window.Blend.state.listMeta.slideshow.description
  }));
  expect(imported.playlist.map(item => item.name)).toEqual(['Track A.mp3', 'Track A.mp3']);
  expect(imported.playlist[0].id).toBe(imported.playlist[1].id);
  expect(imported.playlist.every(item => item.available === false)).toBe(true);
  expect(imported.slideshow.map(item => item.name)).toEqual(['IL.jpeg', 'Missing B.png', 'Missing B.png']);
  expect(imported.slideshow[1].id).toBe(imported.slideshow[2].id);
  expect(imported.libraryNames).toContain('IL.jpeg');
  expect(imported.slideshow.slice(1).every(item => item.available === false)).toBe(true);
  expect(imported.opacity).toBe(0.37);
  expect(imported.defaultImageDuration).toBe(7.5);
  expect(imported.playlistDescription).toBe('Imported playlist order');
  expect(imported.slideshowDescription).toBe('Imported slideshow order');

  await blendPage.createExperience('Issue 05 Other');
  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await blendPage.switchExperience('Issue 05 Previous (2)');
  expect(await page.evaluate(() => window.Blend.state.activeExperienceId)).toBe(importedId);
  expect(await page.evaluate(() => ({
    libraryNames: Array.from(window.Blend.state.library.values()).map(item => item.name),
    playlist: window.Blend.state.playlist.map(item => ({ id: item.id, available: item.available, name: item.name })),
    slideshow: window.Blend.state.slideshow.map(item => ({ id: item.id, available: item.available, name: item.name })),
    opacity: window.Blend.state.settings.opacity,
    defaultImageDuration: window.Blend.state.settings.defaultImageDuration,
    playlistDescription: window.Blend.state.listMeta.playlist.description,
    slideshowDescription: window.Blend.state.listMeta.slideshow.description
  }))).toEqual(imported);
  const storedCatalog = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onerror = () => reject(request.error || new Error('Could not open Blend database'));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('experiences', 'readonly');
      const records = transaction.objectStore('experiences').getAll();
      transaction.oncomplete = () => {
        db.close();
        resolve(records.result.map(record => record.id));
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('Could not read saved experiences'));
      };
    };
  }));
  expect(storedCatalog).toContain(importedId);
});
