import { expect, test } from '@playwright/test';

const STORE_KEY_PATHS = {
  library: 'id',
  playlist: 'key',
  slideshow: 'key',
  settings: 'key',
  experiences: 'id',
  thumbnails: 'key',
  dirHandles: 'id',
  aliases: 'id',
  aliasMeta: 'key'
};

async function seedDatabase(page, libraryKeyPath = 'id', includeLegacyRecords = false) {
  await page.goto('/offline.html');
  await page.evaluate(({ storeKeyPaths, libraryKeyPath: keyPath, includeLegacyRecords: seedLegacyRecords }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 6);
    request.onupgradeneeded = event => {
      const database = event.target.result;
      for (const [name, expectedKeyPath] of Object.entries(storeKeyPaths)) {
        database.createObjectStore(name, {
          keyPath: name === 'library' ? keyPath : expectedKeyPath
        });
      }
      const savedItem = {
        id: 'saved-in-schema-six',
        name: 'schema-six-library.jpg',
        type: 'image',
        pathHint: 'samples/schema-six-library.jpg',
        sourceUrl: 'https://media.example.test/schema-six-library.jpg',
        size: 128
      };
      if (keyPath === 'url') savedItem.url = 'https://media.example.test/schema-six-library.jpg';
      event.target.transaction.objectStore('library').put(savedItem);
      if (seedLegacyRecords) {
        event.target.transaction.objectStore('playlist').put({
          key: 'default',
          items: [{ id: 'saved-schema-six-playlist-item', addedAt: 2 }],
          mode: 'sequential',
          index: 0,
          meta: {}
        });
        event.target.transaction.objectStore('settings').put({
          key: 'global',
          projectName: 'Saved schema six settings',
          opacity: 0.37,
          autoVerifyOnStartup: false
        });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  }), { storeKeyPaths: STORE_KEY_PATHS, libraryKeyPath, includeLegacyRecords });
}

async function suppressFirstRunPrompts(page) {
  await page.addInitScript(() => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
  });
}

test('opens a higher database version when required stores and key paths remain compatible', async ({ page }) => {
  await seedDatabase(page, 'id', true);
  await suppressFirstRunPrompts(page);

  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__unhandledDatabaseRejections = 0;
    window.addEventListener('unhandledrejection', event => {
      window.__unhandledDatabaseRejections += 1;
      event.preventDefault();
    });
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.Blend?.state?.library?.has('saved-in-schema-six'));

  expect(await page.evaluate(() => window.Blend.state.library.get('saved-in-schema-six')?.name))
    .toBe('schema-six-library.jpg');
  expect(await page.evaluate(() => window.Blend.state.settings.opacity)).toBe(0.37);
  expect(await page.evaluate(() => window.Blend.state.playlist[0]?.id)).toBe('saved-schema-six-playlist-item');

  const configGear = page.getByRole('button', { name: 'Open configuration panel' });
  const configPanel = page.locator('#config-panel');
  await configGear.focus();
  await page.keyboard.press('Enter');
  await expect(configPanel).toHaveClass(/open/);
  await expect(configPanel).toHaveAttribute('aria-hidden', 'false');
  await expect(configGear).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#close-config').focus();
  await page.keyboard.press('Enter');
  await expect(configPanel).not.toHaveClass(/open/);
  await configGear.click();
  await expect(configPanel).toHaveClass(/open/);
  await page.locator('#close-config').click();
  await configGear.focus();
  await page.keyboard.press('Enter');
  await expect(configPanel).toHaveClass(/open/);

  await page.reload();
  await page.waitForFunction(() => window.Blend?.state?.library?.has('saved-in-schema-six'));
  expect(await page.evaluate(() => window.Blend.state.settings.opacity)).toBe(0.37);
  expect(await page.evaluate(() => window.Blend.state.playlist[0]?.id)).toBe('saved-schema-six-playlist-item');

  const databaseVersion = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['library', 'playlist', 'settings'], 'readonly');
      const records = {};
      for (const storeName of ['library', 'playlist', 'settings']) {
        const read = transaction.objectStore(storeName).getAll();
        read.onsuccess = () => { records[storeName] = read.result; };
      }
      transaction.oncomplete = () => {
        database.close();
        resolve({ version: database.version, records });
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  expect(databaseVersion.version).toBe(6);
  expect(databaseVersion.records.library.map(item => item.id)).toContain('saved-in-schema-six');
  expect(databaseVersion.records.playlist.find(record => record.key === 'default')?.items[0]?.id)
    .toBe('saved-schema-six-playlist-item');
  expect(databaseVersion.records.settings.find(record => record.key === 'global')?.opacity).toBe(0.37);
  expect(await page.evaluate(() => window.__unhandledDatabaseRejections)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('rejects an incompatible higher schema without changing its saved records', async ({ page }) => {
  await seedDatabase(page, 'url');
  await suppressFirstRunPrompts(page);

  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/index.html');

  await expect(page.locator('#database-startup-recovery')).toBeVisible();
  await expect(page.locator('#database-startup-message'))
    .toContainText('cannot safely read the saved database schema');
  expect(await page.evaluate(() => Boolean(window.Blend))).toBe(false);
  const savedDatabase = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('library', 'readonly');
      const read = transaction.objectStore('library').getAll();
      read.onsuccess = () => resolve({ version: database.version, records: read.result });
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
    };
  }));

  expect(savedDatabase.version).toBe(6);
  expect(savedDatabase.records).toHaveLength(1);
  expect(savedDatabase.records[0].id).toBe('saved-in-schema-six');
  expect(pageErrors).toEqual([]);
});
