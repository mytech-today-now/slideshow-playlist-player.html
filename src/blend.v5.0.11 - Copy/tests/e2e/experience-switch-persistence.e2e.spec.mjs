import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const SOURCE_NAME = 'Issue 06 Source';
const TARGET_NAME = 'Issue 06 Target';
const FAILURE_COPY = 'Changes are not saved yet. Retry to save, export a backup, continue without saving, or cancel the switch.';
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

async function setupSourceAndTarget(page, blendPage) {
  await blendPage.createExperience(SOURCE_NAME);
  const sourceId = await blendPage.activeExperienceIdByName(SOURCE_NAME);

  await blendPage.createExperience(TARGET_NAME);
  const targetId = await blendPage.activeExperienceIdByName(TARGET_NAME);
  const targetSaved = await page.evaluate(() => {
    const state = window.Blend.state;
    state.projectName = 'Issue 06 Target';
    state.settings.opacity = 0.31;
    state.playlist = [{ id: 'target-playlist-item', addedAt: 10 }];
    state.slideshow = [{ id: 'target-slideshow-item', displayDuration: 9 }];
    state.runtime.playlistIndex = 0;
    state.runtime.slideshowIndex = 0;
    return window.Blend.saveStateNow();
  });
  expect(targetSaved).toBe(true);

  await blendPage.switchExperience(SOURCE_NAME);
  const baselineSaved = await page.evaluate(() => window.Blend.saveStateNow());
  expect(baselineSaved).toBe(true);

  const sourceState = await page.evaluate(() => {
    const state = window.Blend.state;
    state.projectName = 'Issue 06 Source with unsaved edits';
    state.settings.opacity = 0.83;
    state.settings.masterVolume = 0.27;
    state.playlist = [
      { id: 'unsaved-playlist-0', addedAt: 20 },
      { id: 'unsaved-playlist-1', addedAt: 21 }
    ];
    state.slideshow = [
      { id: 'unsaved-slideshow-0', displayDuration: 6 },
      { id: 'unsaved-slideshow-1', displayDuration: 7 },
      { id: 'unsaved-slideshow-2', displayDuration: 8 }
    ];
    state.runtime.playlistIndex = 1;
    state.runtime.slideshowIndex = 2;
    state.runtime.isPlaying = true;
    state.ui.activeList = 'slideshow';
    return {
      activeExperienceId: state.activeExperienceId,
      projectName: state.projectName,
      playlistIds: state.playlist.map(item => item.id),
      slideshowIds: state.slideshow.map(item => item.id),
      opacity: state.settings.opacity,
      masterVolume: state.settings.masterVolume,
      playlistIndex: state.runtime.playlistIndex,
      slideshowIndex: state.runtime.slideshowIndex,
      isPlaying: state.runtime.isPlaying,
      activeList: state.ui.activeList
    };
  });
  return { sourceId, targetId, sourceState };
}

async function setupSavedSourceAndTarget(blendPage) {
  await blendPage.createExperience(SOURCE_NAME);
  const sourceId = await blendPage.activeExperienceIdByName(SOURCE_NAME);
  await blendPage.createExperience(TARGET_NAME);
  const targetId = await blendPage.activeExperienceIdByName(TARGET_NAME);
  return { sourceId, targetId };
}

async function getLiveState(page) {
  return page.evaluate(() => {
    const state = window.Blend.state;
    return {
      activeExperienceId: state.activeExperienceId,
      projectName: state.projectName,
      playlistIds: state.playlist.map(item => item.id),
      slideshowIds: state.slideshow.map(item => item.id),
      opacity: state.settings.opacity,
      masterVolume: state.settings.masterVolume,
      playlistIndex: state.runtime.playlistIndex,
      slideshowIndex: state.runtime.slideshowIndex,
      isPlaying: state.runtime.isPlaying,
      activeList: state.ui.activeList
    };
  });
}

async function failNextExperiencePut(page, { recordId, errorName, message }) {
  await page.evaluate(({ targetId, nextErrorName, nextMessage }) => {
    if (!window.__issue06PutFailureInstalled) {
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function issue06InjectedPut(value, ...args) {
        const failure = window.__issue06PutFailure;
        if (failure && this.name === 'experiences' && value?.id === failure.recordId && failure.remaining > 0) {
          failure.remaining -= 1;
          throw new DOMException(failure.message, failure.errorName);
        }
        return originalPut.call(this, value, ...args);
      };
      window.__issue06PutFailureInstalled = true;
    }
    window.__issue06PutFailure = {
      recordId: targetId,
      errorName: nextErrorName,
      message: nextMessage,
      remaining: 1
    };
  }, { targetId: recordId, nextErrorName: errorName, nextMessage: message });
}

async function openFailedSwitch(page, blendPage, targetId, errorName = 'QuotaExceededError') {
  const secretSentinel = `private-path-sentinel-${errorName}?token=private-token-sentinel`;
  await failNextExperiencePut(page, {
    recordId: (await getLiveState(page)).activeExperienceId,
    errorName,
    message: secretSentinel
  });
  await blendPage.openConfig();
  await blendPage.experienceSelect.selectOption(targetId);
  const dialog = page.getByRole('dialog', { name: 'Save the current experience' });
  await expect(dialog).toBeVisible();
  return { dialog, secretSentinel };
}

async function readPersistedExperience(page, id) {
  return page.evaluate(targetId => new Promise((resolve, reject) => {
    const request = indexedDB.open('player-blend-v1');
    request.onerror = () => reject(request.error || new Error('Could not open Blend database'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('experiences', 'readonly');
      const read = transaction.objectStore('experiences').get(targetId);
      read.onsuccess = () => {
        const record = read.result || null;
        database.close();
        resolve(record);
      };
      read.onerror = () => {
        const error = read.error || new Error('Could not read experience');
        database.close();
        reject(error);
      };
    };
  }), id);
}

test('exporting each outgoing experience closes the dialog and switches in both directions', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  const { sourceId, targetId, sourceState } = await setupSourceAndTarget(page, blendPage);
  const { dialog, secretSentinel } = await openFailedSwitch(page, blendPage, targetId);

  await expect(dialog).toContainText(FAILURE_COPY);
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Export Backup' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue Without Saving' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel Switch' })).toBeVisible();
  expect(await dialog.getAttribute('aria-describedby')).toBe('experience-switch-save-message');
  expect(await getLiveState(page)).toEqual(sourceState);
  await expect(blendPage.experienceSelect).toHaveValue(targetId);

  const debugLog = await page.evaluate(() => window.Blend.log.exportJson());
  expect(debugLog).toContain('QuotaExceededError');
  expect(debugLog).not.toContain(secretSentinel);
  expect(debugLog).not.toContain('unsaved-playlist-0');

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export Backup' }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.schema).toBe('player.blend.experience.v2');
  expect(exported.name).toBe(sourceState.projectName);
  expect(exported.playlist.order).toEqual(sourceState.playlistIds);
  expect(exported.slideshow.order).toEqual(sourceState.slideshowIds);
  await expect(dialog).not.toBeVisible();
  await page.waitForFunction(expectedId => window.Blend?.state?.activeExperienceId === expectedId, targetId);
  await expect(blendPage.experienceSelect).toHaveValue(targetId);
  expect((await getLiveState(page)).projectName).toBe(TARGET_NAME);

  await blendPage.flushSaveState();
  const targetSwitch = await openFailedSwitch(page, blendPage, sourceId, 'DataCloneError');
  const targetDownloadPromise = page.waitForEvent('download');
  await targetSwitch.dialog.getByRole('button', { name: 'Export Backup' }).click();
  const targetDownload = await targetDownloadPromise;
  const exportedTarget = JSON.parse(await readFile(await targetDownload.path(), 'utf8'));
  expect(exportedTarget.name).toBe(TARGET_NAME);
  expect(exportedTarget.playlist.order).toEqual(['target-playlist-item']);
  expect(exportedTarget.slideshow.order).toEqual(['target-slideshow-item']);
  await expect(targetSwitch.dialog).not.toBeVisible();
  await page.waitForFunction(expectedId => window.Blend?.state?.activeExperienceId === expectedId, sourceId);
  await expect(blendPage.experienceSelect).toHaveValue(sourceId);
  expect((await getLiveState(page)).projectName).toBe(SOURCE_NAME);

  const storedSource = await readPersistedExperience(page, sourceId);
  expect(storedSource.payload.projectName).toBe(SOURCE_NAME);
  await blendPage.switchExperience(TARGET_NAME);
  await expect(blendPage.experienceSelect).toHaveValue(targetId);
  await expect(page.locator('#experience-switch-save-modal')).not.toBeVisible();
});

test('continuing without export closes the dialog and alternates between two experiences', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  const { sourceId, targetId } = await setupSourceAndTarget(page, blendPage);

  const sourceSwitch = await openFailedSwitch(page, blendPage, targetId);
  await sourceSwitch.dialog.getByRole('button', { name: 'Continue Without Saving' }).click();
  await expect(sourceSwitch.dialog).not.toBeVisible();
  await page.waitForFunction(expectedId => window.Blend?.state?.activeExperienceId === expectedId, targetId);
  await expect(blendPage.experienceSelect).toHaveValue(targetId);
  expect((await getLiveState(page)).projectName).toBe(TARGET_NAME);
  const sourceAfterSkip = await readPersistedExperience(page, sourceId);
  expect(sourceAfterSkip.payload.projectName).toBe(SOURCE_NAME);

  await blendPage.flushSaveState();
  await page.evaluate(() => {
    window.Blend.state.projectName = `${window.Blend.state.projectName} with unsaved edits`;
    window.Blend.state.settings.opacity = 0.91;
  });
  const targetSwitch = await openFailedSwitch(page, blendPage, sourceId, 'DataCloneError');
  await targetSwitch.dialog.getByRole('button', { name: 'Continue Without Saving' }).click();
  await expect(targetSwitch.dialog).not.toBeVisible();
  await page.waitForFunction(expectedId => window.Blend?.state?.activeExperienceId === expectedId, sourceId);
  await expect(blendPage.experienceSelect).toHaveValue(sourceId);
  expect((await getLiveState(page)).projectName).toBe(SOURCE_NAME);

  await blendPage.switchExperience(TARGET_NAME);
  await expect(blendPage.experienceSelect).toHaveValue(targetId);
  expect(await blendPage.activeExperienceName()).toBe(TARGET_NAME);
  expect((await readPersistedExperience(page, targetId)).payload.settings.opacity).toBe(0.31);
});

test('the dropdown alternates between two experiences without requiring a manual export', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  const { sourceId, targetId } = await setupSavedSourceAndTarget(blendPage);

  for (const [name, id] of [
    [SOURCE_NAME, sourceId],
    [TARGET_NAME, targetId],
    [SOURCE_NAME, sourceId],
    [TARGET_NAME, targetId]
  ]) {
    await blendPage.openConfig();
    await blendPage.experienceSelect.selectOption(id);
    await page.waitForFunction(({ expectedId, expectedName }) => (
      window.Blend?.state?.activeExperienceId === expectedId
      && window.Blend?.state?.projectName === expectedName
    ), { expectedId: id, expectedName: name });
    await expect(blendPage.experienceSelect).toHaveValue(id);
    await expect(page.locator('#experience-switch-save-modal')).not.toBeVisible();
    expect(await blendPage.activeExperienceName()).toBe(name);
    await blendPage.flushSaveState();
  }

  const storedSource = await readPersistedExperience(page, sourceId);
  const storedTarget = await readPersistedExperience(page, targetId);
  expect(storedSource.payload.projectName).toBe(SOURCE_NAME);
  expect(storedTarget.payload.projectName).toBe(TARGET_NAME);
});

test('save error classes stay distinct and the recovery dialog supports keyboard and viewport changes', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  const { sourceId, targetId, sourceState } = await setupSourceAndTarget(page, blendPage);
  const { dialog, secretSentinel } = await openFailedSwitch(page, blendPage, targetId, 'DataCloneError');

  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeFocused();
  const ariaSnapshot = await dialog.ariaSnapshot();
  expect(ariaSnapshot).toContain(FAILURE_COPY);
  await expect(dialog).toContainText(FAILURE_COPY);
  const debugLog = await page.evaluate(() => window.Blend.log.exportJson());
  expect(debugLog).toContain('DataCloneError');
  expect(debugLog).not.toContain('QuotaExceededError');
  expect(debugLog).not.toContain(secretSentinel);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const layout = await dialog.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const footer = node.querySelector('.modal-footer');
      const buttons = Array.from(footer.querySelectorAll('button')).map(button => {
        const buttonRect = button.getBoundingClientRect();
        return {
          left: buttonRect.left,
          right: buttonRect.right,
          top: buttonRect.top,
          bottom: buttonRect.bottom,
          visible: buttonRect.width > 0 && buttonRect.height > 0
        };
      });
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        buttons
      };
    });
    expect(layout.left, viewport.label).toBeGreaterThanOrEqual(-1);
    expect(layout.right, viewport.label).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.top, viewport.label).toBeGreaterThanOrEqual(-1);
    expect(layout.bottom, viewport.label).toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.scrollWidth, viewport.label).toBeLessThanOrEqual(layout.clientWidth + 1);
    for (const button of layout.buttons) {
      expect(button.visible, viewport.label).toBe(true);
      expect(button.left, viewport.label).toBeGreaterThanOrEqual(layout.left - 1);
      expect(button.right, viewport.label).toBeLessThanOrEqual(layout.right + 1);
    }
  }

  // At 200% browser zoom, a 320 px viewport has roughly 160 CSS px available.
  await page.setViewportSize({ width: 160, height: 320 });
  const zoomLayout = await dialog.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth
    };
  });
  expect(zoomLayout.left).toBeGreaterThanOrEqual(-1);
  expect(zoomLayout.right).toBeLessThanOrEqual(zoomLayout.viewportWidth + 1);
  expect(zoomLayout.scrollWidth).toBeLessThanOrEqual(zoomLayout.clientWidth + 1);

  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Export Backup' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Continue Without Saving' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Export Backup' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(await getLiveState(page)).toEqual(sourceState);
  await expect(blendPage.experienceSelect).toHaveValue(sourceId);
});

test('retry waits for the outgoing write, switches once, and reload retains both experience snapshots', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  const { sourceId, targetId, sourceState } = await setupSourceAndTarget(page, blendPage);
  const { dialog } = await openFailedSwitch(page, blendPage, targetId, 'QuotaExceededError');
  expect(await getLiveState(page)).toEqual(sourceState);

  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog).not.toBeVisible();
  await page.waitForFunction(expectedId => window.Blend?.state?.activeExperienceId === expectedId, targetId);
  await expect(blendPage.experienceSelect).toHaveValue(targetId);
  await expect(blendPage.toastContainer).toContainText(`Switched to ${TARGET_NAME}`);
  expect(await blendPage.toastContainer.locator('.toast').filter({ hasText: `Switched to ${TARGET_NAME}` }).count()).toBe(1);

  await page.reload();
  await page.waitForFunction(expectedId => window.Blend?.state?.activeExperienceId === expectedId, targetId);
  const restoredTarget = await getLiveState(page);
  expect(restoredTarget.projectName).toBe(TARGET_NAME);
  expect(restoredTarget.playlistIds).toEqual(['target-playlist-item']);
  expect(restoredTarget.slideshowIds).toEqual(['target-slideshow-item']);
  expect(restoredTarget.opacity).toBe(0.31);

  const storedSource = await readPersistedExperience(page, sourceId);
  const storedTarget = await readPersistedExperience(page, targetId);
  expect(storedSource.payload.projectName).toBe(sourceState.projectName);
  expect(storedSource.payload.playlist.map(item => item.id)).toEqual(sourceState.playlistIds);
  expect(storedSource.payload.slideshow.map(item => item.id)).toEqual(sourceState.slideshowIds);
  expect(storedSource.payload.settings.opacity).toBe(sourceState.opacity);
  expect(storedTarget.payload.projectName).toBe(TARGET_NAME);
  expect(storedTarget.payload.playlist.map(item => item.id)).toEqual(['target-playlist-item']);
  expect(storedTarget.payload.slideshow.map(item => item.id)).toEqual(['target-slideshow-item']);
  expect(await getLiveState(page)).toEqual({
    ...restoredTarget,
    activeExperienceId: targetId
  });

  await blendPage.switchExperience(sourceState.projectName);
  await expect(blendPage.experienceSelect).toHaveValue(sourceId);
  await expect(blendPage.toastContainer).toContainText(`Switched to ${sourceState.projectName}`);
  expect(await blendPage.toastContainer.locator('.toast').filter({ hasText: `Switched to ${sourceState.projectName}` }).count()).toBe(1);
  expect((await getLiveState(page)).playlistIds).toEqual(sourceState.playlistIds);

  await blendPage.switchExperience(TARGET_NAME);
  await expect(blendPage.experienceSelect).toHaveValue(targetId);
  await expect(blendPage.toastContainer).toContainText(`Switched to ${TARGET_NAME}`);
  expect(await blendPage.toastContainer.locator('.toast').filter({ hasText: `Switched to ${TARGET_NAME}` }).count()).toBe(1);
});
