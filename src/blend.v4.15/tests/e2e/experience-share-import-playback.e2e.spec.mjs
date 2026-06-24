import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BlendAppPage, expectSourceMatch } from './support/blend-app-page.mjs';
import { createRunSuffix } from './support/experience-lifecycle-utils.mjs';
import {
  buildExperienceNameCases,
  ensureUniqueExperienceNameLikeApp
} from './support/experience-name-cases.mjs';

function samplePath(file) {
  return path.resolve(process.cwd(), 'samples', file);
}

async function assertExperiencePlayback(
  blendPage,
  experienceName,
  {
    expectedPlaylistSources = [],
    expectedSlideshowSources = [],
    minPlaylistItems = 1,
    minSlideshowItems = 1,
    requireIsPlaying = true
  } = {}
) {
  await blendPage.switchExperience(experienceName);
  await blendPage.startPlayback();
  const summary = await blendPage.playbackSummary();

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
    const blendPage = new BlendAppPage(page);
    const slideshowNames = ['IL.jpeg', 'blotter-01.png', 'its-a-trap.jpg'];
    const playlistNames = ['1983-music-only.mp3'];
    const allLocalFiles = [...slideshowNames, ...playlistNames].map(samplePath);

    await blendPage.boot('/index.html');
    await blendPage.createExperience(experienceName);
    await blendPage.expectExperienceOption(experienceName, true);

    await blendPage.addLocalFiles(allLocalFiles);
    await blendPage.selectLibraryItemsByNames(slideshowNames);
    await blendPage.addSelectedLibraryToList('slideshow', slideshowNames.length);
    await blendPage.clearLibrarySearch();
    await blendPage.selectLibraryItemsByNames(playlistNames);
    await blendPage.addSelectedLibraryToList('playlist', playlistNames.length);

    await assertExperiencePlayback(blendPage, experienceName, {
      expectedPlaylistSources: playlistNames,
      expectedSlideshowSources: slideshowNames,
      minPlaylistItems: 1,
      minSlideshowItems: 3,
      requireIsPlaying: true
    });

    const origin = new URL(page.url()).origin;
    await blendPage.configureIpfsForFixture(origin, `${origin}/ipfs/`);
    const shareUrl = await blendPage.shareActiveExperienceAndCaptureUrl();
    expect(shareUrl).toMatch(/[?&]ipfsExperience=/);

    await blendPage.switchExperience(experienceName);
    await blendPage.deleteCurrentExperience();
    await blendPage.expectExperienceOption(experienceName, false);

    const sharedTab = await page.context().newPage();
    const sharedBlendPage = new BlendAppPage(sharedTab);
    await sharedBlendPage.boot(shareUrl);
    await sharedBlendPage.expectExperienceOption(experienceName, true);

    await assertExperiencePlayback(sharedBlendPage, experienceName, {
      expectedPlaylistSources: ['ipfs://'],
      expectedSlideshowSources: ['ipfs://'],
      minPlaylistItems: 1,
      minSlideshowItems: 3,
      requireIsPlaying: true
    });

    const importedName = 'New York, New York!';
    await sharedBlendPage.importExperience(samplePath('New-York-New-York-01.json'));
    await sharedBlendPage.expectExperienceOption(importedName, true);

    await assertExperiencePlayback(sharedBlendPage, importedName, {
      expectedPlaylistSources: ['mytech.today/tools/media/videos/nyc/videos/'],
      expectedSlideshowSources: ['tripadvisor.com/media/photo-o/', 'mytech.today/tools/media/videos/nyc/images/'],
      minPlaylistItems: 1,
      minSlideshowItems: 1,
      requireIsPlaying: false
    });

    await assertExperiencePlayback(sharedBlendPage, experienceName, {
      expectedPlaylistSources: ['ipfs://'],
      expectedSlideshowSources: ['ipfs://'],
      minPlaylistItems: 1,
      minSlideshowItems: 3,
      requireIsPlaying: true
    });
  });
});
