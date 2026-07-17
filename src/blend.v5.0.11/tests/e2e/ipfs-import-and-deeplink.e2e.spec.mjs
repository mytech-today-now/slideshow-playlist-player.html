import { test, expect } from '@playwright/test';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

function buildSharedExperiencePayload() {
  const createdAt = '2026-06-22T00:00:00.000Z';
  const playlistUrl = `${FIXTURE_ORIGIN}/samples/nyc-01.mp4`;
  const slideshowUrl = `${FIXTURE_ORIGIN}/samples/IL.jpeg`;
  return {
    schema: 'player.blend.experience.v2',
    type: 'experience',
    id: 'exp-shared-supabase-e2e',
    name: 'Shared Supabase Experience',
    exportedAt: createdAt,
    settings: {
      resumeOnLoad: false,
      playbackModePlaylist: 'sequential',
      playbackModeSlideshow: 'sequential'
    },
    playlist: {
      type: 'playlist',
      name: 'Playlist',
      description: '',
      createdAt,
      order: ['playlist-item-1'],
      items: [
        {
          id: 'playlist-item-1',
          path: playlistUrl,
          sourceUrl: playlistUrl,
          name: 'nyc-01.mp4',
          type: 'video',
          available: true,
          order: 0
        }
      ]
    },
    slideshow: {
      type: 'slideshow',
      name: 'Slideshow',
      description: '',
      createdAt,
      order: ['slideshow-item-1'],
      items: [
        {
          id: 'slideshow-item-1',
          path: slideshowUrl,
          sourceUrl: slideshowUrl,
          name: 'IL.jpeg',
          type: 'image',
          displayDuration: 4,
          available: true,
          order: 0
        }
      ]
    }
  };
}

async function boot(page, url = '/index.html') {
  await page.addInitScript(({ fixtureOrigin }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
    const runtimeConfigKey = 'blend-runtime-config-v1';
    try {
      const existingRaw = localStorage.getItem(runtimeConfigKey);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      localStorage.setItem(runtimeConfigKey, JSON.stringify({
        ...existing,
        SUPABASE_URL: fixtureOrigin,
        SUPABASE_AUTH_REDIRECT_URL: `${fixtureOrigin}/index.html`,
        SUPABASE_MEDIA_BUCKET: 'media',
        SUPABASE_PUBLIC_BUCKETS: 'public'
      }));
    } catch (_) {}
  }, { fixtureOrigin: FIXTURE_ORIGIN });
  await page.goto(url);
  await page.waitForFunction(() => !!window.Blend && !!window.Blend.state);
}

test('imports a shared experience from a direct storageExperience URL', async ({ page }) => {
  const sharedPayload = buildSharedExperiencePayload();
  const sharedUrl = `${FIXTURE_ORIGIN}/e2e/shared-experience.v2.json`;
  await page.route(sharedUrl, async route => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(sharedPayload)
    });
  });

  await boot(page, `/index.html?storageExperience=${encodeURIComponent(sharedUrl)}`);
  await page.waitForFunction(
    expectedName => (window.Blend?.state?.experiences || []).some(exp => exp?.name === expectedName),
    sharedPayload.name
  );

  const summary = await page.evaluate(() => {
    const state = window.Blend?.state;
    const active = (state?.experiences || []).find(exp => exp?.id === state?.activeExperienceId) || null;
    const playlistRef = state?.playlist?.[0] || null;
    const slideshowRef = state?.slideshow?.[0] || null;
    return {
      activeName: active?.name || '',
      playlistCount: state?.playlist?.length || 0,
      slideshowCount: state?.slideshow?.length || 0,
      playlistSource: playlistRef?.sourceUrl || playlistRef?.path || '',
      slideshowSource: slideshowRef?.sourceUrl || slideshowRef?.path || ''
    };
  });

  expect(summary.activeName).toBe(sharedPayload.name);
  expect(summary.playlistCount).toBeGreaterThanOrEqual(1);
  expect(summary.slideshowCount).toBeGreaterThanOrEqual(1);
  expect(summary.playlistSource).toContain('/samples/nyc-01.mp4');
  expect(summary.slideshowSource).toContain('/samples/IL.jpeg');
});

test('builds a storageExperience share URL from a Supabase reference', async ({ page }) => {
  await boot(page);
  const storageReference = 'supabase://public/e2e/shared-experience.v2.json';
  const builtUrl = await page.evaluate(reference => {
    return window.Blend?.buildIpfsExperienceShareUrl(reference) || '';
  }, storageReference);
  expect(builtUrl).toContain('storageExperience=');
  expect(builtUrl).toContain(encodeURIComponent(storageReference));
});

test('reports a readable error when shared experience fetch fails', async ({ page }) => {
  const missingUrl = `${FIXTURE_ORIGIN}/e2e/missing-experience.json`;
  await page.route(missingUrl, async route => {
    await route.fulfill({
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: 'not found'
    });
  });

  await boot(page, `/index.html?storageExperience=${encodeURIComponent(missingUrl)}`);
  await expect(page.locator('#toast-container')).toContainText('Could not fetch shared experience (404)');
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
      sourceUrl: `${base}/icon.svg`,
      pathHint: `${base}/icon.svg`,
      addedAt: now,
      lastVerified: now
    });
    Blend.state.library.set(secondId, {
      id: secondId,
      ...common,
      name: 'city-b.svg',
      type: 'image',
      sourceUrl: `${base}/icon-maskable.svg`,
      pathHint: `${base}/icon-maskable.svg`,
      addedAt: now + 1,
      lastVerified: now + 1
    });

    Blend.state.slideshow.push({
      id: firstId,
      addedAt: now,
      path: `${base}/icon.svg`,
      name: 'city-a.svg',
      type: 'image',
      sourceUrl: `${base}/icon.svg`,
      available: true,
      displayDuration: 60
    });
    Blend.state.slideshow.push({
      id: secondId,
      addedAt: now + 1,
      path: `${base}/icon-maskable.svg`,
      name: 'city-b.svg',
      type: 'image',
      sourceUrl: `${base}/icon-maskable.svg`,
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

  const deepLinkUrl = new URL(seeded.deepLink);
  deepLinkUrl.searchParams.set('autoplay', '1');
  await page.goto(deepLinkUrl.toString());
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
