import { test, expect } from '@playwright/test';
import { attachBrowserEngineEvidence } from './support/browser-engine-evidence.mjs';
import { BlendAppPage } from './support/blend-app-page.mjs';

const PAUSED_STATUS = 'Folder scanning is paused while this tab is in the background. Return to Blend to resume or cancel. Saved batches remain available.';

async function bootApp(page) {
  const app = new BlendAppPage(page);
  await app.boot('/index.html');
  await app.openConfig();
}

async function installGatedDirectory(page, { fakeVisibility = true, fileExtension = 'mp4' } = {}) {
  await page.evaluate(({ useFakeVisibility, syntheticFileExtension }) => {
    if (useFakeVisibility) {
      let visibilityState = 'visible';
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibilityState
      });
      window.__setScanVisibilityState = nextState => {
        visibilityState = nextState;
        document.dispatchEvent(new Event('visibilitychange'));
      };
    }

    const fileHandles = Array.from({ length: 48 }, (_, index) => {
      const name = `Background-${String(index).padStart(3, '0')}.${syntheticFileExtension}`;
      const file = new File(['synthetic'], name, { type: 'video/mp4' });
      const handle = Object.create({ getFile: async () => file });
      Object.assign(handle, { kind: 'file', name, file, transient: true });
      return handle;
    });
    let enumerationCount = 0;
    let markEnumerationStarted;
    let releaseEnumeration;
    let markResumeBoundary;
    let releaseResumedEnumeration;
    window.__directoryEnumerationStarted = new Promise(resolve => { markEnumerationStarted = resolve; });
    window.__directoryResumeBoundary = new Promise(resolve => { markResumeBoundary = resolve; });
    const enumerationGate = new Promise(resolve => { releaseEnumeration = resolve; });
    const resumedGate = new Promise(resolve => { releaseResumedEnumeration = resolve; });
    window.__releaseDirectoryEnumeration = releaseEnumeration;
    window.__releaseResumedEnumeration = releaseResumedEnumeration;
    window.__directoryEnumerationCount = () => enumerationCount;

    const root = Object.create({
      async *values() {
        enumerationCount += 1;
        markEnumerationStarted();
        await enumerationGate;
        for (let index = 0; index < fileHandles.length; index += 1) {
          if (index === 24) {
            markResumeBoundary();
            await resumedGate;
          }
          yield fileHandles[index];
        }
      }
    });
    Object.assign(root, { kind: 'directory', name: 'Background' });
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => root
    });
  }, { useFakeVisibility: fakeVisibility, syntheticFileExtension: fileExtension });
}

async function installPermissionLossAfterSavedBatch(page) {
  await page.evaluate(() => {
    let visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState
    });
    window.__setScanVisibilityState = nextState => {
      visibilityState = nextState;
      document.dispatchEvent(new Event('visibilitychange'));
    };

    const fileHandles = Array.from({ length: 264 }, (_, index) => {
      const name = `Saved-${String(index).padStart(3, '0')}.mp4`;
      const file = new File(['synthetic'], name, { type: 'video/mp4' });
      const handle = Object.create({ getFile: async () => file });
      Object.assign(handle, { kind: 'file', name, file, transient: true });
      return handle;
    });
    let enumerationCount = 0;
    let markBatchSaved;
    let releaseAfterSavedBatch;
    window.__directoryBatchSaved = new Promise(resolve => { markBatchSaved = resolve; });
    const afterSavedBatch = new Promise(resolve => { releaseAfterSavedBatch = resolve; });
    window.__releaseAfterSavedBatch = releaseAfterSavedBatch;
    const root = Object.create({
      async *values() {
        enumerationCount += 1;
        for (let index = 0; index < fileHandles.length; index += 1) {
          if (index === 250) {
            markBatchSaved();
            await afterSavedBatch;
          }
          yield fileHandles[index];
        }
        throw new DOMException('simulated permission loss after resume', 'NotAllowedError');
      }
    });
    Object.assign(root, { kind: 'directory', name: 'SavedBatch' });
    window.__directoryEnumerationCount = () => enumerationCount;
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => root
    });
  });
}

test.describe('Cross-engine directory visibility smoke', { tag: '@cross-engine-smoke' }, () => {
test.beforeEach(async ({ browser }, testInfo) => {
  await attachBrowserEngineEvidence(browser, testInfo);
});

test('visibility changes pause and resume the same directory scan without repeating entries', async ({ page, browserName }) => {
  test.setTimeout(60000);
  await bootApp(page);
  await installGatedDirectory(page);
  await page.locator('#add-folder').click();
  await page.evaluate(() => window.__directoryEnumerationStarted);
  await page.evaluate(() => {
    window.__setScanVisibilityState('hidden');
    window.__releaseDirectoryEnumeration();
  });

  const progress = page.locator('.toast-directory-scan-progress');
  await expect(progress).toHaveAttribute('role', 'status');
  await expect(progress).toContainText(PAUSED_STATUS);
  await expect(page.getByText('Folder scan complete.', { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => window.Blend.state.library.size)).toBe(0);
  expect(await page.evaluate(() => window.__directoryEnumerationCount())).toBe(1);

  await page.evaluate(() => window.__setScanVisibilityState('visible'));
  await page.evaluate(() => window.__directoryResumeBoundary);
  await expect(progress).toContainText('Scanning "Background"... 24 files found');
  await page.evaluate(() => window.__releaseResumedEnumeration());
  await expect(progress).toHaveCount(0);
  const resumed = await page.evaluate(() => {
    const items = Array.from(window.Blend.state.library.values())
      .filter(item => item.name.startsWith('Background-'));
    return {
      count: items.length,
      uniqueIds: new Set(items.map(item => item.id)).size,
      uniqueNames: new Set(items.map(item => item.name)).size,
      enumerationCount: window.__directoryEnumerationCount()
    };
  });
  expect(resumed).toEqual({ count: 48, uniqueIds: 48, uniqueNames: 48, enumerationCount: 1 });
  console.log(`[DIRECTORY VISIBILITY] ${browserName}: simulated hidden -> paused -> visible -> resumed without duplicate enumeration`);
});

test('a native background tab pauses and resumes the same directory scan', async ({ page, context, browserName }) => {
  test.setTimeout(45000);
  await bootApp(page);
  await installGatedDirectory(page, { fakeVisibility: false });
  await page.locator('#add-folder').click();
  await page.evaluate(() => window.__directoryEnumerationStarted);

  const backgroundPage = await context.newPage();
  try {
    await backgroundPage.goto('about:blank');
    await backgroundPage.bringToFront();
    try {
      await page.waitForFunction(() => document.visibilityState === 'hidden', undefined, { timeout: 5000 });
    } catch (_) {
      test.skip(true, `${browserName} did not expose native hidden-tab visibility in this browser session`);
    }

    await page.evaluate(() => window.__releaseDirectoryEnumeration());
    const progress = page.locator('.toast-directory-scan-progress');
    await expect(progress).toContainText(PAUSED_STATUS);
    await page.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'visible', undefined, { timeout: 5000 });
    await page.evaluate(() => window.__directoryResumeBoundary);
    await expect(progress).toContainText('Scanning "Background"... 24 files found');
    await page.evaluate(() => window.__releaseResumedEnumeration());
    await expect(progress).toHaveCount(0);
    const state = await page.evaluate(() => ({
      mediaCount: window.Blend.state.library.size,
      enumerationCount: window.__directoryEnumerationCount()
    }));
    expect(state).toEqual({ mediaCount: 48, enumerationCount: 1 });
    console.log(`[DIRECTORY VISIBILITY] ${browserName}: native hidden -> paused -> visible -> resumed`);
  } finally {
    await backgroundPage.close();
  }
});

test('a native background scan can be canceled after returning to Blend', async ({ page, context, browserName }) => {
  test.setTimeout(45000);
  await bootApp(page);
  await installGatedDirectory(page, { fakeVisibility: false });
  await page.locator('#add-folder').click();
  await page.evaluate(() => window.__directoryEnumerationStarted);

  const backgroundPage = await context.newPage();
  try {
    await backgroundPage.goto('about:blank');
    await backgroundPage.bringToFront();
    try {
      await page.waitForFunction(() => document.visibilityState === 'hidden', undefined, { timeout: 5000 });
    } catch (_) {
      test.skip(true, `${browserName} did not expose native hidden-tab visibility in this browser session`);
    }

    await page.evaluate(() => window.__releaseDirectoryEnumeration());
    const progress = page.locator('.toast-directory-scan-progress');
    await expect(progress).toContainText(PAUSED_STATUS);
    await page.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'visible', undefined, { timeout: 5000 });
    await page.evaluate(() => window.__directoryResumeBoundary);
    await expect(progress).toContainText('Scanning "Background"... 24 files found');

    const cancel = progress.getByRole('button', { name: 'Cancel scan' });
    await cancel.click();
    await page.evaluate(() => window.__releaseResumedEnumeration());
    const status = page.locator('.toast-directory-scan');
    await expect(status).toContainText('Folder scan canceled. 24 media files found so far were kept.');
    await expect(page.getByText('Folder scan complete.', { exact: false })).toHaveCount(0);
    const canceled = await page.evaluate(() => ({
      librarySize: window.Blend.state.library.size,
      uniqueIds: new Set(window.Blend.state.library.keys()).size,
      enumerationCount: window.__directoryEnumerationCount()
    }));
    expect(canceled).toEqual({ librarySize: 24, uniqueIds: 24, enumerationCount: 1 });
    console.log(`[DIRECTORY VISIBILITY] ${browserName}: native hidden -> paused -> returned -> canceled with partial results`);
  } finally {
    await backgroundPage.close();
  }
});

test('permission loss after a hidden pause preserves the saved batch as a partial result', async ({ page, browserName }) => {
  test.setTimeout(120000);
  test.skip(browserName === 'webkit', 'The WebKit runner did not commit the synthetic 250-file handle batch to IndexedDB; saved-batch behavior is unverified there.');
  await bootApp(page);
  await installPermissionLossAfterSavedBatch(page);

  await page.locator('#add-folder').click();
  const progress = page.locator('.toast-directory-scan-progress');
  await expect(progress).toHaveAttribute('role', 'status');
  await page.evaluate(() => window.__directoryBatchSaved);
  expect(await page.evaluate(() => window.Blend.state.library.size)).toBe(250);
  await page.evaluate(() => {
    window.__setScanVisibilityState('hidden');
    window.__releaseAfterSavedBatch();
  });
  await expect(progress).toContainText(PAUSED_STATUS, { timeout: 30000 });
  await expect(page.getByText('Folder scan complete.', { exact: false })).toHaveCount(0);
  const beforeResume = await page.evaluate(() => {
    const items = Array.from(window.Blend.state.library.values())
      .filter(item => item.name.startsWith('Saved-'));
    return {
      count: items.length,
      ids: items.map(item => item.id).sort(),
      uniqueIds: new Set(items.map(item => item.id)).size,
      uniqueNames: new Set(items.map(item => item.name)).size,
      enumerationCount: window.__directoryEnumerationCount()
    };
  });
  expect(beforeResume).toMatchObject({ count: 250, uniqueIds: 250, uniqueNames: 250, enumerationCount: 1 });

  await page.evaluate(() => window.__setScanVisibilityState('visible'));
  const status = page.locator('.toast-directory-scan');
  await expect(status).toContainText('Folder scan was partial: 1 folder could not be read.');
  await expect(status).toContainText('264 supported media files found; 250 added, 0 skipped (0 already present), 14 pending.');
  await expect(page.getByText('Folder scan complete.', { exact: false })).toHaveCount(0);
  const afterResume = await page.evaluate(() => {
    const items = Array.from(window.Blend.state.library.values())
      .filter(item => item.name.startsWith('Saved-'));
    return {
      count: items.length,
      ids: items.map(item => item.id).sort(),
      uniqueIds: new Set(items.map(item => item.id)).size,
      uniqueNames: new Set(items.map(item => item.name)).size,
      enumerationCount: window.__directoryEnumerationCount()
    };
  });
  expect(afterResume).toEqual({ ...beforeResume, uniqueIds: 250, uniqueNames: 250, enumerationCount: 1 });
  console.log(`[DIRECTORY VISIBILITY] ${browserName}: synthetic permission loss after resume retained 250 saved items as a partial result`);
});

test.describe('Paused scan status viewport and touch checks', () => {
  test.use({ hasTouch: true });

  test('paused status wraps, remains reachable, and can be canceled at requested viewport sizes', async ({ page }) => {
    test.setTimeout(90000);
    const viewports = [
      { width: 320, height: 480 },
      { width: 360, height: 800 },
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1280, height: 720 }
    ];

    await bootApp(page);
    await installGatedDirectory(page, { fileExtension: 'txt' });
    await page.locator('#add-folder').click();
    await page.evaluate(() => window.__directoryEnumerationStarted);
    await page.evaluate(() => {
      window.__setScanVisibilityState('hidden');
      window.__releaseDirectoryEnumeration();
    });

    const progress = page.locator('.toast-directory-scan-progress');
    const cancel = progress.getByRole('button', { name: 'Cancel scan' });
    await expect(progress).toHaveAttribute('role', 'status');
    await expect(progress).toContainText(PAUSED_STATUS);

    await page.locator('#close-config').focus();
    const focusableCount = await page.evaluate(() => document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ).length);
    let reachedCancelByKeyboard = false;
    for (let index = 0; index < focusableCount + 1; index += 1) {
      await page.keyboard.press('Tab');
      if (await cancel.evaluate(node => node === document.activeElement)) {
        reachedCancelByKeyboard = true;
        break;
      }
    }
    expect(reachedCancelByKeyboard).toBe(true);
    await expect(cancel).toBeFocused();

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(progress).toBeVisible();
      await expect(progress).toContainText(PAUSED_STATUS);
      const metrics = await progress.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const label = node.querySelector('span');
        const labelRect = label.getBoundingClientRect();
        const action = node.querySelector('button');
        const actionRect = action.getBoundingClientRect();
        const hit = document.elementFromPoint(
          actionRect.left + actionRect.width / 2,
          actionRect.top + actionRect.height / 2
        );
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          labelHeight: labelRect.height,
          labelLineHeight: Number.parseFloat(getComputedStyle(label).lineHeight),
          labelScrollWidth: label.scrollWidth,
          labelClientWidth: label.clientWidth,
          labelScrollHeight: label.scrollHeight,
          labelClientHeight: label.clientHeight,
          labelTop: labelRect.top,
          labelBottom: labelRect.bottom,
          actionTop: actionRect.top,
          actionBottom: actionRect.bottom,
          actionWidth: actionRect.width,
          actionHeight: actionRect.height,
          actionHitReachable: hit === action || action.contains(hit),
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          pageWidth: document.documentElement.scrollWidth
        };
      });

      expect(metrics.left).toBeGreaterThanOrEqual(-1);
      expect(metrics.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(metrics.top).toBeGreaterThanOrEqual(-1);
      expect(metrics.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(metrics.pageWidth).toBeLessThanOrEqual(viewport.width + 2);
      expect(metrics.labelHeight).toBeGreaterThan(metrics.labelLineHeight);
      expect(metrics.labelScrollWidth).toBeLessThanOrEqual(metrics.labelClientWidth + 1);
      expect(metrics.labelScrollHeight).toBeLessThanOrEqual(metrics.labelClientHeight + 1);
      expect(metrics.actionTop).toBeGreaterThanOrEqual(metrics.labelBottom - 1);
      expect(metrics.actionWidth).toBeGreaterThanOrEqual(44);
      expect(metrics.actionHeight).toBeGreaterThanOrEqual(44);
      expect(metrics.actionHitReachable).toBe(true);

      const focus = await cancel.evaluate(node => ({
        focusVisible: node.matches(':focus-visible'),
        outlineStyle: getComputedStyle(node).outlineStyle,
        outlineWidth: getComputedStyle(node).outlineWidth
      }));
      expect(focus.focusVisible).toBe(true);
      expect(focus.outlineStyle).toBe('solid');
      expect(focus.outlineWidth).toBe('2px');
      await expect(cancel).toBeFocused();
    }

    await cancel.tap();
    const status = page.locator('.toast-directory-scan');
    await expect(status).toContainText('Folder scan canceled. No media files were added.');
    await expect(page.getByText('Folder scan complete.', { exact: false })).toHaveCount(0);
    const canceled = await page.evaluate(() => ({
      librarySize: window.Blend.state.library.size,
      uniqueIds: new Set(window.Blend.state.library.keys()).size,
      enumerationCount: window.__directoryEnumerationCount()
    }));
    expect(canceled).toEqual({ librarySize: 0, uniqueIds: 0, enumerationCount: 1 });
  });
});
});
