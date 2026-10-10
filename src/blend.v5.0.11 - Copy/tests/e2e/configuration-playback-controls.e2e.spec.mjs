import { expect, test } from '@playwright/test';

test('playback toolbar opens from configuration and stays usable after reload', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.Blend?.state));
  await expect(page.locator('#welcome-modal')).toBeVisible();

  const gear = page.locator('#config-gear');
  const panel = page.locator('#config-panel');
  const transport = page.locator('#transport');
  await expect(transport).toBeHidden();
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#welcome-dismiss').click();

  await gear.click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(transport).toBeVisible();
  await expect(gear).toHaveAttribute('aria-expanded', 'true');
  await expect(gear).toHaveAttribute('aria-label', 'Close configuration panel');
  expect(await transport.evaluate(element => element.closest('#config-panel')?.id)).toBe('config-panel');

  for (const id of [
    'btn-prev',
    'btn-play',
    'btn-next',
    'btn-stop',
    'btn-share',
    'blend-slider',
    'btn-fullscreen',
    'btn-mute',
    'vol-master',
    'vol-playlist',
    'vol-slideshow'
  ]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }

  const slider = page.locator('#blend-slider');
  await slider.focus();
  await page.keyboard.press('End');
  await expect(page.locator('#blend-value')).toHaveText('100%');
  await expect.poll(() => page.evaluate(() => window.Blend.state.settings.opacity)).toBe(1);

  await page.locator('#close-config').click();
  await expect(panel).not.toBeVisible();
  await expect(transport).toBeHidden();
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await expect(gear).toHaveAttribute('aria-label', 'Open configuration panel');

  await gear.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await expect(transport).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(transport).toBeHidden();

  await gear.click();
  await expect(transport).toBeVisible();
  expect(await page.locator('#transport').count()).toBe(1);
  const duplicateIds = await page.locator('[id]').evaluateAll(elements => {
    const ids = elements.map(element => element.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.Blend?.state));
  await expect(transport).toBeHidden();
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await gear.click();
  await expect(panel).toBeVisible();
  await expect(transport).toBeVisible();
  expect(await page.locator('#transport').count()).toBe(1);
  expect(pageErrors).toEqual([]);
});
