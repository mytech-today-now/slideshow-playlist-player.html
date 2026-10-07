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

async function saveResumeSession(page, { enabled = true, missingPlaylist = false, expiredUrl = '' } = {}) {
  return page.evaluate(async options => {
    const state = window.Blend.state;
    const firstRef = state.playlist[0];
    const firstItem = state.library.get(firstRef.id);
    const secondId = `resume-second-${Date.now()}`;
    const secondSource = options.expiredUrl || firstItem.sourceUrl;
    state.library.set(secondId, {
      ...firstItem,
      id: secondId,
      name: options.expiredUrl ? 'expired.mp4' : 'nyc-01-second.mp4',
      pathHint: options.expiredUrl ? 'expired.mp4' : 'nyc-01-second.mp4',
      sourceUrl: secondSource,
      stale: false
    });
    state.playlist.push({ ...firstRef, id: secondId, sourceUrl: secondSource });
    state.runtime.playlistIndex = 1;
    state.runtime.slideshowIndex = 1;
    state.runtime.historyPlaylist = [0];
    state.runtime.historySlideshow = [0];
    state.settings.resumeOnLoad = options.enabled;
    state.settings.resumeOnLoadExplicit = true;
    document.querySelector('#resume-on-load').checked = options.enabled;
    if (options.missingPlaylist) state.library.delete(secondId);
    return await window.Blend.saveStateNow();
  }, { enabled, missingPlaylist, expiredUrl });
}

async function resumePlaybackState(page) {
  return page.evaluate(() => {
    const state = window.Blend.state;
    const playlistItem = state.library.get(state.playlist[1]?.id);
    return {
      transport: window.Blend.transport,
      isPlaying: state.runtime.isPlaying,
      playlistIndex: state.runtime.playlistIndex,
      slideshowIndex: state.runtime.slideshowIndex,
      historyPlaylist: [...state.runtime.historyPlaylist],
      historySlideshow: [...state.runtime.historySlideshow],
      playlistLength: state.playlist.length,
      slideshowLength: state.slideshow.length,
      playlistCurrentItemId: state.playlist[state.runtime.playlistIndex]?.id || '',
      playlistItemRetained: !!playlistItem,
      playlistItemSourceUrl: playlistItem?.sourceUrl || '',
      playButtonText: document.querySelector('#btn-play')?.textContent || '',
      playButtonLabel: document.querySelector('#btn-play')?.getAttribute('aria-label') || '',
      resumeChecked: !!document.querySelector('#resume-on-load')?.checked,
      resumeExplicit: state.settings.resumeOnLoadExplicit === true,
      playlistVideoSrc: Array.from(document.querySelectorAll('#playlist-layer video')).find(video => video.getAttribute('src'))?.src || '',
      playlistVideoPaused: Array.from(document.querySelectorAll('#playlist-layer video')).find(video => video.getAttribute('src'))?.paused ?? null,
      slideshowImageSrc: document.querySelector('#slideshow-layer img[src]')?.src || '',
      resumeNotice: document.querySelector('.toast-resume-on-load')?.textContent || '',
      mediaPlayCalls: window.__resumePlayCallCount ?? null,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
    };
  });
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

test('enabled resume restores both saved indices paused and survives autoplay rejection', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const blendPage = await buildVideoExperience(page, testInfo);
  await blendPage.openConfig();
  await page.locator('#resume-on-load').check();
  await blendPage.closeConfig();
  expect(await saveResumeSession(page)).toBe(true);

  await page.addInitScript(() => {
    const prototype = HTMLMediaElement.prototype;
    const originalPlay = prototype.play;
    window.__resumePlayCallCount = 0;
    window.__resumeCountingPlay = function (...args) {
      window.__resumePlayCallCount += 1;
      return originalPlay.apply(this, args);
    };
    prototype.play = window.__resumeCountingPlay;
  });
  await page.reload();
  await page.waitForFunction(() => window.Blend?.transport === 'paused' && !!document.querySelector('.toast-resume-on-load'));

  let restored = await resumePlaybackState(page);
  expect(restored.transport).toBe('paused');
  expect(restored.isPlaying).toBe(false);
  expect(restored.playlistIndex).toBe(1);
  expect(restored.slideshowIndex).toBe(1);
  expect(restored.historyPlaylist).toEqual([0]);
  expect(restored.historySlideshow).toEqual([0]);
  expect(restored.playlistLength).toBe(2);
  expect(restored.slideshowLength).toBe(2);
  expect(restored.playlistVideoSrc).toContain('/samples/nyc-01.mp4');
  expect(restored.playlistVideoPaused).toBe(true);
  expect(restored.slideshowImageSrc).toContain('/samples/blotter-01.png');
  expect(restored.playButtonText).toBe('▶');
  expect(restored.playButtonLabel).toBe('Play');
  expect(restored.resumeChecked).toBe(true);
  expect(restored.resumeExplicit).toBe(true);
  expect(restored.resumeNotice).toBe('Your last session is ready. Select Play to resume.');
  expect(restored.mediaPlayCalls).toBe(0);
  expect(restored.reducedMotion).toBe(true);

  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(new DOMException('Playback requires a user gesture', 'NotAllowedError'));
    };
  });
  await blendPage.playButton.click();
  await page.waitForFunction(() => window.Blend?.transport === 'paused' && /Your last session is ready\. Select Play to resume\./.test(document.querySelector('.toast-resume-on-load')?.textContent || ''));
  restored = await resumePlaybackState(page);
  expect(restored.playlistIndex).toBe(1);
  expect(restored.slideshowIndex).toBe(1);
  expect(restored.playlistLength).toBe(2);
  expect(restored.slideshowLength).toBe(2);
  expect(restored.playButtonText).toBe('▶');

  await page.evaluate(() => { HTMLMediaElement.prototype.play = window.__resumeCountingPlay; });
  await page.locator('#viewport').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.Blend?.transport === 'playing', null, { timeout: 8000 });
  expect(await page.evaluate(() => window.Blend?.state?.runtime?.playlistIndex)).toBe(1);
});

test('disabled resume keeps the saved indices stopped without loading media', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildVideoExperience(page, testInfo);
  await expect(page.locator('#resume-on-load')).not.toBeChecked();
  expect(await saveResumeSession(page, { enabled: false })).toBe(true);

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  const restored = await resumePlaybackState(page);
  expect(restored.transport).toBe('stopped');
  expect(restored.isPlaying).toBe(false);
  expect(restored.playlistIndex).toBe(1);
  expect(restored.slideshowIndex).toBe(1);
  expect(restored.playlistLength).toBe(2);
  expect(restored.slideshowLength).toBe(2);
  expect(restored.playlistVideoSrc).toBe('');
  expect(restored.slideshowImageSrc).toBe('');
  expect(restored.playButtonText).toBe('▶');
  expect(restored.playButtonLabel).toBe('Play');
  expect(restored.resumeChecked).toBe(false);
  expect(restored.resumeNotice).toBe('');
});

test('missing saved media reports the playlist layer and retains its list entry', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildVideoExperience(page, testInfo);
  expect(await saveResumeSession(page, { missingPlaylist: true })).toBe(true);

  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('.toast-resume-on-load'));
  const restored = await resumePlaybackState(page);
  expect(restored.transport).toBe('paused');
  expect(restored.playlistIndex).toBe(1);
  expect(restored.slideshowIndex).toBe(1);
  expect(restored.playlistLength).toBe(2);
  expect(restored.playlistItemRetained).toBe(false);
  expect(restored.playlistCurrentItemId).not.toBe('');
  expect(restored.slideshowImageSrc).toContain('/samples/blotter-01.png');
  expect(restored.resumeNotice).toContain('playlist media could not be restored');
  expect(restored.resumeNotice).toContain('saved lists are intact');
});

test('expired remote media fails only its layer and preserves the saved playlist', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildVideoExperience(page, testInfo);
  const expiredUrl = `${FIXTURE_ORIGIN}/samples/expired.mp4?token=expired`;
  await page.route('**/samples/expired.mp4*', route => route.fulfill({ status: 403, contentType: 'video/mp4', body: '' }));
  expect(await saveResumeSession(page, { expiredUrl })).toBe(true);

  await page.reload();
  await page.waitForFunction(() => /playlist media could not be restored/.test(document.querySelector('.toast-resume-on-load')?.textContent || ''), null, { timeout: 20000 });
  const restored = await resumePlaybackState(page);
  expect(restored.transport).toBe('paused');
  expect(restored.playlistIndex).toBe(1);
  expect(restored.slideshowIndex).toBe(1);
  expect(restored.playlistLength).toBe(2);
  expect(restored.playlistItemRetained).toBe(true);
  expect(restored.playlistCurrentItemId).not.toBe('');
  expect(restored.playlistItemSourceUrl).toContain('/samples/expired.mp4');
  expect(restored.slideshowImageSrc).toContain('/samples/blotter-01.png');
  expect(restored.resumeNotice).toContain('playlist media could not be restored');
  expect(restored.resumeNotice).toContain('saved lists are intact');
});

test('touch help is truthful and supported navigation controls stay accessible', async ({ browser }, testInfo) => {
  test.setTimeout(90000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });

  try {
    const page = await context.newPage();
    await buildVideoExperience(page, testInfo);
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press('?');
    const help = page.locator('#help-modal');
    await expect(help).toBeVisible();
    const helpText = await help.locator('.modal-body').innerText();
    expect(helpText).toContain('Swipe gestures are unavailable. Use the Previous and Next buttons or keyboard arrows.');
    expect(helpText).toContain('Adjust blend opacity with the Blend slider.');
    expect(helpText).not.toMatch(/Swipe\s*(?:←|↑|→|↓|left|right|up|down)/i);
    await page.keyboard.press('Escape');

    const previous = page.getByRole('button', { name: 'Previous item' });
    const next = page.getByRole('button', { name: 'Next item' });
    const blend = page.getByRole('slider', { name: 'Blend opacity' });
    await expect(previous).toBeVisible();
    await expect(next).toBeVisible();
    await expect(blend).toBeVisible();

    const expectNavigationChange = async action => {
      const before = await page.evaluate(() => ({
        playlistIndex: window.Blend.state.runtime.playlistIndex,
        slideshowIndex: window.Blend.state.runtime.slideshowIndex
      }));
      await action();
      await expect.poll(() => page.evaluate(() => ({
        playlistIndex: window.Blend.state.runtime.playlistIndex,
        slideshowIndex: window.Blend.state.runtime.slideshowIndex
      }))).not.toEqual(before);
    };

    await expectNavigationChange(() => next.tap());

    await page.setViewportSize({ width: 844, height: 390 });
    const landscapeWidth = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    expect(landscapeWidth.document).toBeLessThanOrEqual(landscapeWidth.viewport + 2);
    await expectNavigationChange(() => previous.tap());

    await blend.focus();
    const startingBlend = Number(await blend.inputValue());
    await page.keyboard.press('ArrowRight');
    await expect(blend).toHaveValue(String(startingBlend + 1));

    await page.evaluate(() => document.body.focus());
    await expectNavigationChange(() => page.keyboard.press('ArrowRight'));
    await expectNavigationChange(() => page.keyboard.press('ArrowLeft'));
  } finally {
    await context.close();
  }
});

test('layer order controls persist and random navigation uses per-layer history', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildVideoExperience(page, testInfo);
  const originalExperienceId = await page.evaluate(() => window.Blend.state.activeExperienceId);

  await page.evaluate(() => {
    const state = window.Blend.state;
    const sourceRef = state.playlist[0];
    const sourceItem = state.library.get(sourceRef.id);
    for (let copy = 0; copy < 2; copy++) {
      const id = `playback-mode-copy-${copy}-${Date.now()}`;
      state.library.set(id, { ...sourceItem, id, name: `copy-${copy}.mp4`, pathHint: `copy-${copy}.mp4` });
      state.playlist.push({ ...sourceRef, id });
    }
    state.settings.defaultImageDuration = 300;
    state.slideshow.forEach(ref => { ref.displayDuration = 300; });
    state.runtime.playlistIndex = 0;
    state.runtime.slideshowIndex = 0;
    state.runtime.historyPlaylist = [];
    state.runtime.historySlideshow = [];
  });
  await page.evaluate(() => window.Blend.saveStateNow());

  await blendPage.openConfig();
  const playlistOrder = page.getByRole('combobox', { name: 'Playlist order' });
  const slideshowOrder = page.getByRole('combobox', { name: 'Slideshow order' });
  await expect(playlistOrder).toHaveValue('sequential');
  await expect(slideshowOrder).toHaveValue('sequential');

  await page.getByRole('combobox', { name: 'Experience playback mode' }).focus();
  await page.keyboard.press('Tab');
  await expect(playlistOrder).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(playlistOrder).toHaveValue('random');
  await page.keyboard.press('Tab');
  await expect(slideshowOrder).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(slideshowOrder).toHaveValue('random');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(playlistOrder).toBeVisible();
  await expect(slideshowOrder).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  await page.setViewportSize({ width: 1366, height: 900 });

  await page.evaluate(() => window.Blend.saveStateNow());
  const alternateName = `Mode switch ${createRunSuffix(testInfo)}`;
  await blendPage.createExperience(alternateName);
  await page.getByRole('combobox', { name: 'Playlist order' }).selectOption('sequential');
  await page.getByRole('combobox', { name: 'Slideshow order' }).selectOption('sequential');
  await page.evaluate(() => window.Blend.saveStateNow());
  await page.evaluate(async id => {
    await window.Blend.switchExperienceById(id);
    return true;
  }, originalExperienceId);
  await expect(playlistOrder).toHaveValue('random');
  await expect(slideshowOrder).toHaveValue('random');
  await page.evaluate(() => window.Blend.saveStateNow());

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await blendPage.openConfig();
  await expect(page.getByRole('combobox', { name: 'Playlist order' })).toHaveValue('random');
  await expect(page.getByRole('combobox', { name: 'Slideshow order' })).toHaveValue('random');
  await blendPage.closeConfig();

  await page.evaluate(() => {
    const state = window.Blend.state;
    state.playlist[1].available = false;
    state.playlist[1].retryAfter = Date.now() + 60000;
    state.runtime.playlistIndex = 0;
    state.runtime.slideshowIndex = 0;
    state.runtime.historyPlaylist = [];
    state.runtime.historySlideshow = [];
  });
  await page.locator('#btn-next').click();
  await expect.poll(() => page.evaluate(() => window.Blend.state.runtime.playlistIndex)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.Blend.state.runtime.slideshowIndex)).not.toBe(0);
  await expect.poll(() => page.evaluate(() => window.Blend.state.runtime.historyPlaylist.at(-1))).toBe(0);
  await expect.poll(() => page.evaluate(() => window.Blend.state.runtime.historySlideshow.at(-1))).toBe(0);

  await page.locator('#btn-prev').click();
  await expect.poll(() => page.evaluate(() => ({
    playlistIndex: window.Blend.state.runtime.playlistIndex,
    slideshowIndex: window.Blend.state.runtime.slideshowIndex
  }))).toEqual({ playlistIndex: 0, slideshowIndex: 0 });
  await expect.poll(() => page.evaluate(() => [
    window.Blend.state.runtime.historyPlaylist.length,
    window.Blend.state.runtime.historySlideshow.length
  ])).toEqual([0, 0]);

  await page.locator('#btn-stop').click();
  await page.evaluate(() => {
    const state = window.Blend.state;
    state.playlist.splice(1);
    state.slideshow.splice(1);
    state.runtime.playlistIndex = 0;
    state.runtime.slideshowIndex = 0;
    state.runtime.historyPlaylist = [];
    state.runtime.historySlideshow = [];
  });
  await page.locator('#btn-next').click();
  await expect.poll(() => page.evaluate(() => ({
    playlistIndex: window.Blend.state.runtime.playlistIndex,
    slideshowIndex: window.Blend.state.runtime.slideshowIndex,
    playlistHistory: window.Blend.state.runtime.historyPlaylist,
    slideshowHistory: window.Blend.state.runtime.historySlideshow
  }))).toEqual({ playlistIndex: 0, slideshowIndex: 0, playlistHistory: [0], slideshowHistory: [0] });
});

test('old experience schema without layer order fields imports as sequential', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildVideoExperience(page, testInfo);
  const oldName = `Legacy order ${createRunSuffix(testInfo)}`;
  const payload = {
    type: 'experience',
    schema: 'player.blend.experience.v1',
    name: oldName,
    settings: { defaultImageDuration: 5 },
    playlist: { type: 'playlist', items: [] },
    slideshow: { type: 'slideshow', items: [] }
  };

  await blendPage.openConfig();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#experience-import').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'legacy-experience.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload))
  });
  await page.waitForFunction(name => window.Blend?.state?.projectName === name, oldName);
  await expect(page.getByRole('combobox', { name: 'Playlist order' })).toHaveValue('sequential');
  await expect(page.getByRole('combobox', { name: 'Slideshow order' })).toHaveValue('sequential');
  expect(await page.evaluate(() => ({
    playlist: window.Blend.state.settings.playbackModePlaylist,
    slideshow: window.Blend.state.settings.playbackModeSlideshow
  }))).toEqual({ playlist: 'sequential', slideshow: 'sequential' });
});
