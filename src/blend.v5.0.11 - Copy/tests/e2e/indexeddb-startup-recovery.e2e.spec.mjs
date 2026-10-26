import { expect, test } from '@playwright/test';

const COMPATIBLE_SCHEMA_6_STORE_PATHS = {
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

function addStartupPreferences(page) {
  return page.addInitScript(() => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
    window.__startupTestUnhandledRejections = [];
    window.addEventListener('unhandledrejection', event => {
      window.__startupTestUnhandledRejections.push({
        name: String(event.reason?.name || 'Error'),
        code: String(event.reason?.code || '')
      });
      event.preventDefault();
    });
  });
}

async function seedCompatibleSchema6(page) {
  await page.goto('/offline.html');
  return page.evaluate(storePaths => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 6);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const [name, keyPath] of Object.entries(storePaths)) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath });
        }
      }
      request.transaction.objectStore('library').put({
        id: 'synthetic-schema-6-sentinel',
        name: 'schema-6-fixture.jpg',
        type: 'image',
        pathHint: 'schema-6-fixture.jpg',
        sourceUrl: 'https://media.example.test/schema-6-fixture.jpg'
      });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const result = {
        version: database.version,
        stores: Array.from(database.objectStoreNames).sort()
      };
      database.close();
      resolve(result);
    };
  }), COMPATIBLE_SCHEMA_6_STORE_PATHS);
}

test('clean profile records boot stages and opens Configuration on first gear activation', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await addStartupPreferences(page);

  await page.goto('/index.html');
  await page.waitForFunction(() => window.BlendDebug?.getStatus().startup.completed === true);

  const beforeGear = await page.evaluate(() => {
    const events = window.BlendDebug.getRecentEvents(100);
    return {
      status: window.BlendDebug.getStatus(),
      gearBoundReadyState: events.find(event => event.message === '[config] gear handler bound')
        ?.args?.[1]?.documentReadyState,
      phases: events
        .filter(event => event.message === '[startup] phase started')
        .map(event => event.args?.[1]?.stage),
      order: [
        events.findIndex(event => event.message === '[config] gear handler bound'),
        events.findIndex(event => event.message === '[startup] bootstrap attempt started'),
        events.findIndex(event => event.message === '[startup] phase started' && event.args?.[1]?.stage === 'indexeddb_open'),
        events.findIndex(event => event.message === '[storage] opening IndexedDB'),
        events.findIndex(event => event.message === '[startup] phase started' && event.args?.[1]?.stage === 'state_hydration'),
        events.findIndex(event => event.message === '[startup] app ready'),
        events.findIndex(event => event.message === '[startup] bootstrap attempt completed')
      ]
    };
  });

  expect(beforeGear.status.startup).toMatchObject({ stage: 'ready', completed: true, inProgress: false });
  expect(beforeGear.status.gear.handlerBound).toBe(true);
  expect(beforeGear.status.panel).toMatchObject({ open: false, startupLocked: false });
  expect(beforeGear.gearBoundReadyState).toBe('interactive');
  await expect(page.locator('#app-version')).toHaveText('v5.0.11');
  expect(beforeGear.phases).toEqual([
    'read_startup_request',
    'indexeddb_open',
    'state_hydration',
    'auth_restore',
    'wire_controls',
    'pwa_setup',
    'initial_render',
    'restore_requested_experience',
    'ready'
  ]);
  expect(beforeGear.order.every(index => index >= 0)).toBe(true);
  expect(beforeGear.order).toEqual([...beforeGear.order].sort((a, b) => a - b));

  await page.locator('#config-gear').click();
  await expect(page.locator('#config-panel')).toHaveClass(/open/);
  await page.waitForFunction(() => window.BlendDebug?.getRecentEvents(100)
    .some(event => event.message === '[config] gear activation settled'));
  const afterGear = await page.evaluate(() => ({
    status: window.BlendDebug.getStatus(),
    events: window.BlendDebug.getRecentEvents(100)
      .filter(event => [
        '[config] gear activation received',
        '[config] panel opened',
        '[config] gear activation settled'
      ].includes(event.message))
  }));

  expect(afterGear.status.gear).toMatchObject({ handlerBound: true, expanded: 'true' });
  expect(afterGear.status.panel).toMatchObject({ open: true, ariaHidden: 'false', startupLocked: false });
  expect(afterGear.events.map(event => event.message)).toEqual([
    '[config] gear activation received',
    '[config] panel opened',
    '[config] gear activation settled'
  ]);
  expect(afterGear.events[0].args?.[1]?.trusted).toBe(true);
  expect(afterGear.events[1].args?.[1]?.panel?.open).toBe(true);
  expect(await page.evaluate(() => window.__startupTestUnhandledRejections)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('schema 6 preflight starts v5.0.11 without downgrade and preserves the synthetic record', async ({ context }) => {
  const seedPage = await context.newPage();
  const seeded = await seedCompatibleSchema6(seedPage);
  await seedPage.close();
  expect(seeded.version).toBe(6);
  expect(seeded.stores).toEqual(Object.keys(COMPATIBLE_SCHEMA_6_STORE_PATHS).sort());

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await addStartupPreferences(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.BlendDebug?.getStatus().startup.completed === true);
  await page.waitForFunction(() => window.Blend?.state?.library?.has('synthetic-schema-6-sentinel'));

  const startupEvidence = await page.evaluate(() => {
    const events = window.BlendDebug.getRecentEvents(100);
    return {
      status: window.BlendDebug.getStatus(),
      preflight: events.find(event => event.message === '[storage] IndexedDB versionless_preflight'),
      opened: events.find(event => event.message === '[storage] IndexedDB versionless_preflight_opened'),
      versionErrorFallback: events.some(event => event.message === '[storage] IndexedDB version_error_fallback')
    };
  });
  expect(startupEvidence.status.startup).toMatchObject({ stage: 'ready', completed: true });
  expect(startupEvidence.preflight?.args?.[1]).toMatchObject({
    requestedVersion: 5,
    existingVersion: 6,
    stage: 'indexeddb_open'
  });
  expect(startupEvidence.opened?.args?.[1]).toMatchObject({
    requestedVersion: 5,
    actualVersion: 6,
    stage: 'indexeddb_open'
  });
  expect(startupEvidence.versionErrorFallback).toBe(false);

  const savedDatabase = await page.evaluate(storePaths => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(Object.keys(storePaths), 'readonly');
      const keyPaths = Object.fromEntries(Object.keys(storePaths).map(name => [
        name,
        transaction.objectStore(name).keyPath
      ]));
      const read = transaction.objectStore('library').get('synthetic-schema-6-sentinel');
      let record;
      read.onsuccess = () => { record = read.result; };
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => {
        const result = {
          version: database.version,
          keyPaths,
          record
        };
        database.close();
        resolve(result);
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }), COMPATIBLE_SCHEMA_6_STORE_PATHS);

  expect(savedDatabase.version).toBe(6);
  expect(savedDatabase.keyPaths).toEqual(COMPATIBLE_SCHEMA_6_STORE_PATHS);
  expect(savedDatabase.record?.id).toBe('synthetic-schema-6-sentinel');
  expect(savedDatabase.record?.name).toBe('schema-6-fixture.jpg');
  expect(await page.evaluate(() => window.__startupTestUnhandledRejections)).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.close();
});

test('a VersionError during schema 6 startup falls back without an unhandled rejection', async ({ context }) => {
  const seedPage = await context.newPage();
  await seedCompatibleSchema6(seedPage);
  await seedPage.close();

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await addStartupPreferences(page);
  await page.addInitScript(() => {
    const factoryPrototype = Object.getPrototypeOf(indexedDB);
    Object.defineProperty(factoryPrototype, 'databases', {
      configurable: true,
      writable: true,
      value: () => Promise.resolve([{ name: 'player-blend-v1', version: 5 }])
    });
  });

  await page.goto('/index.html');
  await page.waitForFunction(() => window.BlendDebug?.getStatus().startup.completed === true);
  await page.waitForFunction(() => window.Blend?.state?.library?.has('synthetic-schema-6-sentinel'));

  const fallback = await page.evaluate(() => {
    const events = window.BlendDebug.getRecentEvents(100);
    return {
      status: window.BlendDebug.getStatus(),
      versionError: events.find(event => event.message === '[storage] IndexedDB version_error_fallback'),
      opened: events.find(event => event.message === '[storage] IndexedDB versionless_fallback_opened')
    };
  });
  expect(fallback.status.startup).toMatchObject({ stage: 'ready', completed: true });
  expect(fallback.versionError?.args?.[1]).toMatchObject({
    requestedVersion: 5,
    stage: 'indexeddb_open',
    error: {
      name: 'IndexedDBOpenError',
      code: 'idb_open_error',
      cause: { name: 'VersionError' }
    }
  });
  expect(fallback.opened?.args?.[1]).toMatchObject({
    requestedVersion: 5,
    actualVersion: 6,
    stage: 'indexeddb_open'
  });
  expect(await page.evaluate(() => window.__startupTestUnhandledRejections)).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.close();
});

test('an incompatible newer schema shows handled startup recovery and preserves its record', async ({ context }) => {
  const seedPage = await context.newPage();
  await seedPage.goto('/offline.html');
  const seeded = await seedPage.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 6);
    request.onupgradeneeded = () => {
      const database = request.result;
      const library = database.createObjectStore('library', { keyPath: 'id' });
      library.put({ id: 'incompatible-schema-sentinel', name: 'preserved.jpg' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const result = { version: database.version, stores: Array.from(database.objectStoreNames) };
      database.close();
      resolve(result);
    };
  }));
  await seedPage.close();
  expect(seeded).toEqual({ version: 6, stores: ['library'] });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await addStartupPreferences(page);
  await page.addInitScript(() => {
    const factoryPrototype = Object.getPrototypeOf(indexedDB);
    Object.defineProperty(factoryPrototype, 'databases', {
      configurable: true,
      writable: true,
      value: () => Promise.resolve([{ name: 'player-blend-v1', version: 5 }])
    });
  });

  await page.goto('/index.html');
  const recovery = page.locator('#database-startup-recovery');
  await expect(recovery).toBeVisible();
  await expect(page.locator('#database-startup-message'))
    .toContainText('cannot safely read the saved database schema');
  await expect(page.getByRole('button', { name: 'Reload Blend' })).toBeVisible();
  await expect(page.locator('#database-startup-retry')).toHaveAttribute('data-action', 'reload');

  const failure = await page.evaluate(() => {
    const events = window.BlendDebug.getRecentEvents(100);
    return {
      startup: window.BlendDebug.getStatus().startup,
      versionError: events.find(event => event.message === '[storage] IndexedDB version_error_fallback'),
      schemaFailure: events.find(event => event.message === '[storage] IndexedDB schema_validation_failed'),
      bootstrapFailure: events.find(event => event.message === '[startup] bootstrap attempt failed')
    };
  });
  expect(failure.startup).toMatchObject({ stage: 'failed', completed: false });
  expect(failure.versionError?.args?.[1]?.error?.cause?.name).toBe('VersionError');
  expect(failure.schemaFailure?.args?.[1]?.actualVersion).toBe(6);
  expect(failure.bootstrapFailure?.args?.[1]?.error).toMatchObject({
    name: 'IndexedDBOpenError',
    code: 'idb_schema_incompatible'
  });

  const savedDatabase = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('library', 'readonly');
      const read = transaction.objectStore('library').get('incompatible-schema-sentinel');
      let record;
      read.onsuccess = () => { record = read.result; };
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => {
        const result = { version: database.version, record };
        database.close();
        resolve(result);
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  expect(savedDatabase.version).toBe(6);
  expect(savedDatabase.record).toEqual({ id: 'incompatible-schema-sentinel', name: 'preserved.jpg' });
  expect(await page.evaluate(() => window.__startupTestUnhandledRejections)).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.close();
});

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

  await page.locator('#config-gear').click();
  await expect(page.locator('#config-panel')).toHaveClass(/open/);
  await expect(page.locator('#transport')).toHaveAttribute('inert', '');
  await expect(page.locator('#transport')).toHaveAttribute('aria-disabled', 'true');

  await holder.evaluate(() => window.__heldBlendDatabase.close());
  await page.waitForFunction(() => window.Blend?.state?.library?.has('saved-before-blocked-upgrade'));
  await expect(recovery).toBeHidden();
  await expect(page.locator('#transport')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#transport')).not.toHaveAttribute('aria-disabled', 'true');
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

  const startupFailure = await page.evaluate(() => window.BlendDebug?.getRecentEvents(50)
    .find(event => event.message === '[startup] bootstrap attempt failed'));
  expect(startupFailure?.args?.[1]?.failedStage).toBe('indexeddb_open');
  expect(startupFailure?.args?.[1]?.error?.code).toBe('idb_open_error');
  expect(startupFailure?.args?.[1]?.error?.name).toBe('IndexedDBOpenError');
  expect(startupFailure?.args?.[1]?.error?.message).toBe('The local Blend database could not be opened.');
  expect(startupFailure?.args?.[1]?.error?.cause?.name).toBe('UnknownError');
  expect(startupFailure?.args?.[1]?.error?.cause?.message).toBe('Synthetic open failure');

  await page.locator('#config-gear').click();
  await expect(page.locator('#config-panel')).toHaveClass(/open/);
  await expect(page.locator('#transport')).toHaveAttribute('inert', '');
  await expect(page.locator('#transport')).toHaveAttribute('aria-disabled', 'true');
  const lockedConfig = await page.evaluate(() => window.BlendDebug?.getStatus());
  expect(lockedConfig?.panel.open).toBe(true);
  expect(lockedConfig?.panel.startupLocked).toBe(true);
  await page.locator('#close-config').click();

  await page.getByRole('button', { name: 'Retry startup' }).click();
  await page.waitForFunction(() => Boolean(window.Blend?.state));
  await expect(page.locator('#database-startup-recovery')).toBeHidden();
  expect(await page.evaluate(() => window.__unhandledBootstrapRejections)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('an aborted legacy upgrade preserves the existing database and shows startup recovery', async ({ context }) => {
  const holder = await context.newPage();
  await holder.goto('/offline.html');
  await holder.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 4);
    request.onupgradeneeded = event => {
      event.target.result.createObjectStore('library', { keyPath: 'id' }).put({
        id: 'saved-before-aborted-upgrade',
        name: 'saved-before-aborted-upgrade.jpg',
        type: 'image',
        sourceUrl: 'https://media.example.test/saved-before-aborted-upgrade.jpg'
      });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  }));
  await holder.close();

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');

    const nativeCreateObjectStore = IDBDatabase.prototype.createObjectStore;
    Object.defineProperty(IDBDatabase.prototype, 'createObjectStore', {
      configurable: true,
      writable: true,
      value: function (name, options) {
        if (name === 'settings') {
          throw new DOMException('Synthetic upgrade failure.', 'UnknownError');
        }
        return nativeCreateObjectStore.call(this, name, options);
      }
    });
  });

  await page.goto('/index.html');
  await expect(page.locator('#database-startup-recovery')).toBeVisible();
  await expect(page.locator('#database-startup-message'))
    .toContainText('could not open your saved library');
  expect(await page.evaluate(() => Boolean(window.Blend))).toBe(false);

  const savedDatabase = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const stores = Array.from(database.objectStoreNames).sort();
      const transaction = database.transaction('library', 'readonly');
      const read = transaction.objectStore('library').get('saved-before-aborted-upgrade');
      let record;
      read.onsuccess = () => { record = read.result; };
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => {
        const result = { version: database.version, stores, record };
        database.close();
        resolve(result);
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }));

  expect(savedDatabase.version).toBe(4);
  expect(savedDatabase.stores).toEqual(['library']);
  expect(savedDatabase.record?.id).toBe('saved-before-aborted-upgrade');
  expect(pageErrors).toEqual([]);
  await page.close();
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
