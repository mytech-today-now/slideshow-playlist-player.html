import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

test('keeps malformed Supabase Add URL input editable and reports a safe validation message', async ({ page }) => {
  const blendPage = new BlendAppPage(page);
  let storageRequests = 0;
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error));
  await page.route('**/storage/v1/**', route => {
    storageRequests += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });
  await blendPage.boot('/index.html');
  await page.locator('#add-url').click();
  await expect(blendPage.experienceModal).toBeVisible();

  const input = blendPage.experienceInput;
  const enteredValue = 'supabase://media/private/private-name%GG.mp4';
  await input.fill(enteredValue);
  await page.locator('#experience-modal-ok').click();

  await expect(blendPage.experienceModal).toBeVisible();
  await expect(input).toBeEditable();
  await expect(input).toHaveValue(enteredValue);
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#experience-modal-message')).toHaveText(
    'The storage path has invalid percent encoding. Check the URL and try again.'
  );
  expect(storageRequests).toBe(0);
  expect(pageErrors).toHaveLength(0);
});
