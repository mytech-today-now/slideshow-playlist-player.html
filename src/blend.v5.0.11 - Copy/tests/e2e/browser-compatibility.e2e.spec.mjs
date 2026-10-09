import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlendAppPage } from './support/blend-app-page.mjs';

const VIEWPORTS = [
  { label: '4K desktop', width: 3840, height: 2160 },
  { label: 'HD desktop', width: 1920, height: 1080 },
  { label: 'tablet landscape', width: 1024, height: 768 },
  { label: 'tablet portrait', width: 768, height: 1024 },
  { label: 'mobile portrait', width: 390, height: 844 },
  { label: 'mobile landscape', width: 844, height: 390 },
  { label: 'small mobile', width: 360, height: 800 }
];

const pageErrors = new WeakMap();

test.beforeEach(async ({ page }, testInfo) => {
  const browser = page.context().browser();
  const evidence = `${testInfo.project.name}\n${browser?.version() || 'version unavailable'}\n`;
  await testInfo.attach('browser-engine-version.txt', {
    body: Buffer.from(evidence, 'utf8'),
    contentType: 'text/plain'
  });

  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

async function bootApp(page, { serviceWorkersUnavailable = false } = {}) {
  await page.addInitScript(({ serviceWorkersUnavailable: disableServiceWorkers }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
    const runtimeConfigKey = 'blend-runtime-config-v1';
    try {
      const current = JSON.parse(localStorage.getItem(runtimeConfigKey) || '{}');
      localStorage.setItem(runtimeConfigKey, JSON.stringify({
        ...current,
        SUPABASE_URL: location.origin,
        SUPABASE_AUTH_REDIRECT_URL: `${location.origin}/index.html`,
        SUPABASE_MEDIA_BUCKET: 'media',
        SUPABASE_PUBLIC_BUCKETS: 'public'
      }));
    } catch (_) {}
    try {
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true, writable: true });
      Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true, writable: true });
    } catch (_) {}
    if (disableServiceWorkers) {
      try {
        Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
      } catch (_) {}
    }
  }, { serviceWorkersUnavailable });

  await page.goto('/index.html');
  await page.waitForFunction(() => !!window.Blend?.state);
  await page.waitForSelector('#playlist-layer video');
  return new BlendAppPage(page);
}

async function chooseSyntheticFiles(page, files) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add Files' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
}

async function stateSnapshot(page) {
  return page.evaluate(() => {
    const state = window.Blend.state;
    return {
      library: Array.from(state.library.keys()).sort(),
      playlist: state.playlist.map(item => item.id),
      slideshow: state.slideshow.map(item => item.id),
      selection: Array.from(state.ui.selectedLibrary).sort()
    };
  });
}

test('file-input fallback reports reload persistence and keeps list editing keyboard-accessible', async ({ page }) => {
  test.setTimeout(90000);
  const app = await bootApp(page);
  await app.openConfig();
  await chooseSyntheticFiles(page, [
    { name: 'compatibility-one.mp4', mimeType: 'video/mp4', buffer: Buffer.from('synthetic-one') },
    { name: 'compatibility-two.mp4', mimeType: 'video/mp4', buffer: Buffer.from('synthetic-two') }
  ]);

  await page.waitForFunction(() => window.Blend?.state?.library?.size === 2);
  const saveNotice = page.locator('#toast-container .toast[role="status"]').last();
  const saveNoticeText = await saveNotice.innerText();
  const fileDataSaved = saveNoticeText.includes('saved the selected file data in this browser');
  if (fileDataSaved) {
    await expect(saveNotice).toContainText('Added 2 media files.');
    await expect(saveNotice).toContainText('Source-folder access is not retained');
    await expect(page.locator('#save-status')).toHaveText('All changes saved', { timeout: 15000 });
  } else {
    await expect(saveNotice).toContainText('available for this session only');
    await expect(saveNotice).toContainText('select them again after reload');
  }

  const selectedFiles = await page.evaluate(async () => Promise.all(
    Array.from(window.Blend.state.library.values(), async item => ({
      name: item.name,
      contents: await (await item.handle.getFile()).text(),
      sourceUrl: item.sourceUrl || null
    }))
  ));
  expect(selectedFiles.sort((left, right) => left.name.localeCompare(right.name))).toEqual([
    { name: 'compatibility-one.mp4', contents: 'synthetic-one', sourceUrl: null },
    { name: 'compatibility-two.mp4', contents: 'synthetic-two', sourceUrl: null }
  ]);

  await app.selectLibraryItemsByNames(['compatibility-one.mp4', 'compatibility-two.mp4']);
  await app.addSelectedLibraryToList('playlist', 2);
  await app.switchListTab('playlist');
  const firstRow = page.locator('#list-editor .list-item[data-idx="0"]');
  await expect(firstRow).toHaveAttribute('role', 'listitem');
  const beforeOrder = await page.evaluate(() => window.Blend.state.playlist.map(item => item.id));
  await firstRow.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => page.evaluate(() => window.Blend.state.playlist.map(item => item.id)))
    .toEqual([...beforeOrder].reverse());
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => ({
    role: document.activeElement?.getAttribute('role') || '',
    name: document.activeElement?.getAttribute('aria-label') || '',
    visible: document.activeElement?.matches(':focus-visible') || false,
    outlineStyle: getComputedStyle(document.activeElement).outlineStyle,
    outlineWidth: getComputedStyle(document.activeElement).outlineWidth
  }));
  expect(focus.role).toBe('listitem');
  expect(focus.name).toMatch(/^\d+ of 2: compatibility-.*\.mp4/);
  expect(focus).toMatchObject({ visible: true, outlineStyle: 'solid', outlineWidth: '2px' });

  const visibleStatus = await page.locator('#toast-container').innerText();
  expect(visibleStatus).not.toMatch(/[A-Z]:\\|Bearer\s|https?:\/\//i);

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  if (fileDataSaved) {
    await page.waitForFunction(() => window.Blend.state.library.size === 2);
    const persisted = await page.evaluate(async () => Promise.all(
      Array.from(window.Blend.state.library.values(), async item => ({
        name: item.name,
        contents: await (await item.handle.getFile()).text(),
        sourceUrl: item.sourceUrl || null
      }))
    ));
    expect(persisted.sort((left, right) => left.name.localeCompare(right.name))).toEqual(selectedFiles);
  } else {
    await expect.poll(() => page.evaluate(() => window.Blend.state.library.size)).toBe(0);
  }
});

test('directory-input fallback imports synthetic folder files or explains unavailable folder selection', async ({ page }) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'blend-browser-compat-'));
  try {
    const mediaDirectory = join(tempRoot, 'Synthetic Media');
    await mkdir(mediaDirectory);
    await writeFile(join(mediaDirectory, 'compatibility-folder.mp4'), 'synthetic-folder-media');

    const app = await bootApp(page);
    await app.openConfig();
    const directoryInputAvailable = await page.evaluate(() => (
      typeof document.createElement('input').webkitdirectory === 'boolean'
    ));

    if (!directoryInputAvailable) {
      await page.getByRole('button', { name: 'Add Folder' }).click();
      await expect(page.locator('#toast-container .toast[role="status"]').last())
        .toHaveText('Folder selection is unavailable in this browser. Use Add Files to select media individually.');
      expect((await stateSnapshot(page)).library).toEqual([]);
      return;
    }

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add Folder' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(tempRoot);
    await page.waitForFunction(() => window.Blend?.state?.library?.size === 1);
    const notice = page.locator('#toast-container .toast[role="status"]').last();
    await expect(notice).toContainText('Added 1 item from selected folder');
    const folderDataSaved = (await notice.innerText()).includes('saved the selected file data in this browser');
    if (folderDataSaved) {
      await expect(notice).toContainText('Source-folder access is not retained');
    } else {
      await expect(notice).toContainText('available for this session only');
      await expect(notice).toContainText('select them again after reload');
    }

    const selectedFolderFile = await page.evaluate(async () => {
      const item = Array.from(window.Blend.state.library.values())[0];
      return { name: item.name, text: await (await item.handle.getFile()).text() };
    });
    expect(selectedFolderFile).toEqual({ name: 'compatibility-folder.mp4', text: 'synthetic-folder-media' });

    await page.reload();
    await page.waitForFunction(() => !!window.Blend?.state);
    if (folderDataSaved) {
      await page.waitForFunction(() => window.Blend.state.library.size === 1);
      const storedFile = await page.evaluate(async () => {
        const item = Array.from(window.Blend.state.library.values())[0];
        return { name: item.name, text: await (await item.handle.getFile()).text() };
      });
      expect(storedFile).toEqual(selectedFolderFile);
    } else {
      await expect.poll(() => page.evaluate(() => window.Blend.state.library.size)).toBe(0);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('file and folder picker cancellation preserve library, lists, selection, and status', async ({ page }) => {
  const app = await bootApp(page);
  await app.openConfig();
  await chooseSyntheticFiles(page, [
    { name: 'cancel-state.mp4', mimeType: 'video/mp4', buffer: Buffer.from('synthetic-state') }
  ]);
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 1);
  await app.selectLibraryItemsByNames(['cancel-state.mp4']);
  await app.addSelectedLibraryToList('playlist', 1);
  await app.selectLibraryItemsByNames(['cancel-state.mp4']);
  await app.addSelectedLibraryToList('slideshow', 1);
  await expect.poll(() => page.locator('#save-status').getAttribute('data-state'), { timeout: 15000 })
    .toMatch(/^(saved|failed)$/);

  const before = await stateSnapshot(page);
  const statusBefore = await page.locator('#toast-container .toast').allTextContents();
  await page.evaluate(() => {
    window.__pickerCancelCalls = { files: 0, folders: 0 };
    window.showOpenFilePicker = async () => {
      window.__pickerCancelCalls.files++;
      throw new DOMException('Synthetic picker cancellation', 'AbortError');
    };
    window.showDirectoryPicker = async () => {
      window.__pickerCancelCalls.folders++;
      throw new DOMException('Synthetic picker cancellation', 'AbortError');
    };
  });

  await page.getByRole('button', { name: 'Add Files' }).click();
  await page.waitForFunction(() => window.__pickerCancelCalls?.files === 1);
  expect(await stateSnapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Add Folder' }).click();
  await page.waitForFunction(() => window.__pickerCancelCalls?.folders === 1);
  expect(await stateSnapshot(page)).toEqual(before);
  expect(await page.locator('#toast-container .toast').allTextContents()).toEqual(statusBefore);
});

test('expired private media auth failure preserves its portable reference without leaking private path or bearer URL', async ({ page }) => {
  const privatePath = String.raw`C:\Users\synthetic-user\Private Media\private-clip.mp4`;
  const bearerToken = 'synthetic-issue10-bearer-secret';
  const storageReference = 'supabase://media/private/private-clip.mp4';
  const consoleMessages = [];
  page.on('console', message => consoleMessages.push(message.text()));
  const fakeNow = Date.UTC(2026, 0, 1);
  await page.addInitScript(startTime => {
    Date.now = () => startTime;
    window.__issue10E2eClock = { now: () => startTime };
  }, fakeNow);

  await bootApp(page);
  // Startup validates restored media handles shortly after the app becomes ready.
  await page.waitForTimeout(1300);
  const bearerUrl = new URL(`/samples/IL.jpeg?token=${bearerToken}`, page.url()).href;
  await page.evaluate(({ privatePath: pathHint, sourceUrl, storageReference: reference }) => {
    const id = 'synthetic-private-media';
    const name = 'Synthetic private clip.mp4';
    const metadata = {
      storageReference: reference,
      storageBucket: 'media',
      storagePath: 'private/private-clip.mp4',
      signedUrlExpiresAt: window.__issue10E2eClock.now() - 1
    };
    const item = {
      id,
      name,
      pathHint,
      sourceUrl,
      type: 'image',
      size: 0,
      stale: false,
      handle: { remote: true, sourceUrl },
      metadata: { ...metadata }
    };
    window.Blend.state.library = new Map([[id, item]]);
    window.Blend.state.playlist = [];
    window.Blend.state.slideshow = [{
      id,
      name,
      path: reference,
      sourceUrl,
      type: 'image',
      available: true,
      metadata: { ...metadata }
    }];
    window.Blend.state.runtime.slideshowIndex = 0;
    window.Blend.state.ui.activeList = 'slideshow';
    window.Blend.state.settings.experiencePlaybackMode = 'stop';
    window.Blend.renderLibrary();
    window.Blend.renderListEditor();
  }, { privatePath, sourceUrl: bearerUrl, storageReference });

  await page.evaluate(() => window.Blend.play());
  const authToast = page.locator('#toast-container .toast[role="alert"]')
    .filter({ hasText: 'Sign in to access private media.' });
  await expect(authToast).toBeVisible();
  const mediaState = await page.evaluate(() => {
    const item = window.Blend.state.library.get('synthetic-private-media');
    const reference = window.Blend.state.slideshow[0];
    return {
      inLibrary: !!item,
      stale: item?.stale,
      storageReference: item?.metadata?.storageReference,
      lastStorageError: item?.metadata?.lastStorageError,
      inSlideshow: window.Blend.state.slideshow.includes(reference),
      available: reference?.available
    };
  });
  expect(mediaState).toEqual({
    inLibrary: true,
    stale: false,
    storageReference,
    lastStorageError: 'auth_required',
    inSlideshow: true,
    available: false
  });

  const visibleStatus = await page.locator('#toast-container').innerText();
  const persistedLog = await page.evaluate(() => localStorage.getItem('blend-debug-log-v1') || '');
  const diagnostics = `${visibleStatus}\n${consoleMessages.join('\n')}\n${persistedLog}`;
  expect(diagnostics).not.toContain(privatePath);
  expect(diagnostics).not.toContain(bearerUrl);
  expect(diagnostics).not.toContain(`token=${bearerToken}`);
  expect(diagnostics).not.toContain(bearerToken);
  expect(diagnostics).not.toMatch(/Bearer\s+\S+/i);
});

test('directory input absence is announced and Add Files remains available', async ({ page }) => {
  const app = await bootApp(page);
  await app.openConfig();
  await page.evaluate(() => {
    const createElement = document.createElement.bind(document);
    document.createElement = (tagName, ...args) => {
      const element = createElement(tagName, ...args);
      if (String(tagName).toLowerCase() === 'input') {
        Object.defineProperty(element, 'webkitdirectory', {
          configurable: true,
          writable: true,
          value: undefined
        });
      }
      return element;
    };
  });

  await page.getByRole('button', { name: 'Add Folder' }).click();
  await expect(page.locator('#toast-container .toast[role="status"]').last())
    .toHaveText('Folder selection is unavailable in this browser. Use Add Files to select media individually.');
  await expect(page.getByRole('button', { name: 'Add Files' })).toBeEnabled();
  expect((await stateSnapshot(page)).library).toEqual([]);
});

test('fullscreen API absence and rejection produce accessible feedback', async ({ page }) => {
  await bootApp(page);
  const fullscreenButton = page.getByRole('button', { name: 'Toggle fullscreen viewport' });
  await expect(fullscreenButton).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(document.querySelector('#viewport'), 'requestFullscreen', {
      configurable: true,
      value: undefined
    });
  });
  await fullscreenButton.click();
  await expect(page.locator('#toast-container .toast[role="status"]').last())
    .toContainText('Fullscreen is unavailable in this browser');

  await page.evaluate(() => {
    Object.defineProperty(document.querySelector('#viewport'), 'requestFullscreen', {
      configurable: true,
      value: () => Promise.reject(new DOMException('Synthetic rejection', 'NotAllowedError'))
    });
  });
  await fullscreenButton.click();
  await expect(page.locator('#toast-container .toast[role="status"]').last())
    .toContainText('Fullscreen could not be started');

  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.querySelector('#viewport')
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: undefined
    });
  });
  await fullscreenButton.click();
  await expect(page.locator('#toast-container .toast[role="status"]').last())
    .toContainText('Fullscreen cannot be exited');

  await page.evaluate(() => {
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: () => Promise.reject(new DOMException('Synthetic exit rejection', 'NotAllowedError'))
    });
  });
  await fullscreenButton.click();
  await expect(page.locator('#toast-container .toast[role="status"]').last())
    .toContainText('Fullscreen could not be exited');
});

test('service-worker absence is explained in the accessible PWA status region', async ({ page }) => {
  await bootApp(page, { serviceWorkersUnavailable: true });
  await expect(page.locator('#pwa-status')).toBeVisible();
  await expect(page.locator('#pwa-status')).toHaveAttribute('role', 'status');
  await expect(page.locator('#pwa-status-text'))
    .toHaveText('Offline shell caching is unavailable in this browser.');
  await expect(page.locator('#app-version')).toHaveText('v5.0.11');
});

test('service-worker shell is registered and cached or its limitation is announced', async ({ page }) => {
  await bootApp(page);
  const serviceWorkerSupported = await page.evaluate(() => (
    !!navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function'
  ));

  if (!serviceWorkerSupported) {
    await expect(page.locator('#pwa-status')).toBeVisible();
    await expect(page.locator('#pwa-status-text')).toContainText('Offline shell caching is unavailable');
    return;
  }

  const scriptUrl = new URL('./service-worker.js', page.url()).href;
  const controlled = await page.waitForFunction(expected => (
    navigator.serviceWorker?.controller?.scriptURL === expected
  ), scriptUrl, { timeout: 20000 }).then(() => true).catch(() => false);

  if (!controlled) {
    await expect(page.locator('#pwa-status')).toBeVisible();
    await expect(page.locator('#pwa-status-text'))
      .toContainText('Offline shell caching could not be enabled');
    return;
  }

  const cachedShell = await page.evaluate(async () => (
    !!await caches.match(new URL('./index.html', location.href).href)
  ));
  expect(cachedShell).toBe(true);
  await expect(page.locator('#app-version')).toHaveText('v5.0.11');
});

test('responsive viewport, text scale, and touch targets remain usable', async ({ page }) => {
  const app = await bootApp(page);
  await app.openConfig();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector('#config-panel');
      const panelRect = panel.getBoundingClientRect();
      const buttons = ['#add-files', '#add-folder'].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      return {
        pageWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        panelTop: panelRect.top,
        panelBottom: panelRect.bottom,
        panelClientWidth: panel.clientWidth,
        panelScrollWidth: panel.scrollWidth,
        buttons
      };
    });

    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.clientWidth + 2);
    expect(metrics.panelLeft).toBeGreaterThanOrEqual(-2);
    expect(metrics.panelRight).toBeLessThanOrEqual(metrics.viewportWidth + 2);
    expect(metrics.panelTop).toBeGreaterThanOrEqual(-2);
    expect(metrics.panelBottom).toBeLessThanOrEqual(metrics.viewportHeight + 2);
    expect(metrics.panelScrollWidth).toBeLessThanOrEqual(metrics.panelClientWidth + 1);
    if (viewport.width <= 844) {
      for (const button of metrics.buttons) {
        expect(button.width).toBeGreaterThanOrEqual(32);
        expect(button.height).toBeGreaterThanOrEqual(32);
      }
    }

    if (viewport.width === 360) {
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      const scaled = await page.evaluate(() => ({
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        pageWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        panelRight: document.querySelector('#config-panel').getBoundingClientRect().right,
        viewportWidth: window.innerWidth
      }));
      expect(scaled.rootFontSize).toBe('32px');
      expect(scaled.pageWidth).toBeLessThanOrEqual(scaled.clientWidth + 2);
      expect(scaled.panelRight).toBeLessThanOrEqual(scaled.viewportWidth + 2);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    }
  }
});
