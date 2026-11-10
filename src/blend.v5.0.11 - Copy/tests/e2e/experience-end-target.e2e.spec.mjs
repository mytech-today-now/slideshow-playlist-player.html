import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import { createRunSuffix } from './support/experience-lifecycle-utils.mjs';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;
const RANDOM_CYCLE_COMPLETION_COPY = 'Random order finished its current cycle. Playback will stop, loop, or move to the next experience according to Experience playback mode.';

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

async function setupTwoLayerPlayback(page, testInfo, {
  endTarget,
  slideshowDuration,
  playbackMode = 'stop',
  playlistOrder = 'sequential',
  slideshowOrder = 'sequential'
}) {
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
  const saved = await page.evaluate(({ target, duration, playbackMode, playlistOrder, slideshowOrder }) => {
    const state = window.Blend.state;
    state.settings.experienceEndTarget = target;
    state.settings.experiencePlaybackMode = playbackMode;
    state.settings.playbackModePlaylist = playlistOrder;
    state.settings.playbackModeSlideshow = slideshowOrder;
    state.settings.transitionOverlapMs = 0;
    state.slideshow[0].displayDuration = duration;
    return window.Blend.saveStateNow();
  }, { target: endTarget, duration: slideshowDuration, playbackMode, playlistOrder, slideshowOrder });
  expect(saved).toBe(true);
  await blendPage.openConfig();
  return blendPage;
}

async function addUnavailableBoundaryReferences(page, layer) {
  const saved = await page.evaluate(layerName => {
    const state = window.Blend.state;
    const list = state[layerName];
    if (!Array.isArray(list) || list.length !== 1) throw new Error(`Expected one ${layerName} item`);
    const playableRef = list[0];
    state[layerName] = [
      { id: `${layerName}-unavailable-leading`, available: false },
      playableRef,
      { id: `${layerName}-unavailable-trailing`, available: false }
    ];
    state.runtime[`${layerName}Index`] = 0;
    return window.Blend.saveStateNow();
  }, layer);
  expect(saved).toBe(true);
}

async function addMixedSlideshowBoundaryReferences(page) {
  const saved = await page.evaluate(() => {
    const state = window.Blend.state;
    if (state.slideshow.length !== 1 || state.playlist.length !== 1) {
      throw new Error('Expected one image and one video fixture');
    }
    const imageRef = state.slideshow[0];
    const videoRef = { ...state.playlist[0], includeAudio: false };
    state.slideshow = [
      { id: 'slideshow-unavailable-leading', available: false },
      imageRef,
      { id: 'slideshow-unavailable-middle', available: false },
      videoRef,
      { id: 'slideshow-unavailable-trailing', available: false }
    ];
    state.runtime.slideshowIndex = 0;
    return window.Blend.saveStateNow();
  });
  expect(saved).toBe(true);
}

async function duplicatePlayableLayerReferences(page, layer, sourceLayer = layer) {
  const saved = await page.evaluate(({ layerName, sourceLayerName }) => {
    const state = window.Blend.state;
    const source = state[sourceLayerName]?.[0];
    if (!source) throw new Error(`Expected a playable ${sourceLayerName} item`);
    const first = { ...source };
    if (layerName === 'slideshow') first.includeAudio = false;
    state[layerName] = [first, { ...first }];
    state.runtime[`${layerName}Index`] = 0;
    return window.Blend.saveStateNow();
  }, { layerName: layer, sourceLayerName: sourceLayer });
  expect(saved).toBe(true);
}

async function endActiveVideo(page, layer) {
  await page.evaluate(layerName => {
    const selector = layerName === 'playlist' ? '#playlist-layer video[src]' : '#slideshow-layer video[src]';
    const media = Array.from(document.querySelectorAll(selector)).find(element => !element.paused);
    if (!media?.onended) throw new Error(`No active ${layerName} video ended handler is available`);
    media.dispatchEvent(new Event('ended'));
  }, layer);
}

async function expectLayerVideoPlaying(page, layer, index) {
  await page.waitForFunction(({ layerName, expectedIndex }) => {
    const mediaSelector = layerName === 'playlist' ? '#playlist-layer video[src]' : '#slideshow-layer video[src]';
    return window.Blend?.transport === 'playing' &&
      window.Blend.state.runtime[`${layerName}Index`] === expectedIndex &&
      Array.from(document.querySelectorAll(mediaSelector)).some(element => !element.paused && element.currentTime > 0);
  }, { layerName: layer, expectedIndex: index }, { timeout: 15000 });
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
  await page.keyboard.press('Tab');
  await expect(slideshowOrder).toBeFocused();
  const cycleDescription = page.locator('#experience-random-cycle-help');
  await expect(cycleDescription).toBeVisible();
  await expect(cycleDescription).toContainText('each playable item plays once per cycle');
  await expect(cycleDescription).toContainText('After reload, a new cycle begins from the saved current item');
  for (const control of [playbackMode, endTarget, playlistOrder, slideshowOrder]) {
    await expect(control).toHaveAttribute('aria-describedby', 'experience-random-cycle-help');
  }

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
  await addUnavailableBoundaryReferences(page, 'playlist');
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
    playlistIndex: window.Blend.state.runtime.playlistIndex,
    playlistRefs: window.Blend.state.playlist.map(ref => ref.id),
    slideshowIndex: window.Blend.state.runtime.slideshowIndex,
    slideshowImageVisible: !!document.querySelector('#slideshow-layer img[src]'),
    transitionState: window.__endTargetTransition.playState,
    activeAnimations: document.querySelector('#slideshow-layer').getAnimations({ subtree: true }).length,
    transform: document.querySelector('#slideshow-layer img[src]')?.style.transform || ''
  }));
  expect(state.transport).toBe('stopped');
  expect(state.playlistIndex).toBe(1);
  expect(state.playlistRefs).toHaveLength(3);
  expect(state.playlistRefs[0]).toBe('playlist-unavailable-leading');
  expect(state.playlistRefs[1]).toBeTruthy();
  expect(state.playlistRefs[2]).toBe('playlist-unavailable-trailing');
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
  await addMixedSlideshowBoundaryReferences(page);
  await blendPage.playButton.click();
  await page.waitForFunction(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    const image = document.querySelector('#slideshow-layer img[src]');
    return window.Blend?.transport === 'playing' &&
      window.Blend.state.runtime.slideshowIndex === 1 &&
      video && image?.complete && image.naturalWidth > 0;
  });
  const playlistHadNotEnded = await page.evaluate(() => {
    const video = document.querySelector('#playlist-layer video[src]');
    return video.ended === false;
  });
  expect(playlistHadNotEnded).toBe(true);

  await page.waitForFunction(() => (
    window.Blend?.transport === 'playing' &&
    window.Blend.state.runtime.slideshowIndex === 3 &&
    document.querySelector('#slideshow-layer video[src]')
  ), null, { timeout: 10000 });
  await page.evaluate(() => {
    const video = document.querySelector('#slideshow-layer video[src]');
    if (!video?.onended) throw new Error('Slideshow video ended handler is unavailable');
    video.dispatchEvent(new Event('ended'));
  });
  await page.waitForFunction(() => window.Blend?.transport === 'stopped', null, { timeout: 10000 });

  const state = await page.evaluate(() => ({
    transport: window.Blend.transport,
    slideshowIndex: window.Blend.state.runtime.slideshowIndex,
    slideshowRefs: window.Blend.state.slideshow.map(ref => ref.id),
    slideshowTypes: window.Blend.state.slideshow.map(ref => window.Blend.state.library.get(ref.id)?.type || 'unavailable')
  }));
  expect(state.transport).toBe('stopped');
  expect(state.slideshowIndex).toBe(3);
  expect(state.slideshowRefs).toHaveLength(5);
  expect(state.slideshowRefs[0]).toBe('slideshow-unavailable-leading');
  expect(state.slideshowRefs[2]).toBe('slideshow-unavailable-middle');
  expect(state.slideshowRefs[4]).toBe('slideshow-unavailable-trailing');
  expect(state.slideshowTypes).toEqual(['unavailable', 'image', 'unavailable', 'video', 'unavailable']);
});

test('sequential Playlist visits every playable index before completing past trailing unavailable rows', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'playlist',
    slideshowDuration: 60
  });
  const saved = await page.evaluate(() => {
    const state = window.Blend.state;
    const playableRef = state.playlist[0];
    state.playlist = [
      { id: 'playlist-unavailable-leading', available: false },
      playableRef,
      { id: 'playlist-unavailable-middle', available: false },
      { ...playableRef },
      { id: 'playlist-unavailable-trailing', available: false }
    ];
    state.runtime.playlistIndex = 0;
    return window.Blend.saveStateNow();
  });
  expect(saved).toBe(true);

  await blendPage.playButton.click();
  await page.waitForFunction(() => (
    window.Blend?.transport === 'playing' &&
    window.Blend.state.runtime.playlistIndex === 1 &&
    Array.from(document.querySelectorAll('#playlist-layer video[src]')).some(video => !video.paused)
  ));
  await page.evaluate(() => {
    const video = Array.from(document.querySelectorAll('#playlist-layer video[src]'))
      .find(element => !element.paused);
    if (!video?.onended) throw new Error('Playlist ended handler is unavailable');
    video.dispatchEvent(new Event('ended'));
  });
  await page.waitForFunction(() => (
    window.Blend?.transport === 'playing' &&
    window.Blend.state.runtime.playlistIndex === 3 &&
    Array.from(document.querySelectorAll('#playlist-layer video[src]')).some(video => !video.paused)
  ));

  await page.evaluate(() => {
    const video = Array.from(document.querySelectorAll('#playlist-layer video[src]'))
      .find(element => !element.paused);
    if (!video?.onended) throw new Error('Final Playlist ended handler is unavailable');
    video.dispatchEvent(new Event('ended'));
  });
  await expect.poll(() => page.evaluate(() => window.Blend?.transport)).toBe('stopped');
  await expect(page.locator('#toast-container .toast').filter({ hasText: 'Experience finished' })).toHaveCount(1);
  expect(await page.evaluate(() => ({
    index: window.Blend.state.runtime.playlistIndex,
    refs: window.Blend.state.playlist.map(ref => ref.id),
    availableFlags: window.Blend.state.playlist.map(ref => ref.available)
  }))).toEqual({
    index: 3,
    refs: [
      'playlist-unavailable-leading',
      expect.any(String),
      'playlist-unavailable-middle',
      expect.any(String),
      'playlist-unavailable-trailing'
    ],
    availableFlags: [false, true, false, true, false]
  });
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

test('random Playlist end target stops after one cycle and leaves Slideshow visible', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'playlist',
    slideshowDuration: 60,
    playbackMode: 'stop',
    playlistOrder: 'random'
  });
  await duplicatePlayableLayerReferences(page, 'playlist');

  const mediaRequests = [];
  const signedUrlRequests = [];
  page.on('request', request => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.startsWith('/samples/')) mediaRequests.push(requestUrl.pathname);
    if (requestUrl.pathname.includes('/storage/v1/object/sign/')) signedUrlRequests.push(requestUrl.pathname);
  });

  await blendPage.playButton.click();
  await expectLayerVideoPlaying(page, 'playlist', 0);
  await expect.poll(() => page.evaluate(() => {
    const image = document.querySelector('#slideshow-layer img[src]');
    return !!image?.complete && image.naturalWidth > 0;
  })).toBe(true);

  await endActiveVideo(page, 'playlist');
  await expectLayerVideoPlaying(page, 'playlist', 1);
  expect(await page.evaluate(() => window.Blend.transport)).toBe('playing');
  expect(await page.evaluate(() => !!document.querySelector('#slideshow-layer img[src]'))).toBe(true);

  await page.evaluate(() => { window.__randomCycleBoundaryAt = performance.now(); });
  await endActiveVideo(page, 'playlist');
  await page.waitForFunction(() => window.Blend?.transport === 'stopped', null, { timeout: 15000 });
  await expect(page.getByRole('status').filter({ hasText: RANDOM_CYCLE_COMPLETION_COPY })).toHaveCount(1);
  expect(await page.evaluate(() => ({
    playlistIndex: window.Blend.state.runtime.playlistIndex,
    slideshowIndex: window.Blend.state.runtime.slideshowIndex,
    slideshowVisible: !!document.querySelector('#slideshow-layer img[src]')
  }))).toEqual({ playlistIndex: 1, slideshowIndex: 0, slideshowVisible: true });

  const requestCountAtStop = mediaRequests.length;
  await page.waitForFunction(() => performance.now() - window.__randomCycleBoundaryAt >= 1200, null, { timeout: 3000 });
  expect(mediaRequests).toHaveLength(requestCountAtStop);
  expect(signedUrlRequests).toEqual([]);
});

test('random Slideshow end target stops after one cycle and leaves Playlist visible', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'slideshow',
    slideshowDuration: 60,
    playbackMode: 'stop',
    playlistOrder: 'random',
    slideshowOrder: 'random'
  });
  await duplicatePlayableLayerReferences(page, 'playlist');
  await duplicatePlayableLayerReferences(page, 'slideshow', 'playlist');

  await blendPage.playButton.click();
  await expectLayerVideoPlaying(page, 'playlist', 0);
  await expectLayerVideoPlaying(page, 'slideshow', 0);
  await endActiveVideo(page, 'slideshow');
  await expectLayerVideoPlaying(page, 'slideshow', 1);
  expect(await page.evaluate(() => window.Blend.transport)).toBe('playing');

  await endActiveVideo(page, 'slideshow');
  await page.waitForFunction(() => window.Blend?.transport === 'stopped', null, { timeout: 15000 });
  await expect(page.getByRole('status').filter({ hasText: RANDOM_CYCLE_COMPLETION_COPY })).toHaveCount(1);
  expect(await page.evaluate(() => ({
    slideshowIndex: window.Blend.state.runtime.slideshowIndex,
    playlistIndex: window.Blend.state.runtime.playlistIndex,
    playlistVisible: !!document.querySelector('#playlist-layer video[src]')
  }))).toEqual({ slideshowIndex: 1, playlistIndex: expect.any(Number), playlistVisible: true });
});

test('Loop restarts a fresh random cycle after the end-target cycle finishes', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'playlist',
    slideshowDuration: 60,
    playbackMode: 'loop',
    playlistOrder: 'random'
  });
  await duplicatePlayableLayerReferences(page, 'playlist');
  await blendPage.playButton.click();
  await expectLayerVideoPlaying(page, 'playlist', 0);
  await endActiveVideo(page, 'playlist');
  await expectLayerVideoPlaying(page, 'playlist', 1);
  await endActiveVideo(page, 'playlist');
  await expectLayerVideoPlaying(page, 'playlist', 0);
  await expect(page.getByRole('status').filter({ hasText: RANDOM_CYCLE_COMPLETION_COPY })).toHaveCount(1);

  await endActiveVideo(page, 'playlist');
  await expectLayerVideoPlaying(page, 'playlist', 1);
  expect(await page.evaluate(() => window.Blend.transport)).toBe('playing');
});

test('Go to Next Experience waits for a full random end-target cycle', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'playlist',
    slideshowDuration: 60,
    playbackMode: 'next-experience',
    playlistOrder: 'random'
  });
  const firstExperienceName = await page.evaluate(() => window.Blend.state.projectName);
  const nextExperienceName = `Next random target ${createRunSuffix(testInfo)}`;
  await blendPage.createExperience(nextExperienceName);
  await blendPage.dropListFile('playlist', {
    name: 'next-random-playlist.txt',
    text: `${FIXTURE_ORIGIN}/samples/nyc-01.mp4\n`,
    expectedMinimumCount: 1
  });
  await blendPage.dropListFile('slideshow', {
    name: 'next-random-slideshow.txt',
    text: `${FIXTURE_ORIGIN}/samples/IL.jpeg\n`,
    expectedMinimumCount: 1
  });
  await blendPage.flushSaveState();
  await blendPage.switchExperience(firstExperienceName);
  await duplicatePlayableLayerReferences(page, 'playlist');

  await blendPage.playButton.click();
  await expectLayerVideoPlaying(page, 'playlist', 0);
  await endActiveVideo(page, 'playlist');
  await expectLayerVideoPlaying(page, 'playlist', 1);
  expect(await page.evaluate(() => window.Blend.state.projectName)).toBe(firstExperienceName);

  await endActiveVideo(page, 'playlist');
  await page.waitForFunction(expectedName => (
    window.Blend?.state?.projectName === expectedName &&
    window.Blend.transport === 'playing' &&
    document.querySelector('#playlist-layer video[src]') &&
    document.querySelector('#slideshow-layer img[src]')
  ), nextExperienceName, { timeout: 15000 });
});

test('manual Next at a random cycle boundary does not finish the experience', async ({ page }, testInfo) => {
  const blendPage = await setupTwoLayerPlayback(page, testInfo, {
    endTarget: 'playlist',
    slideshowDuration: 60,
    playbackMode: 'stop',
    playlistOrder: 'random'
  });
  await duplicatePlayableLayerReferences(page, 'playlist');
  await blendPage.playButton.click();
  await expectLayerVideoPlaying(page, 'playlist', 0);

  await page.locator('#btn-next').click();
  await expectLayerVideoPlaying(page, 'playlist', 1);
  await page.locator('#btn-next').click();
  await page.waitForFunction(() => window.Blend?.transport === 'playing', null, { timeout: 10000 });
  expect(await page.evaluate(() => [0, 1].includes(window.Blend.state.runtime.playlistIndex))).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: RANDOM_CYCLE_COMPLETION_COPY })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Experience finished' })).toHaveCount(0);
});
