import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const PRIVATE_STORAGE_SIGNING_COPY = 'Private Storage signing is unavailable until the project owner records a reviewed policy revision. You can play local files and direct public media URLs, and you can export JSON.';
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

test('unverified private Storage signing is blocked while local and direct playback stay available', async ({ page }) => {
  let signingRequests = 0;
  await page.route('**/storage/v1/object/sign/**', async route => {
    signingRequests += 1;
    await route.abort();
  });

  const app = new BlendAppPage(page);
  await app.boot();
  await app.openConfig();
  const { reference, expiredUrl } = await installPrivateAndLocalSlideshow(page);
  await page.locator('#list-editor .list-item[data-idx="0"] .name').click();

  await expect(page.locator('#toast-container .toast[role="alert"]'))
    .toContainText(PRIVATE_STORAGE_SIGNING_COPY);
  await expect.poll(() => page.evaluate(() => window.Blend.state.runtime.slideshowIndex))
    .toBe(1);
  await expect.poll(() => page.evaluate(() => document.querySelector('#slideshow-layer img')?.src.startsWith('blob:') || false))
    .toBe(true);

  const blockedState = await page.evaluate(() => {
    const item = window.Blend.state.library.get('stalled-private-image');
    const ref = window.Blend.state.slideshow[0];
    return {
      sourceUrl: item.sourceUrl,
      reference: item.metadata.storageReference,
      error: item.metadata.lastStorageError,
      stale: item.stale,
      refSourceUrl: ref.sourceUrl,
      refPath: ref.path,
      refAvailable: ref.available,
      activeIndex: window.Blend.state.runtime.slideshowIndex
    };
  });
  expect(blockedState).toEqual({
    sourceUrl: expiredUrl,
    reference,
    error: 'storage_policy_unverified',
    stale: false,
    refSourceUrl: expiredUrl,
    refPath: reference,
    refAvailable: true,
    activeIndex: 1
  });
  expect(signingRequests).toBe(0);

  const directUrl = await page.evaluate(() => new URL('/samples/IL.jpeg', location.origin).href);
  await page.evaluate(async url => {
    const B = window.Blend;
    await B.stop();
    const item = B.state.library.get('stalled-private-image');
    const ref = B.state.slideshow[0];
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
    B.state.runtime.slideshowIndex = 0;
    B.renderListEditor();
    void B.play();
  }, directUrl);
  await expect.poll(() => page.evaluate(() => document.querySelector('#slideshow-layer img')?.currentSrc || ''))
    .toContain('/samples/IL.jpeg');
  expect(signingRequests).toBe(0);
});
