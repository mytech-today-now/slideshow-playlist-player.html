import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import { createRunSuffix } from './support/experience-lifecycle-utils.mjs';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

// Reads the playback time of the active (visible, src-bearing) playlist video.
async function playlistVideoState(page) {
  return page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('#playlist-layer video'));
    const withSrc = videos.filter(v => v.getAttribute('src'));
    // The active video is the one that is visible (opacity 1); fall back to the
    // one furthest along.
    const active = withSrc.find(v => v.style.opacity === '1') || withSrc[0] || null;
    return {
      transport: window.Blend?.transport || window.Blend?.state?.runtime?.transport || '',
      isPlaying: !!window.Blend?.state?.runtime?.isPlaying,
      playlistIndex: window.Blend?.state?.runtime?.playlistIndex ?? -1,
      hasActiveVideo: !!active,
      paused: active ? active.paused : null,
      currentTime: active ? active.currentTime : null,
      src: active ? active.src : '',
      playButtonText: document.querySelector('#btn-play')?.textContent || ''
    };
  });
}

async function buildVideoExperience(page, testInfo) {
  const blendPage = new BlendAppPage(page);
  const experienceName = `Player ${createRunSuffix(testInfo)}`;
  await blendPage.boot('/index.html');
  await blendPage.createExperience(experienceName);
  await blendPage.dropListFile('playlist', {
    name: 'playlist.txt',
    text: `${FIXTURE_ORIGIN}/samples/nyc-01.mp4\n`,
    expectedMinimumCount: 1
  });
  await blendPage.dropListFile('slideshow', {
    name: 'slideshow.txt',
    text: `${FIXTURE_ORIGIN}/samples/IL.jpeg\n${FIXTURE_ORIGIN}/samples/blotter-01.png\n`,
    expectedMinimumCount: 2
  });
  await blendPage.closeConfig();
  return blendPage;
}

// Starts playback (user gesture) and waits for the active video clock to move.
async function startAndWaitForProgress(page, blendPage) {
  await blendPage.playButton.click();
  await page.waitForFunction(() => window.Blend?.transport === 'playing', null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const v = Array.from(document.querySelectorAll('#playlist-layer video')).find(el => el.getAttribute('src'));
    return v && !v.paused && v.currentTime > 0.15;
  }, null, { timeout: 12000 });
}

test('Pause freezes both layers at the exact position; Play resumes from there', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildVideoExperience(page, testInfo);

  await startAndWaitForProgress(page, blendPage);
  const playing = await playlistVideoState(page);
  expect(playing.transport).toBe('playing');
  expect(playing.paused).toBe(false);
  expect(playing.playButtonText).toBe('⏸');
  const srcWhilePlaying = playing.src;

  // --- Pause -------------------------------------------------------------
  await blendPage.playButton.click();
  await page.waitForFunction(() => window.Blend?.transport === 'paused', null, { timeout: 5000 });
  const paused = await playlistVideoState(page);
  expect(paused.transport).toBe('paused');
  expect(paused.paused).toBe(true);
  expect(paused.playButtonText).toBe('▶');
  expect(paused.src).toBe(srcWhilePlaying); // media was NOT unloaded
  const pausedTime = paused.currentTime;
  expect(pausedTime).toBeGreaterThan(0.1);

  // While paused, the clock must not advance.
  await page.waitForTimeout(800);
  const stillPaused = await playlistVideoState(page);
  expect(Math.abs(stillPaused.currentTime - pausedTime)).toBeLessThan(0.25);

  // --- Resume ------------------------------------------------------------
  await blendPage.playButton.click();
  await page.waitForFunction(() => window.Blend?.transport === 'playing', null, { timeout: 5000 });
  const resumed = await playlistVideoState(page);
  expect(resumed.paused).toBe(false);
  expect(resumed.src).toBe(srcWhilePlaying); // same element, not reloaded from 0
  // Resumed from (>=) the paused position rather than restarting.
  expect(resumed.currentTime).toBeGreaterThanOrEqual(pausedTime - 0.3);

  await page.waitForFunction(
    banked => {
      const v = Array.from(document.querySelectorAll('#playlist-layer video')).find(el => el.getAttribute('src'));
      return v && v.currentTime > banked + 0.2;
    },
    pausedTime,
    { timeout: 8000 }
  );
});

test('Stop resets to a blank state; Play restarts from the very beginning', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildVideoExperience(page, testInfo);

  await startAndWaitForProgress(page, blendPage);
  // Let it run a little so currentTime is clearly non-zero before stopping.
  await page.waitForFunction(() => {
    const v = Array.from(document.querySelectorAll('#playlist-layer video')).find(el => el.getAttribute('src'));
    return v && v.currentTime > 0.6;
  }, null, { timeout: 12000 });

  // --- Stop --------------------------------------------------------------
  await page.locator('#btn-stop').click();
  await page.waitForFunction(() => window.Blend?.transport === 'stopped', null, { timeout: 5000 });
  const stopped = await page.evaluate(() => {
    const wrapper = document.querySelector('#slideshow-layer .kenburns-wrapper');
    const playlistVideosWithSrc = Array.from(document.querySelectorAll('#playlist-layer video'))
      .filter(v => v.getAttribute('src')).length;
    return {
      transport: window.Blend?.transport,
      isPlaying: !!window.Blend?.state?.runtime?.isPlaying,
      playlistIndex: window.Blend?.state?.runtime?.playlistIndex,
      slideshowIndex: window.Blend?.state?.runtime?.slideshowIndex,
      slideshowChildren: wrapper ? wrapper.childElementCount : -1,
      playlistVideosWithSrc,
      playButtonText: document.querySelector('#btn-play')?.textContent || ''
    };
  });
  expect(stopped.transport).toBe('stopped');
  expect(stopped.isPlaying).toBe(false);
  expect(stopped.playlistIndex).toBe(0);
  expect(stopped.slideshowIndex).toBe(0);
  expect(stopped.slideshowChildren).toBe(0); // blank screen
  expect(stopped.playlistVideosWithSrc).toBe(0); // media unloaded
  expect(stopped.playButtonText).toBe('▶');

  // --- Play again: starts over from the beginning ------------------------
  await blendPage.playButton.click();
  await page.waitForFunction(() => window.Blend?.transport === 'playing', null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const v = Array.from(document.querySelectorAll('#playlist-layer video')).find(el => el.getAttribute('src'));
    return v && v.currentTime > 0;
  }, null, { timeout: 12000 });
  const restarted = await playlistVideoState(page);
  expect(restarted.playlistIndex).toBe(0);
  // Restarted near the beginning (not resumed from the pre-stop position).
  expect(restarted.currentTime).toBeLessThan(0.6);
});

test('rapid Play/Pause/Stop toggles settle into a consistent state', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildVideoExperience(page, testInfo);

  await startAndWaitForProgress(page, blendPage);
  // Hammer the transport quickly through the public API.
  await page.evaluate(async () => {
    const B = window.Blend;
    B.togglePlay(); B.togglePlay(); B.togglePlay();
    B.stop();
    await B.togglePlay();
    B.pause();
    await B.resume();
  });
  const state = await page.evaluate(() => window.Blend?.transport);
  expect(['playing', 'paused', 'stopped']).toContain(state);
  // The app is still responsive: an explicit stop returns to a known state.
  await page.locator('#btn-stop').click();
  await page.waitForFunction(() => window.Blend?.transport === 'stopped', null, { timeout: 5000 });
  expect(await page.evaluate(() => window.Blend?.transport)).toBe('stopped');
});

test('pressing Play with an empty experience stays stopped (no crash)', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await blendPage.createExperience(`Empty ${createRunSuffix(testInfo)}`);
  await blendPage.closeConfig();

  await blendPage.playButton.click();
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => ({
    transport: window.Blend?.transport,
    isPlaying: !!window.Blend?.state?.runtime?.isPlaying,
    playButtonText: document.querySelector('#btn-play')?.textContent || ''
  }));
  expect(state.transport).toBe('stopped');
  expect(state.isPlaying).toBe(false);
  expect(state.playButtonText).toBe('▶');
});

test('the S keyboard shortcut stops playback', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildVideoExperience(page, testInfo);
  await startAndWaitForProgress(page, blendPage);
  await page.locator('#viewport').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('s');
  await page.waitForFunction(() => window.Blend?.transport === 'stopped', null, { timeout: 5000 });
  expect(await page.evaluate(() => window.Blend?.transport)).toBe('stopped');
});
