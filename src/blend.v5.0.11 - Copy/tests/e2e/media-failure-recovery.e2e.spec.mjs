import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const STORAGE_TIMEOUT_COPY = 'The storage request timed out. Check your connection and retry.';

async function signInForPrivateMedia(page, app) {
  await app.openConfig();
  await page.locator('#supabase-sign-in').click();
  await page.locator('#supabase-auth-token').fill('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdG9yYWdlLXRpbWVvdXQtZTJlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.signature');
  await page.locator('[data-auth-submit]').click();
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();
}

async function installPrivateAndLocalSlideshow(page) {
  // Let app startup handle verification finish before replacing its library
  // with in-memory fixtures that intentionally use lightweight fake handles.
  await page.waitForTimeout(1300);
  return page.evaluate(async () => {
    const B = window.Blend;
    const reference = 'supabase://media/private/stalled-image.png';
    const expiredUrl = `${location.origin}/samples/IL.jpeg?token=expired-sentinel`;
    const metadata = {
      storageReference: reference,
      storageBucket: 'media',
      storagePath: 'private/stalled-image.png',
      signedUrlExpiresAt: Date.now() - 1
    };
    const privateItem = {
      id: 'stalled-private-image',
      name: 'Stalled private image.png',
      pathHint: reference,
      sourceUrl: expiredUrl,
      type: 'image',
      size: 0,
      stale: false,
      handle: { remote: true, sourceUrl: expiredUrl },
      metadata: { ...metadata }
    };
    const localBlob = await fetch('/samples/IL.jpeg').then(response => response.blob());
    const localFile = new File([localBlob], 'IL.jpeg', { type: localBlob.type || 'image/jpeg' });
    const localItem = {
      id: 'local-fallback-image',
      name: 'Local fallback image.jpeg',
      pathHint: 'Local fallback image.jpeg',
      sourceUrl: '',
      type: 'image',
      size: localFile.size,
      stale: false,
      handle: { getFile: async () => localFile },
      metadata: {}
    };
    B.state.library = new Map([[privateItem.id, privateItem], [localItem.id, localItem]]);
    B.state.playlist = [];
    B.state.slideshow = [
      { id: privateItem.id, name: privateItem.name, path: reference, sourceUrl: expiredUrl, type: 'image', available: true, metadata: { ...metadata } },
      { id: localItem.id, name: localItem.name, path: localItem.pathHint, sourceUrl: '', type: 'image', available: true, displayDuration: 60, metadata: {} }
    ];
    B.state.runtime.slideshowIndex = 0;
    B.state.ui.activeList = 'slideshow';
    B.renderLibrary();
    B.renderListEditor();
    return { reference, expiredUrl };
  });
}

test('a 521 media failure is retried, then remains recoverable instead of becoming stale', async ({ page }) => {
  const app = new BlendAppPage(page);
  await app.boot();
  await app.openConfig();
  await page.waitForTimeout(1300);

  await page.route('**/transient-521.mp4', route => route.fulfill({
    status: 521,
    contentType: 'text/plain',
    body: 'Web server is down'
  }));

  await page.evaluate(() => {
    const B = window.Blend;
    const sourceUrl = `${location.origin}/transient-521.mp4`;
    B.state.library = new Map([[
      'transient-video',
      {
        id: 'transient-video',
        name: 'Transient video.mp4',
        pathHint: sourceUrl,
        sourceUrl,
        type: 'video',
        size: 0,
        stale: false,
        handle: { remote: true }
      }
    ]]);
    B.state.playlist = [{
      id: 'transient-video', name: 'Transient video.mp4', path: sourceUrl,
      sourceUrl, type: 'video', available: true
    }];
    B.state.slideshow = [];
    B.state.ui.activeList = 'playlist';
    B.renderLibrary();
    B.renderListEditor();
  });

  await page.evaluate(() => window.Blend.play());

  const row = page.locator('#list-editor .list-item[data-idx="0"]');
  await expect(row).toHaveClass(/temporarily-unavailable/, { timeout: 12_000 });
  await expect(row.locator('.availability')).toHaveText('Temporarily unavailable');
  await expect(row.locator('.retry-media')).toBeVisible();

  const recovery = await page.evaluate(() => {
    const item = window.Blend.state.library.get('transient-video');
    const ref = window.Blend.state.playlist[0];
    return {
      stale: item.stale,
      available: ref.available,
      retryAfter: ref.retryAfter,
      reason: ref.reason,
      lastStorageError: item.metadata?.lastStorageError || ''
    };
  });
  expect(recovery.stale, JSON.stringify(recovery)).toBe(false);
  expect(recovery.available).toBe(false);
  expect(recovery.retryAfter).toBeGreaterThan(Date.now());
  expect(recovery.reason).toContain('temporarily unavailable');
});

test('expired Supabase signed URLs renew from the portable reference and direct URLs stay direct', async ({ page }) => {
  const fakeNow = Date.UTC(2026, 0, 1);
  await page.addInitScript(startTime => {
    let now = startTime;
    Date.now = () => now;
    window.__blendE2eClock = {
      now: () => now,
      advance: milliseconds => { now += Number(milliseconds) || 0; }
    };
  }, fakeNow);

  let signingRequests = 0;
  await page.route('**/storage/v1/object/sign/**', async route => {
    signingRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        signedURL: `/samples/IL.jpeg?token=refreshed-${signingRequests}`
      })
    });
  });

  const app = new BlendAppPage(page);
  await app.boot();
  await app.openConfig();
  await page.locator('#supabase-sign-in').click();
  await page.locator('#supabase-auth-token').fill('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWUyZSIsImVtYWlsIjoiZTJlQGV4YW1wbGUudGVzdCIsImV4cCI6NDEwMjQ0NDgwMH0.signature');
  await page.locator('[data-auth-submit]').click();
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();

  const portableReference = 'supabase://media/private/renewal.png';
  await page.evaluate(reference => {
    const B = window.Blend;
    const now = window.__blendE2eClock.now();
    const expiredUrl = `${location.origin}/samples/IL.jpeg?token=expired-before-play`;
    const metadata = {
      storageReference: reference,
      storageBucket: 'media',
      storagePath: 'private/renewal.png',
      signedUrlExpiresAt: now - 1
    };
    const item = {
      id: 'private-renewal-image',
      name: 'Private renewal.png',
      pathHint: reference,
      sourceUrl: expiredUrl,
      type: 'image',
      size: 0,
      stale: false,
      handle: { remote: true, sourceUrl: expiredUrl },
      metadata: { ...metadata }
    };
    B.state.library = new Map([[item.id, item]]);
    B.state.playlist = [];
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
    B.state.settings.storageSignedUrlTtlSeconds = 120;
    B.state.ui.activeList = 'slideshow';
    B.renderLibrary();
    B.renderListEditor();
  }, portableReference);

  await page.evaluate(() => window.Blend.play());
  expect(signingRequests).toBe(1);
  const firstResolution = await page.evaluate(() => {
    const item = window.Blend.state.library.get('private-renewal-image');
    const ref = window.Blend.state.slideshow[0];
    return {
      sourceUrl: item.sourceUrl,
      itemReference: item.metadata.storageReference,
      refSourceUrl: ref.sourceUrl,
      refReference: ref.metadata.storageReference,
      itemExpiry: item.metadata.signedUrlExpiresAt,
      refExpiry: ref.metadata.signedUrlExpiresAt
    };
  });
  expect(firstResolution.sourceUrl).toContain('token=refreshed-1');
  expect(firstResolution.itemReference).toBe(portableReference);
  expect(firstResolution.refSourceUrl).toBe(firstResolution.sourceUrl);
  expect(firstResolution.refReference).toBe(portableReference);
  expect(firstResolution.itemExpiry).toBeGreaterThan(fakeNow);
  expect(firstResolution.refExpiry).toBe(firstResolution.itemExpiry);

  await page.evaluate(async () => {
    await window.Blend.stop();
    await window.Blend.play();
  });
  expect(signingRequests).toBe(1);
  await expect.poll(async () => page.evaluate(() => window.Blend.state.slideshow[0].sourceUrl))
    .toContain('token=refreshed-1');

  await page.evaluate(() => window.__blendE2eClock.advance(76_000));
  await page.evaluate(async () => {
    await window.Blend.stop();
    await window.Blend.play();
  });
  expect(signingRequests).toBe(2);
  const refreshedResolution = await page.evaluate(() => {
    const item = window.Blend.state.library.get('private-renewal-image');
    const ref = window.Blend.state.slideshow[0];
    return {
      sourceUrl: item.sourceUrl,
      itemReference: item.metadata.storageReference,
      refSourceUrl: ref.sourceUrl,
      refReference: ref.metadata.storageReference,
      itemExpiry: item.metadata.signedUrlExpiresAt,
      refExpiry: ref.metadata.signedUrlExpiresAt
    };
  });
  expect(refreshedResolution.sourceUrl).toContain('token=refreshed-2');
  expect(refreshedResolution.itemReference).toBe(portableReference);
  expect(refreshedResolution.refSourceUrl).toBe(refreshedResolution.sourceUrl);
  expect(refreshedResolution.refReference).toBe(portableReference);
  expect(refreshedResolution.itemExpiry).toBeGreaterThan(firstResolution.itemExpiry);
  expect(refreshedResolution.refExpiry).toBe(refreshedResolution.itemExpiry);
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();

  const directUrl = await page.evaluate(() => new URL('/samples/IL.jpeg', location.origin).href);
  await page.evaluate(async url => {
    await window.Blend.stop();
    const item = window.Blend.state.library.get('private-renewal-image');
    const ref = window.Blend.state.slideshow[0];
    item.sourceUrl = url;
    item.pathHint = url;
    item.metadata = { sourceUrl: url };
    item.stale = false;
    ref.sourceUrl = url;
    ref.path = url;
    ref.metadata = { sourceUrl: url };
    ref.available = true;
    delete ref.retryAfter;
    delete ref.reason;
    window.Blend.renderListEditor();
    await window.Blend.play();
  }, directUrl);
  expect(signingRequests).toBe(2);
  const directResolution = await page.evaluate(() => ({
    itemSourceUrl: window.Blend.state.library.get('private-renewal-image').sourceUrl,
    refSourceUrl: window.Blend.state.slideshow[0].sourceUrl
  }));
  expect(directResolution.itemSourceUrl).toBe(directUrl);
  expect(directResolution.refSourceUrl).toBe(directUrl);
});

test('a stalled signing request times out into one retry state and local playback remains available', async ({ page }) => {
  test.setTimeout(45_000);
  const app = new BlendAppPage(page);
  await app.boot();
  await signInForPrivateMedia(page, app);

  let requestCount = 0;
  let releaseFirstRequest;
  let signalRequestStarted;
  let signalFirstRequestSettled;
  const firstRequestStarted = new Promise(resolve => { signalRequestStarted = resolve; });
  const firstRequestSettled = new Promise(resolve => { signalFirstRequestSettled = resolve; });
  await page.route('**/storage/v1/object/sign/**', async route => {
    requestCount += 1;
    if (requestCount === 1) {
      signalRequestStarted();
      await new Promise(resolve => { releaseFirstRequest = resolve; });
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ signedURL: '/samples/IL.jpeg?token=late-stale-response' })
        });
      } catch (_) {
        // The browser has already aborted this route after the client deadline.
      }
      signalFirstRequestSettled();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ signedURL: '/samples/IL.jpeg?token=retry-success' })
    });
  });

  const { reference, expiredUrl } = await installPrivateAndLocalSlideshow(page);
  const row = page.locator('#list-editor .list-item[data-idx="0"]');
  await page.locator('#list-editor .list-item[data-idx="0"] .name').click();
  await firstRequestStarted;
  await expect(row).toHaveClass(/temporarily-unavailable/, { timeout: 25_000 });
  await expect(row.locator('.retry-media')).toHaveCount(1);
  await expect(row.locator('.retry-media')).toBeVisible();
  await expect(page.locator('#toast-container')).toContainText(STORAGE_TIMEOUT_COPY);
  await expect.poll(async () => page.evaluate(() => window.Blend.state.runtime.slideshowIndex), { timeout: 5_000 })
    .toBe(1);
  await expect.poll(async () => page.evaluate(() => document.querySelector('#slideshow-layer img')?.src.startsWith('blob:') || false), { timeout: 2_000 })
    .toBe(true);

  const timedOutState = await page.evaluate(() => {
    const item = window.Blend.state.library.get('stalled-private-image');
    const ref = window.Blend.state.slideshow[0];
    return {
      itemSourceUrl: item.sourceUrl,
      itemStorageReference: item.metadata.storageReference,
      lastStorageError: item.metadata.lastStorageError,
      refSourceUrl: ref.sourceUrl,
      refPath: ref.path,
      available: ref.available,
      stale: item.stale,
      activeIndex: window.Blend.state.runtime.slideshowIndex,
      localImageIsPlaying: document.querySelector('#slideshow-layer img')?.src.startsWith('blob:') || false
    };
  });
  expect(timedOutState).toEqual({
    itemSourceUrl: expiredUrl,
    itemStorageReference: reference,
    lastStorageError: 'storage_request_timeout',
    refSourceUrl: expiredUrl,
    refPath: reference,
    available: false,
    stale: false,
    activeIndex: 1,
    localImageIsPlaying: true
  });
  releaseFirstRequest();
  await firstRequestSettled;
  expect(requestCount).toBe(1);
  await row.locator('.retry-media').click();
  await expect.poll(async () => page.evaluate(() => window.Blend.state.library.get('stalled-private-image').sourceUrl))
    .toContain('token=retry-success');
  expect(requestCount).toBe(2);
  const retriedState = await page.evaluate(() => ({
    reference: window.Blend.state.library.get('stalled-private-image').metadata.storageReference,
    available: window.Blend.state.slideshow[0].available,
    localStillInLibrary: window.Blend.state.library.has('local-fallback-image')
  }));
  expect(retriedState).toEqual({ reference, available: true, localStillInLibrary: true });
});

test('a superseded signing response cannot replace the selected local slideshow item', async ({ page }) => {
  const app = new BlendAppPage(page);
  await app.boot();
  await signInForPrivateMedia(page, app);

  let releaseSigningRequest;
  let signalRequestStarted;
  let signalRequestSettled;
  const requestStarted = new Promise(resolve => { signalRequestStarted = resolve; });
  const requestSettled = new Promise(resolve => { signalRequestSettled = resolve; });
  let requestCount = 0;
  await page.route('**/storage/v1/object/sign/**', async route => {
    requestCount += 1;
    if (requestCount === 1) {
      signalRequestStarted();
      await new Promise(resolve => { releaseSigningRequest = resolve; });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ signedURL: '/samples/IL.jpeg?token=fresh-preload' })
      });
      return;
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ signedURL: '/samples/IL.jpeg?token=late-after-selection' })
      });
    } catch (_) {
      // Selection changes abort the underlying browser request.
    }
    signalRequestSettled();
  });

  const { reference, expiredUrl } = await installPrivateAndLocalSlideshow(page);
  await page.locator('#list-editor .list-item[data-idx="0"] .name').click();
  await requestStarted;
  await page.locator('#list-editor .list-item[data-idx="1"] .name').click();
  await expect.poll(async () => page.evaluate(() => document.querySelector('#slideshow-layer img')?.src.startsWith('blob:') || false))
    .toBe(true);

  releaseSigningRequest();
  await requestSettled;
  const finalState = await page.evaluate(() => {
    const item = window.Blend.state.library.get('stalled-private-image');
    const ref = window.Blend.state.slideshow[0];
    return {
      itemSourceUrl: item.sourceUrl,
      itemReference: item.metadata.storageReference,
      itemError: item.metadata.lastStorageError || '',
      refSourceUrl: ref.sourceUrl,
      refPath: ref.path,
      refAvailable: ref.available,
      activeIndex: window.Blend.state.runtime.slideshowIndex,
      localImageIsPlaying: document.querySelector('#slideshow-layer img')?.src.startsWith('blob:') || false
    };
  });
  expect(finalState.itemSourceUrl).not.toContain('late-after-selection');
  expect(finalState.itemReference).toBe(reference);
  expect(finalState.itemError).toBe('');
  expect(finalState.refSourceUrl).not.toContain('late-after-selection');
  expect(finalState.refPath).toBe(reference);
  expect(finalState.refAvailable).toBe(true);
  expect(finalState.activeIndex).toBe(1);
  expect(finalState.localImageIsPlaying).toBe(true);
});

test('an expired private link without a session stays listed and offers Supabase connection', async ({ page }) => {
  const fakeNow = Date.UTC(2026, 0, 1);
  await page.addInitScript(startTime => {
    let now = startTime;
    Date.now = () => now;
    window.__blendE2eClock = { now: () => now };
  }, fakeNow);

  const app = new BlendAppPage(page);
  await app.boot();
  // Startup verifies persisted handles shortly after boot; install this
  // in-memory remote fixture only after that pass has completed.
  await page.waitForTimeout(1300);
  const portableReference = 'supabase://media/private/no-session.png';
  await page.evaluate(reference => {
    const B = window.Blend;
    const expiredUrl = `${location.origin}/samples/IL.jpeg?token=expired-no-session`;
    const metadata = {
      storageReference: reference,
      storageBucket: 'media',
      storagePath: 'private/no-session.png',
      signedUrlExpiresAt: window.__blendE2eClock.now() - 1
    };
    const item = {
      id: 'private-no-session-image',
      name: 'Private no-session.png',
      pathHint: reference,
      sourceUrl: expiredUrl,
      type: 'image',
      size: 0,
      stale: false,
      handle: { remote: true, sourceUrl: expiredUrl },
      metadata: { ...metadata }
    };
    B.state.library = new Map([[item.id, item]]);
    B.state.playlist = [];
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
  }, portableReference);

  await page.evaluate(() => window.Blend.play());
  await expect(page.locator('#toast-container')).toContainText(
    'This private media link expired. Connect Supabase to refresh access.'
  );
  const retained = await page.evaluate(() => {
    const item = window.Blend.state.library.get('private-no-session-image');
    const ref = window.Blend.state.slideshow[0];
    return {
      inLibrary: !!item,
      stale: item?.stale,
      inSlideshow: window.Blend.state.slideshow.includes(ref),
      storageReference: item?.metadata?.storageReference,
      lastStorageError: item?.metadata?.lastStorageError,
      reason: ref.reason,
      available: ref.available
    };
  });
  expect(retained).toEqual({
    inLibrary: true,
    stale: false,
    inSlideshow: true,
    storageReference: portableReference,
    lastStorageError: 'auth_required',
    reason: 'Connect Supabase to refresh access.',
    available: false
  });
  await expect(page.locator('#list-editor .list-item')).toContainText('Private no-session.png');
  const connect = page.locator('#toast-container button', { hasText: 'Connect' });
  await expect(connect).toBeVisible();
  await connect.click();
  await expect(page.locator('#supabase-auth-modal')).toBeVisible();
  await page.locator('[data-auth-cancel]').click();
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();
});
