import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const SOURCE_NAME = 'Issue 07 Source';
const TARGET_NAME = 'Issue 07 Target';
const FAILURE_COPY = 'Changes are not saved yet. Retry or export a backup before closing.';
const BASE_ORDER = ['issue07-a', 'issue07-b', 'issue07-c'];
const VIEWPORTS = [
  { label: '4K desktop', width: 3840, height: 2160 },
  { label: 'HD desktop', width: 1920, height: 1080 },
  { label: 'desktop', width: 1366, height: 900 },
  { label: 'tablet landscape', width: 1024, height: 768 },
  { label: 'tablet portrait', width: 768, height: 1024 },
  { label: 'iPhone portrait', width: 390, height: 844 },
  { label: 'Android portrait', width: 360, height: 800 },
  { label: 'narrow phone', width: 320, height: 640 }
];

async function prepareSourceAndTarget(page, blendPage) {
  await blendPage.boot('/index.html');
  await blendPage.createExperience(SOURCE_NAME);
  const sourceId = await blendPage.activeExperienceIdByName(SOURCE_NAME);
  await blendPage.createExperience(TARGET_NAME);
  const targetId = await blendPage.activeExperienceIdByName(TARGET_NAME);
  await page.evaluate(id => window.Blend.switchExperienceById(id), sourceId);

  const baselineSaved = await page.evaluate(() => {
    const state = window.Blend.state;
    state.playlist = ['issue07-a', 'issue07-b', 'issue07-c'].map((id, index) => ({ id, addedAt: index + 1 }));
    state.slideshow = [];
    state.runtime.playlistIndex = 0;
    return window.Blend.saveStateNow();
  });
  expect(baselineSaved).toBe(true);
  await expect(page.locator('#save-status')).toHaveText('All changes saved');
  return { sourceId, targetId };
}

async function reversePlaylist(page, blendPage) {
  await blendPage.openConfig();
  await page.locator('button[data-tab="playlist"]').click();
  await page.locator('#list-reverse').click();
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  await expect.poll(() => page.evaluate(() => window.Blend.state.playlist.map(item => item.id)))
    .toEqual([...BASE_ORDER].reverse());
}

async function readPersistedPlaylist(page, experienceId) {
  return page.evaluate(id => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onerror = () => reject(request.error || new Error('Could not open Blend database'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('experiences', 'readonly');
      const read = transaction.objectStore('experiences').get(id);
      read.onsuccess = () => {
        const record = read.result || null;
        database.close();
        resolve((record?.payload?.playlist || []).map(item => item.id));
      };
      read.onerror = () => {
        const error = read.error || new Error('Could not read saved experience');
        database.close();
        reject(error);
      };
    };
  }), experienceId);
}

async function countPersistedExperienceRecords(page, experienceId) {
  return page.evaluate(id => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1', 5);
    request.onerror = () => reject(request.error || new Error('Could not open Blend database'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('experiences', 'readonly');
      const read = transaction.objectStore('experiences').getAll();
      read.onsuccess = () => {
        const matches = (read.result || []).filter(record => record.id === id).length;
        database.close();
        resolve(matches);
      };
      read.onerror = () => {
        const error = read.error || new Error('Could not read saved experiences');
        database.close();
        reject(error);
      };
    };
  }), experienceId);
}

async function installHeldWrite(page, { recordPagehide = false } = {}) {
  await page.evaluate(markPagehide => {
    window.__issue07GateEntered = false;
    window.__issue07GateReleased = false;
    window.__BLEND_TEST_HOOKS__ ||= {};
    window.__BLEND_TEST_HOOKS__.beforeSnapshotPersist = () => {
      if (window.__issue07RecordPagehide) localStorage.setItem('issue07-pagehide-flush', 'started');
      if (window.__issue07GateReleased) return;
      window.__issue07GateEntered = true;
      return new Promise(resolve => { window.__issue07ReleaseGate = resolve; });
    };
    window.__issue07RecordPagehide = markPagehide;
  }, recordPagehide);
}

async function installOneShotWriteFailure(page) {
  await page.evaluate(() => {
    window.__issue07FailureSentinel = 'private-path-and-token-sentinel';
    window.__issue07FailNextSnapshot = true;
    window.__BLEND_TEST_HOOKS__ ||= {};
    window.__BLEND_TEST_HOOKS__.beforeSnapshotPersist = () => {
      if (!window.__issue07FailNextSnapshot) return;
      window.__issue07FailNextSnapshot = false;
      throw new DOMException(window.__issue07FailureSentinel, 'QuotaExceededError');
    };
  });
}

async function closeAndReopen(context, oldPage) {
  await oldPage.close();
  const reopened = await context.newPage();
  await new BlendAppPage(reopened).boot('/index.html');
  return reopened;
}

test('closing inside the debounce window attempts a best-effort flush and keeps the prior snapshot intact', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  const { sourceId } = await prepareSourceAndTarget(page, blendPage);
  await reversePlaylist(page, blendPage);
  await installHeldWrite(page, { recordPagehide: true });

  const reopened = await closeAndReopen(page.context(), page);
  await expect.poll(() => reopened.evaluate(() => localStorage.getItem('issue07-pagehide-flush')))
    .toBe('started');
  expect(await readPersistedPlaylist(reopened, sourceId)).toEqual(BASE_ORDER);
  await reopened.close();
});

test('closing after the 850 ms debounce reopens with the committed edit', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  const { sourceId } = await prepareSourceAndTarget(page, blendPage);
  await reversePlaylist(page, blendPage);
  await expect(page.locator('#save-status')).toHaveText('All changes saved', { timeout: 10_000 });

  const reopened = await closeAndReopen(page.context(), page);
  await expect.poll(() => reopened.evaluate(() => window.Blend.state.playlist.map(item => item.id)))
    .toEqual([...BASE_ORDER].reverse());
  expect(await readPersistedPlaylist(reopened, sourceId)).toEqual([...BASE_ORDER].reverse());
  expect(await countPersistedExperienceRecords(reopened, sourceId)).toBe(1);
  await reopened.close();
});

test('experience switching waits for the latest in-window revision before leaving', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  const { sourceId, targetId } = await prepareSourceAndTarget(page, blendPage);
  await reversePlaylist(page, blendPage);
  await installHeldWrite(page);

  await blendPage.experienceSelect.selectOption(targetId);
  await page.waitForFunction(() => window.__issue07GateEntered === true);
  await expect(page.locator('#save-status')).toHaveText('Saving changes…');
  expect(await page.evaluate(() => window.Blend.state.activeExperienceId)).toBe(sourceId);

  await page.evaluate(() => {
    window.__issue07GateReleased = true;
    window.__issue07ReleaseGate?.();
  });
  await expect.poll(() => page.evaluate(() => window.Blend.state.activeExperienceId)).toBe(targetId);
  expect(await readPersistedPlaylist(page, sourceId)).toEqual([...BASE_ORDER].reverse());
});

test('failed save keeps edits exportable, announces status, and supports keyboard retry', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  const { sourceId } = await prepareSourceAndTarget(page, blendPage);
  await reversePlaylist(page, blendPage);
  await installOneShotWriteFailure(page);

  const saved = await page.evaluate(() => window.Blend.saveStateNow());
  expect(saved).toBe(false);
  const status = page.locator('#save-status');
  await expect(status).toHaveText(FAILURE_COPY);
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  expect(await page.evaluate(() => window.Blend.state.playlist.map(item => item.id)))
    .toEqual([...BASE_ORDER].reverse());
  expect(await readPersistedPlaylist(page, sourceId)).toEqual(BASE_ORDER);

  const alert = page.getByRole('alert').filter({ hasText: FAILURE_COPY });
  const retry = alert.getByRole('button', { name: 'Retry' });
  const exportBackup = alert.getByRole('button', { name: 'Export Backup' });
  await expect(retry).toBeVisible();
  await expect(exportBackup).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(status, viewport.label).toBeVisible();
    const box = await status.boundingBox();
    expect(box?.width, viewport.label).toBeGreaterThan(0);
    expect((box?.x || 0) + (box?.width || 0), viewport.label).toBeLessThanOrEqual(viewport.width + 1);
  }
  const statusWrapping = await status.evaluate(element => getComputedStyle(element).whiteSpace);
  expect(statusWrapping).not.toBe('nowrap');

  await page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
  await expect(status).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });

  const debugLog = await page.evaluate(() => window.Blend.log.exportJson());
  expect(debugLog).toContain('QuotaExceededError');
  expect(debugLog).not.toContain('private-path-and-token-sentinel');

  const downloadPromise = page.waitForEvent('download');
  await exportBackup.focus();
  await expect(exportBackup).toBeFocused();
  await page.keyboard.press('Enter');
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.schema).toBe('player.blend.experience.v2');
  expect(exported.playlist.order).toEqual([...BASE_ORDER].reverse());

  await retry.focus();
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('All changes saved');
  await expect(alert).not.toBeVisible();
  expect(await readPersistedPlaylist(page, sourceId)).toEqual([...BASE_ORDER].reverse());
});
