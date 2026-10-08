import { expect, test } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ERROR_COPY = 'This compatibility link could not keep its shared playback or sign-in details. Open the original link in index.html or request a fresh link.';
const VIEWPORTS = [
  { label: '4K UHD desktop', width: 3840, height: 2160 },
  { label: 'HD desktop', width: 1920, height: 1080 },
  { label: 'tablet landscape', width: 1024, height: 768 },
  { label: 'tablet portrait', width: 768, height: 1024 },
  { label: 'mobile portrait', width: 390, height: 844 },
  { label: 'mobile landscape', width: 844, height: 390 },
  { label: 'small mobile portrait', width: 360, height: 800 }
];

async function prepareAppPage(page) {
  await page.addInitScript(({ origin }) => {
    if (window.location.origin !== origin) return;

    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
    const configKey = 'blend-runtime-config-v1';
    try {
      const existing = JSON.parse(localStorage.getItem(configKey) || '{}');
      localStorage.setItem(configKey, JSON.stringify({
        ...existing,
        SUPABASE_URL: origin,
        SUPABASE_AUTH_REDIRECT_URL: `${origin}/index.html`,
        SUPABASE_MEDIA_BUCKET: 'media',
        SUPABASE_PUBLIC_BUCKETS: 'public'
      }));
    } catch (_) {}

    if (window.location.pathname.endsWith('/index.html')) {
      const countKey = 'issue04-compat-index-load-count';
      const count = Number(sessionStorage.getItem(countKey) || '0');
      sessionStorage.setItem(countKey, String(count + 1));
      sessionStorage.setItem(
        'issue04-compat-first-index-url',
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      );
    }

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      if (window.location.hash.includes('access_token=')) {
        sessionStorage.setItem('issue04-auth-hash-before-cleanup', window.location.hash);
        sessionStorage.setItem('issue04-auth-cleanup-target', String(args[2] || ''));
      }
      return originalReplaceState.apply(this, args);
    };
  }, { origin: ORIGIN });
}

async function waitForApp(page) {
  await page.waitForFunction(() => !!window.Blend?.state);
}

test('compatibility redirect preserves and applies a deep link, stays local, and replaces history', async ({ page }) => {
  await prepareAppPage(page);
  await page.goto('/index.html?before=issue04-history');
  await waitForApp(page);
  const appPage = new BlendAppPage(page);
  const experienceName = `Issue 04 compatibility ${Date.now()}`;
  await appPage.createExperience(experienceName);
  const activeExperienceId = await appPage.activeExperienceIdByName(experienceName);

  const target = await page.evaluate(async () => {
    const { Blend } = window;
    const now = Date.now();
    const firstId = `compat-first-${now}`;
    const targetId = `compat-target-${now}`;
    const activeExperienceId = Blend.state.activeExperienceId;
    const common = { handle: { remote: true }, stale: false, metadata: {}, size: 0, duration: 0 };

    Blend.state.library.clear();
    Blend.state.playlist = [];
    Blend.state.slideshow = [];
    Blend.state.ui.activeList = 'playlist';
    Blend.state.runtime.playlistIndex = 0;
    Blend.state.runtime.slideshowIndex = 0;
    Blend.state.runtime.isPlaying = false;
    Blend.state.library.set(firstId, {
      id: firstId, ...common, name: 'first.svg', type: 'image',
      sourceUrl: `${location.origin}/icon.svg`, pathHint: `${location.origin}/icon.svg`,
      addedAt: now, lastVerified: now
    });
    Blend.state.library.set(targetId, {
      id: targetId, ...common, name: 'target.svg', type: 'image',
      sourceUrl: `${location.origin}/icon-maskable.svg`, pathHint: `${location.origin}/icon-maskable.svg`,
      addedAt: now + 1, lastVerified: now + 1
    });
    Blend.state.slideshow.push(
      { id: firstId, addedAt: now, path: `${location.origin}/icon.svg`, name: 'first.svg', type: 'image', sourceUrl: `${location.origin}/icon.svg`, available: true, displayDuration: 60 },
      { id: targetId, addedAt: now + 1, path: `${location.origin}/icon-maskable.svg`, name: 'target.svg', type: 'image', sourceUrl: `${location.origin}/icon-maskable.svg`, available: true, displayDuration: 60 }
    );
    Blend.renderLibrary();
    Blend.renderListEditor();
    await Blend.saveStateNow();

    const deepLink = new URL(Blend.buildDeepLinkUrl({
      experienceId: activeExperienceId,
      layer: 'slideshow',
      itemId: targetId
    }), location.href);
    deepLink.searchParams.set('autoplay', 'true');
    deepLink.searchParams.set('returnTo', 'https://outside.invalid/auth/return');
    deepLink.searchParams.set('opaque', 'a/b c');
    deepLink.hash = 'compat-fragment=preserve';
    return {
      href: deepLink.href,
      pathname: deepLink.pathname,
      search: deepLink.search,
      hash: deepLink.hash,
      experienceId: activeExperienceId,
      itemId: targetId
    };
  });
  expect(target.experienceId).toBe(activeExperienceId);

  await page.evaluate(() => {
    sessionStorage.removeItem('issue04-compat-first-index-url');
    sessionStorage.removeItem('issue04-compat-index-load-count');
  });
  await page.goto(target.href);
  await page.waitForFunction(({ experienceId, itemId }) => {
    const state = window.Blend?.state;
    const current = state?.slideshow?.[state.runtime.slideshowIndex];
    return state?.activeExperienceId === experienceId &&
      state?.ui?.activeList === 'slideshow' &&
      state?.runtime?.isPlaying === true &&
      current?.id === itemId;
  }, { experienceId: target.experienceId, itemId: target.itemId });

  const finalUrl = new URL(page.url());
  const firstIndexUrl = await page.evaluate(() => sessionStorage.getItem('issue04-compat-first-index-url'));
  expect(finalUrl.origin).toBe(ORIGIN);
  expect(finalUrl.pathname).toBe('/index.html');
  expect(finalUrl.search).toBe(target.search);
  expect(finalUrl.hash).toBe(target.hash);
  expect(firstIndexUrl).toBe(`${target.pathname}${target.search}${target.hash}`);
  expect(finalUrl.searchParams.get('returnTo')).toBe('https://outside.invalid/auth/return');
  expect(finalUrl.searchParams.get('opaque')).toBe('a/b c');
  expect(await page.evaluate(() => sessionStorage.getItem('issue04-compat-index-load-count'))).toBe('1');

  const applied = await page.evaluate(() => {
    const { state } = window.Blend;
    return {
      activeExperienceId: state.activeExperienceId,
      activeList: state.ui.activeList,
      isPlaying: state.runtime.isPlaying,
      currentItemId: state.slideshow[state.runtime.slideshowIndex]?.id
    };
  });
  expect(applied).toEqual({
    activeExperienceId: target.experienceId,
    activeList: 'slideshow',
    isPlaying: true,
    currentItemId: target.itemId
  });

  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => new URL(page.url()).search).toBe('?before=issue04-history');
  expect(new URL(page.url()).pathname).toBe('/index.html');
});

test('compatibility auth callback receives the original synthetic fragment and cleans it through the existing flow', async ({ page }) => {
  const consoleOutput = [];
  const requestUrls = [];
  page.on('console', message => consoleOutput.push(message.text()));
  page.on('request', request => requestUrls.push(request.url()));
  await prepareAppPage(page);

  const fragment = '#access_token=synthetic-access-issue04&refresh_token=synthetic-refresh-issue04&expires_in=3600&token_type=bearer';
  const search = '?callback-state=synthetic-issue04';
  await page.goto(`/slideshow-playlist-player.html${search}${fragment}`);
  await waitForApp(page);
  await page.waitForFunction(() =>
    !!sessionStorage.getItem('issue04-auth-hash-before-cleanup') && window.location.hash === ''
  );

  const evidence = await page.evaluate(() => ({
    initialIndexUrl: sessionStorage.getItem('issue04-compat-first-index-url'),
    hashBeforeCleanup: sessionStorage.getItem('issue04-auth-hash-before-cleanup'),
    cleanupTarget: sessionStorage.getItem('issue04-auth-cleanup-target'),
    finalPath: location.pathname,
    finalSearch: location.search,
    finalHash: location.hash,
    visibleText: document.body.innerText,
    toastText: document.querySelector('#toast-container')?.innerText || '',
    links: Array.from(document.querySelectorAll('a'), link => link.href)
  }));

  expect(evidence.initialIndexUrl).toBe(`/index.html${search}${fragment}`);
  expect(evidence.hashBeforeCleanup).toBe(fragment);
  const cleanupTarget = new URL(evidence.cleanupTarget, ORIGIN);
  expect(cleanupTarget.origin).toBe(ORIGIN);
  expect(cleanupTarget.pathname).toBe('/index.html');
  expect(cleanupTarget.search).toBe(search);
  expect(cleanupTarget.hash).toBe('');
  expect(evidence.finalPath).toBe('/index.html');
  expect(evidence.finalSearch).toBe(search);
  expect(evidence.finalHash).toBe('');
  expect(evidence.visibleText).not.toContain('synthetic-access-issue04');
  expect(evidence.visibleText).not.toContain('synthetic-refresh-issue04');
  expect(evidence.toastText).not.toContain('synthetic-');
  expect(evidence.links.some(href => href.includes('synthetic-access-issue04') || href.includes('synthetic-refresh-issue04'))).toBe(false);
  expect(consoleOutput.some(value => value.includes('synthetic-access-issue04') || value.includes('synthetic-refresh-issue04'))).toBe(false);
  expect(requestUrls.some(value => value.includes('synthetic-access-issue04') || value.includes('synthetic-refresh-issue04'))).toBe(false);
  expect(requestUrls.every(value => new URL(value).origin === ORIGIN)).toBe(true);
});

test('compatibility entry without a deep link redirects once and direct index entry stays direct', async ({ page }) => {
  await prepareAppPage(page);
  await page.goto('/slideshow-playlist-player.html');
  await waitForApp(page);
  expect(new URL(page.url()).pathname).toBe('/index.html');
  expect(new URL(page.url()).origin).toBe(ORIGIN);
  await expect(page).toHaveTitle('Untitled Session • Blend');
  expect(await page.evaluate(() => sessionStorage.getItem('issue04-compat-index-load-count'))).toBe('1');

  await page.goto('/index.html');
  await waitForApp(page);
  expect(new URL(page.url()).pathname).toBe('/index.html');
  await expect(page).toHaveTitle('Untitled Session • Blend');
});

test('keyboard-only focus is visible after compatibility and direct index entry', async ({ page }) => {
  await prepareAppPage(page);
  const skipLink = page.getByRole('link', { name: 'Skip to controls' });

  await page.goto('/slideshow-playlist-player.html');
  await waitForApp(page);
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.goto('/index.html');
  await waitForApp(page);
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
});

test('destination construction failure shows safe, useful fallback copy', async ({ page }) => {
  const consoleOutput = [];
  page.on('console', message => consoleOutput.push(message.text()));
  await page.addInitScript(() => { window.URL = undefined; });
  const originalUrl = `${ORIGIN}/slideshow-playlist-player.html?state=synthetic#access_token=synthetic-access-issue04`;
  await page.goto(originalUrl);

  await expect(page.locator('#redirect-error')).toBeVisible();
  await expect(page.locator('#redirect-error')).toHaveText(ERROR_COPY);
  await expect(page.locator('#direct-index-link')).toHaveText('Open Blend directly without forwarded details');
  await expect(page.locator('#original-link-container')).toBeVisible();
  expect(await page.locator('#original-link').evaluate(link => link.href)).toBe(originalUrl);
  expect(new URL(page.url()).pathname).toBe('/slideshow-playlist-player.html');
  expect(await page.locator('body').innerText()).not.toContain('synthetic-access-issue04');
  expect(consoleOutput.some(value => value.includes('synthetic-access-issue04'))).toBe(false);
});

for (const viewport of VIEWPORTS) {
  test(`JavaScript-disabled fallback is keyboard-usable and responsive at ${viewport.label} (${viewport.width}x${viewport.height})`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      javaScriptEnabled: false
    });
    const page = await context.newPage();
    try {
      const originalUrl = `${ORIGIN}/slideshow-playlist-player.html?shared=synthetic#state=synthetic`;
      await page.goto(originalUrl);
      expect(page.url()).toBe(originalUrl);
      await expect(page).toHaveTitle('Blend version 5.0.11');
      await expect(page.locator('#no-script-original-link-help')).toContainText('copy this page\'s original URL from your browser address bar');
      await expect(page.locator('#no-script-error')).toHaveText(ERROR_COPY);
      await expect(page.locator('#no-script-index-link')).toContainText('shared details may not carry');

      await page.keyboard.press('Tab');
      await expect(page.locator('#no-script-index-link')).toBeFocused();

      const linkMetrics = await page.locator('#no-script-index-link').evaluate(link => {
        const rect = link.getBoundingClientRect();
        const style = getComputedStyle(link);
        return { height: rect.height, width: rect.width, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      });
      expect(linkMetrics.height).toBeGreaterThanOrEqual(44);
      expect(linkMetrics.width).toBeLessThanOrEqual(viewport.width);
      expect(linkMetrics.outlineStyle).not.toBe('none');
      expect(Number.parseFloat(linkMetrics.outlineWidth)).toBeGreaterThan(0);

      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        mainWidth: document.querySelector('main').getBoundingClientRect().width,
        viewportWidth: window.innerWidth
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
      expect(layout.mainWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    } finally {
      await context.close();
    }
  });
}
