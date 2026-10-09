import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;
const AUTH_STORAGE_KEY = 'blend-supabase-auth-session-v2';
const RUNTIME_CONFIG_STORAGE_KEY = 'blend-runtime-config-v1';
const RESET_CONFIRMATION = 'This removes Blend browser data only: library entries, playlists, slideshows, experiences, settings, cached thumbnails, and saved media access handles, including the saved Supabase session. Operator-managed runtime configuration (blend-runtime-config-v1) is preserved so its connection settings remain available. Your media files on disk are not touched.';
const RESET_SESSION_STORAGE_FAILURE = 'Browser reset incomplete. You are signed out in this tab, but removal of all saved Supabase session data could not be confirmed. Other Blend data was kept.';
const RESET_SNAPSHOT_FAILURE = 'Browser reset could not create a recovery copy. Your saved Blend data was kept; close other Blend tabs and retry.';
const RESET_DELETE_FAILURE = 'Browser reset incomplete. The saved Supabase session was removed from this browser. Saved data recovery is in progress; the thumbnail cache may be cleared, and previews can regenerate from retained media handles when available. Close other Blend tabs and retry.';
const RESET_UNCONFIRMED_FAILURE = 'This tab is signed out, but another Blend tab may still be active. Close all Blend tabs and retry the local reset.';
const RESET_SUCCESS = 'Browser data cleared. The saved Supabase session was removed, runtime configuration was preserved, and other apps on this site were left alone.';
const AUTH_RESET_CHANNEL = 'blend-supabase-auth-local-reset-v1:blend-supabase-auth-session-v2';

async function confirmResetWithKeyboard(page) {
  const resetButton = page.locator('#clear-browser-storage');
  await resetButton.focus();
  await expect(resetButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#experience-modal')).toBeVisible();
  await expect(page.locator('#experience-modal-message')).toHaveText(RESET_CONFIRMATION);
  await expect(page.locator('#experience-modal-ok')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#experience-modal')).not.toBeVisible();
}

function syntheticAccessToken(tabName, expiresInSeconds = 3600) {
  const payload = Buffer.from(JSON.stringify({
    sub: `synthetic-${tabName}-user`,
    email: `${tabName}@example.test`,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  })).toString('base64url');
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.synthetic-signature`;
}

async function captureAuthTabMessages(page, { ignoreReset = false } = {}) {
  await page.addInitScript(({ channelName, shouldIgnoreReset }) => {
    if (typeof BroadcastChannel !== 'function') return;
    window.__blendAuthSentMessages = [];
    window.__blendAuthReceivedMessages = [];
    const originalPostMessage = BroadcastChannel.prototype.postMessage;
    const originalAddEventListener = BroadcastChannel.prototype.addEventListener;
    BroadcastChannel.prototype.postMessage = function postMessageWithCapture(data) {
      if (this.name === channelName && data && typeof data === 'object') {
        window.__blendAuthSentMessages.push({ ...data });
      }
      return Reflect.apply(originalPostMessage, this, [data]);
    };
    BroadcastChannel.prototype.addEventListener = function addEventListenerWithCapture(type, listener, options) {
      if (type !== 'message' || this.name !== channelName || typeof listener !== 'function') {
        return Reflect.apply(originalAddEventListener, this, [type, listener, options]);
      }
      const channel = this;
      const wrappedListener = function captureMessage(event) {
        const message = event?.data && typeof event.data === 'object' ? { ...event.data } : event?.data;
        window.__blendAuthReceivedMessages.push(message);
        if (shouldIgnoreReset && message?.type === 'local-reset') return;
        return listener.call(channel, event);
      };
      return Reflect.apply(originalAddEventListener, this, [type, wrappedListener, options]);
    };
  }, { channelName: AUTH_RESET_CHANNEL, shouldIgnoreReset: ignoreReset });
}

async function installSyntheticAuthRoutes(page, tabName, requestLog, logoutLog, { beforeRefresh } = {}) {
  await page.route('**/auth/v1/**', async route => {
    const requestUrl = new URL(route.request().url());
    requestLog.push({ tab: tabName, path: requestUrl.pathname, method: route.request().method() });
    if (requestUrl.pathname.endsWith('/logout')) {
      logoutLog.push({ tab: tabName });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (requestUrl.pathname.endsWith('/token') && requestUrl.searchParams.get('grant_type') === 'refresh_token') {
      if (beforeRefresh) await beforeRefresh(route);
      try {
        return await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: `synthetic-${tabName}-refreshed-access-token`,
            refresh_token: `synthetic-${tabName}-refreshed-refresh-token`,
            expires_in: 3600
          })
        });
      } catch (_) {
        return;
      }
    }
    return route.abort('failed');
  });
}

async function connectSyntheticSession(app, { tabName, persist = false, expiresInSeconds = 3600 }) {
  const page = app.page;
  await app.openConfig();
  await page.locator('#supabase-sign-in').click();
  await expect(page.locator('#supabase-auth-modal')).toBeVisible();
  const persistenceControl = page.locator('#supabase-auth-persist-session');
  if (persist) await persistenceControl.check();
  else await expect(persistenceControl).not.toBeChecked();
  await page.locator('#supabase-auth-token').fill(syntheticAccessToken(tabName, expiresInSeconds));
  await page.locator('#supabase-auth-refresh-token').fill(`synthetic-${tabName}-refresh-token`);
  await page.locator('[data-auth-submit]').click();
  await expect(page.locator('#supabase-auth-modal')).not.toBeVisible();
  if (expiresInSeconds > 100) {
    await expect(page.locator('#supabase-auth-status')).toContainText('Supabase API token connected for private media.');
  }
}

async function storedExperienceNames(page) {
  return page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onsuccess = () => {
      const connection = request.result;
      if (!connection.objectStoreNames.contains('experiences')) {
        connection.close();
        resolve([]);
        return;
      }
      const transaction = connection.transaction('experiences', 'readonly');
      const records = transaction.objectStore('experiences').getAll();
      records.onsuccess = () => resolve(records.result.map(record => record.name));
      transaction.oncomplete = () => connection.close();
      transaction.onerror = () => {
        connection.close();
        resolve([]);
      };
    };
    request.onerror = () => resolve([]);
  }));
}

async function heldExperienceNames(page) {
  return page.evaluate(() => new Promise(resolve => {
    const connection = window.__heldBlendDatabase;
    const transaction = connection.transaction('experiences', 'readonly');
    const records = transaction.objectStore('experiences').getAll();
    records.onsuccess = () => resolve(records.result.map(record => record.name));
    transaction.onerror = () => resolve([]);
  }));
}

async function heldResetThumbnail(page) {
  return page.evaluate(() => new Promise(resolve => {
    const connection = window.__heldBlendDatabase;
    const transaction = connection.transaction('thumbnails', 'readonly');
    const result = transaction.objectStore('thumbnails').get('reset-rollback-marker');
    result.onsuccess = () => resolve(result.result?.value || null);
    transaction.onerror = () => resolve(null);
  }));
}

async function seedResetThumbnail(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onsuccess = () => {
      const connection = request.result;
      const transaction = connection.transaction('thumbnails', 'readwrite');
      transaction.objectStore('thumbnails').put({ key: 'reset-rollback-marker', value: 'preserve-me' });
      transaction.oncomplete = () => { connection.close(); resolve(); };
      transaction.onerror = () => { connection.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }));
}

async function seedResetUserAuthoredState(page) {
  await page.evaluate(async () => {
    const state = window.Blend.state;
    const libraryId = 'synthetic-library-entry';
    const file = new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="#2480a8"/></svg>'
    ], 'synthetic-preview.svg', { type: 'image/svg+xml', lastModified: 5 });
    state.library.set(libraryId, {
      id: libraryId,
      handle: {
        kind: 'file',
        name: file.name,
        transient: true,
        file,
        getFile: async () => file
      },
      name: 'Synthetic media entry',
      size: file.size,
      type: 'image',
      sourceUrl: null,
      pathHint: 'synthetic-reference',
      addedAt: 1,
      lastVerified: 1,
      stale: true
    });
    state.playlist = [{ id: libraryId, name: 'Synthetic media entry', path: 'synthetic-reference', type: 'image', available: false, order: 0 }];
    state.slideshow = [{ id: libraryId, name: 'Synthetic media entry', path: 'synthetic-reference', type: 'image', available: false, displayDuration: 4, order: 0 }];
    state.settings.masterVolume = 0.42;
    state.directoryHandles.set('synthetic-directory-entry', {
      id: 'synthetic-directory-entry',
      name: 'Synthetic directory entry',
      addedAt: 1,
      handle: { synthetic: true }
    });
    if (!(await window.Blend.saveStateNow())) throw new Error('Synthetic user state did not persist');
  });
}

async function seedSyntheticThumbnailProfile(page, { count, bytesPerBlob }) {
  return page.evaluate(({ count: recordCount, bytesPerBlob: blobSize }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onsuccess = () => {
      const connection = request.result;
      const transaction = connection.transaction('thumbnails', 'readwrite');
      const store = transaction.objectStore('thumbnails');
      const payload = new Uint8Array(blobSize);
      for (let index = 0; index < recordCount; index += 1) {
        store.put({
          key: `synthetic-cache-${index}`,
          blob: new Blob([payload], { type: 'image/webp' }),
          at: index
        });
      }
      const countRequest = store.count();
      let storedCount = 0;
      countRequest.onsuccess = () => { storedCount = countRequest.result || 0; };
      transaction.oncomplete = () => {
        connection.close();
        resolve({ recordCount: storedCount, totalBlobBytes: storedCount * blobSize });
      };
      transaction.onerror = () => { connection.close(); reject(transaction.error); };
      transaction.onabort = () => { connection.close(); reject(transaction.error || new Error('Synthetic thumbnail seed aborted')); };
    };
    request.onerror = () => reject(request.error);
  }), { count, bytesPerBlob });
}

async function clearSyntheticThumbnailStore(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onsuccess = () => {
      const connection = request.result;
      const transaction = connection.transaction('thumbnails', 'readwrite');
      transaction.objectStore('thumbnails').clear();
      transaction.oncomplete = () => { connection.close(); resolve(); };
      transaction.onerror = () => { connection.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }));
}

async function storedThumbnailCount(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onsuccess = () => {
      const connection = request.result;
      const transaction = connection.transaction('thumbnails', 'readonly');
      const count = transaction.objectStore('thumbnails').count();
      count.onsuccess = () => resolve(count.result || 0);
      transaction.oncomplete = () => connection.close();
      transaction.onerror = () => { connection.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }));
}

async function installSnapshotReadMetrics(page) {
  await page.evaluate(() => {
    const requiredStores = ['library', 'dirHandles', 'experiences', 'playlist', 'slideshow', 'settings', 'aliases', 'aliasMeta'];
    const trackedTransactions = new WeakSet();
    const metrics = {
      active: false,
      transactionCount: 0,
      storeNames: [],
      getAllRequests: 0,
      getAllKeysRequests: 0,
      readRecords: 0,
      thumbnailValueRequests: 0,
      thumbnailKeyRequests: 0,
      thumbnailRecordsRead: 0,
      thumbnailBlobBytesRead: 0,
      heapBeforeBytes: null,
      heapAfterBytes: null
    };
    window.__resetSnapshotMetrics = metrics;
    const isSnapshotTransaction = transaction => {
      if (!metrics.active || !transaction || transaction.mode !== 'readonly') return false;
      const names = Array.from(transaction.objectStoreNames);
      return requiredStores.every(name => names.includes(name));
    };
    const trackRequest = (store, kind, request) => {
      if (!isSnapshotTransaction(store.transaction)) return request;
      if (!trackedTransactions.has(store.transaction)) {
        trackedTransactions.add(store.transaction);
        metrics.transactionCount += 1;
        metrics.storeNames = Array.from(store.transaction.objectStoreNames).sort();
      }
      if (kind === 'values') metrics.getAllRequests += 1;
      else metrics.getAllKeysRequests += 1;
      if (store.name === 'thumbnails') {
        if (kind === 'values') metrics.thumbnailValueRequests += 1;
        else metrics.thumbnailKeyRequests += 1;
      }
      request.addEventListener('success', () => {
        const rows = request.result || [];
        metrics.readRecords += rows.length;
        if (store.name === 'thumbnails') {
          metrics.thumbnailRecordsRead += rows.length;
          if (kind === 'values') {
            metrics.thumbnailBlobBytesRead += rows.reduce((sum, row) => sum + Number(row?.blob?.size || 0), 0);
          }
        }
      }, { once: true });
      return request;
    };
    window.__nativeSnapshotGetAll = IDBObjectStore.prototype.getAll;
    window.__nativeSnapshotGetAllKeys = IDBObjectStore.prototype.getAllKeys;
    IDBObjectStore.prototype.getAll = function getAllWithSnapshotMetrics(...args) {
      return trackRequest(this, 'values', Reflect.apply(window.__nativeSnapshotGetAll, this, args));
    };
    IDBObjectStore.prototype.getAllKeys = function getAllKeysWithSnapshotMetrics(...args) {
      return trackRequest(this, 'keys', Reflect.apply(window.__nativeSnapshotGetAllKeys, this, args));
    };
  });
}

async function startSnapshotReadMetrics(page) {
  await page.evaluate(() => {
    const metrics = window.__resetSnapshotMetrics;
    metrics.heapBeforeBytes = Number.isFinite(performance.memory?.usedJSHeapSize)
      ? performance.memory.usedJSHeapSize
      : null;
    metrics.active = true;
  });
}

async function stopSnapshotReadMetrics(page) {
  return page.evaluate(() => {
    const metrics = window.__resetSnapshotMetrics;
    metrics.active = false;
    metrics.heapAfterBytes = Number.isFinite(performance.memory?.usedJSHeapSize)
      ? performance.memory.usedJSHeapSize
      : null;
    return {
      ...metrics,
      heapDeltaBytes: metrics.heapBeforeBytes == null || metrics.heapAfterBytes == null
        ? null
        : metrics.heapAfterBytes - metrics.heapBeforeBytes
    };
  });
}

async function restoreSnapshotReadMetrics(page) {
  await page.evaluate(() => {
    if (window.__nativeSnapshotGetAll) IDBObjectStore.prototype.getAll = window.__nativeSnapshotGetAll;
    if (window.__nativeSnapshotGetAllKeys) IDBObjectStore.prototype.getAllKeys = window.__nativeSnapshotGetAllKeys;
    delete window.__nativeSnapshotGetAll;
    delete window.__nativeSnapshotGetAllKeys;
    delete window.__resetSnapshotMetrics;
  });
}

async function persistedResetState(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onsuccess = () => {
      const connection = request.result;
      const names = ['library', 'playlist', 'slideshow', 'settings', 'experiences', 'dirHandles', 'thumbnails'];
      const transaction = connection.transaction(names, 'readonly');
      const state = {};
      for (const name of names) {
        if (name === 'thumbnails') {
          const count = transaction.objectStore(name).count();
          count.onsuccess = () => { state.thumbnailCount = count.result || 0; };
          continue;
        }
        const rows = transaction.objectStore(name).getAll();
        rows.onsuccess = () => {
          const records = rows.result || [];
          if (name === 'library') {
            state.libraryCount = records.length;
            state.libraryIds = records.map(row => row.id).sort();
            state.libraryNames = records.map(row => row.name).sort();
          }
          if (name === 'playlist') {
            const items = records.find(row => row.key === 'default')?.items || [];
            state.playlistItemCount = items.length;
            state.playlistItemIds = items.map(item => item.id);
          }
          if (name === 'slideshow') {
            const items = records.find(row => row.key === 'default')?.items || [];
            state.slideshowItemCount = items.length;
            state.slideshowItemIds = items.map(item => item.id);
          }
          if (name === 'settings') state.masterVolume = records.find(row => row.key === 'global')?.masterVolume ?? null;
          if (name === 'experiences') {
            state.experienceCount = records.length;
            state.experienceNames = records.map(row => row.name).sort();
          }
          if (name === 'dirHandles') {
            state.directoryHandleCount = records.length;
            state.directoryHandleNames = records.map(row => row.name).sort();
          }
        };
      }
      transaction.oncomplete = () => { connection.close(); resolve(state); };
      transaction.onerror = () => { connection.close(); reject(transaction.error); };
      transaction.onabort = () => { connection.close(); reject(transaction.error || new Error('Synthetic reset-state read aborted')); };
    };
    request.onerror = () => reject(request.error);
  }));
}

async function injectDeleteFailure(page, mode) {
  await page.evaluate(failureMode => {
    const factory = IDBFactory.prototype;
    window.__nativeDeleteDatabase = factory.deleteDatabase;
    factory.deleteDatabase = function deleteDatabaseWithFailure(...args) {
      const request = {};
      if (failureMode === 'error') {
        setTimeout(() => {
          request.error = new DOMException('Synthetic deletion failure', 'UnknownError');
          request.onerror?.call(request, new Event('error'));
        }, 0);
      }
      return request;
    };
  }, mode);
}

async function injectSnapshotFailure(page) {
  await page.evaluate(() => {
    const prototype = IDBDatabase.prototype;
    window.__nativeDatabaseTransaction = prototype.transaction;
    prototype.transaction = function transactionWithSnapshotFailure(...args) {
      const [storeNames, mode] = args;
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      if (mode === 'readonly' && names.length > 5) {
        throw new DOMException('Synthetic snapshot failure', 'UnknownError');
      }
      return Reflect.apply(window.__nativeDatabaseTransaction, this, args);
    };

    const factory = IDBFactory.prototype;
    window.__nativeDeleteDatabase = factory.deleteDatabase;
    window.__resetDeleteDatabaseAttempts = 0;
    factory.deleteDatabase = function countedDeleteDatabase(...args) {
      window.__resetDeleteDatabaseAttempts += 1;
      return Reflect.apply(window.__nativeDeleteDatabase, this, args);
    };
  });
}

async function restoreSnapshotFailure(page) {
  await page.evaluate(() => {
    if (window.__nativeDatabaseTransaction) {
      IDBDatabase.prototype.transaction = window.__nativeDatabaseTransaction;
      delete window.__nativeDatabaseTransaction;
    }
    if (window.__nativeDeleteDatabase) {
      IDBFactory.prototype.deleteDatabase = window.__nativeDeleteDatabase;
      delete window.__nativeDeleteDatabase;
    }
  });
}

async function restoreDeleteDatabase(page) {
  await page.evaluate(() => {
    if (window.__nativeDeleteDatabase) {
      IDBFactory.prototype.deleteDatabase = window.__nativeDeleteDatabase;
      delete window.__nativeDeleteDatabase;
    }
  });
}

async function injectCleanupFailure(page, mode) {
  await page.evaluate(failureMode => {
    if (failureMode === 'cache-storage') {
      const prototype = CacheStorage.prototype;
      window.__nativeCacheStorageKeys = prototype.keys;
      prototype.keys = async function keysWithFailure() {
        throw new DOMException('Synthetic Cache Storage failure', 'SecurityError');
      };
      return;
    }

    Object.defineProperty(ServiceWorkerRegistration.prototype, 'unregister', {
      configurable: true,
      value: async () => false
    });
  }, mode);
}

for (const persistenceEnabled of [false, true]) {
  test(`local reset clears two auth tabs (${persistenceEnabled ? 'opted-in persistence' : 'memory-only'}) without provider logout`, async ({ page }) => {
    const peerPage = await page.context().newPage();
    const app = new BlendAppPage(page);
    const peerApp = new BlendAppPage(peerPage);
    const authRequests = [];
    const logoutRequests = [];
    let releaseResetRefresh;
    let releasePeerRefresh;
    let markResetRefreshStarted;
    let markPeerRefreshStarted;
    const resetRefreshStarted = new Promise(resolve => { markResetRefreshStarted = resolve; });
    const peerRefreshStarted = new Promise(resolve => { markPeerRefreshStarted = resolve; });

    try {
      await captureAuthTabMessages(page);
      await captureAuthTabMessages(peerPage);
      await installSyntheticAuthRoutes(page, 'reset-tab', authRequests, logoutRequests, {
        beforeRefresh: async () => {
          markResetRefreshStarted();
          await new Promise(resolve => { releaseResetRefresh = resolve; });
        }
      });
      await installSyntheticAuthRoutes(peerPage, 'peer-tab', authRequests, logoutRequests, {
        beforeRefresh: async () => {
          markPeerRefreshStarted();
          await new Promise(resolve => { releasePeerRefresh = resolve; });
        }
      });
      await app.boot('/index.html');
      await peerApp.boot('/index.html');
      await expect.poll(async () => page.evaluate(() => window.__blendAuthSentMessages?.filter(message => message.type === 'tab-open').length || 0))
        .toBeGreaterThanOrEqual(2);
      await expect.poll(async () => peerPage.evaluate(() => window.__blendAuthSentMessages?.filter(message => message.type === 'tab-open').length || 0))
        .toBeGreaterThanOrEqual(2);

      if (persistenceEnabled) {
        await connectSyntheticSession(app, {
          tabName: 'reset',
          persist: true,
          expiresInSeconds: 76
        });
        // A second open tab restores the same explicitly opted-in local session.
        await peerApp.boot('/index.html');
      } else {
        await connectSyntheticSession(app, {
          tabName: 'reset',
          persist: false,
          expiresInSeconds: 3600
        });
        await connectSyntheticSession(peerApp, {
          tabName: 'peer',
          persist: false,
          expiresInSeconds: 76
        });
      }
      if (persistenceEnabled) {
        expect(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY)).not.toBeNull();
      } else {
        expect(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
      }

      if (persistenceEnabled) await Promise.all([resetRefreshStarted, peerRefreshStarted]);
      else await peerRefreshStarted;
      await confirmResetWithKeyboard(page);
      await expect(app.toastContainer).toContainText(RESET_SUCCESS, { timeout: 12000 });
      await expect(page.locator('#clear-browser-storage')).toBeFocused();
      await expect(page.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
      await expect(peerPage.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
      expect(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();

      const requestsAfterReset = authRequests.length;
      releaseResetRefresh?.();
      releasePeerRefresh?.();
      await page.waitForTimeout(1200);
      expect(authRequests).toHaveLength(requestsAfterReset);
      expect(logoutRequests).toEqual([]);

      const sentMessages = await Promise.all([
        page.evaluate(() => window.__blendAuthSentMessages || []),
        peerPage.evaluate(() => window.__blendAuthSentMessages || [])
      ]);
      const serializedMessages = JSON.stringify(sentMessages);
      for (const message of sentMessages.flat()) {
        expect(Object.keys(message).sort()).toEqual(['nonce', 'type']);
      }
      for (const token of [
        'synthetic-reset',
        'synthetic-peer',
        'synthetic-reset-refreshed-access-token',
        'synthetic-peer-refreshed-access-token'
      ]) {
        expect(serializedMessages).not.toContain(token);
      }
      expect(sentMessages.flat().some(message => message.type === 'local-reset')).toBe(true);
      expect(sentMessages.flat().some(message => message.type === 'local-reset-ack')).toBe(true);
    } finally {
      releaseResetRefresh?.();
      releasePeerRefresh?.();
      await peerPage.close().catch(() => {});
    }
  });
}

for (const viewport of [
  { name: 'desktop', width: 1366, height: 768 },
  { name: 'mobile', width: 390, height: 844 }
]) {
test(`unconfirmed tab warns and retry succeeds at ${viewport.name} size`, async ({ page }) => {
  const peerPage = await page.context().newPage();
  const app = new BlendAppPage(page);
  const peerApp = new BlendAppPage(peerPage);
  const authRequests = [];
  const logoutRequests = [];

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await peerPage.setViewportSize({ width: viewport.width, height: viewport.height });
  await captureAuthTabMessages(page);
  await captureAuthTabMessages(peerPage, { ignoreReset: true });
  await installSyntheticAuthRoutes(page, 'reset-tab', authRequests, logoutRequests);
  await installSyntheticAuthRoutes(peerPage, 'peer-tab', authRequests, logoutRequests);
  await app.boot('/index.html');
  await peerApp.boot('/index.html');
  await expect.poll(async () => page.evaluate(() => window.__blendAuthSentMessages?.filter(message => message.type === 'tab-open').length || 0))
    .toBeGreaterThanOrEqual(2);
  await expect.poll(async () => peerPage.evaluate(() => window.__blendAuthSentMessages?.filter(message => message.type === 'tab-open').length || 0))
    .toBeGreaterThanOrEqual(2);

  await connectSyntheticSession(app, { tabName: 'reset-unconfirmed' });
  await connectSyntheticSession(peerApp, { tabName: 'peer-unconfirmed' });
  await app.createExperience('Keep after unconfirmed peer');

  const resetStartedAt = Date.now();
  await confirmResetWithKeyboard(page);
  await expect(app.toastContainer).toContainText(RESET_UNCONFIRMED_FAILURE);
  expect(Date.now() - resetStartedAt).toBeLessThan(5000);
  await expect(page.locator('#clear-browser-storage')).toBeFocused();
  await expect(page.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
  await expect(peerPage.locator('#supabase-auth-status')).toContainText('Supabase API token connected for private media.');
  expect(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
  expect(await page.evaluate(() => window.Blend.state.experiences.map(record => record.name)))
    .toContain('Keep after unconfirmed peer');
  expect(await storedExperienceNames(page)).toContain('Keep after unconfirmed peer');
  expect(logoutRequests).toEqual([]);

  await peerPage.close();
  await expect.poll(async () => page.evaluate(() =>
    (window.__blendAuthReceivedMessages || []).some(message => message?.type === 'tab-close'))
  ).toBe(true);
  await confirmResetWithKeyboard(page);
  await expect(app.toastContainer).toContainText(RESET_SUCCESS, { timeout: 12000 });
  expect(await page.evaluate(() => window.Blend.state.experiences)).toHaveLength(0);
  expect(authRequests.filter(request => request.path.endsWith('/logout'))).toEqual([]);
});
}

test('reset removes the saved Supabase session, preserves runtime config, and keeps public playback available without remote logout', async ({ page }) => {
  let authRequests = 0;
  await page.route('**/auth/v1/**', async route => {
    authRequests += 1;
    await route.abort('failed');
  });
  const runtimeConfig = {
    SUPABASE_URL: 'https://reset-preserved.example.test',
    SUPABASE_ANON_KEY: 'synthetic-reset-preserved-anon-key',
    SUPABASE_MEDIA_BUCKET: 'reset-preserved-media',
    SUPABASE_AUTH_REDIRECT_URL: 'http://127.0.0.1:4191/index.html',
    SUPABASE_PUBLIC_BUCKETS: 'public'
  };
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html', { runtimeConfigOverrides: runtimeConfig });

  await page.evaluate(storageKey => {
    localStorage.setItem(storageKey, JSON.stringify({
      access_token: 'synthetic-reset-access-token',
      refresh_token: 'synthetic-reset-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600
    }));
  }, AUTH_STORAGE_KEY);
  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await expect(page.locator('#supabase-auth-status')).toContainText('Supabase API token connected for private media.');

  await blendPage.openConfig();
  await confirmResetWithKeyboard(page);

  await expect(blendPage.toastContainer).toContainText(RESET_SUCCESS);
  await expect(page.locator('#clear-browser-storage')).toBeFocused();
  await expect(page.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
  const afterReset = await page.evaluate(storageKey => ({
    authSession: localStorage.getItem(storageKey),
    values: Object.keys(localStorage).map(key => localStorage.getItem(key) || '')
  }), AUTH_STORAGE_KEY);
  expect(afterReset.authSession).toBeNull();
  expect(afterReset.values.join('\n')).not.toContain('synthetic-reset-access-token');
  expect(afterReset.values.join('\n')).not.toContain('synthetic-reset-refresh-token');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), RUNTIME_CONFIG_STORAGE_KEY))
    .toEqual(runtimeConfig);
  expect(authRequests).toBe(0);

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await expect(page.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), AUTH_STORAGE_KEY)).toBeNull();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), RUNTIME_CONFIG_STORAGE_KEY))
    .toEqual(runtimeConfig);
  const emptyAfterReload = await page.evaluate(() => ({
    library: window.Blend.state.library.size,
    playlist: window.Blend.state.playlist.length,
    slideshow: window.Blend.state.slideshow.length,
    experiences: window.Blend.state.experiences.length,
    directories: window.Blend.state.directoryHandles.size
  }));
  expect(emptyAfterReload).toEqual({ library: 0, playlist: 0, slideshow: 0, experiences: 0, directories: 0 });
  await expect(page.locator('#experience-select')).toHaveText('No experiences');

  const publicVideoUrl = `${FIXTURE_ORIGIN}/samples/nyc-01.mp4`;
  const publicImageUrl = `${FIXTURE_ORIGIN}/samples/IL.jpeg`;
  await blendPage.dropListFile('playlist', {
    name: 'public-reset-playlist.txt',
    text: `${publicVideoUrl}\n`
  });
  await blendPage.dropListFile('slideshow', {
    name: 'public-reset-slideshow.txt',
    text: `${publicImageUrl}\n`
  });
  await blendPage.closeConfig();
  await page.locator('#btn-play').click();
  await page.waitForFunction(() => window.Blend?.transport === 'playing', null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const video = Array.from(document.querySelectorAll('#playlist-layer video'))
      .find(element => element.getAttribute('src'));
    return video && !video.paused && video.currentTime > 0.1;
  }, null, { timeout: 15000 });

  const playback = await blendPage.playbackSummary();
  expect(playback.playlistLength).toBe(1);
  expect(playback.slideshowLength).toBe(1);
  expect(playback.playlistCurrentSource || playback.playlistElementSrc).toContain('/samples/nyc-01.mp4');
  expect(playback.slideshowCurrentSource || playback.slideshowElementSrc).toContain('/samples/IL.jpeg');
  expect(authRequests).toBe(0);
});

test('reset reports a saved-session removal failure and keeps existing Blend data', async ({ page }) => {
  let authRequests = 0;
  await page.route('**/auth/v1/**', async route => {
    authRequests += 1;
    await route.abort('failed');
  });
  await page.addInitScript(storageKey => {
    localStorage.setItem(storageKey, JSON.stringify({
      access_token: 'synthetic-partial-reset-access-token',
      refresh_token: 'synthetic-partial-reset-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600
    }));
  }, AUTH_STORAGE_KEY);

  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await expect(page.locator('#supabase-auth-status')).toContainText('Supabase API token connected for private media.');
  await blendPage.createExperience('Keep this experience');

  await page.evaluate(storageKey => {
    const originalRemoveItem = Storage.prototype.removeItem;
    window.__nativeStorageRemoveItem = originalRemoveItem;
    Storage.prototype.removeItem = function removeItem(key) {
      if (key === storageKey) throw new DOMException('Storage is unavailable', 'SecurityError');
      return originalRemoveItem.call(this, key);
    };
  }, AUTH_STORAGE_KEY);
  await blendPage.openConfig();
  await confirmResetWithKeyboard(page);

  await expect(blendPage.toastContainer).toContainText(RESET_SESSION_STORAGE_FAILURE);
  await expect(page.locator('#clear-browser-storage')).toBeFocused();
  await expect(page.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
  const partialReset = await page.evaluate(storageKey => ({
    savedSession: localStorage.getItem(storageKey),
    experienceNames: (window.Blend?.state?.experiences || []).map(experience => experience.name)
  }), AUTH_STORAGE_KEY);
  expect(partialReset.savedSession).toContain('synthetic-partial-reset-access-token');
  expect(partialReset.experienceNames).toContain('Keep this experience');
  expect(authRequests).toBe(0);

  await page.evaluate(() => {
    if (window.__nativeStorageRemoveItem) {
      Storage.prototype.removeItem = window.__nativeStorageRemoveItem;
      delete window.__nativeStorageRemoveItem;
    }
  });
  await confirmResetWithKeyboard(page);
  await expect(blendPage.toastContainer).toContainText(RESET_SUCCESS);
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), AUTH_STORAGE_KEY)).toBeNull();
  expect(await page.evaluate(() => window.Blend.state.experiences)).toHaveLength(0);
  expect(authRequests).toBe(0);
});

test('snapshot failure keeps saved data and the local session, then retry completes', async ({ page }) => {
  let authRequests = 0;
  await page.route('**/auth/v1/**', async route => {
    authRequests += 1;
    await route.abort('failed');
  });
  await page.addInitScript(storageKey => {
    localStorage.setItem(storageKey, JSON.stringify({
      access_token: 'synthetic-snapshot-reset-access-token',
      refresh_token: 'synthetic-snapshot-reset-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600
    }));
  }, AUTH_STORAGE_KEY);

  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await expect(page.locator('#supabase-auth-status')).toContainText('Supabase API token connected for private media.');
  await blendPage.createExperience('Keep after snapshot failure');
  await injectSnapshotFailure(page);

  await blendPage.openConfig();
  await confirmResetWithKeyboard(page);
  await expect(blendPage.toastContainer).toContainText(RESET_SNAPSHOT_FAILURE);
  await expect(page.locator('#supabase-auth-status')).toContainText('Supabase API token connected for private media.');
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), AUTH_STORAGE_KEY))
    .toContain('synthetic-snapshot-reset-access-token');
  expect(await page.evaluate(() => window.__resetDeleteDatabaseAttempts)).toBe(0);
  expect(await page.evaluate(() => window.Blend.state.experiences.map(record => record.name)))
    .toContain('Keep after snapshot failure');
  await expect.poll(() => storedExperienceNames(page)).toContain('Keep after snapshot failure');
  expect(authRequests).toBe(0);

  await restoreSnapshotFailure(page);
  await confirmResetWithKeyboard(page);
  await expect(blendPage.toastContainer).toContainText(RESET_SUCCESS);
  await expect(page.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), AUTH_STORAGE_KEY)).toBeNull();
  expect(await page.evaluate(() => window.Blend.state.experiences)).toHaveLength(0);
  expect(authRequests).toBe(0);
});

test('measures small, typical, and large thumbnail caches while recovering every user-authored store', async ({ browser }) => {
  test.setTimeout(120000);
  const profiles = [
    { name: 'small', count: 10, bytesPerBlob: 1024 },
    { name: 'typical', count: 512, bytesPerBlob: 8192 },
    { name: 'large', count: 4096, bytesPerBlob: 16384 }
  ];
  const measurements = [];
  for (const profile of profiles) {
    const context = await browser.newContext({
      baseURL: FIXTURE_ORIGIN,
      viewport: { width: 1366, height: 900 }
    });
    try {
      const page = await context.newPage();
      const blendPage = new BlendAppPage(page);
      await blendPage.boot('/index.html');
      await blendPage.createExperience('Synthetic rollback experience');
      await seedResetUserAuthoredState(page);
      const expectedUserState = await persistedResetState(page);
      expect(expectedUserState).toMatchObject({
        libraryCount: 1,
        libraryIds: ['synthetic-library-entry'],
        libraryNames: ['Synthetic media entry'],
        playlistItemCount: 1,
        playlistItemIds: ['synthetic-library-entry'],
        slideshowItemCount: 1,
        slideshowItemIds: ['synthetic-library-entry'],
        masterVolume: 0.42,
        directoryHandleCount: 1,
        directoryHandleNames: ['Synthetic directory entry'],
        thumbnailCount: 0
      });
      expect(expectedUserState.experienceCount).toBeGreaterThan(0);
      expect(expectedUserState.experienceNames).toContain('Synthetic rollback experience');
      const expectedUserAuthoredState = Object.fromEntries(
        Object.entries(expectedUserState).filter(([key]) => key !== 'thumbnailCount')
      );

      const seeded = await seedSyntheticThumbnailProfile(page, profile);
      expect(seeded).toEqual({
        recordCount: profile.count,
        totalBlobBytes: profile.count * profile.bytesPerBlob
      });

      await installSnapshotReadMetrics(page);
      await startSnapshotReadMetrics(page);
      await injectDeleteFailure(page, 'timeout');
      await blendPage.openConfig();
      await confirmResetWithKeyboard(page);
      await expect(blendPage.toastContainer).toContainText(RESET_DELETE_FAILURE, { timeout: 12000 });
      const snapshot = await stopSnapshotReadMetrics(page);
      await restoreSnapshotReadMetrics(page);
      await restoreDeleteDatabase(page);

      expect(snapshot.transactionCount).toBe(1);
      expect(snapshot.storeNames).toHaveLength(8);
      expect(snapshot.storeNames).not.toContain('thumbnails');
      expect(snapshot.getAllRequests).toBe(8);
      expect(snapshot.getAllKeysRequests).toBe(8);
      expect(snapshot.thumbnailValueRequests).toBe(0);
      expect(snapshot.thumbnailKeyRequests).toBe(0);
      expect(snapshot.thumbnailRecordsRead).toBe(0);
      expect(snapshot.thumbnailBlobBytesRead).toBe(0);

      await expect.poll(async () => {
        const persisted = await persistedResetState(page);
        return Object.fromEntries(Object.entries(persisted).filter(([key]) => key !== 'thumbnailCount'));
      }, { timeout: 15000 }).toEqual(expectedUserAuthoredState);
      const stateAfterFailedReset = await persistedResetState(page);
      expect(stateAfterFailedReset.thumbnailCount).toBeGreaterThanOrEqual(seeded.recordCount);
      expect(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();

      if (profile.name === 'small') {
        const retainedHandle = await page.evaluate(async () => {
          const item = window.Blend.state.library.get('synthetic-library-entry');
          const file = await item?.handle?.getFile?.();
          return { available: !!file, bytes: file?.size || 0 };
        });
        expect(retainedHandle.available).toBe(true);
        expect(retainedHandle.bytes).toBeGreaterThan(0);
      }

      const measurement = {
        profile: profile.name,
        thumbnailRecords: seeded.recordCount,
        thumbnailRecordsAfterFailedReset: stateAfterFailedReset.thumbnailCount,
        thumbnailBlobBytes: seeded.totalBlobBytes,
        snapshotStoreCount: snapshot.storeNames.length,
        snapshotReadRecords: snapshot.readRecords,
        snapshotValueRequests: snapshot.getAllRequests,
        snapshotKeyRequests: snapshot.getAllKeysRequests,
        snapshotThumbnailRecords: snapshot.thumbnailRecordsRead,
        snapshotThumbnailBlobBytes: snapshot.thumbnailBlobBytesRead,
        heapBeforeBytes: snapshot.heapBeforeBytes,
        heapAfterBytes: snapshot.heapAfterBytes,
        heapDeltaBytes: snapshot.heapDeltaBytes
      };
      measurements.push(measurement);
      console.log(`RESET_SNAPSHOT_METRICS ${JSON.stringify(measurement)}`);
    } finally {
      await context.close();
    }
  }
  expect(measurements.map(item => item.thumbnailRecords)).toEqual([10, 512, 4096]);
  expect(measurements.map(item => item.thumbnailBlobBytes)).toEqual([10240, 4194304, 67108864]);
  expect(measurements.every(item => item.snapshotThumbnailRecords === 0 && item.snapshotThumbnailBlobBytes === 0)).toBe(true);
});

test('a missing thumbnail cache regenerates lazily from a retained handle and uses an icon fallback without one', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await clearSyntheticThumbnailStore(page);
  await blendPage.openConfig();

  await page.evaluate(() => {
    const syntheticSvg = new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="#2480a8"/></svg>'
    ], 'synthetic-preview.svg', { type: 'image/svg+xml', lastModified: 5 });
    const id = 'synthetic-preview-rebuild';
    window.Blend.state.library.set(id, {
      id,
      name: syntheticSvg.name,
      size: syntheticSvg.size,
      type: 'image',
      sourceUrl: null,
      pathHint: 'synthetic-preview',
      stale: false,
      handle: { getFile: async () => syntheticSvg }
    });
    window.Blend.renderLibrary();
  });

  const previewRow = page.locator('[data-id="synthetic-preview-rebuild"]');
  await previewRow.scrollIntoViewIfNeeded();
  const generatedPreview = previewRow.locator('.thumb img');
  await expect(generatedPreview).toBeVisible({ timeout: 12000 });
  const generatedCache = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onsuccess = () => {
      const connection = request.result;
      const transaction = connection.transaction('thumbnails', 'readonly');
      const result = transaction.objectStore('thumbnails').getAll();
      result.onsuccess = () => resolve((result.result || []).map(record => ({
        blobBytes: record?.blob?.size || 0,
        mimeType: record?.blob?.type || ''
      })));
      transaction.oncomplete = () => connection.close();
      transaction.onerror = () => { connection.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }));
  expect(generatedCache).toHaveLength(1);
  expect(generatedCache[0].blobBytes).toBeGreaterThan(0);
  expect(generatedCache[0].mimeType).toMatch(/^image\//);

  await page.evaluate(() => {
    const id = 'synthetic-preview-fallback';
    window.Blend.state.library.set(id, {
      id,
      name: 'synthetic-unavailable-preview',
      size: 0,
      type: 'image',
      sourceUrl: null,
      pathHint: 'synthetic-unavailable-preview',
      stale: true,
      handle: null
    });
    window.Blend.renderLibrary();
  });
  await expect(page.locator('[data-id="synthetic-preview-fallback"] .thumb')).toHaveText('🖼️');
});

test('reset confirmation and partial-failure copy fit the established viewport matrix', async ({ page }) => {
  const viewports = [
    { width: 3840, height: 2160 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 360, height: 800 }
  ];
  const blendPage = new BlendAppPage(page);
  await page.setViewportSize(viewports[0]);
  await blendPage.boot('/index.html');
  await blendPage.openConfig();

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { document.body.style.fontSize = '200%'; });
    const resetButton = page.locator('#clear-browser-storage');
    await resetButton.scrollIntoViewIfNeeded();
    await resetButton.focus();
    await page.keyboard.press('Enter');
    const okButton = page.locator('#experience-modal-ok');
    await expect(page.locator('#experience-modal')).toBeVisible();
    await expect(okButton).toBeFocused();
    await expect(okButton).toHaveAccessibleName('✓ Clear Browser Storage');

    const layout = await page.evaluate(() => {
      const dialog = document.querySelector('#experience-modal');
      const message = document.querySelector('#experience-modal-message');
      const button = document.querySelector('#experience-modal-ok');
      const toastContainer = document.documentElement;
      const rect = node => {
        const bounds = node.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
      };
      const buttonStyle = getComputedStyle(button);
      const messageStyle = getComputedStyle(message);
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentWidth: toastContainer.scrollWidth,
        bodyFontSize: getComputedStyle(document.body).fontSize,
        dialog: rect(dialog),
        message: { ...rect(message), scrollWidth: message.scrollWidth, clientWidth: message.clientWidth, lineHeight: parseFloat(messageStyle.lineHeight) || 0 },
        button: rect(button),
        buttonOutlineStyle: buttonStyle.outlineStyle,
        fontSize: messageStyle.fontSize
      };
    });
    expect(layout.dialog.left).toBeGreaterThanOrEqual(-2);
    expect(layout.dialog.right).toBeLessThanOrEqual(viewport.width + 2);
    expect(layout.dialog.top).toBeGreaterThanOrEqual(-2);
    expect(layout.dialog.bottom).toBeLessThanOrEqual(viewport.height + 2);
    expect(layout.documentWidth).toBeLessThanOrEqual(viewport.width + 2);
    expect(layout.message.scrollWidth).toBeLessThanOrEqual(layout.message.clientWidth + 1);
    expect(layout.message.height).toBeGreaterThan(layout.message.lineHeight);
    expect(layout.button.height).toBeGreaterThanOrEqual(44);
    expect(layout.button.width).toBeGreaterThanOrEqual(44);
    expect(layout.button.top).toBeGreaterThanOrEqual(-2);
    expect(layout.button.bottom).toBeLessThanOrEqual(viewport.height + 2);
    expect(layout.buttonOutlineStyle).not.toBe('none');
    expect(layout.bodyFontSize).toBe('26px');
    expect(layout.fontSize).toBe(layout.bodyFontSize);

    await page.keyboard.press('Escape');
    await expect(page.locator('#experience-modal')).not.toBeVisible();
    await expect(resetButton).toBeFocused();
    await page.evaluate(() => { document.body.style.removeProperty('font-size'); });
  }

  await page.evaluate(() => { document.body.style.fontSize = '200%'; });
  await injectDeleteFailure(page, 'error');
  await confirmResetWithKeyboard(page);
  await expect(blendPage.toastContainer).toContainText(RESET_DELETE_FAILURE);
  const resetButton = page.locator('#clear-browser-storage');
  await expect(resetButton).toBeVisible();
  await expect(resetButton).toBeFocused();
  await expect(resetButton).toHaveAccessibleName('Clear Browser Storage');
  const toastLayout = await page.locator('#toast-container .toast').last().evaluate(node => {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      viewportWidth: window.innerWidth
    };
  });
  expect(toastLayout.left).toBeGreaterThanOrEqual(-2);
  expect(toastLayout.right).toBeLessThanOrEqual(toastLayout.viewportWidth + 2);
  expect(toastLayout.scrollWidth).toBeLessThanOrEqual(toastLayout.clientWidth + 1);
  await restoreDeleteDatabase(page);
});

test('blocked deletion keeps the current experience and a retry clears it after reload', async ({ page }) => {
  let authRequests = 0;
  await page.route('**/auth/v1/**', async route => {
    authRequests += 1;
    await route.abort('failed');
  });
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await page.evaluate(storageKey => {
    localStorage.setItem(storageKey, JSON.stringify({
      access_token: 'synthetic-blocked-reset-access-token',
      refresh_token: 'synthetic-blocked-reset-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600
    }));
  }, AUTH_STORAGE_KEY);
  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  await expect(page.locator('#supabase-auth-status')).toContainText('Supabase API token connected for private media.');
  await blendPage.createExperience('Keep this experience');
  await seedResetThumbnail(page);

  const holderPage = await page.context().newPage();
  const holderBlendPage = new BlendAppPage(holderPage);
  await holderBlendPage.boot('/index.html');
  await expect(holderPage.locator('#supabase-auth-status')).toContainText('Supabase API token connected for private media.');
  await holderPage.evaluate(async () => {
    const request = indexedDB.open('player-blend-v1', 5);
    window.__heldBlendDatabase = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });

  await blendPage.openConfig();
  await confirmResetWithKeyboard(page);
  await expect(blendPage.toastContainer).toContainText(RESET_DELETE_FAILURE, { timeout: 12000 });
  await expect(blendPage.toastContainer).not.toContainText('Browser data cleared.');
  await expect(page.locator('#clear-browser-storage')).toBeFocused();
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), AUTH_STORAGE_KEY)).toBeNull();
  await expect(page.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
  await expect(holderPage.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
  await expect(page.locator('#experience-select')).toHaveValue(await blendPage.activeExperienceIdByName('Keep this experience'));
  expect(await page.evaluate(() => window.Blend.state.experiences.map(record => record.name))).toContain('Keep this experience');
  expect(await heldExperienceNames(holderPage)).toContain('Keep this experience');
  await expect.poll(() => heldResetThumbnail(holderPage)).toBe('preserve-me');

  await holderPage.evaluate(() => window.__heldBlendDatabase.close());
  await holderPage.close();
  await expect.poll(() => storedExperienceNames(page), { timeout: 12000 }).toContain('Keep this experience');

  await confirmResetWithKeyboard(page);
  await expect(blendPage.toastContainer).toContainText(RESET_SUCCESS, { timeout: 12000 });
  await expect(page.locator('#clear-browser-storage')).toBeFocused();
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), AUTH_STORAGE_KEY)).toBeNull();
  expect(authRequests).toBe(0);
  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  const emptyAfterRetry = await page.evaluate(() => ({
    library: window.Blend.state.library.size,
    playlist: window.Blend.state.playlist.length,
    slideshow: window.Blend.state.slideshow.length,
    experiences: window.Blend.state.experiences.length,
    directories: window.Blend.state.directoryHandles.size
  }));
  expect(emptyAfterRetry).toEqual({ library: 0, playlist: 0, slideshow: 0, experiences: 0, directories: 0 });
  await expect(page.locator('#experience-select')).toHaveText('No experiences');
});

for (const cleanupMode of ['cache-storage', 'service-worker']) {
  test(`reports ${cleanupMode} cleanup failure separately from saved-data deletion`, async ({ page }) => {
    const blendPage = new BlendAppPage(page);
    await blendPage.boot('/index.html');
    await injectCleanupFailure(page, cleanupMode);

    await blendPage.openConfig();
    await confirmResetWithKeyboard(page);
    const failedStep = cleanupMode === 'cache-storage' ? 'Cache Storage' : 'Blend service worker registration';
    await expect(blendPage.toastContainer).toContainText(`Saved Blend data and the local Supabase session were cleared from this browser. Cleanup still needs attention: ${failedStep}.`);
    await expect(blendPage.toastContainer).not.toContainText(RESET_SUCCESS);
    await expect(page.locator('#clear-browser-storage')).toBeFocused();
    expect(await page.evaluate(() => ({
      library: window.Blend.state.library.size,
      playlist: window.Blend.state.playlist.length,
      slideshow: window.Blend.state.slideshow.length
    }))).toEqual({ library: 0, playlist: 0, slideshow: 0 });
  });
}

for (const failureMode of ['error', 'timeout']) {
  test(`failed IndexedDB delete (${failureMode}) preserves the current experience`, async ({ page }) => {
    const blendPage = new BlendAppPage(page);
    await blendPage.boot('/index.html');
    await blendPage.createExperience(`Keep after ${failureMode}`);
    await injectDeleteFailure(page, failureMode);

    await blendPage.openConfig();
    await confirmResetWithKeyboard(page);
    await expect(blendPage.toastContainer).toContainText(RESET_DELETE_FAILURE, { timeout: 12000 });
    await expect(blendPage.toastContainer).not.toContainText('Browser data cleared.');
    await expect(page.locator('#clear-browser-storage')).toBeFocused();
    expect(await page.evaluate(() => window.Blend.state.experiences.map(record => record.name)))
      .toContain(`Keep after ${failureMode}`);

    await restoreDeleteDatabase(page);
    await expect.poll(() => storedExperienceNames(page), { timeout: 12000 }).toContain(`Keep after ${failureMode}`);
    await page.reload();
    await page.waitForFunction(() => !!window.Blend?.state);
    expect(await page.evaluate(() => window.Blend.state.experiences.map(record => record.name)))
      .toContain(`Keep after ${failureMode}`);
  });
}
