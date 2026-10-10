import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

const MOCK_GTAG_LOADER = [
  'window.__analyticsMockCalls = [];',
  'const originalGtag = window.gtag;',
  'window.gtag = function (...args) {',
  '  window.__analyticsMockCalls.push(args);',
  '  return originalGtag.apply(this, args);',
  '};'
].join('\n');

function captureAnalyticsRequests(page) {
  const requests = [];
  page.on('request', request => {
    const url = request.url();
    if (/https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com)\//i.test(url)) {
      requests.push({ url, resourceType: request.resourceType() });
    }
  });
  return requests;
}

async function installLoaderMock(page, onRequest = route => route.fulfill({
  status: 200,
  contentType: 'application/javascript',
  body: MOCK_GTAG_LOADER
})) {
  const requests = [];
  await page.route('https://www.googletagmanager.com/gtag/js*', async route => {
    requests.push(route.request().url());
    await onRequest(route, requests.length);
  });
  return requests;
}

async function preparePage(page, {
  consent = null,
  doNotTrack = null,
  globalPrivacyControl = false
} = {}) {
  await page.addInitScript(({ consentValue, dntValue, gpcValue, fixtureOrigin }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    if (consentValue === '0' || consentValue === '1') {
      localStorage.setItem('blend-analytics-consent-v1', consentValue);
    }
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
    consentValue: consent,
    dntValue: doNotTrack,
    gpcValue: globalPrivacyControl,
    fixtureOrigin: FIXTURE_ORIGIN
  });
}

async function waitForApp(page) {
  await page.waitForFunction(() => !!window.Blend?.state);
  await expect(page.locator('#analytics-consent')).toBeAttached();
}

async function openConfig(page) {
  const panel = page.locator('#config-panel');
  if (!(await panel.evaluate(node => node.classList.contains('open')))) {
    await page.locator('#config-gear').click();
    await expect(panel).toHaveClass(/open/);
  }
}

test('no request before consent; opt-in loads once, reload honors consent, and opt-out stops events', async ({ page }) => {
  const vendorRequests = captureAnalyticsRequests(page);
  const loaderRequests = await installLoaderMock(page);
  await preparePage(page);
  await page.goto('/index.html');
  await waitForApp(page);

  expect(await page.evaluate(() => localStorage.getItem('blend-analytics-consent-v1'))).toBe('0');
  expect(vendorRequests).toHaveLength(0);
  expect(loaderRequests).toHaveLength(0);
  expect(await page.evaluate(() => ({ hasGtag: typeof window.gtag === 'function', hasDataLayer: Array.isArray(window.dataLayer) })))
    .toEqual({ hasGtag: false, hasDataLayer: false });

  await page.evaluate(() => localStorage.setItem('blend-analytics-consent-v1', '0'));
  await page.reload();
  await waitForApp(page);
  expect(vendorRequests).toHaveLength(0);
  expect(loaderRequests).toHaveLength(0);
  expect(await page.evaluate(() => typeof window.gtag)).toBe('undefined');

  const consent = page.locator('#analytics-consent');
  await openConfig(page);
  await expect(consent).not.toBeChecked();
  await expect(consent).toHaveAttribute('aria-describedby', 'analytics-consent-description');
  await expect(page.locator('#analytics-consent-description')).toContainText('media type/layer');
  await expect(page.locator('#analytics-consent-description')).toContainText('fixed Blend Player title/origin and standard browser/session metadata');
  await expect(page.locator('#analytics-consent-description')).toContainText('event parameters exclude user names, media IDs');
  await consent.check();
  await expect(page.locator('#analytics-consent-status')).toHaveText('Analytics is enabled.');
  expect(loaderRequests).toHaveLength(1);
  expect(vendorRequests.filter(request => request.url.includes('googletagmanager.com'))).toHaveLength(1);
  expect(await page.evaluate(() => window.__analyticsMockCalls.filter(call => call[0] === 'config').length)).toBe(1);

  await page.reload();
  await waitForApp(page);
  await expect(page.locator('#analytics-consent-status')).toHaveText('Analytics is enabled.');
  expect(loaderRequests).toHaveLength(2);
  expect(vendorRequests.filter(request => request.url.includes('googletagmanager.com'))).toHaveLength(2);
  expect(await page.evaluate(() => window.__analyticsMockCalls.filter(call => call[0] === 'config').length)).toBe(1);

  await openConfig(page);
  await page.locator('#analytics-consent').uncheck();
  await expect(page.locator('#analytics-consent-status')).toHaveText('Analytics does not load until you enable it.');
  const eventsBeforeOptOutActions = await page.evaluate(() => window.__analyticsMockCalls.filter(call => call[0] === 'event').length);
  await page.locator('#btn-play').click();
  await page.evaluate(async () => {
    await window.Blend.shareContextByMethod('copy');
  });
  expect(await page.evaluate(() => window.__analyticsMockCalls.filter(call => call[0] === 'event').length))
    .toBe(eventsBeforeOptOutActions);
  expect(await page.evaluate(() => window['ga-disable-G-5NVWHE6T4V'])).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('blend-analytics-consent-v1'))).toBe('0');
  expect(vendorRequests).toHaveLength(2);

  await page.reload();
  await waitForApp(page);
  expect(vendorRequests).toHaveLength(2);
  expect(await page.evaluate(() => ({ hasGtag: typeof window.gtag === 'function', consent: localStorage.getItem('blend-analytics-consent-v1') })))
    .toEqual({ hasGtag: false, consent: '0' });
});

test('saved consent remains blocked by DNT and GPC while playback controls stay available', async ({ page, context }) => {
  const dntPage = await context.newPage();
  const gpcPage = await context.newPage();
  const dntRequests = captureAnalyticsRequests(dntPage);
  const gpcRequests = captureAnalyticsRequests(gpcPage);
  await installLoaderMock(dntPage);
  await installLoaderMock(gpcPage);
  await preparePage(dntPage, { consent: '1', doNotTrack: '1' });
  await preparePage(gpcPage, { consent: '1', globalPrivacyControl: true });

  await dntPage.goto('/index.html');
  await gpcPage.goto('/index.html');
  await Promise.all([waitForApp(dntPage), waitForApp(gpcPage)]);

  for (const blockedPage of [dntPage, gpcPage]) {
    await expect(blockedPage.locator('#analytics-consent')).toBeChecked();
    await expect(blockedPage.locator('#analytics-consent-status')).toHaveText(
      'Analytics is off because a browser privacy setting or local-file mode blocks it.'
    );
    expect(await blockedPage.evaluate(() => typeof window.gtag)).toBe('undefined');
    await blockedPage.locator('#config-gear').click();
    await blockedPage.locator('#btn-play').click();
    await expect(blockedPage.locator('#btn-play')).toBeVisible();
  }
  expect(dntRequests).toHaveLength(0);
  expect(gpcRequests).toHaveLength(0);
});

test('a failed script leaves analytics off and permits one retry without blocking the player', async ({ page }) => {
  const vendorRequests = captureAnalyticsRequests(page);
  const loaderRequests = await installLoaderMock(page, async (route, attempt) => {
    if (attempt === 1) {
      await route.abort();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK_GTAG_LOADER });
  });
  await preparePage(page, { consent: '1' });
  await page.goto('/index.html');
  await waitForApp(page);
  await expect(page.locator('#analytics-consent-status')).toContainText('Turn this setting off and on to retry once.');
  await expect(page.locator('#analytics-consent')).toBeChecked();
  expect(loaderRequests).toHaveLength(1);
  expect(await page.evaluate(() => window['ga-disable-G-5NVWHE6T4V'])).toBe(true);
  expect(await page.evaluate(() => window.dataLayer?.some(args => args[0] === 'config') || false)).toBe(false);

  await openConfig(page);
  await page.locator('#analytics-consent').uncheck();
  await page.locator('#analytics-consent').check();
  await expect(page.locator('#analytics-consent-status')).toHaveText('Analytics is enabled.');
  expect(loaderRequests).toHaveLength(2);
  expect(vendorRequests.filter(request => request.url.includes('googletagmanager.com'))).toHaveLength(2);
  expect(await page.evaluate(() => window.__analyticsMockCalls.filter(call => call[0] === 'config').length)).toBe(1);

  await page.locator('#btn-play').click();
  await expect(page.locator('#btn-play')).toBeVisible();
});

test('analytics denial does not block information, fixture import, or share-link copy flows', async ({ page }) => {
  const vendorRequests = captureAnalyticsRequests(page);
  await installLoaderMock(page);
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await expect(page.locator('#analytics-consent-status')).toHaveText('Analytics does not load until you enable it.');

  await openConfig(page);
  await page.locator('#open-info').click();
  await expect(page.locator('#info-modal')).toBeVisible();
  await page.locator('#info-close').click();
  await expect(page.locator('#info-modal')).toBeHidden();

  await blendPage.importExperience(path.resolve(process.cwd(), 'samples', 'New-York-New-York-01.json'));
  await expect(page.locator('#experience-select')).toContainText('New York, New York!');

  await page.locator('#btn-share').click();
  const shareUrl = page.locator('#url-share-url-input');
  await expect(shareUrl).toBeVisible();
  await expect(shareUrl).toHaveValue(/(?:\?|&)(?:exp|experience)=/);
  await page.locator('#url-share-copy').click();
  await expect(shareUrl).toHaveValue(/(?:\?|&)(?:exp|experience)=/);
  expect(vendorRequests).toHaveLength(0);
  expect(await page.evaluate(() => typeof window.gtag)).toBe('undefined');
});
