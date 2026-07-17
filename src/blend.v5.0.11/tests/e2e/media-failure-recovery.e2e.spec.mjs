import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

test('a 521 media failure is retried, then remains recoverable instead of becoming stale', async ({ page }) => {
  const app = new BlendAppPage(page);
  await app.boot();
  await app.openConfig();

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
      reason: ref.reason
    };
  });
  expect(recovery.stale).toBe(false);
  expect(recovery.available).toBe(false);
  expect(recovery.retryAfter).toBeGreaterThan(Date.now());
  expect(recovery.reason).toContain('temporarily unavailable');
});
