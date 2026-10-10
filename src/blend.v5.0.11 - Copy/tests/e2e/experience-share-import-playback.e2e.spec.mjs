import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BlendAppPage, expectSourceMatch } from './support/blend-app-page.mjs';
import { createExperienceShareFlowDiagnostics } from './support/experience-share-flow-diagnostics.mjs';
import { createRunSuffix } from './support/experience-lifecycle-utils.mjs';
import {
  buildExperienceNameCases,
  ensureUniqueExperienceNameLikeApp
} from './support/experience-name-cases.mjs';

function samplePath(file) {
  return path.resolve(process.cwd(), 'samples', file);
}

async function waitForExperienceLists(blendPage, experienceName, minPlaylistItems, minSlideshowItems) {
  await blendPage.page.waitForFunction(
    ({ expectedName, playlistItems, slideshowItems }) => {
      const state = window.Blend?.state;
      const overlay = document.querySelector('#experience-load-overlay');
      const overlayVisible = !!overlay && overlay.getClientRects().length > 0 &&
        getComputedStyle(overlay).display !== 'none' && getComputedStyle(overlay).visibility !== 'hidden';
      return !!state &&
        window.Blend?.experienceLoading !== true &&
        !overlayVisible &&
        state.projectName === expectedName &&
        (state.playlist?.length || 0) >= playlistItems &&
        (state.slideshow?.length || 0) >= slideshowItems;
    },
    {
      expectedName: experienceName,
      playlistItems: minPlaylistItems,
      slideshowItems: minSlideshowItems
    },
    { timeout: 30000 }
  );
}

async function waitForPersistedExperienceLists(page, experienceName, minPlaylistItems, minSlideshowItems) {
  const persisted = await page.evaluate(async ({ expectedName, playlistItems, slideshowItems }) => {
    const activeId = window.Blend?.state?.activeExperienceId;
    if (!activeId) return { ready: false, reason: 'active experience is missing' };

    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('player-blend-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the local database'));
      request.onblocked = () => reject(new Error('Local database read was blocked'));
    });

    const deadline = performance.now() + 30000;
    let latest = null;
    try {
      while (performance.now() < deadline) {
        latest = await new Promise((resolve, reject) => {
          let transaction;
          try {
            transaction = database.transaction('experiences', 'readonly');
            const request = transaction.objectStore('experiences').get(activeId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('Could not read the saved experience'));
            transaction.onabort = () => reject(transaction.error || new Error('Experience read was aborted'));
          } catch (error) {
            reject(error);
          }
        });

        const payload = latest?.payload || latest?.snapshot || latest?.data || {};
        const playlistCount = payload.playlist?.length || 0;
        const slideshowCount = payload.slideshow?.length || 0;
        if (latest?.name === expectedName && playlistCount >= playlistItems && slideshowCount >= slideshowItems) {
          return { ready: true, playlistCount, slideshowCount };
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const payload = latest?.payload || latest?.snapshot || latest?.data || {};
      return {
        ready: false,
        experienceFound: Boolean(latest),
        nameMatches: latest?.name === expectedName,
        playlistCount: payload.playlist?.length || 0,
        slideshowCount: payload.slideshow?.length || 0
      };
    } finally {
      database.close();
    }
  }, {
    expectedName: experienceName,
    playlistItems: minPlaylistItems,
    slideshowItems: minSlideshowItems
  });

  expect(persisted.ready, `Experience lists were not committed to IndexedDB: ${JSON.stringify(persisted)}`).toBeTruthy();
}

async function assertExperiencePlayback(
  blendPage,
  experienceName,
  {
    expectedPlaylistSources = [],
    expectedSlideshowSources = [],
    minPlaylistItems = 1,
    minSlideshowItems = 1,
    requireIsPlaying = true,
    onPlaybackPhase = null
  } = {}
) {
  await onPlaybackPhase?.('experience switch:before', blendPage.page);
  await blendPage.switchExperience(experienceName);
  await onPlaybackPhase?.('experience switch:after', blendPage.page);
  await waitForExperienceLists(blendPage, experienceName, minPlaylistItems, minSlideshowItems);
  if (requireIsPlaying) {
    await blendPage.startPlayback({ onPhase: onPlaybackPhase });
  }
  const summary = await blendPage.playbackSummary({ onPhase: onPlaybackPhase });
  if (!requireIsPlaying) {
    await onPlaybackPhase?.('Configuration close after nonplaying assertion:before', blendPage.page);
    await blendPage.closeConfig();
    await onPlaybackPhase?.('Configuration close after nonplaying assertion:after', blendPage.page);
  }

  expect(summary.activeExperienceName).toBe(experienceName);
  expect(summary.playlistLength).toBeGreaterThanOrEqual(minPlaylistItems);
  expect(summary.slideshowLength).toBeGreaterThanOrEqual(minSlideshowItems);

  if (requireIsPlaying) {
    expect(summary.isPlaying, `Playback did not start for "${experienceName}"`).toBeTruthy();
    expect(summary.toastText || '').not.toMatch(/no playable media|could not load/i);
  }

  if (expectedPlaylistSources.length) {
    expectSourceMatch(
      summary.playlistCurrentSource || summary.playlistElementSrc,
      expectedPlaylistSources,
      `${experienceName} playlist`
    );
  }
  if (expectedSlideshowSources.length) {
    expectSourceMatch(
      summary.slideshowCurrentSource || summary.slideshowElementSrc,
      expectedSlideshowSources,
      `${experienceName} slideshow`
    );
  }
}

test.describe('experience create/share/import/playback e2e', () => {
  test('reuses the same naming dataset for create and rename flows', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const runSuffix = createRunSuffix(testInfo);
    const naming = buildExperienceNameCases(runSuffix);
    const blendPage = new BlendAppPage(page);

    await blendPage.boot('/index.html');
    await blendPage.createExperience(naming.duplicateAnchor);
    await blendPage.expectExperienceOption(naming.duplicateAnchor, true);

    for (const entry of naming.cases) {
      const existing = await blendPage.getExperienceNames();
      const expected = ensureUniqueExperienceNameLikeApp(entry.value, existing);
      const result = await blendPage.createExperienceFromInput(entry.value);

      if (!result.accepted) {
        await expect(blendPage.experienceModal).toBeVisible();
        await page.locator('#experience-modal-cancel').click();
        await expect(blendPage.experienceModal).not.toBeVisible();
        continue;
      }

      expect(result.createdName, `Create case "${entry.id}" created unexpected name`).toBe(expected);
      expect(result.activeName, `Create case "${entry.id}" did not activate the created experience`).toBe(expected);
    }

    const renameSeed = `Rename Seed ${runSuffix}`;
    await blendPage.createExperience(renameSeed);
    await blendPage.expectExperienceOption(renameSeed, true);

    let activeRenameName = renameSeed;
    for (const entry of naming.cases) {
      await blendPage.switchExperience(activeRenameName);
      const existing = await blendPage.getExperienceNames();
      const expected = ensureUniqueExperienceNameLikeApp(entry.value, existing, activeRenameName);
      const result = await blendPage.renameCurrentExperienceFromInput(entry.value);

      if (!result.accepted) {
        await expect(blendPage.experienceModal).toBeVisible();
        await page.locator('#experience-modal-cancel').click();
        await expect(blendPage.experienceModal).not.toBeVisible();
        continue;
      }

      const expectedActive = expected === activeRenameName ? activeRenameName : expected;
      expect(result.afterActive, `Rename case "${entry.id}" produced an unexpected active name`).toBe(expectedActive);
      activeRenameName = expectedActive;
    }
  });

  test('covers create, local media add, share URL import, local JSON import, and playback switching', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const runSuffix = createRunSuffix(testInfo);
    const experienceName = `Shared Flow ${runSuffix}`;
    const diagnostics = createExperienceShareFlowDiagnostics(page.context());
    await diagnostics.setOutputPath(testInfo.outputPath('experience-share-flow-diagnostics.json'));
    await diagnostics.observePage(page, 'primary');
    await page.context().route('https://**/*', route => route.abort());
    const onPlaybackPhase = (phase, phasePage) => diagnostics.playbackPhase(phase, phasePage);
    const blendPage = new BlendAppPage(page);
    const slideshowNames = ['IL.jpeg', 'blotter-01.png', 'its-a-trap.jpg'];
    const playlistNames = ['short-tone.mp3'];
    const playlistFile = path.resolve(process.cwd(), 'tests', 'e2e', 'fixtures', 'short-tone.mp3');
    const allLocalFiles = [...slideshowNames.map(samplePath), playlistFile];
    let sharedTab = null;
    let sharedBlendPage = null;

    try {
      await diagnostics.step('initial app setup and experience creation', page, async () => {
        await blendPage.boot('/index.html');
        await blendPage.createExperience(experienceName);
        await blendPage.expectExperienceOption(experienceName, true);
      });

      await diagnostics.step('local media import and list setup', page, async () => {
        await blendPage.addLocalFiles(allLocalFiles);
        await blendPage.selectLibraryItemsByNames(slideshowNames);
        await blendPage.addSelectedLibraryToList('slideshow', slideshowNames.length);
        await blendPage.clearLibrarySearch();
        await blendPage.selectLibraryItemsByNames(playlistNames);
        await blendPage.addSelectedLibraryToList('playlist', playlistNames.length);
      });

      await diagnostics.step('primary-tab playback and summary', page, () => assertExperiencePlayback(blendPage, experienceName, {
        expectedPlaylistSources: playlistNames,
        expectedSlideshowSources: slideshowNames,
        minPlaylistItems: 1,
        minSlideshowItems: 3,
        requireIsPlaying: true,
        onPlaybackPhase
      }));

      await diagnostics.step('wait for primary experience snapshot commit', page, () =>
        waitForPersistedExperienceLists(page, experienceName, 1, 3));

      const origin = new URL(page.url()).origin;
      const shareUrl = await diagnostics.step('share-link creation', page, async () => {
        const value = await blendPage.buildShareLinkForExperience(experienceName);
        expect(value).toMatch(/[?&]exp=/);
        return value;
      });

      await diagnostics.step('shared-tab creation', page, async () => {
        sharedTab = await page.context().newPage();
        await diagnostics.observePage(sharedTab, 'shared-tab');
        sharedBlendPage = new BlendAppPage(sharedTab);
      });

      await diagnostics.step('shared-tab navigation and bootstrap', sharedTab, async () => {
        await sharedBlendPage.boot(shareUrl);
        await sharedBlendPage.expectExperienceOption(experienceName, true);
        await waitForExperienceLists(sharedBlendPage, experienceName, 1, 3);
      });

      diagnostics.note('close source tab before shared-tab playback', page, {
        reason: 'release the source IndexedDB connection before the shared tab saves playback state'
      });
      await page.close();

      await diagnostics.step('shared-tab playback and summary', sharedTab, () => assertExperiencePlayback(sharedBlendPage, experienceName, {
        expectedPlaylistSources: playlistNames,
        expectedSlideshowSources: slideshowNames,
        minPlaylistItems: 1,
        minSlideshowItems: 3,
        requireIsPlaying: true,
        onPlaybackPhase
      }));

      const importedName = 'New York, New York!';
      const storageExperienceUrl = `${origin}/samples/New-York-New-York-01.json`;
      await diagnostics.step('storage JSON experience import and bootstrap', sharedTab, async () => {
        await sharedBlendPage.boot(`/index.html?storageExperience=${encodeURIComponent(storageExperienceUrl)}`);
        await sharedBlendPage.expectExperienceOption(importedName, true);
      });

      await diagnostics.step('storage JSON list assertions without playback', sharedTab, () => assertExperiencePlayback(sharedBlendPage, importedName, {
        expectedPlaylistSources: ['mytech.today/tools/media/videos/nyc/videos/'],
        expectedSlideshowSources: ['tripadvisor.com/media/photo-o/', 'mytech.today/tools/media/videos/nyc/images/'],
        minPlaylistItems: 1,
        minSlideshowItems: 1,
        requireIsPlaying: false,
        onPlaybackPhase
      }));

      await diagnostics.step('local JSON experience import', sharedTab, async () => {
        const namesBeforeLocalImport = await sharedBlendPage.getExperienceNames();
        await sharedBlendPage.importExperience(samplePath('New-York-New-York-01.json'));
        const namesAfterLocalImport = await sharedBlendPage.getExperienceNames();
        expect(namesAfterLocalImport.length).toBeGreaterThan(namesBeforeLocalImport.length);
      });

      await diagnostics.step('final playback switch to shared experience', sharedTab, () => assertExperiencePlayback(sharedBlendPage, experienceName, {
        expectedPlaylistSources: playlistNames,
        expectedSlideshowSources: slideshowNames,
        minPlaylistItems: 1,
        minSlideshowItems: 3,
        requireIsPlaying: true,
        onPlaybackPhase
      }));
    } finally {
      await diagnostics.attach(testInfo);
    }
  });

});
