import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

const SEED_IDS = ['seed-0', 'seed-1', 'seed-2', 'seed-3', 'seed-4'];

// Seed the slideshow list with deterministic items so the test does not
// depend on real media decoding. Reorder only cares about row identity
// and order, so plain refs (rendered as "Not Available") are sufficient.
async function seedSlideshow(page) {
  await page.evaluate(() => {
    const B = window.Blend;
    B.state.slideshow = ['one', 'two', 'three', 'four', 'five'].map((label, i) => ({
      id: `seed-${i}`,
      name: `${label}.png`,
      path: `seed/${label}.png`,
      type: 'image',
      available: true
    }));
    B.state.runtime.slideshowIndex = 0;
    if (B.state.ui.listSelection instanceof Set) B.state.ui.listSelection.clear();
    B.state.ui.listSelectionAnchorId = null;
    B.renderListEditor();
  });
  await expect(page.locator('#list-editor .list-item')).toHaveCount(5);
}

function listOrder(page) {
  return page.evaluate(() => window.Blend.state.slideshow.map(ref => ref.id));
}

function selectionIds(page) {
  return page.evaluate(() => Array.from(window.Blend.state.ui.listSelection || []));
}

async function rowBox(page, idx, selector = '') {
  const box = await page.locator(`#list-editor .list-item[data-idx="${idx}"]${selector}`).boundingBox();
  if (!box) throw new Error(`No bounding box for row ${idx} ${selector}`);
  return box;
}

// Drag the handle of `fromIdx` and release over `toIdx`. `position`
// chooses the half of the target row (before/after) to land on.
async function dragRow(page, fromIdx, toIdx, position = 'after') {
  const handle = await rowBox(page, fromIdx, ' .drag');
  const target = await rowBox(page, toIdx);
  const startX = handle.x + handle.width / 2;
  const startY = handle.y + handle.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Nudge past the drag threshold first, then travel to the target.
  await page.mouse.move(startX, startY + 14, { steps: 3 });
  const targetY = position === 'after' ? target.y + target.height - 4 : target.y + 4;
  await page.mouse.move(target.x + target.width / 2, targetY, { steps: 14 });
  await page.mouse.up();
}

test.describe('list reorder', () => {
  let app;

  test.beforeEach(async ({ page }) => {
    app = new BlendAppPage(page);
    await app.boot();
    await app.switchListTab('slideshow');
    await seedSlideshow(page);
  });

  test('drags a single item to a new position', async ({ page }) => {
    expect(await listOrder(page)).toEqual(SEED_IDS);

    // Drag the first item down onto the third row.
    await dragRow(page, 0, 2, 'after');

    await expect.poll(() => listOrder(page)).toEqual(['seed-1', 'seed-2', 'seed-0', 'seed-3', 'seed-4']);
  });

  test('drags an item upward to the top of the list', async ({ page }) => {
    await dragRow(page, 4, 0, 'before');
    await expect.poll(() => listOrder(page)).toEqual(['seed-4', 'seed-0', 'seed-1', 'seed-2', 'seed-3']);
  });

  test('moves a multi-selected group together, preserving their order', async ({ page }) => {
    // Ctrl/Cmd-click two rows to build a selection without starting playback.
    await page.locator('#list-editor .list-item[data-idx="0"]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('#list-editor .list-item[data-idx="1"]').click({ modifiers: ['ControlOrMeta'] });
    expect((await selectionIds(page)).sort()).toEqual(['seed-0', 'seed-1']);

    // Drag the group to the end of the list.
    await dragRow(page, 1, 4, 'after');

    await expect.poll(() => listOrder(page)).toEqual(['seed-2', 'seed-3', 'seed-4', 'seed-0', 'seed-1']);
    // The moved rows stay selected and follow their items.
    expect((await selectionIds(page)).sort()).toEqual(['seed-0', 'seed-1']);
  });

  test('reorders with the keyboard (Alt+Arrow) on the focused item', async ({ page }) => {
    await page.locator('#list-editor .list-item[data-idx="0"]').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => listOrder(page)).toEqual(['seed-1', 'seed-0', 'seed-2', 'seed-3', 'seed-4']);

    // The item carries its selection, so a second press keeps moving it.
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => listOrder(page)).toEqual(['seed-1', 'seed-2', 'seed-0', 'seed-3', 'seed-4']);

    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => listOrder(page)).toEqual(['seed-1', 'seed-0', 'seed-2', 'seed-3', 'seed-4']);
  });

  test('keeps the order stable when an item is dropped on itself', async ({ page }) => {
    await dragRow(page, 2, 2, 'before');
    await expect.poll(() => listOrder(page)).toEqual(SEED_IDS);
  });
});
