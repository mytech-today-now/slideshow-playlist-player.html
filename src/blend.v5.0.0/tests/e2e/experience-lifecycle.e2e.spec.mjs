import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BlendAppPage, expectSourceMatch } from './support/blend-app-page.mjs';
import {
  createRunSuffix,
  createExperienceNames,
  prepareLifecycleListArtifacts,
  saveDownloadWithRetry
} from './support/experience-lifecycle-utils.mjs';

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
});
