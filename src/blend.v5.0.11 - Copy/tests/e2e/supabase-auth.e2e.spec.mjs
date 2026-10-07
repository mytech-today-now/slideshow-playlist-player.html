import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BlendAppPage } from './support/blend-app-page.mjs';

const AUTH_STORAGE_KEY = 'blend-supabase-auth-session-v2';
const LEGACY_AUTH_STORAGE_KEY = 'blend-supabase-auth-session-v1';
// Keep the synthetic access token within a realistic, future JWT expiry window.
const ACCESS_TOKEN = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  Buffer.from(JSON.stringify({
    sub: 'synthetic-browser-user',
    email: 'e2e@example.test',
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url'),
  'synthetic-signature'
].join('.');
const REFRESH_TOKEN = 'synthetic-browser-refresh-sentinel';

async function openAuthDialog(app) {
  await app.openConfig();
  await expect(app.page.locator('#private-media-policy-warning'))
    .toHaveText('Private media access could not be verified. Contact the project owner before sharing.');
  await app.page.locator('#supabase-sign-in').click();
  await expect(app.page.locator('#supabase-auth-modal')).toBeVisible();
  await expect(app.page.locator('#supabase-auth-persist-session')).not.toBeChecked();
  await expect(app.page.locator('#supabase-auth-persist-session'))
    .toHaveAttribute('aria-describedby', 'supabase-auth-persistence-description');
  await expect(app.page.locator('#supabase-auth-persistence-description'))
    .toContainText('A saved token can be read by scripts running on this site.');
}

async function readExperienceExport(app, testInfo) {
  const downloadPromise = app.page.waitForEvent('download');
  await app.page.locator('#experience-export').click();
  const download = await downloadPromise;
  const outputPath = testInfo.outputPath(download.suggestedFilename() || 'experience.json');
  await download.saveAs(outputPath);
  return await readFile(outputPath, 'utf8');
}

test('fresh profile uses a tab-only session by default and keeps private media gated after reload', async ({ page }, testInfo) => {
  const consoleEntries = [];
  const requestUrls = [];
  page.on('console', message => consoleEntries.push(message.text()));
  page.on('pageerror', error => consoleEntries.push(error.message));
  page.on('request', request => requestUrls.push(request.url()));

  const app = new BlendAppPage(page);
  await app.boot();
  const initialAuthKeys = await page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('blend-supabase-auth-session-')));
  expect(initialAuthKeys).toEqual([]);

  await openAuthDialog(app);
  await page.locator('#supabase-auth-token').fill(ACCESS_TOKEN);
  await page.locator('#supabase-auth-refresh-token').fill(REFRESH_TOKEN);
  await page.locator('[data-auth-submit]').click();
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();
  await expect(page.locator('#supabase-auth-status'))
    .toContainText('Supabase API token connected for private media.');

  const afterConnect = await page.evaluate(({ accessToken, refreshToken }) => ({
    authKey: localStorage.getItem('blend-supabase-auth-session-v2'),
    legacyKey: localStorage.getItem('blend-supabase-auth-session-v1'),
    storedValues: Object.keys(localStorage).map(key => localStorage.getItem(key) || ''),
    bodyText: document.body.innerText,
    inputValues: [
      document.querySelector('#supabase-auth-token')?.value || '',
      document.querySelector('#supabase-auth-refresh-token')?.value || ''
    ],
    currentUrl: location.href,
    loggerJson: window.Blend.log.exportJson(),
    sentinels: [accessToken, refreshToken]
  }), { accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN });
  expect(afterConnect.authKey).toBeNull();
  expect(afterConnect.legacyKey).toBeNull();
  expect(afterConnect.bodyText).not.toContain(ACCESS_TOKEN);
  expect(afterConnect.bodyText).not.toContain(REFRESH_TOKEN);
  expect(afterConnect.inputValues).toEqual(['', '']);
  expect(afterConnect.currentUrl).not.toContain(ACCESS_TOKEN);
  expect(afterConnect.currentUrl).not.toContain(REFRESH_TOKEN);
  expect(afterConnect.loggerJson).not.toContain(ACCESS_TOKEN);
  expect(afterConnect.loggerJson).not.toContain(REFRESH_TOKEN);
  expect(afterConnect.storedValues.join('\n')).not.toContain(ACCESS_TOKEN);
  expect(afterConnect.storedValues.join('\n')).not.toContain(REFRESH_TOKEN);

  const experienceExport = await readExperienceExport(app, testInfo);
  expect(experienceExport).not.toContain(ACCESS_TOKEN);
  expect(experienceExport).not.toContain(REFRESH_TOKEN);

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await expect(page.locator('#supabase-auth-status'))
    .toContainText('Provide API token to access private Supabase media.');
  await expect(page.locator('#btn-share')).toHaveAttribute('data-ipfs-state', 'unauthorized');

  const newTab = await page.context().newPage();
  const newTabApp = new BlendAppPage(newTab);
  await newTabApp.boot();
  await expect(newTab.locator('#supabase-auth-status'))
    .toContainText('Provide API token to access private Supabase media.');
  await expect(newTab.locator('#btn-share')).toHaveAttribute('data-ipfs-state', 'unauthorized');
  await newTab.close();

  const captured = [...consoleEntries, ...requestUrls].join('\n');
  expect(captured).not.toContain(ACCESS_TOKEN);
  expect(captured).not.toContain(REFRESH_TOKEN);
});

test('temporary refresh outage keeps the saved session, local playback, and private media recovery available', async ({ page }) => {
  const fallbackCopy = 'Supabase is temporarily unavailable. Your saved session was kept; retry when online.';
  const providerBodySentinel = 'synthetic-private-provider-response-must-not-be-shown';
  const savedSession = JSON.stringify({
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    expires_at: Math.floor(Date.now() / 1000) - 5
  });
  let providerAvailable = false;
  let refreshRequests = 0;
  let signingRequests = 0;
  let refreshAuthorizationPresent = false;

  await page.addInitScript(({ storageKey, value }) => {
    localStorage.setItem(storageKey, value);
  }, { storageKey: AUTH_STORAGE_KEY, value: savedSession });
  await page.route('**/auth/v1/token*', async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get('grant_type') !== 'refresh_token') return route.continue();
    refreshRequests += 1;
    if (!providerAvailable) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ msg: providerBodySentinel })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'synthetic-recovered-access-token',
        refresh_token: 'synthetic-recovered-refresh-token',
        expires_in: 3600
      })
    });
  });
  await page.route('**/storage/v1/object/sign/**', async route => {
    signingRequests += 1;
    refreshAuthorizationPresent = !!route.request().headers().authorization;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ signedURL: '/samples/IL.jpeg?token=private-media-recovered' })
    });
  });

  const app = new BlendAppPage(page);
  await app.boot();
  await expect(page.locator('#supabase-auth-status')).toHaveText(fallbackCopy);
  await expect(page.locator('#supabase-auth-retry')).toBeVisible();
  const offlineSession = await page.evaluate(storageKey => ({
    entry: localStorage.getItem(storageKey),
    statusState: document.querySelector('#supabase-auth-status')?.dataset.state,
    authStatusText: document.querySelector('#supabase-auth-status')?.textContent
  }), AUTH_STORAGE_KEY);
  expect(offlineSession.entry).toBe(savedSession);
  expect(offlineSession.statusState).toBe('temporarily-unavailable');
  expect(offlineSession.authStatusText).not.toContain(providerBodySentinel);

  const localVideoPath = fileURLToPath(new URL('../../samples/nyc-01.mp4', import.meta.url));
  await app.addLocalFiles([localVideoPath]);
  await app.selectLibraryItemsByNames(['nyc-01.mp4']);
  await app.addSelectedLibraryToList('playlist', 1);
  await page.evaluate(() => window.Blend.play());
  await page.waitForFunction(() => document.querySelector('#playlist-layer video')?.currentSrc.startsWith('blob:'));

  const privateReference = 'supabase://media/private/recovery.png';
  await page.evaluate(reference => {
    const B = window.Blend;
    const expiredUrl = `${location.origin}/samples/IL.jpeg?token=expired-private-fixture`;
    const metadata = {
      storageReference: reference,
      storageBucket: 'media',
      storagePath: 'private/recovery.png',
      signedUrlExpiresAt: Date.now() - 1
    };
    const item = {
      id: 'private-recovery-image',
      name: 'Private recovery.png',
      pathHint: reference,
      sourceUrl: expiredUrl,
      type: 'image',
      size: 0,
      stale: false,
      handle: { remote: true, sourceUrl: expiredUrl },
      metadata: { ...metadata }
    };
    B.state.library.set(item.id, item);
    B.state.slideshow = [{
      id: item.id,
      name: item.name,
      path: reference,
      sourceUrl: expiredUrl,
      type: 'image',
      available: true,
      metadata: { ...metadata }
    }];
    B.state.runtime.slideshowIndex = 0;
    B.state.ui.activeList = 'slideshow';
    B.renderLibrary();
    B.renderListEditor();
  }, privateReference);
  await page.evaluate(async () => {
    await window.Blend.stop();
    await window.Blend.play();
  });
  await expect(page.locator('#toast-container')).toContainText('This private media link expired. Connect Supabase to refresh access.');
  expect(signingRequests).toBe(0);
  await expect(page.locator('#supabase-auth-status')).toHaveText(fallbackCopy);
  await page.waitForFunction(() => document.querySelector('#playlist-layer video')?.currentSrc.startsWith('blob:'));

  providerAvailable = true;
  await page.locator('#supabase-auth-retry').click();
  await expect(page.locator('#supabase-auth-status'))
    .toContainText('Supabase API token connected for private media.');
  await expect(page.locator('#supabase-auth-retry')).toBeHidden();
  const recoveredSession = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) || 'null'), AUTH_STORAGE_KEY);
  expect(recoveredSession.refresh_token).toBe('synthetic-recovered-refresh-token');

  await page.evaluate(async () => {
    const B = window.Blend;
    const ref = B.state.slideshow[0];
    ref.available = true;
    delete ref.retryAfter;
    delete ref.reason;
    B.renderListEditor();
    await B.stop();
    await B.play();
  });
  await expect.poll(() => signingRequests).toBe(1);
  expect(refreshAuthorizationPresent).toBe(true);
  await expect.poll(() => page.locator('#playlist-layer video').evaluate(video => video.currentSrc))
    .toContain('blob:');

  const captured = await page.evaluate(() => ({
    body: document.body.innerText,
    loggerJson: window.Blend.log.exportJson()
  }));
  expect(captured.body).not.toContain(providerBodySentinel);
  expect(captured.loggerJson).not.toContain(providerBodySentinel);
  expect(captured.loggerJson).not.toContain(REFRESH_TOKEN);
});

test('explicit opt-in persists documented fields, restores after reload, and sign-out removes them', async ({ page }, testInfo) => {
  const consoleEntries = [];
  const requestUrls = [];
  page.on('console', message => consoleEntries.push(message.text()));
  page.on('pageerror', error => consoleEntries.push(error.message));
  page.on('request', request => requestUrls.push(request.url()));
  await page.route('**/auth/v1/logout', route => route.fulfill({ status: 200, body: '{}' }));

  const app = new BlendAppPage(page);
  await app.boot();
  await openAuthDialog(app);
  await page.locator('#supabase-auth-persist-session').check();
  await page.locator('#supabase-auth-token').fill(ACCESS_TOKEN);
  await page.locator('#supabase-auth-refresh-token').fill(REFRESH_TOKEN);
  await page.locator('[data-auth-submit]').click();
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();
  await expect(page.locator('#supabase-auth-status'))
    .toContainText('Supabase API token connected for private media.');

  const saved = await page.evaluate(storageKey => ({
    entry: localStorage.getItem(storageKey),
    keys: Object.keys(localStorage).filter(key => key.startsWith('blend-supabase-auth-session-')),
    bodyText: document.body.innerText,
    inputValues: [
      document.querySelector('#supabase-auth-token')?.value || '',
      document.querySelector('#supabase-auth-refresh-token')?.value || ''
    ],
    currentUrl: location.href,
    loggerJson: window.Blend.log.exportJson()
  }), AUTH_STORAGE_KEY);
  expect(saved.keys).toEqual([AUTH_STORAGE_KEY]);
  const parsedSession = JSON.parse(saved.entry);
  expect(Object.keys(parsedSession).sort()).toEqual(['access_token', 'expires_at', 'refresh_token']);
  expect(parsedSession.access_token).toBe(ACCESS_TOKEN);
  expect(parsedSession.refresh_token).toBe(REFRESH_TOKEN);
  expect(saved.bodyText).not.toContain(ACCESS_TOKEN);
  expect(saved.bodyText).not.toContain(REFRESH_TOKEN);
  expect(saved.inputValues).toEqual(['', '']);
  expect(saved.currentUrl).not.toContain(ACCESS_TOKEN);
  expect(saved.currentUrl).not.toContain(REFRESH_TOKEN);
  expect(saved.loggerJson).not.toContain(ACCESS_TOKEN);
  expect(saved.loggerJson).not.toContain(REFRESH_TOKEN);

  const experienceExport = await readExperienceExport(app, testInfo);
  expect(experienceExport).not.toContain(ACCESS_TOKEN);
  expect(experienceExport).not.toContain(REFRESH_TOKEN);

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await expect(page.locator('#supabase-auth-status'))
    .toContainText('Supabase API token connected for private media.');
  await app.openConfig();
  await page.locator('#supabase-sign-out').click();
  await expect(page.locator('#supabase-auth-status'))
    .toContainText('Provide API token to access private Supabase media.');
  await expect(page.locator('#btn-share')).toHaveAttribute('data-ipfs-state', 'unauthorized');

  const afterSignOut = await page.evaluate(storageKey => ({
    entry: localStorage.getItem(storageKey),
    values: Object.keys(localStorage).map(key => localStorage.getItem(key) || ''),
    bodyText: document.body.innerText,
    loggerJson: window.Blend.log.exportJson()
  }), AUTH_STORAGE_KEY);
  expect(afterSignOut.entry).toBeNull();
  expect(afterSignOut.values.join('\n')).not.toContain(ACCESS_TOKEN);
  expect(afterSignOut.values.join('\n')).not.toContain(REFRESH_TOKEN);
  expect(afterSignOut.bodyText).not.toContain(ACCESS_TOKEN);
  expect(afterSignOut.bodyText).not.toContain(REFRESH_TOKEN);
  expect(afterSignOut.loggerJson).not.toContain(ACCESS_TOKEN);
  expect(afterSignOut.loggerJson).not.toContain(REFRESH_TOKEN);

  const captured = [...consoleEntries, ...requestUrls].join('\n');
  expect(captured).not.toContain(ACCESS_TOKEN);
  expect(captured).not.toContain(REFRESH_TOKEN);
});
