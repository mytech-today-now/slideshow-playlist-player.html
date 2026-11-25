import { expect, test } from '@playwright/test';

const RUNTIME_CONFIG_KEY = 'blend-runtime-config-v1';
const HOSTILE_PROJECT_URL = 'https://unreviewed-project.example';

test('unreviewed LocalStorage config cannot send Auth requests and requires confirmation', async ({ page }) => {
  const supabaseRequests = [];
  page.on('request', request => {
    if (/\/(?:auth|storage)\/v1\//.test(new URL(request.url()).pathname)) {
      supabaseRequests.push(request.url());
    }
  });
  await page.addInitScript(({ hostileUrl }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    if (!localStorage.getItem('blend-runtime-config-v1')) {
      localStorage.setItem('blend-runtime-config-v1', JSON.stringify({
        SUPABASE_URL: hostileUrl,
        SUPABASE_ANON_KEY: 'synthetic-unreviewed-anon-key',
        SUPABASE_AUTH_REDIRECT_URL: `${hostileUrl}/callback`
      }));
    }
  }, { hostileUrl: HOSTILE_PROJECT_URL });

  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.Blend?.state));
  await page.locator('#config-gear').click();

  await expect(page.locator('#supabase-config-status'))
    .toContainText('Saved connection settings are pending review');
  await expect(page.locator('#supabase-runtime-project-url')).toHaveValue(HOSTILE_PROJECT_URL);
  await expect(page.locator('#supabase-runtime-config-confirm')).not.toBeChecked();
  await expect(page.locator('#supabase-runtime-config-confirm'))
    .toHaveAccessibleName('I reviewed this project URL and redirect destination and confirm they belong to this Blend deployment.');
  await expect(page.locator('#supabase-runtime-config-save')).toBeDisabled();
  await expect(page.locator('#supabase-sign-in')).toBeDisabled();
  expect(supabaseRequests).toEqual([]);

  const origin = new URL(page.url()).origin;
  await page.locator('#supabase-runtime-project-url').fill(origin);
  await page.locator('#supabase-runtime-anon-key').fill('synthetic-reviewed-anon-key');
  await page.locator('#supabase-runtime-redirect-url').fill('https://evil.example/callback');
  await page.locator('#supabase-runtime-config-confirm').check();
  await page.locator('#supabase-runtime-config-save').click();
  await expect(page.locator('#supabase-runtime-config-status'))
    .toContainText("Entered Auth redirect URL was ignored because it must use this app's HTTP(S) origin.");
  expect(await page.evaluate(key => localStorage.getItem(key), RUNTIME_CONFIG_KEY))
    .toContain(HOSTILE_PROJECT_URL);
  expect(supabaseRequests).toEqual([]);

  await page.locator('#supabase-runtime-redirect-url').fill(`${origin}/index.html`);
  await expect(page.locator('#supabase-runtime-config-confirm')).not.toBeChecked();
  await page.locator('#supabase-runtime-config-confirm').check();
  await page.locator('#supabase-runtime-config-save').click();

  await page.waitForFunction(() => Boolean(window.Blend?.state));
  await expect(page.locator('#supabase-config-status'))
    .toHaveText(`Supabase is configured for project ${origin}.`);
  await expect(page.locator('#supabase-runtime-config-status'))
    .toContainText('Saved connection settings were reviewed for this tab.');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), RUNTIME_CONFIG_KEY);
  expect(saved.SUPABASE_URL).toBe(origin);
  expect(saved.SUPABASE_AUTH_REDIRECT_URL).toBe(`${origin}/index.html`);
  expect(await page.evaluate(() => sessionStorage.getItem('blend-runtime-config-review-v1'))).toBeTruthy();
  expect(supabaseRequests).toEqual([]);
});
