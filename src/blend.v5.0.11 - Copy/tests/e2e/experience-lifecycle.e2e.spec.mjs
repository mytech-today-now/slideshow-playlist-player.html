import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BlendAppPage, expectSourceMatch } from './support/blend-app-page.mjs';
import {
  createRunSuffix,
  createExperienceNames,
  prepareLifecycleListArtifacts,
  saveDownloadWithRetry
} from './support/experience-lifecycle-utils.mjs';

const SAVE_FAILURE_MESSAGE = 'Changes are not saved yet. Retry or export a backup before closing.';

async function setPersistedStateFixture(page, { projectName, libraryId, opacity }) {
  return page.evaluate(async ({ nextProjectName, nextLibraryId, nextOpacity }) => {
    const state = window.Blend.state;
    state.projectName = nextProjectName;
    state.library.clear();
    state.directoryHandles.clear();
    state.library.set(nextLibraryId, {
      id: nextLibraryId,
      handle: null,
      name: `${nextLibraryId}.jpg`,
      size: 17,
      type: 'image',
      duration: null,
      pathHint: `${nextLibraryId}.jpg`,
      sourceUrl: null,
      directoryId: null,
      metadata: null,
      addedAt: 1,
      lastVerified: 1,
      stale: false
    });
    state.playlist = [{ id: nextLibraryId, addedAt: 1 }];
    state.slideshow = [{ id: nextLibraryId, displayDuration: 7 }];
    state.settings.opacity = nextOpacity;
    state.settings.autoVerifyOnStartup = false;
    return window.Blend.saveStateNow();
  }, { nextProjectName: projectName, nextLibraryId: libraryId, nextOpacity: opacity });
}

async function readPersistedSnapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onerror = () => reject(request.error || new Error('Could not open Blend database'));
    request.onsuccess = () => {
      const connection = request.result;
      const storeNames = ['library', 'dirHandles', 'experiences', 'playlist', 'slideshow', 'settings']
        .filter(name => connection.objectStoreNames.contains(name));
      const transaction = connection.transaction(storeNames, 'readonly');
      const result = {};
      for (const storeName of storeNames) {
        const records = transaction.objectStore(storeName).getAll();
        records.onsuccess = () => { result[storeName] = records.result || []; };
      }
      transaction.oncomplete = () => {
        connection.close();
        resolve(result);
      };
      transaction.onerror = () => {
        connection.close();
        reject(transaction.error || new Error('Could not read Blend snapshot'));
      };
      transaction.onabort = () => {
        connection.close();
        reject(transaction.error || new Error('Blend snapshot read was aborted'));
      };
    };
  }));
}

async function seedLegacyListStores(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    localStorage.removeItem('blend-active-experience-id');
    const request = indexedDB.open('player-blend-v1', 5);
    request.onerror = () => reject(request.error || new Error('Could not open Blend database'));
    request.onsuccess = () => {
      const connection = request.result;
      const transaction = connection.transaction(
        ['library', 'playlist', 'slideshow', 'settings', 'experiences'],
        'readwrite'
      );
      transaction.objectStore('library').clear();
      transaction.objectStore('library').put({
        id: 'legacy-media',
        handle: null,
        name: 'legacy-media.jpg',
        size: 21,
        type: 'image',
        pathHint: 'legacy-media.jpg',
        sourceUrl: null,
        stale: true
      });
      transaction.objectStore('playlist').put({
        key: 'default',
        items: [{ id: 'legacy-media', addedAt: 2 }],
        mode: 'sequential',
        index: 0,
        meta: {}
      });
      transaction.objectStore('slideshow').put({
        key: 'default',
        items: [{ id: 'legacy-media', displayDuration: 8 }],
        mode: 'sequential',
        index: 0,
        meta: {}
      });
      transaction.objectStore('settings').put({
        key: 'global',
        projectName: 'Legacy session',
        opacity: 0.37,
        autoVerifyOnStartup: false
      });
      transaction.objectStore('experiences').clear();
      transaction.oncomplete = () => {
        connection.close();
        resolve();
      };
      transaction.onerror = () => {
        connection.close();
        reject(transaction.error || new Error('Could not seed legacy list stores'));
      };
      transaction.onabort = () => {
        connection.close();
        reject(transaction.error || new Error('Legacy fixture write was aborted'));
      };
    };
  }));
}

async function assertExperiencePlayback(blendPage, experienceName, expectedPlaylistUrls, expectedSlideshowUrls) {
  await blendPage.switchExperience(experienceName);
  await blendPage.startPlayback();
  const summary = await blendPage.playbackSummary();

  expect(summary.activeExperienceName).toBe(experienceName);
  expect(summary.playlistLength).toBeGreaterThan(0);
  expect(summary.slideshowLength).toBeGreaterThan(0);
  expect(summary.slideshowElementSrc || summary.slideshowCurrentSource, 'Slideshow media did not resolve').toBeTruthy();
  expect(summary.playlistElementSrc || summary.playlistCurrentSource, 'Playlist media did not resolve').toBeTruthy();

  expectSourceMatch(summary.playlistCurrentSource || summary.playlistElementSrc, expectedPlaylistUrls, `${experienceName} playlist`);
  expectSourceMatch(summary.slideshowCurrentSource || summary.slideshowElementSrc, expectedSlideshowUrls, `${experienceName} slideshow`);
}

test.describe('experience lifecycle regression', () => {
  test('covers create/export/delete/import/switch/persist/rename/share scenarios', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const context = page.context();
    const runSuffix = createRunSuffix(testInfo);
    const names = createExperienceNames(runSuffix);
    const artifacts = await prepareLifecycleListArtifacts(testInfo, runSuffix);
    const blendPage = new BlendAppPage(page);
    expect(artifacts.expected.nycPlaylistUrls.length, 'NYC playlist fixture is empty').toBeGreaterThan(0);
    expect(artifacts.expected.nycSlideshowUrls.length, 'NYC slideshow fixture is empty').toBeGreaterThan(0);
    expect(artifacts.expected.patrioticPlaylistUrls.length, 'Patriotic playlist fixture is empty').toBeGreaterThan(0);
    expect(artifacts.expected.patrioticSlideshowUrls.length, 'Patriotic slideshow fixture is empty').toBeGreaterThan(0);

    await blendPage.boot('/index.html');

    // A) Create NYC Experience
    await blendPage.createExperience(names.nyc);
    await blendPage.importList('playlist', artifacts.paths.nycPlaylistPath);
    await blendPage.importList('slideshow', artifacts.paths.nycSlideshowPath);
    await blendPage.expectExperienceOption(names.nyc, true);

    // B) Export / Delete / Import NYC
    await blendPage.switchExperience(names.nyc);
    const nycDownload = await blendPage.exportExperience();
    const nycExportPath = path.join(testInfo.outputPath('exports'), `nyc-experience-${runSuffix}.json`);
    await saveDownloadWithRetry(await nycDownload, nycExportPath);

    await blendPage.deleteCurrentExperience();
    await blendPage.expectExperienceOption(names.nyc, false);

    await blendPage.importExperience(nycExportPath);
    await blendPage.expectExperienceOption(names.nyc, true);
    await assertExperiencePlayback(
      blendPage,
      names.nyc,
      artifacts.expected.nycPlaylistUrls,
      artifacts.expected.nycSlideshowUrls
    );

    // C) Add Patriotic Experience
    await blendPage.createExperience(names.patriotic);
    await blendPage.importList('playlist', artifacts.paths.patrioticPlaylistPath);
    await blendPage.importList('slideshow', artifacts.paths.patrioticSlideshowPath);
    await blendPage.expectExperienceOption(names.patriotic, true);

    // D) Experience Switching Validation
    await assertExperiencePlayback(
      blendPage,
      names.nyc,
      artifacts.expected.nycPlaylistUrls,
      artifacts.expected.nycSlideshowUrls
    );
    await assertExperiencePlayback(
      blendPage,
      names.patriotic,
      artifacts.expected.patrioticPlaylistUrls,
      artifacts.expected.patrioticSlideshowUrls
    );

    // E) Persistence Across Restart
    await page.close();
    const restartedPage = await context.newPage();
    const restartedBlendPage = new BlendAppPage(restartedPage);
    await restartedBlendPage.boot('/index.html');
    await restartedBlendPage.expectExperienceOption(names.nyc, true);
    await restartedBlendPage.expectExperienceOption(names.patriotic, true);
    await assertExperiencePlayback(
      restartedBlendPage,
      names.nyc,
      artifacts.expected.nycPlaylistUrls,
      artifacts.expected.nycSlideshowUrls
    );
    await assertExperiencePlayback(
      restartedBlendPage,
      names.patriotic,
      artifacts.expected.patrioticPlaylistUrls,
      artifacts.expected.patrioticSlideshowUrls
    );

    // F) Rename Flow
    await restartedBlendPage.switchExperience(names.patriotic);
    await restartedBlendPage.renameCurrentExperience(names.renamed);
    await restartedBlendPage.expectExperienceOption(names.patriotic, false);
    await restartedBlendPage.expectExperienceOption(names.renamed, true);
    await assertExperiencePlayback(
      restartedBlendPage,
      names.renamed,
      artifacts.expected.patrioticPlaylistUrls,
      artifacts.expected.patrioticSlideshowUrls
    );

    // G) Share-Link Flow
    const shareUrl = await restartedBlendPage.buildShareLinkForExperience(names.nyc);
    expect(shareUrl).toMatch(/[?&](exp|experience)=/);

    const sharedTab = await context.newPage();
    const sharedBlendPage = new BlendAppPage(sharedTab);
    await sharedBlendPage.boot(shareUrl);
    await assertExperiencePlayback(
      sharedBlendPage,
      names.nyc,
      artifacts.expected.nycPlaylistUrls,
      artifacts.expected.nycSlideshowUrls
    );
    await assertExperiencePlayback(
      sharedBlendPage,
      names.renamed,
      artifacts.expected.patrioticPlaylistUrls,
      artifacts.expected.patrioticSlideshowUrls
    );
    await assertExperiencePlayback(
      sharedBlendPage,
      names.nyc,
      artifacts.expected.nycPlaylistUrls,
      artifacts.expected.nycSlideshowUrls
    );
  });

  test('Clear View saves only unreferenced library removals', async ({ page }) => {
    const blendPage = new BlendAppPage(page);
    await blendPage.boot('/index.html');

    expect(await setPersistedStateFixture(page, {
      projectName: 'Clear View baseline',
      libraryId: 'referenced-media',
      opacity: 0.51
    })).toBe(true);

    expect(await page.evaluate(async () => {
      const state = window.Blend.state;
      state.library.set('orphan-media', {
        id: 'orphan-media',
        handle: null,
        name: 'orphan-media.jpg',
        size: 23,
        type: 'image',
        duration: null,
        pathHint: 'orphan-media.jpg',
        sourceUrl: null,
        directoryId: null,
        metadata: null,
        addedAt: 2,
        lastVerified: 2,
        stale: false
      });
      return window.Blend.saveStateNow();
    })).toBe(true);

    await blendPage.openConfig();
    await page.locator('#clear-library').click();
    await expect.poll(async () => (await readPersistedSnapshot(page)).library.map(item => item.id).sort())
      .toEqual(['referenced-media']);

    const clearedSnapshot = await readPersistedSnapshot(page);
    expect(clearedSnapshot.playlist[0].items.map(item => item.id)).toEqual(['referenced-media']);
    expect(clearedSnapshot.slideshow[0].items.map(item => item.id)).toEqual(['referenced-media']);
    expect(clearedSnapshot.settings.find(item => item.key === 'global').opacity).toBe(0.51);
    expect(clearedSnapshot.experiences[0].payload.playlist.map(item => item.id)).toEqual(['referenced-media']);

    await page.reload();
    await page.waitForFunction(() => window.Blend?.state?.projectName === 'Clear View baseline');
    const recoveredState = await page.evaluate(() => ({
      libraryIds: Array.from(window.Blend.state.library.keys()),
      playlistIds: window.Blend.state.playlist.map(item => item.id),
      slideshowIds: window.Blend.state.slideshow.map(item => item.id),
      opacity: window.Blend.state.settings.opacity
    }));
    expect(recoveredState).toEqual({
      libraryIds: ['referenced-media'],
      playlistIds: ['referenced-media'],
      slideshowIds: ['referenced-media'],
      opacity: 0.51
    });
  });

  test('an aborted snapshot keeps the previous generation available and offers retry or export', async ({ page }) => {
    test.setTimeout(60000);
    const blendPage = new BlendAppPage(page);
    await blendPage.boot('/index.html');

    expect(await setPersistedStateFixture(page, {
      projectName: 'Atomic baseline',
      libraryId: 'baseline-media',
      opacity: 0.42
    })).toBe(true);

    const failedSave = await page.evaluate(async () => {
      const state = window.Blend.state;
      state.projectName = 'Atomic updated';
      state.library.clear();
      state.library.set('updated-media', {
        id: 'updated-media',
        handle: null,
        name: 'updated-media.jpg',
        size: 29,
        type: 'image',
        duration: null,
        pathHint: 'updated-media.jpg',
        sourceUrl: null,
        directoryId: null,
        metadata: null,
        addedAt: 2,
        lastVerified: 2,
        stale: false
      });
      state.playlist = [{ id: 'updated-media', addedAt: 2 }];
      state.slideshow = [{ id: 'updated-media', displayDuration: 11 }];
      state.settings.opacity = 0.77;
      window.__BLEND_TEST_HOOKS__ = {
        afterSnapshotWriteQueued({ storeName, operation }) {
          if (storeName === 'library' && operation === 'put') {
            delete window.__BLEND_TEST_HOOKS__;
            throw new Error('synthetic-private-path-sentinel');
          }
        }
      };
      return window.Blend.saveStateNow();
    });
    expect(failedSave).toBe(false);

    const failureNotice = page.locator('#toast-container .toast-save-failure[role="alert"]');
    await expect(failureNotice).toHaveCount(1);
    await expect(failureNotice.locator('span')).toHaveText(SAVE_FAILURE_MESSAGE);
    await expect(failureNotice).toHaveAttribute('aria-live', 'assertive');
    await expect(failureNotice.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(failureNotice.getByRole('button', { name: 'Export Backup' })).toBeVisible();
    const inMemoryEdits = await page.evaluate(() => ({
      projectName: window.Blend.state.projectName,
      libraryIds: Array.from(window.Blend.state.library.keys()),
      playlistIds: window.Blend.state.playlist.map(item => item.id)
    }));
    expect(inMemoryEdits).toEqual({
      projectName: 'Atomic updated',
      libraryIds: ['updated-media'],
      playlistIds: ['updated-media']
    });

    const downloadPromise = page.waitForEvent('download');
    await failureNotice.getByRole('button', { name: 'Export Backup' }).click();
    const backup = await downloadPromise;
    expect(backup.suggestedFilename()).toMatch(/\.json$/);
    await expect(failureNotice).toHaveCount(1);
    const logJson = await page.evaluate(() => JSON.stringify(window.Blend.log.exportJson()));
    expect(logJson).not.toContain('synthetic-private-path-sentinel');

    const verificationPage = await page.context().newPage();
    const verificationBlendPage = new BlendAppPage(verificationPage);
    await verificationBlendPage.boot('/index.html');
    const recoveredState = await verificationPage.evaluate(() => ({
      projectName: window.Blend.state.projectName,
      libraryIds: Array.from(window.Blend.state.library.keys()),
      playlistIds: window.Blend.state.playlist.map(item => item.id),
      slideshowIds: window.Blend.state.slideshow.map(item => item.id),
      opacity: window.Blend.state.settings.opacity
    }));
    expect(recoveredState).toEqual({
      projectName: 'Atomic baseline',
      libraryIds: ['baseline-media'],
      playlistIds: ['baseline-media'],
      slideshowIds: ['baseline-media'],
      opacity: 0.42
    });
    const recoveredSnapshot = await readPersistedSnapshot(verificationPage);
    expect(recoveredSnapshot.library.map(item => item.id)).toEqual(['baseline-media']);
    expect(recoveredSnapshot.playlist[0].items.map(item => item.id)).toEqual(['baseline-media']);
    expect(recoveredSnapshot.slideshow[0].items.map(item => item.id)).toEqual(['baseline-media']);
    expect(recoveredSnapshot.settings.find(item => item.key === 'global').opacity).toBe(0.42);
    expect(recoveredSnapshot.experiences[0].payload.projectName).toBe('Atomic baseline');
    await verificationPage.close();

    await failureNotice.getByRole('button', { name: 'Retry' }).click();
    await expect(failureNotice).toHaveCount(0);
    await page.reload();
    await page.waitForFunction(() => window.Blend?.state?.projectName === 'Atomic updated');
    const retriedState = await page.evaluate(() => ({
      libraryIds: Array.from(window.Blend.state.library.keys()),
      playlistIds: window.Blend.state.playlist.map(item => item.id),
      slideshowIds: window.Blend.state.slideshow.map(item => item.id),
      opacity: window.Blend.state.settings.opacity
    }));
    expect(retriedState).toEqual({
      libraryIds: ['updated-media'],
      playlistIds: ['updated-media'],
      slideshowIds: ['updated-media'],
      opacity: 0.77
    });
  });

  test('migrates legacy settings and lists into one complete experience snapshot', async ({ page }) => {
    test.setTimeout(60000);
    const blendPage = new BlendAppPage(page);
    await blendPage.boot('/index.html');
    await seedLegacyListStores(page);
    await page.addInitScript(() => {
      const retryMarker = 'blend-test-legacy-migration-retried';
      if (sessionStorage.getItem(retryMarker)) return;
      window.__BLEND_TEST_HOOKS__ = {
        afterSnapshotWriteQueued({ storeName, operation }) {
          if (storeName === 'library' && operation === 'put') {
            sessionStorage.setItem(retryMarker, '1');
            delete window.__BLEND_TEST_HOOKS__;
            throw new Error('synthetic-legacy-migration-failure');
          }
        }
      };
    });
    await page.reload();
    await page.waitForFunction(() => window.Blend?.state?.projectName === 'Legacy session');

    const migrationFailure = page.locator('#toast-container .toast-save-failure[role="alert"]');
    await expect(migrationFailure).toHaveCount(1);
    await expect(migrationFailure.locator('span')).toHaveText(SAVE_FAILURE_MESSAGE);
    const preservedLegacyStores = await readPersistedSnapshot(page);
    expect(preservedLegacyStores.experiences).toHaveLength(0);
    expect(preservedLegacyStores.library.map(item => item.id)).toEqual(['legacy-media']);
    expect(preservedLegacyStores.playlist[0].items.map(item => item.id)).toEqual(['legacy-media']);
    expect(preservedLegacyStores.slideshow[0].items.map(item => item.id)).toEqual(['legacy-media']);

    await page.reload();
    await page.waitForFunction(() => window.Blend?.state?.projectName === 'Legacy session');
    await expect(migrationFailure).toHaveCount(0);

    const migratedState = await page.evaluate(() => ({
      projectName: window.Blend.state.projectName,
      experienceCount: window.Blend.state.experiences.length,
      activeExperienceId: window.Blend.state.activeExperienceId,
      libraryIds: Array.from(window.Blend.state.library.keys()),
      playlistIds: window.Blend.state.playlist.map(item => item.id),
      slideshowIds: window.Blend.state.slideshow.map(item => item.id),
      opacity: window.Blend.state.settings.opacity
    }));
    expect(migratedState).toEqual({
      projectName: 'Legacy session',
      experienceCount: 1,
      activeExperienceId: expect.any(String),
      libraryIds: ['legacy-media'],
      playlistIds: ['legacy-media'],
      slideshowIds: ['legacy-media'],
      opacity: 0.37
    });

    const migratedSnapshot = await readPersistedSnapshot(page);
    expect(migratedSnapshot.library.map(item => item.id)).toEqual(['legacy-media']);
    expect(migratedSnapshot.playlist[0].items.map(item => item.id)).toEqual(['legacy-media']);
    expect(migratedSnapshot.slideshow[0].items.map(item => item.id)).toEqual(['legacy-media']);
    expect(migratedSnapshot.settings.find(item => item.key === 'global').projectName).toBe('Legacy session');
    expect(migratedSnapshot.experiences).toHaveLength(1);
    expect(migratedSnapshot.experiences[0].payload.playlist.map(item => item.id)).toEqual(['legacy-media']);
    expect(migratedSnapshot.experiences[0].payload.slideshow.map(item => item.id)).toEqual(['legacy-media']);
  });
});
