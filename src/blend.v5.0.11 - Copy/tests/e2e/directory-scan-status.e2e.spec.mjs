import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

async function bootApp(page) {
  const app = new BlendAppPage(page);
  await app.boot('/index.html');
  await app.openConfig();
}

async function installDirectoryPicker(page, mode) {
  await page.evaluate(scanMode => {
    const makeFile = (name, contents) => {
      const file = new File([contents], name, { type: 'video/mp4' });
      const handle = Object.create({ getFile: async () => file });
      Object.assign(handle, { kind: 'file', name, file, transient: true });
      return handle;
    };
    const makeDirectory = (name, values) => {
      const handle = Object.create({ values });
      Object.assign(handle, { kind: 'directory', name });
      return handle;
    };

    let root;
    if (scanMode === 'partial-retry') {
      const before = makeFile('before.mp4', 'before');
      const middle = makeFile('middle.mp4', 'middle');
      const after = makeFile('after.mp4', 'after');
      const recovered = makeFile('recovered.mp4', 'recovered');
      let failingBranchReads = 0;
      const failingBranch = makeDirectory('Unreadable', async function* () {
        yield middle;
        if (failingBranchReads++ === 0) throw new DOMException('simulated read failure', 'NotReadableError');
        yield recovered;
      });
      const laterBranch = makeDirectory('Later', async function* () { yield after; });
      root = makeDirectory('Assets', async function* () {
        yield before;
        yield failingBranch;
        yield laterBranch;
      });
    } else if (scanMode === 'cancelled') {
      const file = makeFile('kept.mp4', 'kept');
      root = makeDirectory('Canceled', async function* () {
        yield file;
        throw new DOMException('simulated cancellation', 'AbortError');
      });
    } else if (scanMode === 'empty') {
      root = makeDirectory('Empty', async function* () {});
    } else {
      const file = makeFile('complete.mp4', 'complete');
      root = makeDirectory('Complete', async function* () { yield file; });
    }

    window.showDirectoryPicker = async () => root;
  }, mode);
}

test('partial folder scan keeps found files, reports the skipped branch, and retries without duplicates', async ({ page }) => {
  await bootApp(page);
  await installDirectoryPicker(page, 'partial-retry');

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 3);
  const partialNotice = page.locator('.toast-directory-scan');
  await expect(partialNotice).toContainText('Folder scan was partial: 1 folder could not be read.');
  await expect(partialNotice).toContainText('3 media files found; 3 added, 0 already present.');

  await partialNotice.getByRole('button', { name: 'Retry scan' }).click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 4);
  await expect(page.locator('.toast-directory-scan')).toContainText('Folder scan complete.');

  const library = await page.evaluate(async () => Promise.all(Array.from(window.Blend.state.library.values(), async item => ({
    pathHint: item.pathHint,
    content: await (await item.handle.getFile()).text()
  }))));
  expect(library).toHaveLength(4);
  expect(library.map(item => item.pathHint).sort()).toEqual([
    'Assets/Later/after.mp4',
    'Assets/Unreadable/middle.mp4',
    'Assets/Unreadable/recovered.mp4',
    'Assets/before.mp4'
  ]);
  expect(library.map(item => item.content).sort()).toEqual(['after', 'before', 'middle', 'recovered']);
});

test('a complete folder scan keeps its existing success message', async ({ page }) => {
  await bootApp(page);
  await installDirectoryPicker(page, 'complete');

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 1);
  await expect(page.locator('.toast').filter({ hasText: 'Added 1 item from "Complete" (0 already present)' })).toBeVisible();
});

test('an empty complete folder scan explains that no supported media was found', async ({ page }) => {
  await bootApp(page);
  await installDirectoryPicker(page, 'empty');

  await page.locator('#add-folder').click();
  await expect(page.locator('.toast-directory-scan')).toHaveText('No supported media found in that folder');
  await expect.poll(() => page.evaluate(() => window.Blend.state.library.size)).toBe(0);
});

test('canceled folder scans retain discovered files without showing a success message', async ({ page }) => {
  await bootApp(page);
  await installDirectoryPicker(page, 'cancelled');

  await page.locator('#add-folder').click();
  await page.waitForFunction(() => window.Blend?.state?.library?.size === 1);
  await expect(page.locator('.toast-directory-scan')).toHaveText('Folder scan canceled. 1 media file found so far was kept.');
  await expect(page.locator('.toast').filter({ hasText: 'Added 1 item from "Canceled"' })).toHaveCount(0);
});
