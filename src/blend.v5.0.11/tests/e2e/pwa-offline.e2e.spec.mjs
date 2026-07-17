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

test('installed PWA shell reloads while offline', async ({ page, context }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#app-version')).toHaveText('v5.0.11');
  await context.setOffline(false);
});
