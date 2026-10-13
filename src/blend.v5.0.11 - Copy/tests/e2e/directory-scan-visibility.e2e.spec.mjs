import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const PAUSED_STATUS = 'Folder scanning is paused while this tab is in the background. Return to Blend to resume or cancel. Saved batches remain available.';

async function bootApp(page) {
  const app = new BlendAppPage(page);
  await app.boot('/index.html');
  await app.openConfig();
}

async function installGatedDirectory(page, { fakeVisibility = true } = {}) {
  await page.evaluate(useFakeVisibility => {
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
      const name = `Background-${String(index).padStart(3, '0')}.mp4`;
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

    const root = {
      kind: 'directory',
      name: 'Background',
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
    };
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => root
    });
  }, fakeVisibility);
}

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
