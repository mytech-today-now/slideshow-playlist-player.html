import { test, expect } from '@playwright/test';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

async function boot(page) {
  await page.addInitScript(({ fixtureOrigin }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
    const runtimeConfigKey = 'blend-runtime-config-v1';
    try {
      const existingRaw = localStorage.getItem(runtimeConfigKey);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      localStorage.setItem(runtimeConfigKey, JSON.stringify({
        ...existing,
        SUPABASE_URL: fixtureOrigin,
        SUPABASE_AUTH_REDIRECT_URL: `${fixtureOrigin}/index.html`,
        SUPABASE_MEDIA_BUCKET: 'media',
        SUPABASE_PUBLIC_BUCKETS: 'public'
      }));
    } catch (_) {}
  }, { fixtureOrigin: FIXTURE_ORIGIN });
  await page.goto('/index.html');
  await page.waitForFunction(() => !!window.Blend && !!window.Blend.state);
}

async function mockSupabasePasswordAuth(page, { ok = true } = {}) {
  await page.route(`${FIXTURE_ORIGIN}/auth/v1/token?grant_type=password`, async route => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    if (!ok) {
      await route.fulfill({
        status: 400,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*'
        },
        body: JSON.stringify({ error_description: 'Invalid login credentials' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*'
      },
      body: JSON.stringify({
        access_token: 'e2e-access-token',
        refresh_token: 'e2e-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'user-e2e', email: 'e2e@example.test' }
      })
    });
  });
}

async function signInFromModal(page, { email = 'e2e@example.test', password = 'P@ssword123!' } = {}) {
  const modal = page.locator('#supabase-auth-modal');
  await expect(modal).toBeVisible();
  await page.locator('#supabase-auth-email').fill(email);
  await page.locator('#supabase-auth-password').fill(password);
  await page.locator('[data-auth-submit]').click();
  await expect(modal).not.toBeVisible();
}

test('opens Supabase auth modal when sharing is requested without a session', async ({ page }) => {
  await boot(page);
  await page.locator('#btn-share').click();
  const authModal = page.locator('#supabase-auth-modal');
  await expect(authModal).toBeVisible();
  await page.locator('[data-auth-cancel]').click();
  await expect(authModal).not.toBeVisible();
  await expect(page.locator('#supabase-auth-status')).toContainText('Sign in to play private Supabase media.');
});

test('signs in through Supabase auth and marks sharing as ready', async ({ page }) => {
  await boot(page);
  await mockSupabasePasswordAuth(page, { ok: true });
  await page.locator('#btn-share').click();
  await signInFromModal(page);

  await expect(page.locator('#supabase-auth-status')).toContainText('Authenticated for private Supabase media.');
  await expect(page.locator('#btn-share')).toHaveAttribute('data-ipfs-state', 'ready');

  const hasSession = await page.evaluate(async () => {
    const session = await window.Blend.shareCurrentExperienceThroughIpfs();
    return !!session?.access_token;
  });
  expect(hasSession).toBeTruthy();
});

test('shows inline auth errors when Supabase credentials are rejected', async ({ page }) => {
  await boot(page);
  await mockSupabasePasswordAuth(page, { ok: false });

  await page.locator('#btn-share').click();
  const authModal = page.locator('#supabase-auth-modal');
  await expect(authModal).toBeVisible();
  await page.locator('#supabase-auth-email').fill('bad@example.test');
  await page.locator('#supabase-auth-password').fill('wrong-password');
  await page.locator('[data-auth-submit]').click();

  await expect(page.locator('[data-auth-error]')).toContainText('Invalid login credentials');
  await expect(authModal).toBeVisible();
  await page.locator('[data-auth-cancel]').click();
  await expect(authModal).not.toBeVisible();
  await expect(page.locator('#supabase-auth-status')).toContainText('Sign in to play private Supabase media.');
});

test('sign out clears the active Supabase session', async ({ page }) => {
  await boot(page);
  await mockSupabasePasswordAuth(page, { ok: true });
  await page.route(`${FIXTURE_ORIGIN}/auth/v1/logout`, async route => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*'
      },
      body: JSON.stringify({})
    });
  });

  await page.locator('#btn-share').click();
  await signInFromModal(page);
  await expect(page.locator('#btn-share')).toHaveAttribute('data-ipfs-state', 'ready');

  await page.evaluate(() => document.getElementById('supabase-sign-out')?.click());
  await expect(page.locator('#supabase-auth-status')).toContainText('Sign in to play private Supabase media.');
  await expect(page.locator('#btn-share')).toHaveAttribute('data-ipfs-state', 'unauthorized');
});
