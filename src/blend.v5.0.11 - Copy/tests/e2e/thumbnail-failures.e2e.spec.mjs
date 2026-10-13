import { test, expect } from '@playwright/test';
import { attachBrowserEngineEvidence } from './support/browser-engine-evidence.mjs';
import { readFile } from 'node:fs/promises';
import { BlendAppPage } from './support/blend-app-page.mjs';

const PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PORT}`;
const IMAGE_FIXTURES = await Promise.all([
  readFile(new URL('../../samples/blotter-01.png', import.meta.url)),
  readFile(new URL('../../samples/its-a-trap.jpg', import.meta.url)),
  readFile(new URL('../../samples/IL.jpeg', import.meta.url))
]);

async function bootThumbnailApp(page) {
  await page.addInitScript(({ fixtureOrigin }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
    localStorage.setItem('blend-runtime-config-v1', JSON.stringify({
      SUPABASE_URL: fixtureOrigin,
      SUPABASE_AUTH_REDIRECT_URL: `${fixtureOrigin}/index.html`,
      SUPABASE_MEDIA_BUCKET: 'media',
      SUPABASE_PUBLIC_BUCKETS: 'public'
    }));
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
    window.__BLEND_TEST_HOOKS__ = {};

    window.__thumbnailObjectUrls = [];
    const createObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = createObjectUrl(blob);
      window.__thumbnailObjectUrls.push({
        url,
        type: String(blob?.type || ''),
        size: Number(blob?.size || 0),
        revoked: false
      });
      return url;
    };
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => {
      const record = window.__thumbnailObjectUrls.find(item => item.url === url);
      if (record) record.revoked = true;
      return revokeObjectUrl(url);
    };
  }, { fixtureOrigin: FIXTURE_ORIGIN });

  await page.goto(`${FIXTURE_ORIGIN}/index.html`);
  await page.waitForFunction(() => Boolean(window.Blend?.state));
  await page.waitForSelector('#playlist-layer video');
}

async function runImageScenario(page, { mode, timeoutMs = 250 }) {
  return page.evaluate(async ({ mode, timeoutMs, imageUrl }) => {
    const helper = window.__BLEND_TEST_HOOKS__?.thumbnails?.imageToThumbBlob;
    if (typeof helper !== 'function') throw new Error('Thumbnail image helper hook is missing');

    const originalImage = window.Image;
    const nativeCreateElement = document.createElement;
    const canvasPrototype = HTMLCanvasElement.prototype;
    const originalGetContext = canvasPrototype.getContext;
    const originalToBlob = canvasPrototype.toBlob;
    const imageStats = { clearCount: 0, removeCount: 0, callbackCount: 0, drawCallCount: 0, handlersCleared: false };
    let image = null;
    let imageSource = '';

    window.Image = function TrackedImage() {
      image = new originalImage();
      const nativeRemove = image.remove.bind(image);
      Object.defineProperty(image, 'src', {
        configurable: true,
        get() { return imageSource; },
        set(value) {
          imageSource = String(value || '');
          if (!value) {
            imageStats.clearCount += 1;
            if (mode === 'cleanup-errors') throw new TypeError('synthetic-cleanup-detail');
          }
          if (!value || mode === 'timeout') return;
          if (value && (mode === 'media-error' || mode === 'cleanup-errors')) {
            setTimeout(() => image.onerror?.(new Event('error')), 0);
            return;
          }
          setTimeout(() => image.onload?.(new Event('load')), 0);
        }
      });
      image.remove = () => {
        imageStats.removeCount += 1;
        if (mode === 'cleanup-errors') throw new TypeError('synthetic-remove-detail');
        nativeRemove();
      };
      return image;
    };

    try {
      canvasPrototype.getContext = function (...args) {
        if (mode === 'get-context-null') return null;
        return {
          drawImage() {
            imageStats.drawCallCount += 1;
            if (mode === 'draw-image-throw') {
              throw new DOMException('synthetic-canvas-detail', 'SecurityError');
            }
          }
        };
      };
      if (mode === 'to-blob-null') {
        canvasPrototype.toBlob = function (callback) {
          imageStats.callbackCount += 1;
          callback(null);
        };
      }
      if (mode === 'success-duplicate-callback') {
        canvasPrototype.toBlob = function (callback) {
          imageStats.callbackCount += 1;
          callback(new Blob(['preview'], { type: 'image/jpeg' }));
          callback(null);
        };
      }

      const startedAt = performance.now();
      const blob = await helper(imageUrl, timeoutMs);
      imageStats.elapsedMs = Math.round(performance.now() - startedAt);
      imageStats.hasBlob = blob instanceof Blob;
      imageStats.blobType = blob?.type || '';
      imageStats.handlersCleared = image?.onload === null && image?.onerror === null;
      imageStats.srcValue = imageSource;
      return imageStats;
    } finally {
      window.Image = originalImage;
      document.createElement = nativeCreateElement;
      canvasPrototype.getContext = originalGetContext;
      canvasPrototype.toBlob = originalToBlob;
    }
  }, { mode, timeoutMs, imageUrl: `${FIXTURE_ORIGIN}/samples/IL.jpeg` });
}

async function runVideoScenario(page, { mode, timeoutMs = 250 }) {
  return page.evaluate(async ({ mode, timeoutMs }) => {
    const helper = window.__BLEND_TEST_HOOKS__?.thumbnails?.videoFrameToBlob;
    if (typeof helper !== 'function') throw new Error('Thumbnail video helper hook is missing');

    const nativeCreateElement = document.createElement;
    const canvasPrototype = HTMLCanvasElement.prototype;
    const originalGetContext = canvasPrototype.getContext;
    const originalToBlob = canvasPrototype.toBlob;
    const videoStats = {
      sourceRemoved: false,
      pauseCount: 0,
      loadCount: 0,
      removeCount: 0,
      callbackCount: 0,
      drawCallCount: 0,
      handlersCleared: false
    };
    let video = null;

    document.createElement = function (tagName, ...args) {
      const element = nativeCreateElement.call(this, tagName, ...args);
      if (String(tagName).toLowerCase() !== 'video') return element;

      video = element;
      let source = '';
      let currentTime = 0;
      Object.defineProperty(video, 'src', {
        configurable: true,
        get() { return source; },
        set(value) {
          source = String(value || '');
          if (!source || mode === 'timeout') return;
          if (mode === 'media-error' || mode === 'cleanup-errors') {
            setTimeout(() => video.onerror?.(new Event('error')), 0);
            return;
          }
          setTimeout(() => video.onloadedmetadata?.(), 0);
        }
      });
      for (const [name, value] of Object.entries({ duration: 10, videoWidth: 16, videoHeight: 9 })) {
        Object.defineProperty(video, name, { configurable: true, value });
      }
      Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get() { return currentTime; },
        set(value) {
          currentTime = Number(value) || 0;
          if (mode !== 'seek-timeout') setTimeout(() => video.onseeked?.(), 0);
        }
      });
      video.pause = () => {
        videoStats.pauseCount += 1;
        if (mode === 'cleanup-errors') throw new TypeError('synthetic-pause-detail');
      };
      video.load = () => {
        videoStats.loadCount += 1;
        if (mode === 'cleanup-errors') throw new TypeError('synthetic-load-detail');
      };
      const nativeRemoveAttribute = video.removeAttribute.bind(video);
      video.removeAttribute = name => {
        if (name === 'src') {
          videoStats.sourceRemoved = true;
          if (mode === 'cleanup-errors') throw new TypeError('synthetic-source-detail');
        }
        nativeRemoveAttribute(name);
      };
      video.remove = () => {
        videoStats.removeCount += 1;
        if (mode === 'cleanup-errors') throw new TypeError('synthetic-remove-detail');
      };
      return video;
    };

    try {
      canvasPrototype.getContext = function () {
        if (mode === 'get-context-null') return null;
        return {
          drawImage() {
            videoStats.drawCallCount += 1;
            if (mode === 'draw-image-throw') {
              throw new DOMException('synthetic-canvas-detail', 'SecurityError');
            }
          }
        };
      };
      canvasPrototype.toBlob = function (callback) {
        videoStats.callbackCount += 1;
        if (mode === 'to-blob-null') {
          callback(null);
          return;
        }
        callback(new Blob(['video-preview'], { type: 'image/jpeg' }));
        if (mode === 'success-duplicate-callback') callback(null);
      };

      const startedAt = performance.now();
      const blob = await helper('blob:thumbnail-fixture', 0.12, timeoutMs);
      videoStats.elapsedMs = Math.round(performance.now() - startedAt);
      videoStats.hasBlob = blob instanceof Blob;
      videoStats.blobType = blob?.type || '';
      videoStats.handlersCleared = video?.onloadedmetadata === null && video?.onseeked === null && video?.onerror === null;
      return videoStats;
    } finally {
      document.createElement = nativeCreateElement;
      canvasPrototype.getContext = originalGetContext;
      canvasPrototype.toBlob = originalToBlob;
    }
  }, { mode, timeoutMs });
}

async function addImages(page, files) {
  const names = files.map(file => file.name);
  const app = new BlendAppPage(page);
  await app.openConfig();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#add-files').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  await page.waitForFunction(expectedNames => expectedNames.every(name =>
    Array.from(window.Blend?.state?.library?.values?.() || []).some(item => item?.name === name)
  ), names);
  await app.dismissImportSummaryIfPresent();
  return app;
}

async function readPersistedLibraryNames(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('player-blend-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the Blend database'));
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('library', 'readonly');
        const request = transaction.objectStore('library').getAll();
        request.onsuccess = () => resolve((request.result || []).map(item => item?.name).filter(Boolean));
        request.onerror = () => reject(request.error || new Error('Could not read the persisted library'));
        transaction.onerror = () => reject(transaction.error || new Error('Could not read the persisted library'));
      });
    } finally {
      database.close();
    }
  });
}

test.describe('Cross-engine thumbnail failure smoke', { tag: '@cross-engine-smoke' }, () => {
test.beforeEach(async ({ browser }, testInfo) => {
  await attachBrowserEngineEvidence(browser, testInfo);
});

test('image thumbnails settle once, clean up, and use the icon fallback for browser faults', async ({ page }) => {
  await bootThumbnailApp(page);

  const success = await runImageScenario(page, { mode: 'success-duplicate-callback' });
  expect(success.hasBlob).toBe(true);
  expect(success.blobType).toBe('image/jpeg');
  expect(success.callbackCount).toBe(1);
  expect(success.drawCallCount).toBe(1);
  expect(success.clearCount).toBe(1);
  expect(success.removeCount).toBe(1);
  expect(success.handlersCleared).toBe(true);
  expect(success.srcValue).toBe('');

  for (const mode of ['get-context-null', 'draw-image-throw', 'to-blob-null', 'media-error', 'timeout', 'cleanup-errors']) {
    const result = await runImageScenario(page, { mode, timeoutMs: 40 });
    expect(result.hasBlob, mode).toBe(false);
    expect(result.clearCount, mode).toBe(1);
    expect(result.removeCount, mode).toBe(1);
    expect(result.handlersCleared, mode).toBe(true);
    if (mode === 'draw-image-throw' || mode === 'to-blob-null') expect(result.drawCallCount, mode).toBe(1);
    if (mode === 'get-context-null') expect(result.drawCallCount, mode).toBe(0);
    if (mode === 'timeout') expect(result.elapsedMs).toBeLessThan(500);
  }

  const logs = await page.evaluate(() => window.Blend.log.exportJson());
  expect(logs).not.toContain('synthetic-canvas-detail');
  expect(logs).not.toContain('synthetic-cleanup-detail');
  expect(logs).toContain('SecurityError');
  expect(logs).toContain('TypeError');
});

test('video thumbnails settle on success, canvas faults, media error, and missing events', async ({ page }) => {
  await bootThumbnailApp(page);

  const success = await runVideoScenario(page, { mode: 'success-duplicate-callback' });
  expect(success.hasBlob).toBe(true);
  expect(success.blobType).toBe('image/jpeg');
  expect(success.drawCallCount).toBe(1);
  expect(success.callbackCount).toBe(1);
  expect(success.pauseCount).toBe(1);
  expect(success.loadCount).toBe(1);
  expect(success.removeCount).toBe(1);
  expect(success.handlersCleared).toBe(true);

  for (const mode of ['get-context-null', 'draw-image-throw', 'to-blob-null', 'media-error', 'timeout', 'seek-timeout', 'cleanup-errors']) {
    const result = await runVideoScenario(page, { mode, timeoutMs: 40 });
    expect(result.hasBlob, mode).toBe(false);
    expect(result.sourceRemoved, mode).toBe(true);
    expect(result.pauseCount, mode).toBe(1);
    expect(result.loadCount, mode).toBe(1);
    expect(result.removeCount, mode).toBe(1);
    expect(result.handlersCleared, mode).toBe(true);
    if (mode === 'draw-image-throw' || mode === 'to-blob-null') expect(result.drawCallCount, mode).toBe(1);
    if (mode === 'get-context-null') expect(result.drawCallCount, mode).toBe(0);
    if (mode === 'timeout' || mode === 'seek-timeout') expect(result.elapsedMs).toBeLessThan(500);
  }

  const logs = await page.evaluate(() => window.Blend.log.exportJson());
  expect(logs).not.toContain('synthetic-canvas-detail');
  expect(logs).not.toContain('synthetic-source-detail');
  expect(logs).toContain('SecurityError');
  expect(logs).toContain('TypeError');
});

test('a canvas failure releases queue capacity and preserves imported rows and playback', async ({ page, browserName }) => {
  await bootThumbnailApp(page);
  const browserErrors = [];
  const handledPersistenceErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/\[ERROR\] save failed \{operation: experience_snapshot_write, errorName: UnknownError\}/.test(text)) {
      handledPersistenceErrors.push(text);
      return;
    }
    browserErrors.push(text);
  });

  await page.evaluate(() => {
    const originalCreateElement = document.createElement;
    window.__thumbnailObjectUrls.length = 0;
    window.__thumbnailQueueFault = { drawCalls: 0, toBlobCalls: 0, failures: 0, failSize: null, sourceSizes: [] };
    document.createElement = function (tagName, ...args) {
      const element = originalCreateElement.call(this, tagName, ...args);
      if (String(tagName).toLowerCase() !== 'canvas') return element;
      element.getContext = function () {
        return {
          drawImage(...drawArgs) {
            const source = String(drawArgs[0]?.src || '');
            const fault = window.__thumbnailQueueFault;
            const record = window.__thumbnailObjectUrls.find(item => item.url === source);
            const size = Number(record?.size || 0);
            fault.drawCalls += 1;
            fault.sourceSizes.push(size);
            if (fault.failSize === null) fault.failSize = size;
            if (size === fault.failSize) {
              fault.failures += 1;
              throw new DOMException('synthetic-queue-canvas-detail', 'SecurityError');
            }
          }
        };
      };
      const nativeToBlob = element.toBlob.bind(element);
      element.toBlob = (callback, ...options) => {
        window.__thumbnailQueueFault.toBlobCalls += 1;
        nativeToBlob(blob => callback(blob), ...options);
      };
      return element;
    };
    window.__thumbnailQueueFault.restore = () => { document.createElement = originalCreateElement; };
  });

  const files = [
    { name: 'preview-fail-first.png', mimeType: 'image/png', buffer: IMAGE_FIXTURES[0] },
    { name: 'preview-next.jpg', mimeType: 'image/jpeg', buffer: IMAGE_FIXTURES[1] },
    { name: 'preview-last.jpeg', mimeType: 'image/jpeg', buffer: IMAGE_FIXTURES[2] }
  ];
  const names = files.map(file => file.name);
  const app = await addImages(page, files);
  const expectedSourceSizes = IMAGE_FIXTURES.map(buffer => buffer.byteLength);
  await page.waitForFunction(() => {
    const queue = window.__BLEND_TEST_HOOKS__?.thumbnails?.queueStatus?.();
    const sourceSizes = new Set(window.__thumbnailQueueFault?.sourceSizes || []);
    return sourceSizes.size >= 3 && window.__thumbnailQueueFault?.failures >= 1 && queue?.active === 0 && queue?.pending === 0;
  }, null, { timeout: 15000 });
  await page.evaluate(() => window.__thumbnailQueueFault?.restore?.());

  const outcomes = await page.evaluate(expectedNames => expectedNames.map(name => {
    const card = Array.from(document.querySelectorAll('#library-grid .lib-card'))
      .find(element => element.getAttribute('aria-label')?.startsWith(`${name},`));
    const thumb = card?.querySelector('.thumb');
    return {
      name,
      ariaLabel: card?.getAttribute('aria-label') || '',
      fallbackText: thumb?.textContent || '',
      hasPreview: Boolean(thumb?.querySelector('img'))
    };
  }), names);
  const thumbnailDebug = await page.evaluate(() => ({
    fault: window.__thumbnailQueueFault,
    urls: window.__thumbnailObjectUrls,
    thumbs: Array.from(document.querySelectorAll('#library-grid .lib-card')).map(card => ({
      label: card.getAttribute('aria-label'),
      state: card.querySelector('.thumb')?.dataset,
      text: card.querySelector('.thumb')?.textContent || ''
    })),
    thumbnailLogs: JSON.parse(window.Blend.log.exportJson())
      .filter(entry => /thumb/i.test(entry.message || ''))
      .map(entry => ({ message: entry.message, args: entry.args }))
  }));
  const injectedFailureIndex = IMAGE_FIXTURES.findIndex(buffer => buffer.byteLength === thumbnailDebug.fault.failSize);
  const failedName = names[injectedFailureIndex];
  const failedOutcome = outcomes.find(outcome => outcome.name === failedName);
  expect(thumbnailDebug.fault.drawCalls).toBeGreaterThanOrEqual(3);
  expect(thumbnailDebug.fault.failures).toBeGreaterThanOrEqual(1);
  expect(thumbnailDebug.fault.toBlobCalls).toBe(2);
  expect(outcomes).toHaveLength(3);
  expect(outcomes.every(outcome => outcome.hasPreview || outcome.fallbackText === '🖼️')).toBe(true);
  expect(failedOutcome?.hasPreview).toBe(false);
  expect(failedOutcome?.fallbackText).toBe('🖼️');
  expect(failedOutcome?.ariaLabel).toContain(failedName);
  if (browserName !== 'webkit') expect(outcomes.filter(outcome => outcome.hasPreview)).toHaveLength(2);
  for (const outcome of outcomes) {
    const name = outcome.name;
    expect(outcome.ariaLabel).toContain(name);
    if (!outcome.hasPreview) {
      expect(outcome.fallbackText).toBe('🖼️');
      continue;
    }
    const card = page.locator('#library-grid .lib-card').filter({ hasText: name }).first();
    await expect(card).toHaveAttribute('aria-label', new RegExp(name.replaceAll('.', '\\.')));
    await expect(card.locator('.thumb img')).toHaveCount(1);
  }

  await page.waitForFunction(sourceSizes => {
    const sources = window.__thumbnailObjectUrls.filter(record => sourceSizes.includes(record.size));
    return sources.length >= 3 && sources.every(record => record.revoked);
  }, expectedSourceSizes, { timeout: 5000 });
  const urlState = await page.evaluate(() => window.__thumbnailObjectUrls);
  const sourceImageUrls = urlState.filter(record => expectedSourceSizes.includes(record.size));
  const thumbnailUrls = urlState.filter(record => record.type === 'image/jpeg' && !expectedSourceSizes.includes(record.size));
  expect(sourceImageUrls.length).toBeGreaterThanOrEqual(3);
  expect(sourceImageUrls.every(record => record.revoked)).toBe(true);
  if (browserName !== 'webkit') expect(thumbnailUrls.length).toBeGreaterThanOrEqual(2);

  const saveSucceeded = await page.evaluate(() => window.Blend.saveStateNow());
  const inMemoryLibraryNames = await page.evaluate(() => Array.from(window.Blend.state.library.values(), item => item.name));
  expect(inMemoryLibraryNames).toEqual(expect.arrayContaining(names));
  if (saveSucceeded) {
    const persistedLibraryNames = await readPersistedLibraryNames(page);
    expect(persistedLibraryNames).toEqual(expect.arrayContaining(names));
  } else {
    expect(browserName).toBe('webkit');
    test.info().annotations.push({
      type: 'browser persistence limitation',
      description: 'WebKit returned an IndexedDB snapshot UnknownError; in-memory rows and playback remain available.'
    });
  }

  await app.selectLibraryItemsByNames([failedName]);
  await app.addSelectedLibraryToList('slideshow', 1);
  await app.startPlayback();
  const playback = await page.evaluate(() => ({
    playing: Boolean(window.Blend?.state?.runtime?.isPlaying),
    slideshowLength: window.Blend?.state?.slideshow?.length || 0,
    imageSource: document.querySelector('#slideshow-layer img[src]')?.src || '',
    sourceSize: window.__thumbnailObjectUrls.find(record => record.url === document.querySelector('#slideshow-layer img[src]')?.src)?.size || 0
  }));
  expect(playback.playing).toBe(true);
  expect(playback.slideshowLength).toBe(1);
  expect(playback.imageSource).toMatch(/^blob:/);
  expect(playback.sourceSize).toBe(expectedSourceSizes[injectedFailureIndex]);

  const logs = await page.evaluate(() => window.Blend.log.exportJson());
  expect(logs).not.toContain('synthetic-queue-canvas-detail');
  if (browserName === 'webkit' && !saveSucceeded) expect(handledPersistenceErrors.length).toBeGreaterThan(0);
  expect(browserErrors).toEqual([]);
});
});
