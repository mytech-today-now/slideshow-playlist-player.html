import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

test('shows concurrent layer timing and cumulative Shared URL checkpoints', async ({ page }) => {
  const app = new BlendAppPage(page);
  await app.boot();
  await app.openConfig();

  await page.evaluate(() => {
    const B = window.Blend;
    B.state.library = new Map([
      ['intro', { id: 'intro', name: 'Intro.mp4', pathHint: 'media/Intro.mp4', type: 'video', duration: 15, size: 1, stale: true }],
      ['feature', { id: 'feature', name: 'Feature.mp4', pathHint: 'media/Feature.mp4', type: 'video', duration: 80, size: 1, stale: true }],
      ['logo', { id: 'logo', name: 'Logo.png', pathHint: 'media/Logo.png', type: 'image', size: 1, stale: true }],
      ['speaker', { id: 'speaker', name: 'Speaker.png', pathHint: 'media/Speaker.png', type: 'image', size: 1, stale: true }],
      ['product', { id: 'product', name: 'Product.jpg', pathHint: 'media/Product.jpg', type: 'image', size: 1, stale: true }]
    ]);
    B.state.playlist = [
      { id: 'intro', name: 'Intro.mp4', path: 'media/Intro.mp4', type: 'video', available: false },
      { id: 'feature', name: 'Feature.mp4', path: 'media/Feature.mp4', type: 'video', available: false }
    ];
    B.state.slideshow = [
      { id: 'logo', name: 'Logo.png', path: 'media/Logo.png', type: 'image', displayDuration: 8, available: false },
      { id: 'speaker', name: 'Speaker.png', path: 'media/Speaker.png', type: 'image', displayDuration: 14, available: false },
      { id: 'product', name: 'Product.jpg', path: 'media/Product.jpg', type: 'image', displayDuration: 15, available: false }
    ];
    B.state.settings.transitionOverlapMs = 0;
    B.state.ui.activeList = 'playlist';
    B.renderListEditor();
  });

  const playlistRows = page.locator('#list-editor .list-item');
  await expect(playlistRows).toHaveCount(2);
  await expect(playlistRows.nth(0)).toContainText('Start00:00');
  await expect(playlistRows.nth(0)).toContainText('End00:15');
  await expect(playlistRows.nth(1)).toContainText('Start00:15');
  await expect(playlistRows.nth(1)).toContainText('End01:35');
  await expect(page.locator('#timeline-playlist-duration')).toHaveText('01:35');
  await expect(page.locator('#timeline-slideshow-duration')).toHaveText('00:37');
  await expect(page.locator('#timeline-combined-duration')).toHaveText('01:35');

  await expect.poll(() => page.evaluate(() => {
    const analysis = window.Blend.timelineAnalysis;
    const atTwentyTwoSeconds = analysis.urlResults.get('22.000000');
    return atTwentyTwoSeconds && {
      playlist: atTwentyTwoSeconds.playlistCount,
      slideshow: atTwentyTwoSeconds.slideshowCount,
      total: atTwentyTwoSeconds.totalCount,
      length: atTwentyTwoSeconds.length,
      status: atTwentyTwoSeconds.health?.label
    };
  })).toEqual({ playlist: 2, slideshow: 3, total: 5, length: expect.any(Number), status: 'SAFE' });

  await page.locator('[data-tab="slideshow"]').click();
  const slideshowRows = page.locator('#list-editor .list-item');
  await expect(slideshowRows).toHaveCount(3);
  await expect(slideshowRows.nth(2)).toContainText('Start00:22');
  await expect(slideshowRows.nth(2)).toContainText('End00:37');
  await expect(slideshowRows.nth(2).locator('.url-health')).toHaveText(/SAFE/);

  await slideshowRows.nth(0).locator('input[type="number"]').fill('10');
  await slideshowRows.nth(0).locator('input[type="number"]').press('Tab');
  await expect(slideshowRows.nth(1)).toContainText('Start00:10');
  await expect(page.locator('#timeline-slideshow-duration')).toHaveText('00:39');
});
