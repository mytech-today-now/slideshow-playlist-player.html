import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import { LOCAL_IMPORT_MAX_MEDIA_FILES } from '../../local-import-limits.js';

async function bootAddFiles(page) {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await blendPage.openConfig();
  return blendPage;
}

async function activateAddFilesByKeyboard(page) {
  await page.locator('#add-files').focus();
  await page.keyboard.press('Enter');
}

async function installSnapshotWriteCounter(page) {
  await page.evaluate(() => {
    window.__selectionSnapshotWrites = 0;
    window.__BLEND_TEST_HOOKS__ ||= {};
    window.__BLEND_TEST_HOOKS__.beforeSnapshotPersist = () => {
      window.__selectionSnapshotWrites += 1;
    };
  });
}

async function readLibrarySnapshot(page) {
  return page.evaluate(() => Array.from(window.Blend.state.library.values())
    .map(item => ({ id: item.id, name: item.name, size: item.size }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)));
}

async function installNativeSelection(page, {
  count,
  failIndex = -1,
  failFirstRead = false,
  firstCallTypeError = false,
  unsupportedIndex = -1
}) {
  await page.evaluate(options => {
    window.__selectionGetFileCalls = 0;
    window.__selectionPickerCalls = [];
    let typeErrorThrown = false;
    const attempts = new Map();
    const handles = Array.from({ length: options.count }, (_, index) => {
      const name = index === options.unsupportedIndex
        ? `synthetic-${String(index).padStart(3, '0')}.txt`
        : `synthetic-${String(index).padStart(3, '0')}.png`;
      const file = new File([`synthetic contents ${index}`], name, {
        type: name.endsWith('.txt') ? 'text/plain' : 'image/png'
      });
      return {
        kind: 'file',
        name,
        transient: true,
        file,
        async getFile() {
          window.__selectionGetFileCalls += 1;
          const reads = (attempts.get(index) || 0) + 1;
          attempts.set(index, reads);
          if (options.failFirstRead && index === options.failIndex && reads === 1) {
            throw new DOMException('synthetic unreadable handle', 'NotReadableError');
          }
          return file;
        },
        async queryPermission() { return 'granted'; },
        async requestPermission() { return 'granted'; }
      };
    });
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async pickerOptions => {
        window.__selectionPickerCalls.push({ multiple: pickerOptions.multiple, hasTypes: !!pickerOptions.types });
        if (options.firstCallTypeError && !typeErrorThrown) {
          typeErrorThrown = true;
          throw new TypeError('synthetic picker type option failure');
        }
        return handles;
      }
    });
  }, { count, failIndex, failFirstRead, firstCallTypeError, unsupportedIndex });
}

async function expectOversizedSelectionNotice(page, selected) {
  const notice = page.locator('#toast-container .toast-import-selection-limit[role="alert"]').last();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('aria-live', 'assertive');
  await expect(notice.locator('span')).toHaveText(
    `You selected more files than Blend can add in one batch. Select up to ${LOCAL_IMPORT_MAX_MEDIA_FILES} files, or choose a smaller folder. No unlisted files were added. Selected: ${selected}; accepted: 0; remaining: ${selected}.`
  );
  return notice;
}

test('native Add Files rejects an oversized selection before reading or saving handles', async ({ page }) => {
  await bootAddFiles(page);
  await installSnapshotWriteCounter(page);
  await installNativeSelection(page, { count: LOCAL_IMPORT_MAX_MEDIA_FILES + 1 });
  const before = await readLibrarySnapshot(page);

  await activateAddFilesByKeyboard(page);

  await expectOversizedSelectionNotice(page, LOCAL_IMPORT_MAX_MEDIA_FILES + 1);
  expect(await readLibrarySnapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.__selectionGetFileCalls)).toBe(0);
  expect(await page.evaluate(() => window.__selectionSnapshotWrites)).toBe(0);
});

test('native Add Files accepts an exact-cap selection without truncating it', async ({ page }) => {
  await bootAddFiles(page);
  await installNativeSelection(page, { count: LOCAL_IMPORT_MAX_MEDIA_FILES });

  await activateAddFilesByKeyboard(page);

  await expect.poll(() => readLibrarySnapshot(page)).toHaveLength(LOCAL_IMPORT_MAX_MEDIA_FILES);
  const rows = await readLibrarySnapshot(page);
  expect(rows[0].name).toBe('synthetic-000.png');
  expect(rows.at(-1).name).toBe(`synthetic-${String(LOCAL_IMPORT_MAX_MEDIA_FILES - 1).padStart(3, '0')}.png`);
});

test('untyped native picker retry uses the same oversized-selection rejection', async ({ page }) => {
  await bootAddFiles(page);
  await installSnapshotWriteCounter(page);
  await installNativeSelection(page, {
    count: LOCAL_IMPORT_MAX_MEDIA_FILES + 1,
    firstCallTypeError: true,
    unsupportedIndex: LOCAL_IMPORT_MAX_MEDIA_FILES
  });
  const before = await readLibrarySnapshot(page);

  await activateAddFilesByKeyboard(page);

  await expectOversizedSelectionNotice(page, LOCAL_IMPORT_MAX_MEDIA_FILES + 1);
  expect(await readLibrarySnapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.__selectionPickerCalls)).toEqual([
    { multiple: true, hasTypes: true },
    { multiple: true, hasTypes: false }
  ]);
  expect(await page.evaluate(() => window.__selectionGetFileCalls)).toBe(0);
  expect(await page.evaluate(() => window.__selectionSnapshotWrites)).toBe(0);
});

test('input fallback rejects an oversized selection and keeps its accessible count visible at narrow zoom', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await bootAddFiles(page);
  await installSnapshotWriteCounter(page);
  const before = await readLibrarySnapshot(page);
  const chooserPromise = page.waitForEvent('filechooser');
  await activateAddFilesByKeyboard(page);
  const chooser = await chooserPromise;
  await chooser.setFiles(Array.from({ length: LOCAL_IMPORT_MAX_MEDIA_FILES + 1 }, (_, index) => ({
    name: `input-${String(index).padStart(3, '0')}.${index === LOCAL_IMPORT_MAX_MEDIA_FILES ? 'txt' : 'png'}`,
    mimeType: index === LOCAL_IMPORT_MAX_MEDIA_FILES ? 'text/plain' : 'image/png',
    buffer: Buffer.from(`input fixture ${index}`)
  })));

  const notice = await expectOversizedSelectionNotice(page, LOCAL_IMPORT_MAX_MEDIA_FILES + 1);
  expect(await readLibrarySnapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.__selectionSnapshotWrites)).toBe(0);
  const initialBounds = await notice.boundingBox();
  expect(initialBounds?.x).toBeGreaterThanOrEqual(0);
  expect((initialBounds?.x || 0) + (initialBounds?.width || 0)).toBeLessThanOrEqual(321);

  await page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
  await expect(notice).toBeVisible();
  expect(await notice.locator('span').evaluate(node => getComputedStyle(node).whiteSpace)).not.toBe('nowrap');
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
});

test('input fallback preserves media filtering for an accepted selection', async ({ page }) => {
  await bootAddFiles(page);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#add-files').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([
    { name: 'accepted-image.png', mimeType: 'image/png', buffer: Buffer.from('accepted image') },
    { name: 'unsupported.txt', mimeType: 'text/plain', buffer: Buffer.from('ignore me') }
  ]);

  await expect.poll(() => readLibrarySnapshot(page)).toHaveLength(1);
  expect((await readLibrarySnapshot(page)).map(item => item.name)).toEqual(['accepted-image.png']);
  const saveStatus = page.locator('#save-status');
  await expect.poll(() => saveStatus.getAttribute('data-state')).toMatch(/^(saved|failed)$/);
  if (await saveStatus.getAttribute('data-state') === 'failed') {
    await expect(page.locator('#toast-container'))
      .toContainText('Selected 2; accepted 1; remaining 0. Added 1; already in library 0; skipped 1.');
  } else {
    await expect(page.locator('#toast-container')).toContainText('Added 1 media file');
  }
});

test('native Add Files keeps exact directory identity duplicates while skipping unsupported media', async ({ page }) => {
  await bootAddFiles(page);
  await page.evaluate(() => {
    const duplicate = name => {
      const file = new File(['same bytes'], name, { type: name.endsWith('.png') ? 'image/png' : 'text/plain' });
      return {
        kind: 'file',
        name,
        directoryId: 'synthetic-directory',
        pathHint: `Assets/${name}`,
        transient: true,
        file,
        async getFile() { return file; },
        async queryPermission() { return 'granted'; },
        async requestPermission() { return 'granted'; }
      };
    };
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [duplicate('same-image.png'), duplicate('same-image.png'), duplicate('unsupported.txt')]
    });
  });

  await activateAddFilesByKeyboard(page);

  await expect.poll(() => readLibrarySnapshot(page)).toHaveLength(1);
  expect((await readLibrarySnapshot(page)).map(item => item.name)).toEqual(['same-image.png']);
});

test('native picker cancellation and input fallback cancellation leave the library unchanged', async ({ page }) => {
  await bootAddFiles(page);
  const before = await readLibrarySnapshot(page);
  await page.evaluate(() => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => { throw new DOMException('user canceled', 'AbortError'); }
    });
  });

  await activateAddFilesByKeyboard(page);
  await expect.poll(() => readLibrarySnapshot(page)).toEqual(before);
  await expect(page.locator('#toast-container')).not.toContainText('more files than Blend can add');

  await page.evaluate(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined });
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') {
        this.dispatchEvent(new Event('cancel'));
        return;
      }
      originalClick.call(this);
    };
  });
  await activateAddFilesByKeyboard(page);
  await expect.poll(() => readLibrarySnapshot(page)).toEqual(before);
  await expect(page.locator('#toast-container')).not.toContainText('more files than Blend can add');
});

test('an unreadable direct handle keeps successful files and retries only the failed file', async ({ page, browserName }) => {
  await bootAddFiles(page);
  await installNativeSelection(page, { count: 3, failIndex: 1, failFirstRead: true });

  await activateAddFilesByKeyboard(page);

  const notice = page.locator('#toast-container .toast-import-partial[role="alert"]');
  await expect(notice).toContainText('1 selected file could not be read.');
  await expect(notice).toContainText('Selected 3; accepted 2; remaining 1. Added 2; already in library 0; skipped 0.');
  await expect(notice.getByRole('button', { name: 'Retry failed file' })).toBeVisible();
  const successfulRows = await readLibrarySnapshot(page);
  expect(successfulRows.map(item => item.name)).toEqual([
    'synthetic-000.png',
    'synthetic-002.png'
  ]);
  if (browserName === 'webkit') {
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'failed');
  } else {
    await expect(page.locator('#save-status')).toHaveText('All changes saved');
  }

  const retry = notice.getByRole('button', { name: 'Retry failed file' });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => readLibrarySnapshot(page)).toHaveLength(3);
  expect((await readLibrarySnapshot(page)).map(item => item.name)).toEqual([
    'synthetic-000.png',
    'synthetic-001.png',
    'synthetic-002.png'
  ]);
  const finalRows = await readLibrarySnapshot(page);
  for (const row of successfulRows) {
    expect(finalRows.find(item => item.name === row.name)?.id).toBe(row.id);
  }
  if (browserName !== 'webkit') await expect(page.locator('#save-status')).toHaveText('All changes saved');
});

test('quota failure retains imported rows and the save retry persists them without duplicates', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Quota-injected snapshot recovery runs in Chromium; all engines run the Add Files selection and read-retry matrix.');
  await bootAddFiles(page);
  await installNativeSelection(page, { count: 3 });
  await page.evaluate(() => {
    window.__selectionQuotaFailures = 1;
    window.__selectionSnapshotPersistCalls = 0;
    window.__BLEND_TEST_HOOKS__ ||= {};
    window.__BLEND_TEST_HOOKS__.beforeSnapshotPersist = () => {
      window.__selectionSnapshotPersistCalls += 1;
      if (!window.__selectionQuotaFailures) return;
      window.__selectionQuotaFailures -= 1;
      throw new DOMException('synthetic quota failure', 'QuotaExceededError');
    };
  });

  await activateAddFilesByKeyboard(page);

  const importNotice = page.locator('#toast-container .toast-import-save-failure[role="alert"]');
  await expect(importNotice).toContainText('Selected 3; accepted 3; remaining 0. Added 3; already in library 0; skipped 0.');
  const saveNotice = page.locator('#toast-container .toast-save-failure[role="alert"]');
  await expect(saveNotice).toBeVisible();
  expect((await readLibrarySnapshot(page)).map(item => item.name)).toEqual([
    'synthetic-000.png',
    'synthetic-001.png',
    'synthetic-002.png'
  ]);

  const retry = saveNotice.getByRole('button', { name: 'Retry' });
  await retry.click();
  await expect.poll(() => page.evaluate(() => window.__selectionSnapshotPersistCalls)).toBeGreaterThan(1);
  await expect(page.locator('#save-status')).toHaveText('All changes saved');
  expect((await readLibrarySnapshot(page)).map(item => item.name)).toEqual([
    'synthetic-000.png',
    'synthetic-001.png',
    'synthetic-002.png'
  ]);
});
