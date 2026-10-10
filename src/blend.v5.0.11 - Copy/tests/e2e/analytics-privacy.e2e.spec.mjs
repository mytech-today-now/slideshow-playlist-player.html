import { test, expect } from '@playwright/test';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

const MOCK_GTAG_LOADER = `
  window.__analyticsMockCalls = [];
  const originalGtag = window.gtag;
  window.gtag = function (...args) {
    window.__analyticsMockCalls.push(args);
    if (args[0] === 'event') {
      const payload = JSON.stringify({ eventName: args[1], params: args[2] || {} });
      void fetch('/__analytics_capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload
      }).catch(() => {});
    }
    return originalGtag.apply(this, args);
  };
`;

async function preparePage(page, { doNotTrack = null, globalPrivacyControl = false } = {}) {
  await page.addInitScript(({ fixtureOrigin, dntValue, gpcValue }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '1');
    if (dntValue !== null) {
      Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: dntValue });
    }
    if (gpcValue) {
      Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    }
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener() {},
        async register() { throw new Error('Service worker disabled for analytics request interception.'); }
      }
    });
    const runtimeConfigKey = 'blend-runtime-config-v1';
    try {
      const existing = JSON.parse(localStorage.getItem(runtimeConfigKey) || '{}');
      localStorage.setItem(runtimeConfigKey, JSON.stringify({
        ...existing,
        SUPABASE_URL: fixtureOrigin,
        SUPABASE_AUTH_REDIRECT_URL: `${fixtureOrigin}/index.html`,
        SUPABASE_MEDIA_BUCKET: 'media',
        SUPABASE_PUBLIC_BUCKETS: 'public'
      }));
    } catch (_) {}
  }, {
    fixtureOrigin: FIXTURE_ORIGIN,
    dntValue: doNotTrack,
    gpcValue: globalPrivacyControl
  });
}

async function installAnalyticsInterceptors(page) {
  const events = [];
  const loaderRequests = [];
  await page.route('https://www.googletagmanager.com/gtag/js*', async route => {
    loaderRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK_GTAG_LOADER });
  });
  await page.route('**/__analytics_capture', async route => {
    const body = route.request().postData() || '{}';
    events.push(JSON.parse(body));
    await route.fulfill({ status: 204, body: '' });
  });
  return { events, loaderRequests };
}

test('consented browser capture contains only allowlisted analytics parameters', async ({ page }) => {
  const { events, loaderRequests } = await installAnalyticsInterceptors(page);
  await page.route('**/samples/PRIVATE-FILE-BETA.png*', route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P8z8DwHwAFgwJ/l7h5WQAAAABJRU5ErkJggg==', 'base64')
  }));
  await preparePage(page);
  await page.goto('/index.html');
  await expect(page.locator('#analytics-consent-status')).toHaveText('Analytics is enabled.');
  await expect.poll(() => events.some(event => event.eventName === 'page_view')).toBe(true);
  expect(loaderRequests).toHaveLength(1);
  expect(await page.evaluate(fixtureOrigin => window.__analyticsMockCalls.find(call => call[0] === 'config')?.[2], FIXTURE_ORIGIN)).toMatchObject({
    page_title: 'Blend Player',
    page_location: `${FIXTURE_ORIGIN}/`,
    page_referrer: `${FIXTURE_ORIGIN}/`
  });

  const localMediaUrl = `${FIXTURE_ORIGIN}/samples/PRIVATE-FILE-BETA.png?source=LOCAL-PATH-OMEGA`;
  await page.evaluate(({ localMediaUrl }) => {
    const state = window.Blend.state;
    const mediaId = 'PRIVATE-MEDIA-ID-GAMMA';
    state.projectName = 'PRIVATE-EXPERIENCE-ALPHA';
    state.activeExperienceId = 'PRIVATE-EXPERIENCE-ID-DELTA';
    state.library.set(mediaId, {
      id: mediaId,
      name: 'PRIVATE-FILE-BETA',
      type: 'image',
      path: localMediaUrl,
      sourceUrl: localMediaUrl,
      metadata: { privateLabel: 'PRIVATE-METADATA-EPSILON' }
    });
    state.playlist = [];
    state.slideshow = [{
      id: mediaId,
      name: 'PRIVATE-FILE-BETA',
      type: 'image',
      path: localMediaUrl,
      sourceUrl: localMediaUrl,
      available: true,
      displayDuration: 60
    }];
    state.runtime.playlistIndex = 0;
    state.runtime.slideshowIndex = 0;
    window.Blend.renderLibrary();
    window.Blend.renderListEditor();
  }, { localMediaUrl });

  await page.evaluate(() => window.Blend.play());
  await expect.poll(() => events.some(event => event.eventName === 'experience_play')).toBe(true);
  await page.evaluate(() => window.Blend.shareContextByMethod('copy'));
  await expect.poll(() => events.filter(event => ['share', 'experience_share'].includes(event.eventName)).length).toBe(2);

  const pageView = events.find(event => event.eventName === 'page_view');
  const playback = events.find(event => event.eventName === 'experience_play');
  const share = events.find(event => event.eventName === 'experience_share');
  expect(pageView.params).toEqual({});
  expect(playback.params).toEqual({ media_type: 'image', media_layer: 'slideshow' });
  expect(share.params).toMatchObject({ method: 'copy', action_outcome: expect.stringMatching(/^(success|failure)$/) });
  expect(JSON.stringify(events)).not.toMatch(/PRIVATE-|LOCAL-PATH-OMEGA|127\.0\.0\.1|page_(?:title|location|path)|(?:experience|media)_(?:name|id)/i);
  for (const event of events) {
    expect(Object.keys(event.params).every(key => [
      'media_type', 'media_layer', 'method', 'action_outcome'
    ].includes(key))).toBe(true);
  }
});

test('DNT and GPC keep consented analytics off with no intercepted requests', async ({ context }) => {
  const dntPage = await context.newPage();
  const gpcPage = await context.newPage();
  const dntCapture = await installAnalyticsInterceptors(dntPage);
  const gpcCapture = await installAnalyticsInterceptors(gpcPage);
  await preparePage(dntPage, { doNotTrack: '1' });
  await preparePage(gpcPage, { globalPrivacyControl: true });

  await dntPage.goto('/index.html');
  await gpcPage.goto('/index.html');
  for (const blockedPage of [dntPage, gpcPage]) {
    await expect(blockedPage.locator('#analytics-consent-status')).toHaveText(
      'Analytics is off because a browser privacy setting or local-file mode blocks it.'
    );
    await blockedPage.locator('#config-gear').click();
    await expect(blockedPage.locator('#btn-play')).toBeVisible();
    expect(await blockedPage.evaluate(() => typeof window.gtag)).toBe('undefined');
  }
  expect(dntCapture.loaderRequests).toHaveLength(0);
  expect(dntCapture.events).toHaveLength(0);
  expect(gpcCapture.loaderRequests).toHaveLength(0);
  expect(gpcCapture.events).toHaveLength(0);
  await dntPage.close();
  await gpcPage.close();
});
