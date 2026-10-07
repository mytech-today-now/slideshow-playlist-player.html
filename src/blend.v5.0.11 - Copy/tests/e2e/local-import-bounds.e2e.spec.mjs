import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import {
  LOCAL_IMPORT_MAX_BYTES,
  LOCAL_IMPORT_SIZE_LIMIT_MESSAGE,
  LOCAL_IMPORT_STRUCTURE_LIMIT_MESSAGE
} from '../../local-import-limits.js';

const EXPERIENCE_EMPTY = {
  schema: 'player.blend.experience.v2',
  type: 'experience',
  name: 'Boundary Experience',
  settings: {},
  library: { schema: 'player.blend.library.v1', type: 'library', order: [], items: [] },
  playlist: { schema: 'player.blend.list.v1', type: 'playlist', order: [], items: [] },
  slideshow: { schema: 'player.blend.list.v1', type: 'slideshow', order: [], items: [] }
};

const LIST_EMPTY = {
  schema: 'player.blend.list.v1',
  type: 'playlist',
  order: [],
  items: []
};

function fileBytes(payload, size = null) {
  const json = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  if (size == null) return json;
  if (json.length > size) throw new Error('Fixture JSON exceeds its requested boundary');
  return Buffer.concat([json, Buffer.alloc(size - json.length, 0x20)]);
}

async function installImportInstrumentation(page) {
  await page.evaluate(() => {
    window.__localImportReads = [];
    window.__localImportJsonParses = 0;
    const originalText = File.prototype.text;
    File.prototype.text = function () {
      window.__localImportReads.push({ name: this.name, size: this.size });
      return originalText.call(this);
    };
    const originalParse = JSON.parse;
    JSON.parse = function (...args) {
      window.__localImportJsonParses += 1;
      return originalParse.apply(this, args);
    };
  });
}

async function captureImportState(page) {
  return page.evaluate(() => {
    const state = window.Blend.state;
    return {
      activeId: state.activeExperienceId,
      activeName: state.projectName,
      activeList: state.ui.activeList,
      experienceIds: state.experiences.map(record => record.id),
      libraryIds: Array.from(state.library.keys()).sort(),
      playlist: state.playlist.map(item => ({ id: item.id, name: item.name, path: item.path })),
      slideshow: state.slideshow.map(item => ({ id: item.id, name: item.name, path: item.path })),
      opacity: state.settings.opacity,
      defaultImageDuration: state.settings.defaultImageDuration
    };
  });
}

async function chooseFileByKeyboard(page, selector, file) {
  const button = page.locator(selector);
  await button.focus();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const chooser = await chooserPromise;
  const before = await captureImportState(page);
  await chooser.setFiles(file);
  return before;
}

async function expectLimitAlert(page, viewportWidth) {
  const alert = page.locator('#toast-container .toast[role="alert"]').last();
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute('aria-live', 'assertive');
  await expect(alert.locator('span')).toHaveText(LOCAL_IMPORT_SIZE_LIMIT_MESSAGE);
  const bounds = await alert.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  });
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(viewportWidth);
  return alert;
}

test('file picker enforces below, exact, and above 10 MiB boundaries for list and experience imports', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await blendPage.switchListTab('playlist');
  await installImportInstrumentation(page);

  const listButton = page.getByRole('button', { name: 'Import List…' });
  await expect(listButton).toHaveAccessibleName('Import List…');

  await chooseFileByKeyboard(page, '#list-import', {
    name: 'below-limit-list.json',
    mimeType: 'application/json',
    buffer: fileBytes(LIST_EMPTY)
  });
  await expect(page.locator('#toast-container')).toContainText('No media paths found in below-limit-list.json');
  await page.waitForFunction(() => window.__localImportReads.length === 1);

  await chooseFileByKeyboard(page, '#list-import', {
    name: 'exact-limit-list.json',
    mimeType: 'application/json',
    buffer: fileBytes(LIST_EMPTY, LOCAL_IMPORT_MAX_BYTES)
  });
  await expect(page.locator('#toast-container')).toContainText('No media paths found in exact-limit-list.json');
  await page.waitForFunction(() => window.__localImportReads.length === 2);
  expect(await page.evaluate(() => window.__localImportReads.map(file => file.size)))
    .toEqual([fileBytes(LIST_EMPTY).length, LOCAL_IMPORT_MAX_BYTES]);

  const listBeforeOversize = await chooseFileByKeyboard(page, '#list-import', {
    name: 'above-limit-list.json',
    mimeType: 'application/json',
    buffer: fileBytes(LIST_EMPTY, LOCAL_IMPORT_MAX_BYTES + 1)
  });
  await expectLimitAlert(page, 1366);
  await expect(page.locator('#list-import')).toBeFocused();
  expect(await captureImportState(page)).toEqual(listBeforeOversize);
  expect(await page.evaluate(() => window.__localImportReads.length)).toBe(2);
  expect(await page.evaluate(() => window.__localImportJsonParses)).toBe(2);
  const experienceButton = page.getByRole('button', { name: 'Import', exact: true });
  await expect(experienceButton).toHaveAccessibleName('Import');

  await chooseFileByKeyboard(page, '#experience-import', {
    name: 'below-limit-experience.json',
    mimeType: 'application/json',
    buffer: fileBytes({ ...EXPERIENCE_EMPTY, name: 'Below Limit' })
  });
  await expect(page.locator('#toast-container')).toContainText('Imported experience "Below Limit"');
  await expect(page.locator('#experience-import')).toBeFocused();
  await page.waitForFunction(() => window.__localImportReads.length === 3);

  await chooseFileByKeyboard(page, '#experience-import', {
    name: 'exact-limit-experience.json',
    mimeType: 'application/json',
    buffer: fileBytes({ ...EXPERIENCE_EMPTY, name: 'Exact Limit' }, LOCAL_IMPORT_MAX_BYTES)
  });
  await expect(page.locator('#toast-container')).toContainText('Imported experience "Exact Limit"');
  await expect(page.locator('#experience-import')).toBeFocused();
  await page.waitForFunction(() => window.__localImportReads.length === 4);
  expect(await page.evaluate(() => window.__localImportReads.map(file => file.size).slice(-2)))
    .toEqual([fileBytes({ ...EXPERIENCE_EMPTY, name: 'Below Limit' }).length, LOCAL_IMPORT_MAX_BYTES]);

  const experienceParsesBeforeOversize = await page.evaluate(() => window.__localImportJsonParses);
  const experienceBeforeOversize = await chooseFileByKeyboard(page, '#experience-import', {
    name: 'above-limit-experience.json',
    mimeType: 'application/json',
    buffer: fileBytes({ ...EXPERIENCE_EMPTY, name: 'Must Not Import' }, LOCAL_IMPORT_MAX_BYTES + 1)
  });
  await expectLimitAlert(page, 1366);
  await expect(page.locator('#experience-import')).toBeFocused();
  expect(await captureImportState(page)).toEqual(experienceBeforeOversize);
  expect(await page.evaluate(() => window.__localImportReads.length)).toBe(4);
  expect(await page.evaluate(() => window.__localImportJsonParses)).toBe(experienceParsesBeforeOversize);
  const logs = await page.evaluate(() => window.Blend.log.exportJson());
  expect(logs).not.toContain('above-limit-experience.json');
  expect(logs).not.toContain('Must Not Import');
});

test('10 MiB rejection alert wraps and stays visible at a 320 px viewport with keyboard activation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await blendPage.switchListTab('playlist');
  await installImportInstrumentation(page);

  const before = await chooseFileByKeyboard(page, '#list-import', {
    name: 'mobile-above-limit-list.json',
    mimeType: 'application/json',
    buffer: fileBytes(LIST_EMPTY, LOCAL_IMPORT_MAX_BYTES + 1)
  });
  const alert = await expectLimitAlert(page, 320);
  await expect(page.locator('#list-import')).toBeFocused();
  expect(await captureImportState(page)).toEqual(before);
  expect(await page.evaluate(() => window.__localImportReads.length)).toBe(0);
  expect(await page.evaluate(() => window.__localImportJsonParses)).toBe(0);
  const presentation = await alert.evaluate(node => ({
    lineCount: Math.max(1, Math.round(node.querySelector('span').getBoundingClientRect().height / 18)),
    horizontalOverflow: node.scrollWidth > node.clientWidth
  }));
  expect(presentation.lineCount).toBeGreaterThan(1);
  expect(presentation.horizontalOverflow).toBe(false);
});

test('structural limits reject before JSON.parse or list and experience state changes', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await blendPage.switchListTab('playlist');
  await installImportInstrumentation(page);

  const tooManyItems = `[${Array.from({ length: 10_001 }, () => '"bad-track.mp3"').join(',')}]`;
  const listBefore = await chooseFileByKeyboard(page, '#list-import', {
    name: 'too-many-list-items.json',
    mimeType: 'application/json',
    buffer: fileBytes(tooManyItems)
  });
  const listAlert = page.locator('#toast-container .toast[role="alert"]').last();
  await expect(listAlert.locator('span')).toHaveText(LOCAL_IMPORT_STRUCTURE_LIMIT_MESSAGE);
  await expect(page.locator('#list-import')).toBeFocused();
  expect(await captureImportState(page)).toEqual(listBefore);
  expect(await page.evaluate(() => window.__localImportReads.length)).toBe(1);
  expect(await page.evaluate(() => window.__localImportJsonParses)).toBe(0);

  let nested = 0;
  for (let depth = 0; depth < 65; depth += 1) nested = { value: nested };
  const experienceBefore = await chooseFileByKeyboard(page, '#experience-import', {
    name: 'too-deep-experience.json',
    mimeType: 'application/json',
    buffer: fileBytes({ ...EXPERIENCE_EMPTY, settings: { nested } })
  });
  const experienceAlert = page.locator('#toast-container .toast-import-failure[role="alert"]').last();
  await expect(experienceAlert.locator('span')).toHaveText(LOCAL_IMPORT_STRUCTURE_LIMIT_MESSAGE);
  await expect(page.locator('#experience-import')).toBeFocused();
  expect(await captureImportState(page)).toEqual(experienceBefore);
  expect(await page.evaluate(() => window.__localImportReads.length)).toBe(2);
  expect(await page.evaluate(() => window.__localImportJsonParses)).toBe(0);
});

test('legacy list JSON and JSONL plus malformed-line fallback still import through the file picker', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await blendPage.createExperience('Legacy Import Compatibility');
  const origin = new URL(page.url()).origin;
  const playlistUrl = `${origin}/samples/nyc-01.mp4`;

  await blendPage.switchListTab('playlist');
  const legacyChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import List…' }).click();
  const legacyChooser = await legacyChooserPromise;
  await legacyChooser.setFiles({
    name: 'legacy-list.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: '5.0.11',
      schema: 'player.blend.list.v1',
      type: 'playlist',
      order: ['legacy-track'],
      items: [{ id: 'legacy-track', path: playlistUrl, fullPath: playlistUrl, name: 'nyc-01.mp4', type: 'video' }]
    }))
  });
  await page.waitForFunction(() => window.Blend?.state?.playlist?.length === 1);
  await blendPage.dismissImportSummaryIfPresent();

  await blendPage.switchListTab('slideshow');
  const slideshowJsonl = [
    JSON.stringify({ path: `${origin}/samples/IL.jpeg`, name: 'IL.jpeg', type: 'image' }),
    `${origin}/samples/blotter-01.png`
  ].join('\n');
  const jsonlChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import List…' }).click();
  const jsonlChooser = await jsonlChooserPromise;
  await jsonlChooser.setFiles({
    name: 'legacy-list.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from(`${slideshowJsonl}\n`)
  });
  await page.waitForFunction(() => window.Blend?.state?.slideshow?.length === 2);
  await blendPage.dismissImportSummaryIfPresent();

  const imported = await page.evaluate(() => ({
    activeName: window.Blend.state.projectName,
    playlist: window.Blend.state.playlist.map(item => item.name),
    slideshow: window.Blend.state.slideshow.map(item => item.name)
  }));
  expect(imported.activeName).toBe('Legacy Import Compatibility');
  expect(imported.playlist).toEqual(['nyc-01.mp4']);
  expect(imported.slideshow).toEqual(['IL.jpeg', 'blotter-01.png']);
});
