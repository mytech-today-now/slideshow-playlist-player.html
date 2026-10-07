import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const ROOT_NAME = 'Assets';

async function bootRelinkPage(page, which = 'playlist') {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await blendPage.openConfig();
  await blendPage.switchListTab(which);
  const bootSaved = await page.evaluate(() => window.Blend.saveStateNow());
  expect(bootSaved).toBe(true);
  await page.waitForFunction(() => {
    const status = window.Blend?.saveStatus;
    return status?.failed || (!status?.dirty && !status?.saving);
  });
  expect(await page.evaluate(() => window.Blend.saveStatus.failed)).toBe(false);
  await page.evaluate(() => {
    window.Blend.state.settings.importBehavior = 'append';
  });
  return blendPage;
}

async function seedExistingItems(page, items) {
  await page.evaluate(records => {
    const state = window.Blend.state;
    for (const record of records) {
      const sourceUrl = `https://example.invalid/${encodeURIComponent(record.name)}`;
      state.library.set(record.id, {
        id: record.id,
        handle: null,
        name: record.name,
        size: 8,
        type: record.type,
        duration: null,
        pathHint: record.name,
        sourceUrl,
        metadata: { storageReference: sourceUrl },
        addedAt: 1,
        lastVerified: 1,
        stale: false
      });
    }
  }, items);
  const seeded = await page.evaluate(() => window.Blend.saveStateNow());
  expect(seeded).toBe(true);
  await page.waitForFunction(() => {
    const status = window.Blend?.saveStatus;
    return status?.failed || (!status?.dirty && !status?.saving);
  });
  expect(await page.evaluate(() => window.Blend.saveStatus.failed)).toBe(false);
}

async function importMissingList(page, which, items) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#list-import').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'issue10-missing-list.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      schema: 'player.blend.list.v1',
      type: which,
      items: items.map(item => ({ pathKind: 'relative', ...item }))
    }))
  });
  await expect(page.locator('#import-summary-modal')).toBeVisible();
  await page.waitForFunction(({ key, count }) => (
    (window.Blend?.state?.[key] || []).length === count
  ), { key: which, count: items.length });
}

async function waitForSaveAfter(page, previousRevision) {
  await page.waitForFunction(previous => {
    const status = window.Blend?.saveStatus;
    return status?.failed || (
      status?.savedRevision > previous && !status?.dirty && !status?.saving
    );
  }, previousRevision);
  expect(await page.evaluate(() => window.Blend.saveStatus.failed)).toBe(false);
}

async function installDirectoryPicker(page, rootName, children) {
  await page.evaluate(({ name, entries }) => {
    const fileHandlePrototype = {
      async getFile() {
        return new File([this.contents], this.name, {
          type: 'application/octet-stream',
          lastModified: 1
        });
      }
    };
    const directoryHandlePrototype = {
      async *values() {
        for (const entry of this.children) yield entry;
      }
    };
    const build = entry => {
      if (entry.kind === 'file') {
        return Object.assign(Object.create(fileHandlePrototype), {
          kind: 'file',
          name: entry.name,
          contents: entry.contents,
          size: new Blob([entry.contents]).size
        });
      }
      return Object.assign(Object.create(directoryHandlePrototype), {
        kind: 'directory',
        name: entry.name,
        children: (entry.children || []).map(build)
      });
    };
    const root = build({ kind: 'directory', name, children: entries });
    window.showDirectoryPicker = async () => root;
  }, { name: rootName, entries: children });
}

async function clickResolve(page, which) {
  await page.locator('#import-summary-modal [data-resolve]').click();
  await page.waitForFunction(key => {
    const list = window.Blend?.state?.[key] || [];
    return list.length > 0;
  }, which);
}

async function readHandleContents(page, which, index) {
  return page.evaluate(async ({ key, itemIndex }) => {
    const ref = window.Blend.state[key][itemIndex];
    const item = window.Blend.state.library.get(ref.id);
    const file = await item.handle.getFile();
    return { id: item.id, text: await file.text(), pathHint: item.pathHint };
  }, { key: which, itemIndex: index });
}

function missingRefSnapshot(page, which, index) {
  return page.evaluate(({ key, itemIndex }) => {
    const state = window.Blend.state;
    const ref = state[key][itemIndex];
    return {
      id: ref?.id,
      path: ref?.path,
      name: ref?.name,
      type: ref?.type,
      available: ref?.available,
      reason: ref?.reason,
      displayDuration: ref?.displayDuration,
      includeAudio: ref?.includeAudio,
      order: state[key].map(item => item.name),
      selected: Array.from(state.ui.listSelection || []),
      anchor: state.ui.listSelectionAnchorId,
      libraryIds: Array.from(state.library.keys())
    };
  }, { key: which, itemIndex: index });
}

async function assertDialogFitsViewport(page, dialog, width, capture) {
  await page.setViewportSize({ width, height: 900 });
  const dimensions = await dialog.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      bodyScrollWidth: node.querySelector('.modal-body').scrollWidth,
      bodyClientWidth: node.querySelector('.modal-body').clientWidth
    };
  });
  expect(dimensions.left).toBeGreaterThanOrEqual(-1);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth + 1);
  if (capture) {
    await page.screenshot({ path: join(tmpdir(), `blend-issue10-relink-${width}.png`) });
  }
}

async function assertMissingRowFitsViewport(page, row, width) {
  await page.setViewportSize({ width, height: 900 });
  const dimensions = await row.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const action = node.querySelector('.resolve-missing-media')?.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      actionRight: action?.right ?? 0
    };
  });
  expect(dimensions.left).toBeGreaterThanOrEqual(-1);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  expect(dimensions.actionRight).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

test('exact normalized path wins over duplicate basenames and updates placeholders in place', async ({ page }) => {
  await bootRelinkPage(page, 'slideshow');
  await seedExistingItems(page, [
    { id: 'issue10-before', name: 'Before.png', type: 'image' },
    { id: 'issue10-after', name: 'After.png', type: 'image' }
  ]);
  await importMissingList(page, 'slideshow', [
    { id: 'issue10-before', name: 'Before.png', path: 'Before.png', type: 'image' },
    { id: 'missing-clip', name: 'clip.mp4', path: 'Assets\\B\\CLIP.MP4', type: 'video', includeAudio: true },
    { id: 'missing-poster', name: 'poster.png', path: 'Assets/C/poster.png', type: 'image', displayDuration: 19.5 },
    { id: 'issue10-after', name: 'After.png', path: 'After.png', type: 'image' }
  ]);
  await installDirectoryPicker(page, ROOT_NAME, [
    { kind: 'directory', name: 'A', children: [{ kind: 'file', name: 'clip.mp4', contents: 'synthetic-folder-a' }] },
    { kind: 'directory', name: 'B', children: [{ kind: 'file', name: 'clip.mp4', contents: 'synthetic-folder-b-intended' }] },
    { kind: 'directory', name: 'C', children: [{ kind: 'file', name: 'poster.png', contents: 'synthetic-poster' }] }
  ]);
  const initial = await missingRefSnapshot(page, 'slideshow', 1);
  await page.evaluate(id => {
    const state = window.Blend.state;
    state.ui.listSelection = new Set([id]);
    state.ui.listSelectionAnchorId = id;
    window.Blend.renderListEditor();
  }, initial.id);
  const revisionBeforeResolve = await page.evaluate(() => window.Blend.saveStatus.savedRevision);
  await clickResolve(page, 'slideshow');

  await page.waitForFunction(() => {
    const state = window.Blend?.state;
    return state?.slideshow?.[1]?.available === true && state?.slideshow?.[2]?.available === true;
  });
  await expect(page.locator('#missing-media-relink-choice')).toHaveCount(0);

  const state = await page.evaluate(() => {
    const current = window.Blend.state;
    return {
      order: current.slideshow.map(ref => ref.name),
      clip: current.slideshow[1],
      poster: current.slideshow[2],
      selected: Array.from(current.ui.listSelection),
      anchor: current.ui.listSelectionAnchorId
    };
  });
  expect(state.order).toEqual(['Before.png', 'clip.mp4', 'poster.png', 'After.png']);
  expect(state.clip.available).toBe(true);
  expect(state.clip.includeAudio).toBe(true);
  expect(state.poster.available).toBe(true);
  expect(state.poster.displayDuration).toBe(19.5);
  expect(state.selected).toContain(state.clip.id);
  expect(state.anchor).toBe(state.clip.id);

  const content = await readHandleContents(page, 'slideshow', 1);
  expect(content.text).toBe('synthetic-folder-b-intended');
  expect(content.pathHint).toBe('Assets/B/clip.mp4');
  const logs = await page.evaluate(() => window.Blend.log.exportJson());
  expect(logs).not.toContain('Assets/A/clip.mp4');
  expect(logs).not.toContain('Assets/B/clip.mp4');
  await waitForSaveAfter(page, revisionBeforeResolve);

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  const persisted = await page.evaluate(() => {
    const ref = window.Blend.state.slideshow[1];
    const item = window.Blend.state.library.get(ref.id);
    return {
      available: ref.available,
      name: item?.name,
      pathHint: item?.pathHint,
      refPath: ref?.path,
      handleKind: item?.handle?.kind,
      handleName: item?.handle?.name,
      savedContents: item?.handle?.contents
    };
  });
  expect(persisted.available).toBe(true);
  expect(persisted.name).toBe('clip.mp4');
  expect(persisted.pathHint).toBe('Assets/B/clip.mp4');
  expect(persisted.refPath).toBe('Assets/B/clip.mp4');
  expect(persisted.handleKind).toBe('file');
  expect(persisted.handleName).toBe('clip.mp4');
  expect(persisted.savedContents).toBe('synthetic-folder-b-intended');
});

test('ambiguous basename presents keyboard choices and explicit selection links the chosen folder', async ({ page }) => {
  await bootRelinkPage(page, 'playlist');
  await importMissingList(page, 'playlist', [
    { id: 'missing-clip', name: 'clip.mp4', path: 'Legacy/clip.mp4', type: 'video' }
  ]);
  await installDirectoryPicker(page, ROOT_NAME, [
    { kind: 'directory', name: 'A', children: [{ kind: 'file', name: 'clip.mp4', contents: 'synthetic-folder-a' }] },
    { kind: 'directory', name: 'B', children: [{ kind: 'file', name: 'clip.mp4', contents: 'synthetic-folder-b-selected' }] }
  ]);

  const before = await missingRefSnapshot(page, 'playlist', 0);
  await page.evaluate(id => {
    const state = window.Blend.state;
    state.ui.listSelection = new Set([id]);
    state.ui.listSelectionAnchorId = id;
    window.Blend.renderListEditor();
  }, before.id);
  const revisionBeforeResolve = await page.evaluate(() => window.Blend.saveStatus.savedRevision);
  await clickResolve(page, 'playlist');

  const dialog = page.locator('#missing-media-relink-choice');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveRole('dialog');
  await expect(dialog).toHaveAttribute('aria-labelledby', 'missing-media-relink-title');
  await expect(dialog).toHaveAttribute('aria-describedby', 'missing-media-relink-message');
  await expect(dialog).toContainText('More than one file with this name was found. Choose the matching folder.');
  const choices = dialog.locator('[data-candidate]');
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toHaveAccessibleName(/Assets\/A\/clip\.mp4/);
  await expect(choices.nth(1)).toHaveAccessibleName(/Assets\/B\/clip\.mp4/);
  await expect(choices.nth(0)).toBeFocused();

  const capture = process.env.ISSUE10_CAPTURE_SCREENSHOTS === '1';
  for (const width of [320, 768, 1366]) {
    await assertDialogFitsViewport(page, dialog, width, capture);
  }
  // At 200% desktop zoom, 1366 device pixels provide roughly 683 CSS pixels.
  await assertDialogFitsViewport(page, dialog, 683, false);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.keyboard.press('Tab');
  await expect(choices.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');

  await page.waitForFunction(() => window.Blend?.state?.playlist?.[0]?.available === true);
  const after = await missingRefSnapshot(page, 'playlist', 0);
  expect(after.order).toEqual(['clip.mp4']);
  expect(after.selected).toContain(after.id);
  expect(after.anchor).toBe(after.id);
  const content = await readHandleContents(page, 'playlist', 0);
  expect(content.text).toBe('synthetic-folder-b-selected');
  expect(content.pathHint).toBe('Assets/B/clip.mp4');
  await waitForSaveAfter(page, revisionBeforeResolve);
});

test('Escape cancels ambiguous relinking without adding a library item or changing the missing row', async ({ page }) => {
  await bootRelinkPage(page, 'playlist');
  await seedExistingItems(page, [
    { id: 'issue10-before', name: 'Before.mp4', type: 'video' },
    { id: 'issue10-after', name: 'After.mp4', type: 'video' }
  ]);
  await importMissingList(page, 'playlist', [
    { id: 'issue10-before', name: 'Before.mp4', path: 'Before.mp4', type: 'video' },
    { id: 'missing-clip', name: 'clip.mp4', path: 'Legacy/clip.mp4', type: 'video' },
    { id: 'issue10-after', name: 'After.mp4', path: 'After.mp4', type: 'video' }
  ]);
  await installDirectoryPicker(page, ROOT_NAME, [
    { kind: 'directory', name: 'A', children: [{ kind: 'file', name: 'clip.mp4', contents: 'synthetic-folder-a' }] },
    { kind: 'directory', name: 'B', children: [{ kind: 'file', name: 'clip.mp4', contents: 'synthetic-folder-b' }] }
  ]);

  const before = await missingRefSnapshot(page, 'playlist', 1);
  await page.evaluate(id => {
    const state = window.Blend.state;
    state.ui.listSelection = new Set([id]);
    state.ui.listSelectionAnchorId = id;
    window.Blend.renderListEditor();
  }, before.id);
  const selectedBefore = await missingRefSnapshot(page, 'playlist', 1);

  await clickResolve(page, 'playlist');
  const dialog = page.locator('#missing-media-relink-choice');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#toast-container')).toContainText('Resolved 0/1 missing path');
  await expect(page.locator('#list-editor .list-item[data-idx="1"]')).toBeFocused();

  const after = await missingRefSnapshot(page, 'playlist', 1);
  expect(after).toEqual(selectedBefore);
  expect(after.order).toEqual(['Before.mp4', 'clip.mp4', 'After.mp4']);
  expect(after.available).toBe(false);
  expect(after.reason).toBe('missing');
  expect(after.path).toBe('Legacy/clip.mp4');
  expect(after.selected).toEqual([before.id]);
  expect(after.anchor).toBe(before.id);
  expect(after.libraryIds).toEqual(before.libraryIds);

  await expect(page.locator('#toast-container')).not.toContainText('paths were missing', { timeout: 10000 });
  const missingRow = page.locator('#list-editor .list-item[data-idx="1"]');
  const relinkButton = missingRow.locator('.resolve-missing-media');
  await expect(relinkButton).toHaveAccessibleName('Resolve missing clip.mp4 in Playlist');
  for (const width of [320, 768, 1366]) {
    await assertMissingRowFitsViewport(page, missingRow, width);
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  const revisionBeforeRecovery = await page.evaluate(() => window.Blend.saveStatus.savedRevision);
  await relinkButton.click();
  const recoveryDialog = page.locator('#missing-media-relink-choice');
  await expect(recoveryDialog).toBeVisible();
  await recoveryDialog.locator('[data-candidate="1"]').click();
  await page.waitForFunction(() => window.Blend?.state?.playlist?.[1]?.available === true);
  const recoveredContent = await readHandleContents(page, 'playlist', 1);
  expect(recoveredContent.text).toBe('synthetic-folder-b');
  await waitForSaveAfter(page, revisionBeforeRecovery);
});

test('one basename candidate resolves automatically and its library handle record survives reload', async ({ page }) => {
  await bootRelinkPage(page, 'playlist');
  await importMissingList(page, 'playlist', [
    { id: 'missing-track', name: 'track.mp4', path: 'Legacy/track.mp4', type: 'video' }
  ]);
  await installDirectoryPicker(page, ROOT_NAME, [
    { kind: 'directory', name: 'Only', children: [{ kind: 'file', name: 'track.mp4', contents: 'synthetic-single-candidate' }] }
  ]);

  const revisionBeforeResolve = await page.evaluate(() => window.Blend.saveStatus.savedRevision);
  await clickResolve(page, 'playlist');
  await page.waitForFunction(() => window.Blend?.state?.playlist?.[0]?.available === true);
  await expect(page.locator('#missing-media-relink-choice')).toHaveCount(0);
  const content = await readHandleContents(page, 'playlist', 0);
  expect(content.text).toBe('synthetic-single-candidate');
  await waitForSaveAfter(page, revisionBeforeResolve);

  await page.reload();
  await page.waitForFunction(() => !!window.Blend?.state);
  const persisted = await page.evaluate(() => {
    const ref = window.Blend.state.playlist[0];
    const item = window.Blend.state.library.get(ref.id);
    return { available: ref.available, handle: item?.handle, name: item?.name };
  });
  expect(persisted.available).toBe(true);
  expect(persisted.name).toBe('track.mp4');
  expect(persisted.handle?.kind).toBe('file');
  expect(persisted.handle?.name).toBe('track.mp4');
});

test('partial directory scans relink found media and report unreadable folders', async ({ page }) => {
  await bootRelinkPage(page, 'playlist');
  await importMissingList(page, 'playlist', [
    { id: 'missing-track', name: 'track.mp4', path: 'Assets/Found/track.mp4', type: 'video' }
  ]);
  await page.evaluate(() => {
    const makeFile = (name, contents) => {
      const handle = Object.create({
        async getFile() { return new File([contents], name, { type: 'video/mp4' }); }
      });
      Object.assign(handle, { kind: 'file', name, transient: true });
      return handle;
    };
    const makeDirectory = (name, values) => {
      const handle = Object.create({ values });
      Object.assign(handle, { kind: 'directory', name });
      return handle;
    };
    const found = makeDirectory('Found', async function* () {
      yield makeFile('track.mp4', 'relinked-before-read-error');
    });
    const unreadable = makeDirectory('Unreadable', async function* () {
      yield makeFile('other.mp4', 'also-discovered');
      throw new DOMException('simulated read failure', 'NotReadableError');
    });
    const root = makeDirectory('Assets', async function* () {
      yield found;
      yield unreadable;
    });
    window.showDirectoryPicker = async () => root;
  });

  await page.locator('#import-summary-modal [data-resolve]').click();
  await page.waitForFunction(() => window.Blend?.state?.playlist?.[0]?.available === true);
  const notice = page.locator('.toast-directory-scan');
  await expect(notice).toContainText('Missing-media scan was partial: 1 folder could not be read.');
  await expect(notice).toContainText('Resolved 1/1 missing path from 2 found media files.');
  await expect(notice.getByRole('button', { name: 'Retry scan' })).toBeVisible();
  expect((await readHandleContents(page, 'playlist', 0)).text).toBe('relinked-before-read-error');
});
