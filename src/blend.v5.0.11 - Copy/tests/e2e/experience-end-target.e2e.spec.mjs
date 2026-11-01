import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import { createRunSuffix } from './support/experience-lifecycle-utils.mjs';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

async function removeEndTargetFromPersistedExperience(page, experienceId) {
  await page.evaluate(async id => {
    const request = indexedDB.open('player-blend-v1');
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open Blend database'));
    });

    await new Promise((resolve, reject) => {
      const transaction = database.transaction('experiences', 'readwrite');
      const store = transaction.objectStore('experiences');
      const read = store.get(id);
      read.onsuccess = () => {
        const record = read.result;
        if (!record?.payload?.settings) {
          transaction.abort();
          return;
        }
        delete record.payload.settings.experienceEndTarget;
        store.put(record);
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not update experience'));
      transaction.onabort = () => reject(transaction.error || new Error('Experience update was aborted'));
    });

    database.close();
  }, experienceId);
}

async function setupExperience(page, testInfo) {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await blendPage.createExperience(`End target ${createRunSuffix(testInfo)}`);
  await blendPage.openConfig();
  return blendPage;
}

async function setupTwoLayerPlayback(page, testInfo, { endTarget, slideshowDuration, playbackMode = 'stop' }) {
  const blendPage = await setupExperience(page, testInfo);
  await blendPage.dropListFile('playlist', {
    name: 'playlist.txt',
    text: `${FIXTURE_ORIGIN}/samples/nyc-01.mp4\n`,
    expectedMinimumCount: 1
  });
  await blendPage.dropListFile('slideshow', {
    name: 'slideshow.txt',
    text: `${FIXTURE_ORIGIN}/samples/IL.jpeg\n`,
    expectedMinimumCount: 1
  });
  const saved = await page.evaluate(({ target, duration, playbackMode }) => {
    const state = window.Blend.state;
    state.settings.experienceEndTarget = target;
    state.settings.experiencePlaybackMode = playbackMode;
    state.settings.transitionOverlapMs = 0;
    state.slideshow[0].displayDuration = duration;
    return window.Blend.saveStateNow();
  }, { target: endTarget, duration: slideshowDuration, playbackMode });
  expect(saved).toBe(true);
  await blendPage.openConfig();
  return blendPage;
}

test('end target choices are keyboard accessible, persist, and leave layer order unchanged', async ({ page }, testInfo) => {
  const blendPage = await setupExperience(page, testInfo);
  const playbackMode = page.getByRole('combobox', { name: 'Experience playback mode' });
  const endTarget = page.getByRole('combobox', { name: 'Experience end target' });
  const playlistOrder = page.getByRole('combobox', { name: 'Playlist order' });
  const slideshowOrder = page.getByRole('combobox', { name: 'Slideshow order' });
  const originalExperienceName = await page.evaluate(() => window.Blend.state.projectName);

  await expect(endTarget).toBeVisible();
  await expect(endTarget).toHaveValue('playlist');
  await playbackMode.focus();
  await page.keyboard.press('Tab');
  await expect(endTarget).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(playlistOrder).toBeFocused();

  await playlistOrder.selectOption('random');
  await slideshowOrder.selectOption('random');
  await endTarget.focus();
  await page.keyboard.press('ArrowDown');
  await expect(endTarget).toHaveValue('slideshow');
  expect(await page.evaluate(() => window.Blend.state.settings.experienceEndTarget)).toBe('slideshow');
  expect(await page.evaluate(() => ({
    playlist: window.Blend.state.settings.playbackModePlaylist,
    slideshow: window.Blend.state.settings.playbackModeSlideshow
  }))).toEqual({ playlist: 'random', slideshow: 'random' });

  const exportPromise = page.waitForEvent('download');
  await page.locator('#experience-export').click();
  const exportedFile = await exportPromise;
  const exportedExperience = JSON.parse(await readFile(await exportedFile.path(), 'utf8'));
  expect(exportedExperience.settings.experienceEndTarget).toBe('slideshow');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(endTarget).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 900 });
  await blendPage.flushSaveState();

  const alternateExperienceName = `Alternate ${createRunSuffix(testInfo)}`;
  await blendPage.createExperience(alternateExperienceName);
  await endTarget.selectOption('playlist');
  await blendPage.flushSaveState();
  await blendPage.switchExperience(originalExperienceName);
  await expect(endTarget).toHaveValue('slideshow');
  await blendPage.switchExperience(alternateExperienceName);
  await expect(endTarget).toHaveValue('playlist');
  await blendPage.switchExperience(originalExperienceName);
  await expect(endTarget).toHaveValue('slideshow');

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await blendPage.openConfig();
  await expect(endTarget).toHaveValue('slideshow');
  await expect(playlistOrder).toHaveValue('random');
  await expect(slideshowOrder).toHaveValue('random');

  await endTarget.selectOption('playlist');
  await blendPage.flushSaveState();
  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await blendPage.openConfig();
  await expect(endTarget).toHaveValue('playlist');
  await expect(playlistOrder).toHaveValue('random');
  await expect(slideshowOrder).toHaveValue('random');

  const activeExperienceId = await page.evaluate(() => window.Blend.state.activeExperienceId);
  await endTarget.selectOption('slideshow');
  await blendPage.flushSaveState();
  await removeEndTargetFromPersistedExperience(page, activeExperienceId);
  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await blendPage.openConfig();
  await expect(endTarget).toHaveValue('playlist');
  expect(await page.evaluate(() => window.Blend.state.settings.experienceEndTarget)).toBe('playlist');
  await expect(playlistOrder).toHaveValue('random');
  await expect(slideshowOrder).toHaveValue('random');
});

test('Playlist end target stops while Slideshow still has a current item', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'playlist',
    slideshowDuration: 1
  });
  await blendPage.playButton.click();
  await expect.poll(() => page.evaluate(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    const image = document.querySelector('#slideshow-layer img[src]');
    return window.Blend?.transport === 'playing' && !!video && !!image?.complete && image.naturalWidth > 0;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => (
    !!document.querySelector('#slideshow-layer img[src]')?.style.transform
  ))).toBe(true);

  const animationState = await page.evaluate(() => {
    const image = document.querySelector('#slideshow-layer img[src]');
    if (!image?.style.transform) throw new Error('Ken Burns transform did not start');
    window.__endTargetTransition = image.animate(
      [{ opacity: '1' }, { opacity: '0.5' }],
      { duration: 60000, fill: 'both' }
    );
    return window.__endTargetTransition.playState;
  });
  expect(animationState).toBe('running');
  await page.evaluate(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    if (!video?.onended) throw new Error('Playlist ended handler is unavailable');
    window.__endTargetBoundaryAt = performance.now();
    video.dispatchEvent(new Event('ended'));
  });
  await expect.poll(() => page.evaluate(() => window.Blend?.transport)).toBe('stopped');

  const state = await page.evaluate(() => ({
    transport: window.Blend.transport,
    slideshowIndex: window.Blend.state.runtime.slideshowIndex,
    slideshowImageVisible: !!document.querySelector('#slideshow-layer img[src]'),
    transitionState: window.__endTargetTransition.playState,
    activeAnimations: document.querySelector('#slideshow-layer').getAnimations({ subtree: true }).length,
    transform: document.querySelector('#slideshow-layer img[src]')?.style.transform || ''
  }));
  expect(state.transport).toBe('stopped');
  expect(state.slideshowIndex).toBe(0);
  expect(state.slideshowImageVisible).toBe(true);
  expect(state.transitionState).toBe('idle');
  expect(state.activeAnimations).toBe(0);

  await page.waitForFunction(() => (
    Number.isFinite(window.__endTargetBoundaryAt) &&
    performance.now() - window.__endTargetBoundaryAt >= 1200
  ), null, { timeout: 3000, polling: 25 });
  const afterBoundary = await page.evaluate(() => ({
    slideshowIndex: window.Blend.state.runtime.slideshowIndex,
    slideshowImageVisible: !!document.querySelector('#slideshow-layer img[src]'),
    transform: document.querySelector('#slideshow-layer img[src]')?.style.transform || ''
  }));
  expect(afterBoundary).toEqual({
    slideshowIndex: 0,
    slideshowImageVisible: true,
    transform: state.transform
  });
});

test('Slideshow end target stops while Playlist has not ended', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'slideshow',
    slideshowDuration: 1
  });
  await blendPage.playButton.click();
  await page.waitForFunction(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    const image = document.querySelector('#slideshow-layer img[src]');
    return window.Blend?.transport === 'playing' && video && image?.complete && image.naturalWidth > 0;
  });
  const playlistHadNotEnded = await page.evaluate(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    return video.ended === false;
  });
  expect(playlistHadNotEnded).toBe(true);
  await page.waitForFunction(() => window.Blend?.transport === 'stopped', null, { timeout: 10000 });

  const state = await page.evaluate(() => ({
    transport: window.Blend.transport,
    playlistEnded: document.querySelector('#playlist-layer video[src]')?.ended ?? null,
    playlistPaused: document.querySelector('#playlist-layer video[src]')?.paused ?? null,
    slideshowIndex: window.Blend.state.runtime.slideshowIndex
  }));
  expect(state).toEqual({ transport: 'stopped', playlistEnded: false, playlistPaused: true, slideshowIndex: 0 });
});

test('manual Next at both layer boundaries does not trigger automatic completion', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'playlist',
    slideshowDuration: 60
  });
  await blendPage.playButton.click();
  await page.waitForFunction(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    const image = document.querySelector('#slideshow-layer img[src]');
    return window.Blend?.transport === 'playing' && video && image?.complete && image.naturalWidth > 0;
  });

  await page.locator('#btn-next').click();
  await expect.poll(() => page.evaluate(() => window.Blend.transport)).toBe('playing');
  await expect.poll(() => page.evaluate(() => ({
    playlistIndex: window.Blend.state.runtime.playlistIndex,
    slideshowIndex: window.Blend.state.runtime.slideshowIndex,
    playlistVisible: !!document.querySelector('#playlist-layer video[src]'),
    slideshowVisible: !!document.querySelector('#slideshow-layer img[src]')
  }))).toEqual({
    playlistIndex: 0,
    slideshowIndex: 0,
    playlistVisible: true,
    slideshowVisible: true
  });
  await expect(page.getByRole('status').filter({ hasText: 'Experience finished' })).toHaveCount(0);
});

test('manual Stop resets playback without showing automatic completion', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'playlist',
    slideshowDuration: 60
  });
  await blendPage.playButton.click();
  await page.waitForFunction(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    const image = document.querySelector('#slideshow-layer img[src]');
    return window.Blend?.transport === 'playing' && video && image?.complete && image.naturalWidth > 0;
  });

  await page.locator('#btn-stop').click();
  await expect.poll(() => page.evaluate(() => window.Blend?.transport)).toBe('stopped');
  await expect(page.getByRole('status').filter({ hasText: 'Experience finished' })).toHaveCount(0);
  expect(await page.evaluate(() => ({
    playlistIndex: window.Blend.state.runtime.playlistIndex,
    slideshowIndex: window.Blend.state.runtime.slideshowIndex,
    slideshowImageVisible: !!document.querySelector('#slideshow-layer img[src]')
  }))).toEqual({ playlistIndex: 0, slideshowIndex: 0, slideshowImageVisible: false });
});

test('an empty selected layer uses the available companion layer boundary', async ({ page }, testInfo) => {
  const blendPage = await setupExperience(page, testInfo);
  await blendPage.dropListFile('playlist', {
    name: 'playlist-only.txt',
    text: `${FIXTURE_ORIGIN}/samples/nyc-01.mp4\n`,
    expectedMinimumCount: 1
  });
  const saved = await page.evaluate(() => {
    const state = window.Blend.state;
    state.settings.experienceEndTarget = 'slideshow';
    state.settings.experiencePlaybackMode = 'stop';
    state.settings.transitionOverlapMs = 0;
    return window.Blend.saveStateNow();
  });
  expect(saved).toBe(true);

  await blendPage.playButton.click();
  await page.waitForFunction(() => (
    window.Blend?.transport === 'playing' && document.querySelector('#playlist-layer video[src]')
  ));
  await page.evaluate(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    if (!video?.onended) throw new Error('Playlist ended handler is unavailable');
    video.dispatchEvent(new Event('ended'));
  });
  await expect.poll(() => page.evaluate(() => window.Blend?.transport)).toBe('stopped');
  expect(await page.evaluate(() => ({
    endTarget: window.Blend.state.settings.experienceEndTarget,
    slideshowLength: window.Blend.state.slideshow.length,
    playlistIndex: window.Blend.state.runtime.playlistIndex
  }))).toEqual({ endTarget: 'slideshow', slideshowLength: 0, playlistIndex: 0 });
});

test('Loop restarts from the beginning after the selected layer ends', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'playlist',
    playbackMode: 'loop',
    slideshowDuration: 60
  });
  await blendPage.playButton.click();
  await page.waitForFunction(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    const image = document.querySelector('#slideshow-layer img[src]');
    return window.Blend?.transport === 'playing' && video && !video.paused && video.currentTime > 0.25 && image?.complete && image.naturalWidth > 0;
  });
  await page.evaluate(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    window.__endTargetPlaybackEvents = [];
    Array.from(document.querySelectorAll('#playlist-layer video')).forEach((element, index) => {
      element.addEventListener('play', () => window.__endTargetPlaybackEvents.push({ type: 'play', index, at: performance.now() }));
      element.addEventListener('pause', () => window.__endTargetPlaybackEvents.push({ type: 'pause', index, at: performance.now() }));
    });
    window.__endTargetBoundaryAt = performance.now();
    video.dispatchEvent(new Event('ended'));
  });

  await page.waitForFunction(() => {
    const boundaryAt = window.__endTargetBoundaryAt;
    const events = (window.__endTargetPlaybackEvents || []).filter(event => event.at >= boundaryAt);
    const pause = events.find(event => event.type === 'pause');
    const resumed = pause && events.some(event => event.type === 'play' && event.at > pause.at);
    const activeVideo = Array.from(document.querySelectorAll('#playlist-layer video[src]'))
      .find(element => !element.paused && element.currentTime > 0);
    return window.Blend?.transport === 'playing' && resumed && !!activeVideo;
  }, null, { timeout: 10000 });
  const state = await page.evaluate(() => ({
    transport: window.Blend.transport,
    playlistIndex: window.Blend.state.runtime.playlistIndex,
    activePlaylistVideo: Array.from(document.querySelectorAll('#playlist-layer video[src]'))
      .some(element => !element.paused),
    playlistCurrentTime: Array.from(document.querySelectorAll('#playlist-layer video[src]'))
      .find(element => !element.paused)?.currentTime ?? null
  }));
  expect(state.transport).toBe('playing');
  expect(state.playlistIndex).toBe(0);
  expect(state.activePlaylistVideo).toBeTruthy();
  expect(state.playlistCurrentTime).toBeLessThan(1);
});

test('Go to Next Experience starts the following experience at the selected layer boundary', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'playlist',
    playbackMode: 'next-experience',
    slideshowDuration: 60
  });
  const firstExperienceName = await page.evaluate(() => window.Blend.state.projectName);
  const nextExperienceName = `Next target ${createRunSuffix(testInfo)}`;
  await blendPage.createExperience(nextExperienceName);
  await blendPage.dropListFile('playlist', {
    name: 'next-playlist.txt',
    text: `${FIXTURE_ORIGIN}/samples/nyc-01.mp4\n`,
    expectedMinimumCount: 1
  });
  await blendPage.dropListFile('slideshow', {
    name: 'next-slideshow.txt',
    text: `${FIXTURE_ORIGIN}/samples/IL.jpeg\n`,
    expectedMinimumCount: 1
  });
  await blendPage.flushSaveState();
  await blendPage.switchExperience(firstExperienceName);
  await page.evaluate(() => {
    window.Blend.state.settings.experiencePlaybackMode = 'next-experience';
    window.Blend.saveStateNow();
  });

  await blendPage.playButton.click();
  await page.waitForFunction(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    const image = document.querySelector('#slideshow-layer img[src]');
    return window.Blend?.transport === 'playing' && video && image?.complete && image.naturalWidth > 0;
  });
  await page.evaluate(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    if (!video?.onended) throw new Error('Playlist ended handler is unavailable');
    video.dispatchEvent(new Event('ended'));
  });

  await page.waitForFunction(expectedName => (
    window.Blend?.state?.projectName === expectedName &&
    window.Blend.transport === 'playing' &&
    document.querySelector('#playlist-layer video[src]') &&
    document.querySelector('#slideshow-layer img[src]')
  ), nextExperienceName, { timeout: 15000 });
  expect(await page.evaluate(() => window.Blend.state.projectName)).toBe(nextExperienceName);
});

test('failed next-item load completes cleanly and a later Play can recover', async ({ page }, testInfo) => {
  const blendPage = await setupExperience(page, testInfo);
  await blendPage.dropListFile('playlist', {
    name: 'playlist-with-failed-next-item.txt',
    text: `${FIXTURE_ORIGIN}/samples/nyc-01.mp4\n${FIXTURE_ORIGIN}/samples/missing-next-item.mp4\n`,
    expectedMinimumCount: 2
  });
  await blendPage.dropListFile('slideshow', {
    name: 'slideshow.txt',
    text: `${FIXTURE_ORIGIN}/samples/IL.jpeg\n`,
    expectedMinimumCount: 1
  });
  const saved = await page.evaluate(() => {
    const state = window.Blend.state;
    state.settings.experienceEndTarget = 'playlist';
    state.settings.experiencePlaybackMode = 'stop';
    state.settings.transitionOverlapMs = 0;
    state.slideshow[0].displayDuration = 60;
    return window.Blend.saveStateNow();
  });
  expect(saved).toBe(true);

  await blendPage.playButton.click();
  await page.waitForFunction(() => {
    const activeVideo = Array.from(document.querySelectorAll('#playlist-layer video[src]'))
      .find(element => !element.paused && element.currentTime > 0.25);
    const image = document.querySelector('#slideshow-layer img[src]');
    return window.Blend?.transport === 'playing' && activeVideo && image?.complete && image.naturalWidth > 0;
  }, null, { timeout: 15000 });
  await page.evaluate(() => {
    const video = Array.from(document.querySelectorAll('#playlist-layer video[src]'))
      .find(element => !element.paused && element.currentTime > 0.25);
    if (!video?.onended) throw new Error('Playlist ended handler is unavailable');
    video.dispatchEvent(new Event('ended'));
  });
  await page.waitForFunction(() => window.Blend?.transport === 'stopped', null, { timeout: 15000 });

  await blendPage.playButton.click();
  await page.waitForFunction(() => (
    window.Blend?.transport === 'playing' &&
    window.Blend.state.runtime.playlistIndex === 0 &&
    Array.from(document.querySelectorAll('#playlist-layer video[src]'))
      .some(element => !element.paused && element.currentTime > 0.25)
  ), null, { timeout: 15000 });
  expect(await page.evaluate(() => window.Blend.transport)).toBe('playing');
});
