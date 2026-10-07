import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import { createRunSuffix } from './support/experience-lifecycle-utils.mjs';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

test('dragging a txt URL list onto slideshow imports those items into the active experience', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const runSuffix = createRunSuffix(testInfo);
  const experienceName = `Slideshow Drop ${runSuffix}`;
  const blendPage = new BlendAppPage(page);
  const droppedLines = [
    `${FIXTURE_ORIGIN}/samples/IL.jpeg`,
    `${FIXTURE_ORIGIN}/samples/nyc-01.mp4`,
    'supabase://public/wedding/IMG_0034.HEIC',
    `${FIXTURE_ORIGIN}/samples/blotter-01.png`
  ];

  await blendPage.boot('/index.html');
  await blendPage.createExperience(experienceName);
  await blendPage.dropListFile('slideshow', {
    name: 'wedding-url-list.txt',
    text: `${droppedLines.join('\n')}\n`,
    expectedMinimumCount: droppedLines.length
  });

  const summary = await page.evaluate(() => {
    const state = window.Blend?.state;
    const slideshowRefs = state?.slideshow || [];
    const playlistRefs = state?.playlist || [];
    const slideshowPaths = slideshowRefs.map(ref => ref?.sourceUrl || ref?.path || '').filter(Boolean);
    return {
      activeExperienceName: state?.projectName || '',
      activeList: state?.ui?.activeList || '',
      slideshowCount: slideshowRefs.length,
      playlistCount: playlistRefs.length,
      slideshowPaths
    };
  });

  expect(summary.activeExperienceName).toBe(experienceName);
  expect(summary.activeList).toBe('slideshow');
  expect(summary.playlistCount).toBe(0);
  expect(summary.slideshowCount).toBe(droppedLines.length);
  expect(summary.slideshowPaths.some(path => path.includes('/samples/IL.jpeg'))).toBeTruthy();
  expect(summary.slideshowPaths.some(path => path.includes('/samples/nyc-01.mp4'))).toBeTruthy();
  expect(summary.slideshowPaths.some(path => /wedding\/IMG_0034\.HEIC/i.test(path))).toBeTruthy();
  expect(summary.slideshowPaths.some(path =>
    /wedding\/IMG_0034\.HEIC/i.test(path) &&
    /(supabase:\/\/|storage\/v1\/object\/public\/|api\.cloudflare\.com\/client\/v4\/accounts\/)/i.test(path)
  )).toBeTruthy();
});

test('dropping browser console output is ignored as non-media text', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const runSuffix = createRunSuffix(testInfo);
  const experienceName = `Console Drop ${runSuffix}`;
  const blendPage = new BlendAppPage(page);
  const droppedLines = [
    'index.html:1 Banner not shown: beforeinstallpromptevent.preventDefault() called.',
    'logger.js?v=20260622-v5.0.0-supabase-storage:124 [2026-06-22T20:26:13.556Z] [Blend] [WARN] Remote media import failed StorageResolverError: Media reference is not a valid Supabase or URL source.',
    '    at Object.resolve (storage-url-resolver.js?v=20260622-v5.0.0-supabase-storage:369:13)',
    'lqpmmviiloztbanshfxy.supabase.co/auth/v1/token?grant_type=password:1  Failed to load resource: the server responded with a status of 400 ()'
  ];

  await blendPage.boot('/index.html');
  await blendPage.createExperience(experienceName);
  await blendPage.dropListFile('slideshow', {
    name: 'console-dump.txt',
    text: `${droppedLines.join('\n')}\n`,
    expectedMinimumCount: 0
  });
  await blendPage.expectToastToContain('No media paths found in console-dump.txt');

  const summary = await page.evaluate(() => {
    const state = window.Blend?.state;
    return {
      playlistCount: state?.playlist?.length || 0,
      slideshowCount: state?.slideshow?.length || 0
    };
  });
  expect(summary.playlistCount).toBe(0);
  expect(summary.slideshowCount).toBe(0);
});
