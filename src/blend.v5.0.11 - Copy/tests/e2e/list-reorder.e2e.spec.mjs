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

  test('exposes list rows and their actions with matching native semantics', async ({ page }) => {
    const list = page.getByRole('list', { name: 'Slideshow editor' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(5);

    const row = list.getByRole('listitem').first();
    await expect(row).toHaveAttribute('aria-posinset', '1');
    await expect(row).toHaveAttribute('aria-setsize', '5');
    await expect(row).not.toHaveAttribute('role', 'option');

    const select = row.getByRole('button', { name: 'Select one.png in Slideshow' });
    const duration = row.getByRole('spinbutton', { name: 'Display seconds for one.png' });
    const share = row.getByRole('button', { name: 'Share one.png' });
    const remove = row.getByRole('button', { name: 'Remove one.png from Slideshow' });
    await expect(select).toHaveAttribute('aria-pressed', 'false');
    await expect(duration).toBeVisible();
    await expect(share).toBeVisible();
    await expect(remove).toBeVisible();

    const semantics = await row.evaluate(element => ({
      rowRole: element.getAttribute('role'),
      rowSelected: element.hasAttribute('aria-selected'),
      listRole: element.closest('#list-editor')?.getAttribute('role'),
      buttons: Array.from(element.querySelectorAll('button')).map(button => ({
        name: button.getAttribute('aria-label'),
        tag: button.tagName,
        type: button.type
      }))
    }));
    expect(semantics.rowRole).toBe('listitem');
    expect(semantics.rowSelected).toBe(false);
    expect(semantics.listRole).toBe('list');
    expect(semantics.buttons).toEqual([
      { name: 'Select one.png in Slideshow', tag: 'BUTTON', type: 'button' },
      { name: 'Share one.png', tag: 'BUTTON', type: 'button' },
      { name: 'Remove one.png from Slideshow', tag: 'BUTTON', type: 'button' }
    ]);
  });

  test('supports keyboard selection, field editing, and sharing without row playback', async ({ page }) => {
    const row = page.locator('#list-editor .list-item[data-id="seed-0"]');
    const select = row.getByRole('button', { name: 'Select one.png in Slideshow' });
    const duration = row.getByRole('spinbutton', { name: 'Display seconds for one.png' });
    const share = row.getByRole('button', { name: 'Share one.png' });
    const transportBefore = await page.evaluate(() => window.Blend.transport);

    await row.focus();
    await page.keyboard.press('Tab');
    await expect(select).toBeFocused();
    await page.keyboard.press('Space');
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => selectionIds(page)).toEqual(['seed-0']);

    await page.keyboard.press('Tab');
    await expect(duration).toBeFocused();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('7.5');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => window.Blend.state.slideshow[0].displayDuration)).toBe(7.5);

    await expect(share).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect.poll(() => selectionIds(page)).toEqual(['seed-0']);
    expect(await page.evaluate(() => window.Blend.transport)).toBe(transportBefore);
  });

  test('activates Retry by keyboard without selecting the parent row', async ({ page }) => {
    await page.evaluate(() => {
      const ref = window.Blend.state.slideshow[0];
      ref.available = false;
      ref.retryAfter = Date.now() + 30000;
      ref.reason = 'Remote media is temporarily unavailable';
      window.Blend.renderListEditor();
    });

    const row = page.locator('#list-editor .list-item[data-id="seed-0"]');
    const select = row.getByRole('button', { name: 'Select one.png in Slideshow' });
    const duration = row.getByRole('spinbutton', { name: 'Display seconds for one.png' });
    const retry = row.getByRole('button', { name: 'Retry one.png in Slideshow' });
    await expect(row).toHaveAttribute('aria-describedby', /list-slideshow-item-0-availability/);
    await expect(row.locator('.sr-only')).toContainText('Remote media is temporarily unavailable');
    await expect(retry).toBeVisible();

    await row.focus();
    await page.keyboard.press('Tab');
    await expect(select).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(duration).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(retry).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => selectionIds(page)).toEqual([]);
  });

  test('removal moves focus to an adjacent row and keyboard Undo restores focus and selection', async ({ page }) => {
    const row = page.locator('#list-editor .list-item[data-id="seed-0"]');
    const select = row.getByRole('button', { name: 'Select one.png in Slideshow' });
    const duration = row.getByRole('spinbutton', { name: 'Display seconds for one.png' });
    const share = row.getByRole('button', { name: 'Share one.png' });
    const remove = row.getByRole('button', { name: 'Remove one.png from Slideshow' });
    const transportBefore = await page.evaluate(() => window.Blend.transport);

    await row.focus();
    await page.keyboard.press('Tab');
    await expect(select).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(duration).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(share).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => listOrder(page)).toEqual(['seed-1', 'seed-2', 'seed-3', 'seed-4']);
    await expect(page.locator('#list-editor .list-item[data-id="seed-1"]')).toBeFocused();
    expect(await page.evaluate(() => window.Blend.transport)).toBe(transportBefore);

    const undo = page.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    await undo.focus();
    await page.keyboard.press('Space');
    await expect.poll(() => listOrder(page)).toEqual(SEED_IDS);
    const restored = page.locator('#list-editor .list-item[data-id="seed-0"]');
    await expect(restored).toBeFocused();
    await expect(restored.getByRole('button', { name: 'Select one.png in Slideshow' })).toHaveAttribute('aria-pressed', 'false');
    await expect(restored).toHaveAttribute('aria-label', /1 of 5: one\.png/);
    await expect.poll(() => selectionIds(page)).toEqual([]);
    expect(await page.evaluate(() => window.Blend.transport)).toBe(transportBefore);
  });

  test('Undo restores the selection that existed before removal', async ({ page }) => {
    const first = page.locator('#list-editor .list-item[data-id="seed-0"]');
    const second = page.locator('#list-editor .list-item[data-id="seed-1"]');
    await first.getByRole('button', { name: 'Select one.png in Slideshow' }).click();
    await second.getByRole('button', { name: 'Select two.png in Slideshow' }).click();
    expect((await selectionIds(page)).sort()).toEqual(['seed-0', 'seed-1']);

    await first.getByRole('button', { name: 'Remove one.png from Slideshow' }).press('Enter');
    await expect.poll(() => listOrder(page)).toEqual(['seed-1', 'seed-2', 'seed-3', 'seed-4']);
    await expect.poll(() => selectionIds(page)).toEqual(['seed-1']);

    const undo = page.getByRole('button', { name: 'Undo' });
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => listOrder(page)).toEqual(SEED_IDS);
    await expect.poll(() => selectionIds(page).then(ids => ids.sort())).toEqual(['seed-0', 'seed-1']);
    await expect(page.locator('#list-editor .list-item[data-id="seed-0"] .list-item-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#list-editor .list-item[data-id="seed-1"] .list-item-select')).toHaveAttribute('aria-pressed', 'true');
  });

  test('removes a focused row with Delete and Backspace without pointer input', async ({ page }) => {
    for (const key of ['Delete', 'Backspace']) {
      const first = page.locator('#list-editor .list-item[data-id="seed-0"]');
      await first.focus();
      await page.keyboard.press(key);
      await expect.poll(() => listOrder(page)).toEqual(['seed-1', 'seed-2', 'seed-3', 'seed-4']);
      await expect(page.locator('#list-editor .list-item[data-id="seed-1"]')).toBeFocused();

      const undo = page.getByRole('button', { name: 'Undo' });
      await undo.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => listOrder(page)).toEqual(SEED_IDS);
      await expect(page.locator('#list-editor .list-item[data-id="seed-0"]')).toBeFocused();
    }
  });

  test('keeps row content and focus visible at 320 px and 390 px widths', async ({ page }) => {
    const row = page.locator('#list-editor .list-item[data-id="seed-0"]');
    const select = row.getByRole('button', { name: 'Select one.png in Slideshow' });

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(row).toBeVisible();
      const geometry = await row.evaluate(element => {
        const rowRect = element.getBoundingClientRect();
        const children = Array.from(element.children).filter(child => getComputedStyle(child).position !== 'absolute');
        const contentBottom = Math.max(...children.map(child => child.getBoundingClientRect().bottom));
        return {
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          rowLeft: rowRect.left,
          rowRight: rowRect.right,
          rowBottom: rowRect.bottom,
          contentBottom
        };
      });
      expect(geometry.documentWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
      expect(geometry.rowLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.rowRight).toBeLessThanOrEqual(width);
      expect(geometry.contentBottom, `wrapped row content overflows at ${width}px`).toBeLessThanOrEqual(geometry.rowBottom + 1);

      await row.focus();
      await page.keyboard.press('Tab');
      await expect(select).toBeFocused();
      const focusStyle = await select.evaluate(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
          left: rect.left,
          right: rect.right
        };
      });
      expect(focusStyle.outlineStyle).not.toBe('none');
      expect(focusStyle.outlineWidth).toBeGreaterThan(0);
      expect(focusStyle.left).toBeGreaterThanOrEqual(0);
      expect(focusStyle.right).toBeLessThanOrEqual(width);
    }
  });
});
