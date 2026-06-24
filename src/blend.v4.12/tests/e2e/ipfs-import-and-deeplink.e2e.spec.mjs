import { test, expect } from '@playwright/test';

const SHARED_MANIFEST_CID = 'bafybeiab47tncsmv4ystfwwh3zujdipnfmgporoahsppz6g22t7uifpfqe';
const SHARED_IMAGE_CID = 'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const FIXTURE_PORT = String(process.env.PLAYWRIGHT_PORT || '4191');

async function boot(page, url = '/index.html') {
  await page.addInitScript(() => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
  });
  await page.goto(url);
  await page.waitForFunction(() => !!window.Blend && !!window.Blend.state);
}

test('imports a shared IPFS experience from URL parameters', async ({ page }) => {
  const gateway = encodeURIComponent(`http://127.0.0.1:${FIXTURE_PORT}/ipfs/`);
  await boot(page, `/index.html?ipfsMode=gateway&ipfsExperience=${SHARED_MANIFEST_CID}&ipfsGateway=${gateway}`);

  await page.waitForFunction(() => {
    const experiences = window.Blend?.state?.experiences || [];
    return experiences.some(exp => exp?.name === 'Shared NYC Experience');
  });

  const summary = await page.evaluate(({ sharedImageCid }) => {
    const { state } = window.Blend;
    const active = state.experiences.find(exp => exp.id === state.activeExperienceId) || null;
    const imageItem = Array.from(state.library.values()).find(item => item?.metadata?.ipfs?.cid) || null;
    const remoteVideo = Array.from(state.library.values()).find(item => /nyc-01\.mp4$/i.test(item?.sourceUrl || '')) || null;
    return {
      activeName: active?.name || '',
      playlistCount: state.playlist.length,
      slideshowCount: state.slideshow.length,
      hasImageFromIpfs: imageItem?.metadata?.ipfs?.cid === sharedImageCid,
      imageManifestCid: imageItem?.metadata?.ipfs?.manifestCid || '',
      hasRemoteVideo: !!remoteVideo
    };
  }, { sharedImageCid: SHARED_IMAGE_CID });

  expect(summary.activeName).toBe('Shared NYC Experience');
  expect(summary.playlistCount).toBe(1);
  expect(summary.slideshowCount).toBe(1);
  expect(summary.hasImageFromIpfs).toBeTruthy();
  expect(summary.imageManifestCid).toBe(SHARED_MANIFEST_CID);
  expect(summary.hasRemoteVideo).toBeTruthy();
});

test('restores deep-link playback state with autoplay enabled', async ({ page }) => {
  await boot(page);

  const seeded = await page.evaluate(async () => {
    const { Blend } = window;
    const now = Date.now();
    const base = window.location.origin;
    const firstId = `deep-link-a-${now}`;
    const secondId = `deep-link-b-${now}`;
    const activeExperienceId = Blend.state.activeExperienceId;

    Blend.state.library.clear();
    Blend.state.playlist = [];
    Blend.state.slideshow = [];
    Blend.state.ui.activeList = 'playlist';
    Blend.state.runtime.playlistIndex = 0;
    Blend.state.runtime.slideshowIndex = 0;
    Blend.state.runtime.isPlaying = false;

    const common = {
      handle: { remote: true },
      stale: false,
      metadata: {},
      size: 0,
      duration: 0
    };

    Blend.state.library.set(firstId, {
      id: firstId,
      ...common,
      name: 'city-a.svg',
      type: 'image',
      sourceUrl: `${base}/assets/icon.svg`,
      pathHint: `${base}/assets/icon.svg`,
      addedAt: now,
      lastVerified: now
    });
    Blend.state.library.set(secondId, {
      id: secondId,
      ...common,
      name: 'city-b.svg',
      type: 'image',
      sourceUrl: `${base}/assets/icon-maskable.svg`,
      pathHint: `${base}/assets/icon-maskable.svg`,
      addedAt: now + 1,
      lastVerified: now + 1
    });

    Blend.state.slideshow.push({
      id: firstId,
      addedAt: now,
      path: `${base}/assets/icon.svg`,
      name: 'city-a.svg',
      type: 'image',
      sourceUrl: `${base}/assets/icon.svg`,
      available: true,
      displayDuration: 60
    });
    Blend.state.slideshow.push({
      id: secondId,
      addedAt: now + 1,
      path: `${base}/assets/icon-maskable.svg`,
      name: 'city-b.svg',
      type: 'image',
      sourceUrl: `${base}/assets/icon-maskable.svg`,
      available: true,
      displayDuration: 60
    });

    Blend.renderLibrary();
    Blend.renderListEditor();
    await Blend.saveStateNow();

    return {
      activeExperienceId,
      targetItemId: secondId,
      deepLink: Blend.buildDeepLinkUrl({
        experienceId: activeExperienceId,
        layer: 'slideshow',
        itemId: secondId
      })
    };
  });

  await page.goto(`${seeded.deepLink}&autoplay=1`);
  await page.waitForFunction(() => !!window.Blend && !!window.Blend.state);

  await page.waitForFunction(({ expId, itemId }) => {
    if (!window.Blend?.state) return false;
    const { state } = window.Blend;
    const current = state.slideshow[state.runtime.slideshowIndex];
    return state.activeExperienceId === expId &&
      state.ui.activeList === 'slideshow' &&
      state.runtime.isPlaying === true &&
      current?.id === itemId;
  }, { expId: seeded.activeExperienceId, itemId: seeded.targetItemId });

  const restored = await page.evaluate(() => {
    const { state } = window.Blend;
    const current = state.slideshow[state.runtime.slideshowIndex] || null;
    return {
      activeExperienceId: state.activeExperienceId,
      activeList: state.ui.activeList,
      slideshowIndex: state.runtime.slideshowIndex,
      isPlaying: state.runtime.isPlaying,
      currentItemId: current?.id || '',
      playButtonText: document.querySelector('#btn-play')?.textContent || ''
    };
  });

  expect(restored.activeExperienceId).toBe(seeded.activeExperienceId);
  expect(restored.activeList).toBe('slideshow');
  expect(restored.slideshowIndex).toBe(1);
  expect(restored.isPlaying).toBeTruthy();
  expect(restored.currentItemId).toBe(seeded.targetItemId);
  expect(restored.playButtonText).toBe('⏸');
});
