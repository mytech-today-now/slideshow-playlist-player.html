import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BlendAppPage, expectSourceMatch } from './support/blend-app-page.mjs';
import { createRunSuffix } from './support/experience-lifecycle-utils.mjs';

test('imports and plays the original 31.4 MB local audio fixture', async ({ page }, testInfo) => {
  const experienceName = `Large Local Audio ${createRunSuffix(testInfo)}`;
  const audioPath = path.resolve(process.cwd(), 'samples', '1983-music-only.mp3');
  const blendPage = new BlendAppPage(page);

  await blendPage.boot('/index.html');
  await blendPage.createExperience(experienceName);
  await blendPage.addLocalFiles([audioPath]);
  await blendPage.selectLibraryItemsByNames(['1983-music-only.mp3']);
  await blendPage.addSelectedLibraryToList('playlist', 1);
  await blendPage.startPlayback();

  const summary = await blendPage.playbackSummary();
  expect(summary.activeExperienceName).toBe(experienceName);
  expect(summary.isPlaying).toBeTruthy();
  expect(summary.playlistLength).toBeGreaterThanOrEqual(1);
  expectSourceMatch(
    summary.playlistCurrentSource || summary.playlistElementSrc,
    ['1983-music-only.mp3'],
    `${experienceName} playlist`
  );
});
