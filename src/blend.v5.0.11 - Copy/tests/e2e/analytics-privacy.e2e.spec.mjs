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

async function preparePage(page, {
  doNotTrack = null,
  globalPrivacyControl = false,
  consent = true,
  rememberedCredential = '',
  unreadableCredential = false
} = {}) {
  await page.addInitScript(({ fixtureOrigin, dntValue, gpcValue, consentValue, credentialValue, unreadableCredentialValue }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    if (consentValue) localStorage.setItem('blend-analytics-consent-v1', '1');
    else localStorage.removeItem('blend-analytics-consent-v1');
    if (credentialValue) {
      localStorage.setItem('blend-git-playlist-credential-v1', JSON.stringify({
        provider: 'github',
        token: credentialValue
      }));
    }
    window.__credentialWrites = 0;
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'blend-git-playlist-credential-v1') {
        window.__credentialWrites += 1;
      }
      return nativeSetItem.call(this, key, value);
    };
    if (unreadableCredentialValue) {
      const nativeGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (this === localStorage && key === 'blend-git-playlist-credential-v1') {
          throw new Error('synthetic storage read failure');
        }
        return nativeGetItem.call(this, key);
      };
    }
    window.__gtagInsertions = 0;
    const nativeAppend = Element.prototype.append;
    Element.prototype.append = function (...nodes) {
      for (const node of nodes) {
        if (node instanceof HTMLScriptElement && node.src.includes('googletagmanager.com/gtag/js')) {
          window.__gtagInsertions += 1;
        }
      }
      return nativeAppend.apply(this, nodes);
    };
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
    gpcValue: globalPrivacyControl,
    consentValue: consent,
    credentialValue: rememberedCredential,
    unreadableCredentialValue: unreadableCredential
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

async function installGithubConnectMock(page) {
  const calls = [];
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type'
  };
  await page.route('https://api.github.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({ method: request.method(), url: url.href, authorization: request.headers().authorization || '' });
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    } else if (url.pathname === '/repos/blend-team/playlists') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ private: true, full_name: 'blend-team/playlists' })
      });
    } else if (url.pathname === '/repos/blend-team/playlists/git/ref/heads/main') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ ref: 'refs/heads/main', object: { sha: 'b'.repeat(40), type: 'commit' } })
      });
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ message: 'not found' })
      });
    }
  });
  return calls;
}

async function waitForApp(page) {
  await page.waitForFunction(() => !!window.Blend && !!window.Blend.state);
  await page.waitForSelector('#playlist-layer video');
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

test('remembered credentials block consented analytics and forgetting restores it accessibly', async ({ page }) => {
  const sentinel = 'SYNTHETIC-GIT-CREDENTIAL-SENTINEL-ANALYTICS-PRIVACY';
  const { events, loaderRequests } = await installAnalyticsInterceptors(page);
  const networkCapture = [];
  const consoleCapture = [];
  const pageErrors = [];
  page.on('request', request => networkCapture.push(`${request.url()} ${request.postData() || ''}`));
  page.on('console', message => consoleCapture.push(message.text()));
  page.on('pageerror', error => pageErrors.push(error.message));
  await preparePage(page, { consent: false, rememberedCredential: sentinel });
  await page.goto('/index.html');
  await waitForApp(page);
  await page.locator('#config-gear').click();

  const consent = page.locator('#analytics-consent');
  const status = page.locator('#analytics-consent-status');
  const blockedMessage = 'Analytics is off while a repository credential is remembered on this device. Forget the credential or continue without analytics. The playlist connection remains available.';
  await expect(status).toHaveText(blockedMessage);
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(consent).toHaveAttribute('aria-describedby', /analytics-consent-status/);

  await consent.focus();
  await page.keyboard.press('Space');
  await expect(consent).toBeChecked();
  await expect(status).toHaveText(blockedMessage);

  const remember = page.locator('#git-playlist-remember');
  await page.locator('#git-playlist-provider').selectOption('github');
  await expect(remember).toBeChecked();
  await expect(remember).toHaveAttribute('aria-describedby', /analytics-consent-status/);
  await remember.focus();
  await page.keyboard.press('Space');
  await expect(remember).not.toBeChecked();
  await expect(status).toHaveText(blockedMessage);
  await remember.focus();
  await page.keyboard.press('Space');
  await expect(remember).toBeChecked();

  expect(loaderRequests).toHaveLength(0);
  expect(events).toHaveLength(0);
  expect(await page.evaluate(() => window.__gtagInsertions)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('blend-analytics-consent-v1'))).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('blend-git-playlist-credential-v1'))).toContain(sentinel);
  expect(JSON.stringify({ networkCapture, consoleCapture, pageErrors, events })).not.toContain(sentinel);
  expect(await page.locator('body').innerText()).not.toContain(sentinel);
  expect(await page.evaluate(() => document.documentElement.innerHTML)).not.toContain(sentinel);

  await page.locator('#git-playlist-forget').click();
  await expect(status).toHaveText('Analytics is enabled.');
  await expect.poll(() => events.some(event => event.eventName === 'page_view')).toBe(true);
  expect(loaderRequests).toHaveLength(1);
  expect(await page.evaluate(() => window.__gtagInsertions)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('blend-analytics-consent-v1'))).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('blend-git-playlist-credential-v1'))).toBeNull();
  expect(JSON.stringify({ networkCapture, consoleCapture, pageErrors, events })).not.toContain(sentinel);
  expect(await page.locator('body').innerText()).not.toContain(sentinel);
  expect(pageErrors).toEqual([]);
});

test('unreadable credential storage fails closed without a gtag request', async ({ page }) => {
  const { events, loaderRequests } = await installAnalyticsInterceptors(page);
  const githubCalls = await installGithubConnectMock(page);
  const consoleCapture = [];
  const pageErrors = [];
  page.on('console', message => consoleCapture.push(message.text()));
  page.on('pageerror', error => pageErrors.push(error.message));
  await preparePage(page, { consent: true, unreadableCredential: true });
  await page.goto('/index.html');
  await waitForApp(page);
  await page.locator('#config-gear').click();
  await expect(page.locator('#analytics-consent-status')).toHaveText(
    'Analytics is off because saved repository credential storage could not be checked. The in-memory Git connection remains available.'
  );
  expect(loaderRequests).toHaveLength(0);
  expect(events).toHaveLength(0);
  expect(await page.evaluate(() => window.__gtagInsertions)).toBe(0);
  expect(await page.evaluate(() => typeof window.gtag)).toBe('undefined');

  const sentinel = 'SYNTHETIC-GIT-CREDENTIAL-SENTINEL-UNREADABLE-STORAGE';
  await page.locator('#git-playlist-provider').selectOption('github');
  await page.locator('#git-playlist-owner').fill('blend-team');
  await page.locator('#git-playlist-repository').fill('playlists');
  await page.locator('#git-playlist-branch').fill('main');
  await page.locator('#git-playlist-path').fill('playlists/ambient.json');
  await page.locator('#git-playlist-token').fill(sentinel);
  await page.locator('#git-playlist-remember').check();
  await page.locator('#git-playlist-connect').click();
  await expect(page.locator('#git-playlist-connection')).toContainText('session-only');
  await expect(page.locator('#git-playlist-disconnect')).toBeEnabled();
  await expect(page.locator('#git-playlist-read')).toBeEnabled();
  expect(githubCalls.filter(call => call.authorization).every(call => call.authorization.includes(sentinel))).toBe(true);
  expect(await page.evaluate(() => window.__credentialWrites)).toBe(0);
  expect(await page.locator('body').innerText()).not.toContain(sentinel);
  expect(JSON.stringify({ events, consoleCapture, pageErrors })).not.toContain(sentinel);
  expect(pageErrors).toEqual([]);
  expect(loaderRequests).toHaveLength(0);
  expect(events).toHaveLength(0);
});

test('a credential remembered in another tab blocks consent without changing it', async ({ context }) => {
  const consentPage = await context.newPage();
  const gitPage = await context.newPage();
  const consentCapture = await installAnalyticsInterceptors(consentPage);
  const gitCapture = await installAnalyticsInterceptors(gitPage);
  const githubCalls = await installGithubConnectMock(gitPage);
  await preparePage(consentPage, { consent: false });
  await consentPage.goto('/index.html');
  await waitForApp(consentPage);
  await consentPage.locator('#config-gear').click();
  await consentPage.locator('#git-playlist-provider').selectOption('github');

  await preparePage(gitPage, { consent: false });
  await gitPage.goto('/index.html');
  await waitForApp(gitPage);
  await gitPage.locator('#config-gear').click();
  await gitPage.locator('#git-playlist-provider').selectOption('github');
  await gitPage.locator('#git-playlist-owner').fill('blend-team');
  await gitPage.locator('#git-playlist-repository').fill('playlists');
  await gitPage.locator('#git-playlist-branch').fill('main');
  await gitPage.locator('#git-playlist-path').fill('playlists/ambient.json');

  const sentinel = 'SYNTHETIC-GIT-CREDENTIAL-SENTINEL-OTHER-TAB';
  await gitPage.locator('#git-playlist-token').fill(sentinel);
  await gitPage.locator('#git-playlist-remember').check();
  await gitPage.locator('#git-playlist-connect').click();
  await expect(gitPage.locator('#git-playlist-connection')).toContainText('credential is remembered in browser storage');
  await expect(consentPage.locator('#analytics-consent-status')).toContainText('repository credential is remembered');
  await expect(consentPage.locator('#git-playlist-remember')).toBeChecked();

  const consent = consentPage.locator('#analytics-consent');
  await consent.focus();
  await consentPage.keyboard.press('Space');
  await expect(consent).toBeChecked();
  await expect(consentPage.locator('#analytics-consent-status')).toHaveText(
    'Analytics is off while a repository credential is remembered on this device. Forget the credential or continue without analytics. The playlist connection remains available.'
  );
  expect(consentCapture.loaderRequests).toHaveLength(0);
  expect(gitCapture.loaderRequests).toHaveLength(0);
  expect(consentCapture.events).toHaveLength(0);
  expect(gitCapture.events).toHaveLength(0);
  expect(await consentPage.evaluate(() => window.__gtagInsertions)).toBe(0);
  expect(await gitPage.evaluate(() => window.__gtagInsertions)).toBe(0);
  expect(await consentPage.evaluate(() => localStorage.getItem('blend-analytics-consent-v1'))).toBe('1');
  expect(await gitPage.evaluate(() => localStorage.getItem('blend-git-playlist-credential-v1'))).toContain(sentinel);
  expect(githubCalls.filter(call => call.authorization).every(call => call.authorization.includes(sentinel))).toBe(true);
});

test('an analytics lock in another tab keeps a Git connection session-only', async ({ context }) => {
  const analyticsPage = await context.newPage();
  const gitPage = await context.newPage();
  const analyticsCapture = await installAnalyticsInterceptors(analyticsPage);
  const githubCalls = await installGithubConnectMock(gitPage);
  await preparePage(analyticsPage, { consent: true });
  await analyticsPage.goto('/index.html');
  await waitForApp(analyticsPage);
  await expect(analyticsPage.locator('#analytics-consent-status')).toHaveText('Analytics is enabled.');
  await expect.poll(() => analyticsCapture.loaderRequests.length).toBe(1);

  const sentinel = 'SYNTHETIC-GIT-CREDENTIAL-SENTINEL-CROSS-TAB';
  await preparePage(gitPage, { consent: true });
  await gitPage.goto('/index.html');
  await waitForApp(gitPage);
  await gitPage.locator('#config-gear').click();
  await gitPage.locator('#git-playlist-provider').selectOption('github');
  await gitPage.locator('#git-playlist-owner').fill('blend-team');
  await gitPage.locator('#git-playlist-repository').fill('playlists');
  await gitPage.locator('#git-playlist-branch').fill('main');
  await gitPage.locator('#git-playlist-path').fill('playlists/ambient.json');
  await gitPage.locator('#git-playlist-token').fill(sentinel);
  const remember = gitPage.locator('#git-playlist-remember');
  await remember.focus();
  await gitPage.keyboard.press('Space');
  await expect(remember).toBeChecked();
  await gitPage.locator('#git-playlist-connect').click();

  await expect(gitPage.locator('#git-playlist-connection')).toContainText('This tab or another Blend tab is using analytics');
  await expect(gitPage.locator('#git-playlist-disconnect')).toBeEnabled();
  await expect(gitPage.locator('#git-playlist-read')).toBeEnabled();
  await expect(remember).toBeChecked();
  expect(await gitPage.evaluate(() => localStorage.getItem('blend-git-playlist-credential-v1'))).toBeNull();
  expect(githubCalls.filter(call => call.method === 'GET')).toHaveLength(2);
  expect(githubCalls.every(call => call.url.startsWith('https://api.github.com/'))).toBe(true);
  expect(githubCalls.filter(call => call.authorization).every(call => call.authorization.includes(sentinel))).toBe(true);
  expect(analyticsCapture.loaderRequests).toHaveLength(1);
  expect(analyticsCapture.events.some(event => JSON.stringify(event).includes(sentinel))).toBe(false);
  expect(await gitPage.evaluate(() => window.__gtagInsertions)).toBe(0);
});

test('a failed analytics load keeps the boundary until reload and prevents credential persistence', async ({ page }) => {
  const loaderRequests = [];
  await page.route('https://www.googletagmanager.com/gtag/js*', async route => {
    loaderRequests.push(route.request().url());
    await route.abort('failed');
  });
  const githubCalls = await installGithubConnectMock(page);
  await preparePage(page, { consent: true });
  await page.goto('/index.html');
  await waitForApp(page);
  await page.locator('#config-gear').click();
  await expect(page.locator('#analytics-consent-status')).toContainText('Analytics could not load and remains off.');
  expect(await page.evaluate(() => window.__gtagInsertions)).toBe(1);

  const sentinel = 'SYNTHETIC-GIT-CREDENTIAL-SENTINEL-LOAD-FAILURE';
  await page.locator('#git-playlist-provider').selectOption('github');
  await page.locator('#git-playlist-owner').fill('blend-team');
  await page.locator('#git-playlist-repository').fill('playlists');
  await page.locator('#git-playlist-branch').fill('main');
  await page.locator('#git-playlist-path').fill('playlists/ambient.json');
  await page.locator('#git-playlist-token').fill(sentinel);
  const remember = page.locator('#git-playlist-remember');
  await remember.check();
  await page.locator('#git-playlist-connect').click();

  await expect(page.locator('#git-playlist-connection')).toContainText('This tab or another Blend tab is using analytics');
  await expect(page.locator('#git-playlist-read')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('blend-git-playlist-credential-v1'))).toBeNull();
  expect(loaderRequests).toHaveLength(1);
  expect(githubCalls.filter(call => call.authorization).every(call => call.authorization.includes(sentinel))).toBe(true);
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
