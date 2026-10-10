import { expect, test } from '@playwright/test';

test('blocked version upgrade shows recovery guidance and continues with saved library data', async ({ context }) => {
  const holder = await context.newPage();
  await holder.goto('/offline.html');
  await holder.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 4);
    request.onupgradeneeded = event => {
      const library = event.target.result.createObjectStore('library', { keyPath: 'id' });
      library.put({
        id: 'saved-before-blocked-upgrade',
        name: 'saved-before-upgrade.jpg',
        type: 'image',
        pathHint: 'samples/IL.jpeg',
        sourceUrl: 'https://media.example.test/saved-before-upgrade.jpg',
        size: 128
      });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      window.__heldBlendDatabase = request.result;
      resolve();
    };
  }));

  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
  });
  await page.goto('/index.html');

  const recovery = page.locator('#database-startup-recovery');
  await expect(recovery).toBeVisible();
  await expect(page.locator('#database-startup-message')).toContainText('Close the other Blend tab');
  await expect(page.locator('#database-startup-retry')).toBeHidden();
  expect(await page.evaluate(() => Boolean(window.Blend))).toBe(false);

  await holder.evaluate(() => window.__heldBlendDatabase.close());
  await page.waitForFunction(() => window.Blend?.state?.library?.has('saved-before-blocked-upgrade'));
  await expect(recovery).toBeHidden();
  expect(await page.evaluate(() => window.Blend.state.library.get('saved-before-blocked-upgrade')?.name))
    .toBe('saved-before-upgrade.jpg');
  expect(await page.evaluate(() => window.Blend?.state?.settings?.opacity)).not.toBeUndefined();

  await holder.close();
  await page.close();
});

test('bootstrap catches an open error and a deliberate retry initializes the app', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
    window.__unhandledBootstrapRejections = 0;
    window.addEventListener('unhandledrejection', event => {
      window.__unhandledBootstrapRejections += 1;
      event.preventDefault();
    });

    const factoryPrototype = Object.getPrototypeOf(indexedDB);
    const nativeOpen = factoryPrototype.open;
    let failFirstOpen = true;
    Object.defineProperty(factoryPrototype, 'open', {
      configurable: true,
      writable: true,
      value: function (...args) {
        if (failFirstOpen) {
          failFirstOpen = false;
          const request = { error: new DOMException('Synthetic open failure', 'UnknownError') };
          setTimeout(() => request.onerror?.({ target: request }), 0);
          return request;
        }
        return nativeOpen.apply(this, args);
      }
    });
  });

  await page.goto('/index.html');
  await expect(page.locator('#database-startup-recovery')).toBeVisible();
  await expect(page.locator('#database-startup-message')).toContainText('could not open your saved library');
  await expect(page.getByRole('button', { name: 'Retry startup' })).toBeVisible();
  expect(await page.evaluate(() => Boolean(window.Blend))).toBe(false);

  await page.getByRole('button', { name: 'Retry startup' }).click();
  await page.waitForFunction(() => Boolean(window.Blend?.state));
  await expect(page.locator('#database-startup-recovery')).toBeHidden();
  expect(await page.evaluate(() => window.__unhandledBootstrapRejections)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('a later schema upgrade closes the stale app connection and requests a reload', async ({ context }) => {
  const appPage = await context.newPage();
  await appPage.addInitScript(() => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
  });
  await appPage.goto('/index.html');
  await appPage.waitForFunction(() => window.Blend?.state);
  await appPage.waitForTimeout(1400);

  const upgradePage = await context.newPage();
  await upgradePage.goto('/offline.html');
  const upgradedVersion = await upgradePage.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 6);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const version = database.version;
      database.close();
      resolve(version);
    };
  }));

  expect(upgradedVersion).toBe(6);
  await expect(appPage.locator('#toast-container'))
    .toContainText('Blend storage changed in another tab. Reload this tab before continuing.');

  await upgradePage.close();
  await appPage.close();
});
