import { expect, test } from '@playwright/test';

async function waitForServiceWorker(page) {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return true;
    await new Promise(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
    });
    return true;
  });
}

test('friendly alias navigation resolves to the cached app shell', async ({ page, context }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForServiceWorker(page);

  await page.goto('/player?deck=summer#slide-3', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-version')).toHaveText('v5.0.11');
  expect(new URL(page.url()).pathname).toBe('/player');

  await context.setOffline(true);
  await page.goto('/blend?offline=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-version')).toHaveText('v5.0.11');
  await context.setOffline(false);
});
