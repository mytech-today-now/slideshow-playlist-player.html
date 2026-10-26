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

function containsPrivateSignedUrlOrToken(value) {
  return /\/storage\/v1\/object\/sign\/[^?#\s"'<>]+|[?&]token=[^&#\s"'<>]+/i.test(String(value ?? ''));
}

async function openAuthDialog(app) {
  await app.openConfig();
  await expect(app.page.locator('#private-media-policy-warning'))
    .toHaveText('Private URL sharing is blocked until the project owner verifies Storage access. You can share a public-only experience or continue local playback.');
  await expect(app.page.locator('#supabase-signed-url-ttl')).toHaveValue('3600');
  await app.page.locator('#supabase-sign-in').click();
  await expect(app.page.locator('#supabase-auth-modal')).toBeVisible();
  await expect(app.page.locator('#supabase-auth-persist-session')).not.toBeChecked();
  await expect(app.page.locator('#supabase-auth-persist-session'))
    .toHaveAttribute('aria-describedby', 'supabase-auth-persistence-description');
  await expect(app.page.locator('#supabase-auth-persistence-description'))
    .toContainText('a saved token can be read by scripts running on this site.');
  await expect(app.page.locator('#supabase-auth-persistence-description'))
    .toContainText('Analytics stays off while a saved session exists or its storage cannot be checked.');
  await expect(app.page.locator('#supabase-auth-persistence-description'))
    .toContainText('That includes any same-origin script.');
}

async function readExperienceExport(app, testInfo) {
  const downloadPromise = app.page.waitForEvent('download');
  await app.page.locator('#experience-export').click();
  const download = await downloadPromise;
  const outputPath = testInfo.outputPath(download.suggestedFilename() || 'experience.json');
  await download.saveAs(outputPath);
  return await readFile(outputPath, 'utf8');
}

async function readPersistedMediaStores(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1');
    request.onerror = () => reject(new Error('Could not inspect saved media records'));
    request.onsuccess = () => {
      const database = request.result;
      const stores = ['library', 'playlist', 'slideshow', 'experiences']
        .filter(name => database.objectStoreNames.contains(name));
      if (!stores.length) {
        database.close();
        resolve('{}');
        return;
      }
      const transaction = database.transaction(stores, 'readonly');
      const records = {};
      for (const name of stores) {
        const read = transaction.objectStore(name).getAll();
        read.onsuccess = () => { records[name] = read.result || []; };
      }
      transaction.oncomplete = () => {
        database.close();
        resolve(JSON.stringify(records, (key, value) => {
          if (key === 'handle') return value && typeof value === 'object'
            ? { remote: !!value.remote, sourceUrl: value.sourceUrl || null }
            : null;
          if (key === 'file') return value && typeof value === 'object'
            ? { name: value.name || '', type: value.type || '', size: value.size || 0 }
            : null;
          return value;
        }));
      };
      transaction.onerror = () => {
        database.close();
        reject(new Error('Could not inspect saved media records'));
      };
      transaction.onabort = () => {
        database.close();
        reject(new Error('Could not inspect saved media records'));
      };
    };
  }));
}

async function seedLegacySignedUrlTtl(page, activeExperienceId) {
  await page.evaluate(activeId => new Promise((resolve, reject) => {
    const signedUrl = 'http://127.0.0.1:4191/storage/v1/object/sign/media/private/legacy.mp4?token=legacy-persisted-sentinel';
    const storageReference = 'supabase://media/private/legacy.mp4';
    const metadata = {
      sourceUrl: signedUrl,
      signedUrlExpiresAt: Date.now() + 60_000,
      storageReference,
      storageBucket: 'media',
      storagePath: 'private/legacy.mp4',
      curatorNote: 'keep legacy media note'
    };
    const request = indexedDB.open('player-blend-v1');
    request.onerror = () => reject(new Error('Could not seed legacy TTL settings'));
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('experiences') || !database.objectStoreNames.contains('library')) {
        database.close();
        reject(new Error('Saved media stores are unavailable'));
        return;
      }
      const transaction = database.transaction(['experiences', 'library'], 'readwrite');
      const experienceStore = transaction.objectStore('experiences');
      const libraryStore = transaction.objectStore('library');
      const read = experienceStore.get(activeId);
      read.onsuccess = () => {
        if (!read.result) {
          try { transaction.abort(); } catch (_) {}
          return;
        }
        const record = read.result;
        const payloadKey = ['payload', 'snapshot', 'data'].find(key => record[key] && typeof record[key] === 'object');
        const payload = payloadKey ? record[payloadKey] : {};
        const settings = { ...(payload.settings || {}), storageSignedUrlTtlSeconds: 1209600 };
        delete settings.storageSignedUrlTtlPolicyVersion;
        const playlist = Array.isArray(payload.playlist) ? payload.playlist.slice() : [];
        playlist.push({
          id: 'legacy-private-media',
          name: 'Legacy private.mp4',
          type: 'video',
          path: storageReference,
          sourceUrl: signedUrl,
          available: true,
          metadata: { ...metadata }
        });
        record[payloadKey || 'payload'] = { ...payload, settings, playlist };
        record.updatedAt = Date.now();
        experienceStore.put(record);
        libraryStore.put({
          id: 'legacy-private-media',
          name: 'Legacy private.mp4',
          type: 'video',
          pathHint: storageReference,
          sourceUrl: signedUrl,
          metadata: { ...metadata }
        });
      };
      read.onerror = () => {
        try { transaction.abort(); } catch (_) {}
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(new Error('Could not seed legacy TTL settings'));
      };
      transaction.onabort = () => {
        database.close();
        reject(new Error('Could not seed legacy TTL settings'));
      };
    };
  }), activeExperienceId);
}

test('migrates the previous default TTL to one hour and persists the policy marker', async ({ page }) => {
  const app = new BlendAppPage(page);
  await app.boot();
  await app.createExperience('Legacy TTL Fixture');
  await page.evaluate(() => window.Blend.flushSaveState());
  const activeExperienceId = await page.evaluate(() => window.Blend.state.activeExperienceId);
  expect(activeExperienceId).toBeTruthy();
  await seedLegacySignedUrlTtl(page, activeExperienceId);

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await page.waitForSelector('#playlist-layer video');
  await app.openConfig();
  await expect(page.locator('#supabase-signed-url-ttl')).toHaveValue('3600');

  await page.evaluate(() => window.Blend.flushSaveState());
  const saved = JSON.parse(await readPersistedMediaStores(page));
  const migrated = saved.experiences.find(record => record.id === activeExperienceId);
  const payload = migrated?.payload || migrated?.snapshot || migrated?.data;
  expect(payload?.settings?.storageSignedUrlTtlSeconds).toBe(3600);
  expect(payload?.settings?.storageSignedUrlTtlPolicyVersion).toBe(1);
  const legacyReference = 'supabase://media/private/legacy.mp4';
  expect(payload?.playlist?.find(item => item.id === 'legacy-private-media')?.metadata?.storageReference).toBe(legacyReference);
  const legacyLibraryItem = saved.library.find(record => record.id === 'legacy-private-media');
  expect(legacyLibraryItem?.metadata?.storageReference).toBe(legacyReference);
  expect(legacyLibraryItem?.metadata?.curatorNote).toBe('keep legacy media note');
  const hydratedLegacy = await page.evaluate(() => ({
    library: window.Blend.state.library.get('legacy-private-media'),
    playlist: window.Blend.state.playlist.find(item => item.id === 'legacy-private-media')
  }));
  expect(JSON.stringify(hydratedLegacy)).not.toContain('legacy-persisted-sentinel');
  expect(hydratedLegacy.library?.metadata?.storageReference).toBe(legacyReference);
  expect(hydratedLegacy.playlist?.metadata?.storageReference).toBe(legacyReference);
  expect(await readPersistedMediaStores(page)).not.toContain('legacy-persisted-sentinel');
});

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
    .toHaveText('The connection is available for this tab only. Do not save credentials on this device.');

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

test('tab-only auth disclosure and fallback stay readable at the issue viewports', async ({ page }) => {
  const app = new BlendAppPage(page);
  await app.boot();
  await openAuthDialog(app);
  const persist = page.locator('#supabase-auth-persist-session');
  await persist.check();
  await expect(persist).toBeChecked();
  await persist.uncheck();
  await expect(persist).not.toBeChecked();
  await page.locator('#supabase-auth-token').fill(ACCESS_TOKEN);
  await page.locator('#supabase-auth-refresh-token').fill(REFRESH_TOKEN);
  await page.locator('[data-auth-submit]').click();
  const status = page.locator('#supabase-auth-status');
  await expect(status).toHaveText('The connection is available for this tab only. Do not save credentials on this device.');
  await expect(page.locator('#supabase-sign-out'))
    .toHaveAttribute('aria-describedby', 'supabase-auth-signout-description');

  const viewportRows = [
    { width: 414, height: 896 },
    { width: 320, height: 480 },
    { width: 160, height: 240 }
  ];
  for (const viewport of viewportRows) {
    await page.setViewportSize(viewport);
    await status.scrollIntoViewIfNeeded();
    await expect(status).toBeVisible();
    const layout = await status.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {
        width: innerWidth,
        height: innerHeight,
        pageScrollWidth: document.documentElement.scrollWidth,
        pageClientWidth: document.documentElement.clientWidth,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        textScrollWidth: element.scrollWidth,
        textClientWidth: element.clientWidth,
        whiteSpace: getComputedStyle(element).whiteSpace
      };
    });
    expect(layout.pageScrollWidth, `${viewport.width}x${viewport.height}: page overflow`)
      .toBeLessThanOrEqual(layout.pageClientWidth + 2);
    expect(layout.right, `${viewport.width}x${viewport.height}: status right edge`)
      .toBeLessThanOrEqual(layout.width + 1);
    expect(layout.left, `${viewport.width}x${viewport.height}: status left edge`).toBeGreaterThanOrEqual(-1);
    expect(layout.bottom, `${viewport.width}x${viewport.height}: status bottom edge`)
      .toBeLessThanOrEqual(layout.height + 1);
    expect(layout.top, `${viewport.width}x${viewport.height}: status top edge`).toBeGreaterThanOrEqual(-1);
    expect(layout.textScrollWidth, `${viewport.width}x${viewport.height}: status text overflow`)
      .toBeLessThanOrEqual(layout.textClientWidth + 1);
    expect(layout.whiteSpace, `${viewport.width}x${viewport.height}: status wrap`).not.toBe('nowrap');
  }
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
  const offlineSessionHandle = await page.waitForFunction(storageKey => {
    const status = document.querySelector('#supabase-auth-status');
    if (status?.dataset.state !== 'temporarily-unavailable') return false;
    return {
      entry: localStorage.getItem(storageKey),
      statusState: status.dataset.state,
      authStatusText: status.textContent
    };
  }, AUTH_STORAGE_KEY);
  const offlineSession = await offlineSessionHandle.jsonValue();
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
    const expiredUrl = `${location.origin}/storage/v1/object/sign/media/private/recovery.png?token=expired-private-fixture`;
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
    const saved = await window.Blend.flushSaveState();
    if (!saved) throw new Error('Could not persist the synthetic expired-media fixture.');
    await window.Blend.stop();
    await window.Blend.play();
  });
  await expect(page.locator('#toast-container')).toContainText('This private media link expired. Connect Supabase to refresh access.');
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  const expiredRecoveryState = await page.evaluate(() => {
    const B = window.Blend;
    const containsBearerData = value => /\/storage\/v1\/object\/sign\/[^?#\s"'<>]+|[?&]token=[^&#\s"'<>]+/i.test(String(value ?? ''));
    const status = document.querySelector('#supabase-auth-status')?.textContent || '';
    const alert = document.querySelector('[role="alert"]')?.textContent || '';
    const log = B.log.exportJson();
    return {
      storageReference: B.state.slideshow[0]?.metadata?.storageReference,
      slideshowIndex: B.state.runtime.slideshowIndex,
      statusContainsBearerData: containsBearerData(status),
      alertContainsBearerData: containsBearerData(alert),
      logContainsBearerData: containsBearerData(log)
    };
  });
  expect(expiredRecoveryState.storageReference).toBe(privateReference);
  expect(expiredRecoveryState.slideshowIndex).toBe(0);
  expect(expiredRecoveryState.statusContainsBearerData).toBe(false);
  expect(expiredRecoveryState.alertContainsBearerData).toBe(false);
  expect(expiredRecoveryState.logContainsBearerData).toBe(false);
  await page.evaluate(() => window.Blend.flushSaveState());
  const expiredPersistence = await readPersistedMediaStores(page);
  expect(containsPrivateSignedUrlOrToken(expiredPersistence)).toBe(false);
  expect(expiredPersistence).toContain(privateReference);
  expect(signingRequests).toBe(0);
  await expect(page.locator('#supabase-auth-status')).toHaveText(fallbackCopy);
  await page.waitForFunction(() => document.querySelector('#playlist-layer video')?.currentSrc.startsWith('blob:'));

  const retryButton = page.locator('#supabase-auth-retry');
  await retryButton.focus();
  await expect(retryButton).toBeFocused();
  providerAvailable = true;
  await page.keyboard.press('Enter');
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
  await expect.poll(() => page.locator('#playlist-layer video').first().evaluate(video => video.currentSrc))
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
    .toContainText('Supabase accepted its default global sign-out request.');
  await expect(page.locator('#supabase-sign-out'))
    .toHaveAttribute('aria-describedby', 'supabase-auth-signout-description');
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

test('sign-out clears both cached private playback layers and allows public, local, and authenticated retry', async ({ page }) => {
  const signedOutCopy = 'Signing out stops playback in this tab. A copied link may still work until its provider and cache lifetime ends.';
  const videoPath = fileURLToPath(new URL('../../samples/nyc-01.mp4', import.meta.url));
  const imagePath = fileURLToPath(new URL('../../samples/IL.jpeg', import.meta.url));
  const signingRequests = [];
  const privateMediaRequests = [];
  const logoutRequests = [];
  await page.route('**/auth/v1/logout', async route => {
    logoutRequests.push(route.request().url());
    await route.fulfill({ status: 200, body: '{}' });
  });
  await page.route('**/storage/v1/object/sign/**', async route => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (request.method() === 'POST') {
      signingRequests.push(requestUrl.pathname);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ signedURL: `${requestUrl.pathname}?token=private-media-retry-${signingRequests.length}` })
      });
    }
    const isVideo = requestUrl.pathname.endsWith('/playlist.mp4');
    privateMediaRequests.push(isVideo ? 'video' : 'image');
    return route.fulfill({
      status: 200,
      contentType: isVideo ? 'video/mp4' : 'image/jpeg',
      path: isVideo ? videoPath : imagePath
    });
  });

  const app = new BlendAppPage(page);
  await page.addInitScript(() => {
    try { Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true }); } catch (_) {}
  });
  await app.boot();
  await openAuthDialog(app);
  await page.locator('#supabase-auth-token').fill(ACCESS_TOKEN);
  await page.locator('#supabase-auth-refresh-token').fill(REFRESH_TOKEN);
  await page.locator('[data-auth-submit]').click();
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();

  await app.addLocalFiles([videoPath]);
  await app.selectLibraryItemsByNames(['nyc-01.mp4']);
  await app.addSelectedLibraryToList('playlist', 1);

  const copiedUrl = await page.evaluate(() => {
    const B = window.Blend;
    const now = Date.now();
    const privateVideoUrl = `${location.origin}/storage/v1/object/sign/media/private/playlist.mp4?token=private-video-copy-sentinel`;
    const privateImageUrl = `${location.origin}/storage/v1/object/sign/media/private/slideshow.jpeg?token=private-image-copy-sentinel`;
    const videoReference = 'supabase://media/private/playlist.mp4';
    const imageReference = 'supabase://media/private/slideshow.jpeg';
    const makeItem = (id, name, type, sourceUrl, reference) => ({
      id,
      name,
      type,
      size: 0,
      duration: 1,
      stale: false,
      pathHint: reference,
      sourceUrl,
      handle: { remote: true, sourceUrl },
      metadata: {
        sourceUrl,
        signedUrlExpiresAt: now + 60_000,
        storageReference: reference,
        storageBucket: 'media',
        storagePath: reference.replace('supabase://media/', ''),
        curatorNote: `keep-${id}`
      }
    });
    const video = makeItem('private-video', 'Private video.mp4', 'video', privateVideoUrl, videoReference);
    const image = makeItem('private-image', 'Private image.jpeg', 'image', privateImageUrl, imageReference);
    const publicVideoUrl = `${location.origin}/samples/nyc-01.mp4?public=playlist`;
    const publicImageUrl = `${location.origin}/samples/IL.jpeg?public=slideshow`;
    const publicVideo = { id: 'public-video', name: 'Public video.mp4', type: 'video', sourceUrl: publicVideoUrl, path: publicVideoUrl, available: true, metadata: {} };
    const publicImage = { id: 'public-image', name: 'Public image.jpeg', type: 'image', sourceUrl: publicImageUrl, path: publicImageUrl, available: true, metadata: {} };
    const localItem = Array.from(B.state.library.values()).find(item => item.name === 'nyc-01.mp4' && item.handle?.getFile);
    B.state.library.set(video.id, video);
    B.state.library.set(image.id, image);
    B.state.library.set(publicVideo.id, { ...publicVideo, handle: { remote: true, sourceUrl: publicVideoUrl } });
    B.state.library.set(publicImage.id, { ...publicImage, handle: { remote: true, sourceUrl: publicImageUrl } });
    B.state.playlist = [
      { id: video.id, name: video.name, type: video.type, sourceUrl: privateVideoUrl, path: videoReference, available: true, metadata: { ...video.metadata } },
      { ...publicVideo },
      { id: localItem.id, name: localItem.name, type: localItem.type, path: localItem.pathHint, sourceUrl: localItem.sourceUrl, available: true, metadata: { ...localItem.metadata } }
    ];
    B.state.slideshow = [
      { id: image.id, name: image.name, type: image.type, sourceUrl: privateImageUrl, path: imageReference, available: true, displayDuration: 60, metadata: { ...image.metadata } },
      { ...publicImage }
    ];
    B.state.runtime.playlistIndex = 0;
    B.state.runtime.slideshowIndex = 0;
    B.state.ui.activeList = 'playlist';
    B.renderLibrary();
    B.renderListEditor();
    return privateVideoUrl;
  });

  await page.evaluate(() => window.Blend.play());
  await expect.poll(() => page.locator('#playlist-layer video').evaluateAll(elements =>
    elements.some(element => element.currentSrc.includes('private-video-copy-sentinel')))).toBe(true);
  await expect.poll(() => page.locator('#slideshow-layer img').evaluateAll(elements =>
    elements.some(element => element.currentSrc.includes('private-image-copy-sentinel')))).toBe(true);

  const liveSignedSources = await page.evaluate(() => [
    window.Blend.state.library.get('private-video')?.sourceUrl,
    window.Blend.state.slideshow[0]?.sourceUrl
  ]);
  expect(liveSignedSources.some(source => source?.includes('private-video-copy-sentinel'))).toBe(true);
  expect(liveSignedSources.some(source => source?.includes('private-image-copy-sentinel'))).toBe(true);
  await page.evaluate(() => window.Blend.flushSaveState());
  const durableBeforeSignOut = await readPersistedMediaStores(page);
  expect(containsPrivateSignedUrlOrToken(durableBeforeSignOut)).toBe(false);
  expect(durableBeforeSignOut).toContain('supabase://media/private/playlist.mp4');
  expect(durableBeforeSignOut).toContain('supabase://media/private/slideshow.jpeg');

  const activeExperienceId = await page.evaluate(() => window.Blend.state.activeExperienceId);
  await app.openConfig();
  await page.locator('#supabase-sign-out').click();
  const signOutAlert = page.getByRole('alert');
  const signInAction = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(signOutAlert).toContainText(signedOutCopy);
  await expect(signInAction).toBeVisible();

  const originalViewport = page.viewportSize() || { width: 1366, height: 900 };
  const signOutViewports = [
    { width: 320, height: 480 },
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 720 }
  ];
  for (const viewport of signOutViewports) {
    await page.setViewportSize(viewport);
    await expect(signOutAlert).toBeVisible();
    const layout = await signOutAlert.evaluate(toast => {
      const rect = toast.getBoundingClientRect();
      const message = toast.querySelector('span');
      const action = toast.querySelector('button');
      const messageRect = message.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        pageScrollWidth: document.documentElement.scrollWidth,
        pageClientWidth: document.documentElement.clientWidth,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        messageScrollWidth: message.scrollWidth,
        messageClientWidth: message.clientWidth,
        messageHeight: messageRect.height,
        messageLineHeight: parseFloat(getComputedStyle(message).lineHeight) || 0,
        messageWhiteSpace: getComputedStyle(message).whiteSpace,
        actionLeft: actionRect.left,
        actionRight: actionRect.right,
        actionBottom: actionRect.bottom
      };
    });
    expect(layout.right, `${viewport.width}x${viewport.height}: toast right`).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.left, `${viewport.width}x${viewport.height}: toast left`).toBeGreaterThanOrEqual(0);
    expect(layout.bottom, `${viewport.width}x${viewport.height}: toast bottom`).toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.top, `${viewport.width}x${viewport.height}: toast top`).toBeGreaterThanOrEqual(0);
    expect(layout.pageScrollWidth, `${viewport.width}x${viewport.height}: page overflow`).toBeLessThanOrEqual(layout.pageClientWidth + 2);
    expect(layout.messageScrollWidth, `${viewport.width}x${viewport.height}: message overflow`).toBeLessThanOrEqual(layout.messageClientWidth + 1);
    expect(layout.messageWhiteSpace, `${viewport.width}x${viewport.height}: wrapping`).not.toBe('nowrap');
    expect(layout.actionLeft, `${viewport.width}x${viewport.height}: action left`).toBeGreaterThanOrEqual(layout.left);
    expect(layout.actionRight, `${viewport.width}x${viewport.height}: action right`).toBeLessThanOrEqual(layout.right + 1);
    expect(layout.actionBottom, `${viewport.width}x${viewport.height}: action clipped`).toBeLessThanOrEqual(layout.viewportHeight + 1);
    if (viewport.width === 320) {
      expect(layout.messageHeight, `${viewport.width}x${viewport.height}: message should wrap`)
        .toBeGreaterThan(layout.messageLineHeight);
    }
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(signOutAlert).toBeVisible();
  await signInAction.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(signInAction).toBeFocused();
  expect(await signInAction.evaluate(element => element.matches(':focus-visible'))).toBe(true);

  // A 200% page zoom at 320x480 leaves an effective 160x240 CSS viewport.
  await page.setViewportSize({ width: 160, height: 240 });
  const zoomLayout = await signOutAlert.evaluate(toast => {
    const rect = toast.getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      pageScrollWidth: document.documentElement.scrollWidth,
      pageClientWidth: document.documentElement.clientWidth,
      overflowY: getComputedStyle(toast).overflowY,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom
    };
  });
  await expect(signOutAlert).toBeVisible();
  expect(zoomLayout.left).toBeGreaterThanOrEqual(0);
  expect(zoomLayout.right).toBeLessThanOrEqual(zoomLayout.viewportWidth + 1);
  expect(zoomLayout.top).toBeGreaterThanOrEqual(0);
  expect(zoomLayout.bottom).toBeLessThanOrEqual(zoomLayout.viewportHeight + 1);
  expect(zoomLayout.pageScrollWidth).toBeLessThanOrEqual(zoomLayout.pageClientWidth + 2);
  expect(zoomLayout.overflowY).toBe('auto');
  await signInAction.evaluate(element => element.blur());
  await signInAction.focus();
  const [actionBounds, toastBounds] = await Promise.all([
    signInAction.boundingBox(),
    signOutAlert.boundingBox()
  ]);
  expect(actionBounds?.y).toBeGreaterThanOrEqual(toastBounds?.y || 0);
  expect((actionBounds?.y || 0) + (actionBounds?.height || 0))
    .toBeLessThanOrEqual((toastBounds?.y || 0) + (toastBounds?.height || 0) + 1);
  await page.setViewportSize(originalViewport);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(signOutAlert).toBeVisible();

  await page.waitForFunction(() => window.Blend.state.playlist[0]?.sourceUrl === null
    && window.Blend.state.slideshow[0]?.sourceUrl === null
    && window.Blend.state.library.get('private-video')?.sourceUrl === null
    && window.Blend.state.library.get('private-image')?.sourceUrl === null);
  await page.evaluate(async () => window.Blend.flushSaveState());

  const afterSignOut = await page.evaluate(() => {
    const B = window.Blend;
    const video = B.state.library.get('private-video');
    const image = B.state.library.get('private-image');
    return {
      experienceId: B.state.activeExperienceId,
      playlistIndex: B.state.runtime.playlistIndex,
      slideshowIndex: B.state.runtime.slideshowIndex,
      video: {
        sourceUrl: video.sourceUrl,
        handleSourceUrl: video.handle.sourceUrl,
        hasMetadataSourceUrl: Object.hasOwn(video.metadata, 'sourceUrl'),
        storageReference: video.metadata.storageReference,
        storageBucket: video.metadata.storageBucket,
        storagePath: video.metadata.storagePath,
        curatorNote: video.metadata.curatorNote,
        available: B.state.playlist[0].available
      },
      image: {
        sourceUrl: image.sourceUrl,
        handleSourceUrl: image.handle.sourceUrl,
        hasMetadataSourceUrl: Object.hasOwn(image.metadata, 'sourceUrl'),
        storageReference: image.metadata.storageReference,
        storageBucket: image.metadata.storageBucket,
        storagePath: image.metadata.storagePath,
        curatorNote: image.metadata.curatorNote,
        available: B.state.slideshow[0].available
      },
      publicUrls: [B.state.playlist[1].sourceUrl, B.state.slideshow[1].sourceUrl],
      authStatusText: document.querySelector('#supabase-auth-status')?.textContent || '',
      alertText: document.querySelector('[role="alert"]')?.textContent || '',
      mediaElements: Array.from(document.querySelectorAll('#playlist-layer video, #slideshow-layer video, #slideshow-layer img'))
        .map(element => ({
          tagName: element.tagName,
          sourceAttribute: element.getAttribute('src'),
          sourceProperty: element.src,
          paused: element.tagName === 'VIDEO' ? element.paused : undefined,
          readyState: element.tagName === 'VIDEO' ? element.readyState : undefined,
          networkState: element.tagName === 'VIDEO' ? element.networkState : undefined
        })),
      log: B.log.exportJson(),
      body: document.body.innerText
    };
  });
  expect(afterSignOut.experienceId).toBe(activeExperienceId);
  expect(afterSignOut.playlistIndex).toBe(0);
  expect(afterSignOut.slideshowIndex).toBe(0);
  for (const item of [afterSignOut.video, afterSignOut.image]) {
    expect(item.sourceUrl).toBeNull();
    expect(item.handleSourceUrl).toBeNull();
    expect(item.hasMetadataSourceUrl).toBe(false);
    expect(item.storageReference).toContain('supabase://media/private/');
    expect(item.storageBucket).toBe('media');
    expect(item.storagePath).toContain('private/');
    expect(item.curatorNote).toMatch(/^keep-private-/);
    expect(item.available).toBe(false);
  }
  expect(afterSignOut.publicUrls).toEqual([
    `${new URL(afterSignOut.publicUrls[0]).origin}/samples/nyc-01.mp4?public=playlist`,
    `${new URL(afterSignOut.publicUrls[1]).origin}/samples/IL.jpeg?public=slideshow`
  ]);
  expect(afterSignOut.mediaElements.every(element => !element.sourceAttribute && !element.sourceProperty)).toBe(true);
  expect(afterSignOut.mediaElements.filter(element => element.tagName === 'VIDEO')
    .every(element => element.paused && element.readyState === 0 && element.networkState === 0)).toBe(true);
  expect(containsPrivateSignedUrlOrToken(`${afterSignOut.authStatusText}\n${afterSignOut.alertText}\n${afterSignOut.body}`)).toBe(false);
  expect(containsPrivateSignedUrlOrToken(afterSignOut.log)).toBe(false);
  expect(afterSignOut.body).not.toMatch(/signed URLs? (?:were )?revoked/i);
  const durableAfterSignOut = await readPersistedMediaStores(page);
  expect(containsPrivateSignedUrlOrToken(durableAfterSignOut)).toBe(false);

  const copiedLinkStatus = await page.evaluate(async url => (await fetch(url)).status, copiedUrl);
  expect(copiedLinkStatus).toBe(200);
  const privateMediaRequestsAfterCopiedFetch = privateMediaRequests.length;
  expect(signingRequests).toHaveLength(0);
  expect(logoutRequests).toHaveLength(1);

  await page.evaluate(() => {
    window.Blend.state.ui.activeList = 'playlist';
    window.Blend.renderListEditor();
  });
  await page.locator('#list-editor .list-item[data-idx="1"]').click();
  await expect.poll(() => page.locator('#playlist-layer video').evaluateAll(elements =>
    elements.some(element => element.currentSrc.includes('/samples/nyc-01.mp4?public=playlist')))).toBe(true);
  expect(privateMediaRequests).toHaveLength(privateMediaRequestsAfterCopiedFetch);
  await page.evaluate(() => {
    window.Blend.state.ui.activeList = 'slideshow';
    window.Blend.renderListEditor();
  });
  await page.locator('#list-editor .list-item[data-idx="1"]').click();
  await expect.poll(() => page.locator('#slideshow-layer img').evaluateAll(elements =>
    elements.some(element => element.currentSrc.includes('/samples/IL.jpeg?public=slideshow')))).toBe(true);
  expect(privateMediaRequests).toHaveLength(privateMediaRequestsAfterCopiedFetch);
  expect(signingRequests).toHaveLength(0);

  await page.evaluate(() => {
    window.Blend.state.ui.activeList = 'playlist';
    window.Blend.renderListEditor();
  });
  await page.locator('#list-editor .list-item[data-idx="2"]').click();
  await expect.poll(() => page.locator('#playlist-layer video').evaluateAll(elements =>
    elements.some(element => element.currentSrc.startsWith('blob:')))).toBe(true);
  expect(privateMediaRequests).toHaveLength(privateMediaRequestsAfterCopiedFetch);
  expect(signingRequests).toHaveLength(0);

  await openAuthDialog(app);
  await page.locator('#supabase-auth-token').fill(ACCESS_TOKEN);
  await page.locator('#supabase-auth-refresh-token').fill(REFRESH_TOKEN);
  await page.locator('[data-auth-submit]').click();
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();
  await expect(page.locator('#list-editor .list-item[data-idx="0"] .retry-media')).toBeVisible();
  await page.locator('#list-editor .list-item[data-idx="0"] .retry-media').click();
  await expect.poll(() => signingRequests.length).toBe(1);
  await expect.poll(() => page.locator('#playlist-layer video').evaluateAll(elements =>
    elements.some(element => element.currentSrc.includes('private-media-retry-1')))).toBe(true);
  await page.evaluate(() => window.Blend.flushSaveState());
  const durableAfterRetry = await readPersistedMediaStores(page);
  expect(containsPrivateSignedUrlOrToken(durableAfterRetry)).toBe(false);
  expect(durableAfterRetry).toContain('supabase://media/private/playlist.mp4');
});

test('sign-out offers an accessible retry when local media cleanup fails without logging bearer data', async ({ page }) => {
  const normalCopy = 'Signing out stops playback in this tab. A copied link may still work until its provider and cache lifetime ends.';
  const incompleteCopy = 'Local cleanup is incomplete. Retry to clear remaining sources and save private references. A copied link may still work until its provider and cache lifetime ends.';
  const imagePath = fileURLToPath(new URL('../../samples/IL.jpeg', import.meta.url));
  const sourceUrl = 'http://127.0.0.1:4191/storage/v1/object/sign/media/private/failure.jpeg?token=cleanup-failure-sentinel';
  const reference = 'supabase://media/private/failure.jpeg';
  await page.route('**/auth/v1/logout', route => route.fulfill({ status: 200, body: '{}' }));
  await page.route('**/storage/v1/object/sign/**', route => route.fulfill({ status: 200, contentType: 'image/jpeg', path: imagePath }));

  const app = new BlendAppPage(page);
  await page.addInitScript(() => {
    try { Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true }); } catch (_) {}
  });
  await app.boot();
  await openAuthDialog(app);
  await page.locator('#supabase-auth-token').fill(ACCESS_TOKEN);
  await page.locator('#supabase-auth-refresh-token').fill(REFRESH_TOKEN);
  await page.locator('[data-auth-submit]').click();
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();

  await page.evaluate(({ sourceUrl, reference }) => {
    const B = window.Blend;
    const metadata = {
      sourceUrl,
      signedUrlExpiresAt: Date.now() + 60_000,
      storageReference: reference,
      storageBucket: 'media',
      storagePath: 'private/failure.jpeg',
      curatorNote: 'keep failure record'
    };
    B.state.library.set('cleanup-failure', {
      id: 'cleanup-failure', name: 'Cleanup failure.jpeg', type: 'image', sourceUrl,
      pathHint: reference, handle: { remote: true, sourceUrl }, metadata: { ...metadata }
    });
    B.state.slideshow = [{
      id: 'cleanup-failure', name: 'Cleanup failure.jpeg', type: 'image', sourceUrl,
      path: reference, available: true, metadata: { ...metadata }
    }];
    B.renderLibrary();
    B.renderListEditor();

    const probe = document.createElement('img');
    probe.id = 'signed-cleanup-failure-probe';
    probe.setAttribute('src', sourceUrl);
    document.body.append(probe);
    const remove = probe.removeAttribute.bind(probe);
    let failOnce = true;
    probe.removeAttribute = name => {
      if (name === 'src' && failOnce) {
        failOnce = false;
        throw new Error(`${sourceUrl} ${reference}`);
      }
      return remove(name);
    };
  }, { sourceUrl, reference });
  await page.evaluate(() => window.Blend.flushSaveState());
  expect(containsPrivateSignedUrlOrToken(await readPersistedMediaStores(page))).toBe(false);
  await app.openConfig();
  const playbackStateBeforeSignOut = await page.evaluate(() => {
    const B = window.Blend;
    return [
      B.state.runtime.playlistIndex ?? null,
      B.state.runtime.slideshowIndex ?? null,
      B.state.slideshow[0]?.id ?? null
    ];
  });
  await page.locator('#supabase-sign-out').click();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('alert')).toContainText(incompleteCopy);
  const retryButton = page.getByRole('button', { name: 'Retry cleanup', exact: true });
  await expect(retryButton).toBeVisible();
  const alertBox = await page.getByRole('alert').boundingBox();
  const retryBox = await retryButton.boundingBox();
  expect(alertBox).toBeTruthy();
  expect(retryBox).toBeTruthy();
  expect(alertBox.x).toBeGreaterThanOrEqual(0);
  expect(alertBox.x + alertBox.width).toBeLessThanOrEqual(375);
  expect(retryBox.x).toBeGreaterThanOrEqual(0);
  expect(retryBox.x + retryBox.width).toBeLessThanOrEqual(375);

  const failedCleanupState = await page.evaluate(expectedUrl => {
    const B = window.Blend;
    const diagnostics = [
      document.querySelector('#supabase-auth-status')?.textContent || '',
      document.querySelector('.toast-private-media-signout')?.textContent || '',
      B.log.exportJson()
    ].join('\n');
    return {
      mediaSourceRetained: document.querySelector('#signed-cleanup-failure-probe')?.getAttribute('src') === expectedUrl,
      itemSourceCleared: B.state.library.get('cleanup-failure')?.sourceUrl === null,
      reference: B.state.library.get('cleanup-failure')?.metadata?.storageReference,
      diagnosticsContainBearerData: /\/storage\/v1\/object\/sign\/[^?#\s"'<>]+|[?&]token=[^&#\s"'<>]+/i.test(diagnostics),
      playbackState: [
        B.state.runtime.playlistIndex ?? null,
        B.state.runtime.slideshowIndex ?? null,
        B.state.slideshow[0]?.id ?? null
      ]
    };
  }, sourceUrl);
  expect(failedCleanupState.mediaSourceRetained).toBe(true);
  expect(failedCleanupState.itemSourceCleared).toBe(true);
  expect(failedCleanupState.reference).toBe(reference);
  expect(failedCleanupState.diagnosticsContainBearerData).toBe(false);
  expect(failedCleanupState.playbackState).toEqual(playbackStateBeforeSignOut);
  expect(containsPrivateSignedUrlOrToken(await readPersistedMediaStores(page))).toBe(false);

  await retryButton.focus();
  await expect(retryButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast-container')).toContainText(normalCopy);
  expect(await page.locator('#signed-cleanup-failure-probe').getAttribute('src')).toBeNull();
  expect(containsPrivateSignedUrlOrToken(await readPersistedMediaStores(page))).toBe(false);
});

test('sign-out cancels pending private signing and ignores its late response', async ({ page }) => {
  const signedOutCopy = 'Signing out stops playback in this tab. A copied link may still work until its provider and cache lifetime ends.';
  const imagePath = fileURLToPath(new URL('../../samples/IL.jpeg', import.meta.url));
  const signingRequests = [];
  let releaseSigning;
  let notifySigningStarted;
  let notifyRouteFinished;
  const signingGate = new Promise(resolve => { releaseSigning = resolve; });
  const signingStarted = new Promise(resolve => { notifySigningStarted = resolve; });
  const routeFinished = new Promise(resolve => { notifyRouteFinished = resolve; });
  await page.route('**/auth/v1/logout', route => route.fulfill({ status: 200, body: '{}' }));
  await page.route('**/storage/v1/object/sign/**', async route => {
    if (route.request().method() === 'POST') {
      signingRequests.push('private-image');
      notifySigningStarted();
      await signingGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ signedURL: '/storage/v1/object/sign/media/private/pending.jpeg?token=late-signout-response' })
        });
      } catch (_) {
        // The auth sign-out may have already aborted this routed fetch.
      } finally {
        notifyRouteFinished();
      }
      return;
    }
    await route.fulfill({ status: 200, contentType: 'image/jpeg', path: imagePath });
  });

  const app = new BlendAppPage(page);
  await page.addInitScript(() => {
    try { Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true }); } catch (_) {}
  });
  await app.boot();
  await openAuthDialog(app);
  await page.locator('#supabase-auth-token').fill(ACCESS_TOKEN);
  await page.locator('#supabase-auth-refresh-token').fill(REFRESH_TOKEN);
  await page.locator('[data-auth-submit]').click();
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();
  await page.evaluate(() => {
    const B = window.Blend;
    const reference = 'supabase://media/private/pending.jpeg';
    const sourceUrl = `${location.origin}/storage/v1/object/sign/media/private/pending.jpeg?token=expired-before-signout`;
    const metadata = {
      sourceUrl,
      signedUrlExpiresAt: Date.now() - 1,
      storageReference: reference,
      storageBucket: 'media',
      storagePath: 'private/pending.jpeg'
    };
    B.state.library.set('pending-private-image', {
      id: 'pending-private-image', name: 'Pending private.jpeg', type: 'image', sourceUrl,
      pathHint: reference, handle: { remote: true, sourceUrl }, metadata: { ...metadata }, stale: false
    });
    B.state.slideshow = [{
      id: 'pending-private-image', name: 'Pending private.jpeg', type: 'image', sourceUrl,
      path: reference, available: true, metadata: { ...metadata }
    }];
    B.state.runtime.slideshowIndex = 0;
    B.renderLibrary();
    B.renderListEditor();
    void B.play();
  });

  await signingStarted;
  await app.openConfig();
  await page.locator('#supabase-sign-out').click();
  await expect(page.locator('#toast-container')).toContainText(signedOutCopy);
  await page.waitForFunction(() => window.Blend.state.library.get('pending-private-image')?.sourceUrl === null
    && window.Blend.state.slideshow[0]?.sourceUrl === null);
  releaseSigning();
  await routeFinished;
  await expect.poll(() => page.evaluate(() => ({
    itemUrl: window.Blend.state.library.get('pending-private-image')?.sourceUrl,
    refUrl: window.Blend.state.slideshow[0]?.sourceUrl,
    storageReference: window.Blend.state.library.get('pending-private-image')?.metadata?.storageReference,
    mediaSources: Array.from(document.querySelectorAll('#slideshow-layer img')).map(element => element.getAttribute('src'))
  }))).toEqual({
    itemUrl: null,
    refUrl: null,
    storageReference: 'supabase://media/private/pending.jpeg',
    mediaSources: []
  });
  expect(signingRequests).toEqual(['private-image']);
});

test('a peer tab clears signed media when it receives the existing local-reset event', async ({ page }) => {
  const imagePath = fileURLToPath(new URL('../../samples/IL.jpeg', import.meta.url));
  await page.route('**/storage/v1/object/sign/**', route => route.fulfill({
    status: 200,
    contentType: 'image/jpeg',
    path: imagePath
  }));
  const peer = await page.context().newPage();
  await peer.route('**/storage/v1/object/sign/**', route => route.fulfill({
    status: 200,
    contentType: 'image/jpeg',
    path: imagePath
  }));
  const senderApp = new BlendAppPage(page);
  const peerApp = new BlendAppPage(peer);
  await senderApp.boot();
  await peerApp.boot();

  await peer.evaluate(() => {
    const B = window.Blend;
    const sourceUrl = `${location.origin}/storage/v1/object/sign/media/private/peer.jpeg?token=peer-tab-private-token`;
    const reference = 'supabase://media/private/peer.jpeg';
    const metadata = {
      sourceUrl,
      signedUrlExpiresAt: Date.now() + 60_000,
      storageReference: reference,
      storageBucket: 'media',
      storagePath: 'private/peer.jpeg'
    };
    B.state.library.set('peer-private-image', {
      id: 'peer-private-image', name: 'Peer private.jpeg', type: 'image', sourceUrl, pathHint: reference,
      handle: { remote: true, sourceUrl }, metadata: { ...metadata }, stale: false
    });
    B.state.slideshow = [{
      id: 'peer-private-image', name: 'Peer private.jpeg', type: 'image', sourceUrl, path: reference,
      available: true, metadata: { ...metadata }
    }];
    const image = document.createElement('img');
    image.id = 'peer-private-media';
    image.src = sourceUrl;
    document.querySelector('#slideshow-layer .kenburns-wrapper').appendChild(image);
    B.renderListEditor();
  });

  await expect.poll(() => peer.evaluate(() => window.Blend.state.slideshow[0]?.sourceUrl))
    .toContain('peer-tab-private-token');
  await page.evaluate(() => {
    const channel = new BroadcastChannel('blend-supabase-auth-local-reset-v1:blend-supabase-auth-session-v2');
    channel.postMessage({ type: 'local-reset', nonce: 'synthetic-peer-local-reset' });
    channel.close();
  });
  await expect(peer.locator('#toast-container')).toContainText('Signing out stops playback in this tab. A copied link may still work until its provider and cache lifetime ends.');
  const peerState = await peer.evaluate(() => ({
    listUrl: window.Blend.state.slideshow[0]?.sourceUrl,
    itemUrl: window.Blend.state.library.get('peer-private-image')?.sourceUrl,
    reference: window.Blend.state.slideshow[0]?.metadata?.storageReference,
    index: window.Blend.state.runtime.slideshowIndex,
    mediaSource: document.querySelector('#peer-private-media')?.getAttribute('src')
  }));
  expect(peerState.listUrl).toBeNull();
  expect(peerState.itemUrl).toBeNull();
  expect(peerState.reference).toBe('supabase://media/private/peer.jpeg');
  expect(peerState.index).toBe(0);
  expect(peerState.mediaSource).toBeNull();
  await peer.close();
});
