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

async function seedDatabase(page, libraryKeyPath = 'id', includeLegacyRecords = false, includeFutureFields = false, databaseVersion = 6) {
  await page.goto('/offline.html');
  await page.evaluate(({ storeKeyPaths, libraryKeyPath: keyPath, includeLegacyRecords: seedLegacyRecords, includeFutureFields: seedFutureFields, databaseVersion: version }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', version);
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
        size: 128,
        addedAt: 1700000000002
      };
      if (seedFutureFields) {
        savedItem.futureMetadata = {
          schema: 'blend.library.v-next',
          details: { quality: 'lossless', retention: 7 }
        };
      }
      if (keyPath === 'url') savedItem.url = 'https://media.example.test/schema-six-library.jpg';
      event.target.transaction.objectStore('library').put(savedItem);
      if (seedFutureFields) {
        event.target.transaction.objectStore('library').put({
          id: 'untouched-schema-six-library',
          name: 'untouched-schema-six-library.jpg',
          type: 'image',
          pathHint: 'samples/untouched-schema-six-library.jpg',
          sourceUrl: 'https://media.example.test/untouched-schema-six-library.jpg',
          size: 64,
          addedAt: 1700000000000
        });
      }
      if (seedLegacyRecords) {
        event.target.transaction.objectStore('dirHandles').put({
          id: 'schema-six-directory',
          handle: { kind: 'directory', name: 'schema-six-folder', opaqueToken: 'handle-sentinel' },
          name: 'schema-six-folder',
          addedAt: 1700000000001
        });
        event.target.transaction.objectStore('aliases').put({
          id: 'schema-six-alias',
          from: './schema-six-legacy-route',
          to: './index.html',
          type: 'navigation',
          match: 'exact',
          status: 200,
          preserveQuery: true,
          preserveHash: true,
          enabled: true,
          priority: 70,
          expiresAt: null
        });
        event.target.transaction.objectStore('aliasMeta').put({
          key: 'manifest',
          schema: 'blend.aliases.v1',
          version: 99,
          generatedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          aliasCount: 1
        });
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
  }), { storeKeyPaths: STORE_KEY_PATHS, libraryKeyPath, includeLegacyRecords, includeFutureFields, databaseVersion });
}

async function readDatabaseRecords(page, storeNames = Object.keys(STORE_KEY_PATHS)) {
  return page.evaluate(names => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(names, 'readonly');
      const records = {};
      for (const storeName of names) {
        const read = transaction.objectStore(storeName).getAll();
        read.onsuccess = () => { records[storeName] = read.result; };
        read.onerror = () => reject(read.error);
      }
      transaction.oncomplete = () => {
        const version = database.version;
        database.close();
        resolve({ version, records });
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }), storeNames);
}

async function changeBlendOpacityAndSave(page) {
  await page.locator('#config-gear').click();
  const slider = page.getByRole('slider', { name: 'Blend opacity' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('38');
  await page.evaluate(() => window.Blend.saveStateNow());
  await expect(page.locator('#save-status')).toHaveText('All changes saved');
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
  await page.addInitScript(() => {
    const factoryPrototype = Object.getPrototypeOf(indexedDB);
    const nativeOpen = factoryPrototype.open;
    window.__blendDatabaseOpenCalls = [];
    Object.defineProperty(factoryPrototype, 'open', {
      configurable: true,
      writable: true,
      value: function (...args) {
        if (args[0] === 'player-blend-v1') {
          window.__blendDatabaseOpenCalls.push({ argumentCount: args.length, version: args[1] ?? null });
        }
        return nativeOpen.apply(this, args);
      }
    });
  });

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

  const configGear = page.locator('#config-gear');
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
  const databaseOpenCalls = await page.evaluate(() => window.__blendDatabaseOpenCalls);
  expect(databaseOpenCalls.length).toBeGreaterThan(0);
  expect(databaseOpenCalls.every(call => call.argumentCount === 1 && call.version === null)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('current-version baseline keeps settings, aliases, directory handles, and media after an edit', async ({ page }) => {
  await seedDatabase(page, 'id', true, false, 5);
  await suppressFirstRunPrompts(page);
  const before = await readDatabaseRecords(page);
  expect(before.version).toBe(5);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.Blend?.state?.library?.has('saved-in-schema-six'));

  await changeBlendOpacityAndSave(page);

  const after = await readDatabaseRecords(page);
  expect(after.version).toBe(5);
  const mediaBefore = before.records.library.find(item => item.id === 'saved-in-schema-six');
  const mediaAfter = after.records.library.find(item => item.id === 'saved-in-schema-six');
  expect(mediaAfter.name).toBe(mediaBefore.name);
  for (const key of ['id', 'type', 'pathHint', 'sourceUrl', 'size', 'addedAt']) {
    expect(mediaAfter[key]).toEqual(mediaBefore[key]);
  }
  expect(after.records.dirHandles).toEqual(before.records.dirHandles);
  expect(after.records.aliases).toEqual(before.records.aliases);
  expect(after.records.aliasMeta).toEqual(before.records.aliasMeta);
  expect(after.records.settings.find(item => item.key === 'global')?.projectName)
    .toBe(before.records.settings.find(item => item.key === 'global')?.projectName);
  expect(after.records.settings.find(item => item.key === 'global')?.opacity).toBe(0.38);
  expect(after.records.playlist.find(item => item.key === 'default')?.items[0]?.id)
    .toBe('saved-schema-six-playlist-item');
});

test('preserves future library fields when this version edits and saves a compatible newer database', async ({ page }) => {
  await seedDatabase(page, 'id', true, true);
  await suppressFirstRunPrompts(page);
  const before = await readDatabaseRecords(page);
  expect(before.version).toBe(6);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.Blend?.state?.library?.has('saved-in-schema-six'));

  await changeBlendOpacityAndSave(page);

  const after = await readDatabaseRecords(page);
  expect(after.version).toBe(6);
  const editedItem = after.records.library.find(item => item.id === 'saved-in-schema-six');
  expect(editedItem.name).toBe('schema-six-library.jpg');
  expect(editedItem.futureMetadata).toEqual({
    schema: 'blend.library.v-next',
    details: { quality: 'lossless', retention: 7 }
  });
  const untouchedBefore = before.records.library.find(item => item.id === 'untouched-schema-six-library');
  const untouchedAfter = after.records.library.find(item => item.id === 'untouched-schema-six-library');
  for (const key of ['id', 'name', 'type', 'pathHint', 'sourceUrl', 'size', 'addedAt']) {
    expect(untouchedAfter[key]).toEqual(untouchedBefore[key]);
  }
  expect(after.records.dirHandles).toEqual(before.records.dirHandles);
  expect(after.records.aliases).toEqual(before.records.aliases);
  expect(after.records.aliasMeta).toEqual(before.records.aliasMeta);
  expect(after.records.settings.find(item => item.key === 'global')?.opacity).toBe(0.38);
  expect(after.records.settings.find(item => item.key === 'global')?.autoVerifyOnStartup).toBe(false);
  expect(after.records.playlist.find(item => item.key === 'default')?.items[0]?.id)
    .toBe('saved-schema-six-playlist-item');
  expect(after.records.settings.find(item => item.key === 'global')?.projectName)
    .toBe(before.records.settings.find(item => item.key === 'global')?.projectName);
});

test('opens a compatible higher schema without database enumeration support', async ({ page }) => {
  await seedDatabase(page, 'id', true);
  await suppressFirstRunPrompts(page);
  await page.addInitScript(() => {
    const factoryPrototype = Object.getPrototypeOf(indexedDB);
    const nativeOpen = factoryPrototype.open;
    Object.defineProperty(factoryPrototype, 'databases', {
      configurable: true,
      writable: true,
      value: undefined
    });
    window.__blendDatabaseOpenCalls = [];
    Object.defineProperty(factoryPrototype, 'open', {
      configurable: true,
      writable: true,
      value: function (...args) {
        if (args[0] === 'player-blend-v1') {
          window.__blendDatabaseOpenCalls.push({ argumentCount: args.length, version: args[1] ?? null });
        }
        return nativeOpen.apply(this, args);
      }
    });
  });

  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/index.html');
  await page.waitForFunction(() => window.Blend?.state?.library?.has('saved-in-schema-six'));

  expect(await page.evaluate(() => window.Blend.state.settings.opacity)).toBe(0.37);
  expect(await page.evaluate(() => window.Blend.state.playlist[0]?.id)).toBe('saved-schema-six-playlist-item');
  const databaseOpenCalls = await page.evaluate(() => window.__blendDatabaseOpenCalls);
  expect(databaseOpenCalls.length).toBeGreaterThan(0);
  expect(databaseOpenCalls.every(call => call.argumentCount === 1 && call.version === null)).toBe(true);
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
  expect(savedDatabase.records).toEqual([{
    id: 'saved-in-schema-six',
    name: 'schema-six-library.jpg',
    type: 'image',
    pathHint: 'samples/schema-six-library.jpg',
    sourceUrl: 'https://media.example.test/schema-six-library.jpg',
    size: 128,
    addedAt: 1700000000002,
    url: 'https://media.example.test/schema-six-library.jpg'
  }]);
  expect(pageErrors).toEqual([]);
});
