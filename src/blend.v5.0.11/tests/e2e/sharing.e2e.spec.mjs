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

async function openConfig(page) {
  const panel = page.locator('#config-panel');
  if (!(await panel.evaluate(node => node.classList.contains('open')))) {
    await page.locator('#config-gear').click();
    await expect(panel).toHaveClass(/open/);
  }
}

async function openSupabaseAuthModal(page) {
  await openConfig(page);
  await page.locator('#supabase-sign-in').click();
}

async function connectTokenFromModal(page, {
  accessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWUyZSIsImVtYWlsIjoiZTJlQGV4YW1wbGUudGVzdCIsImV4cCI6NDEwMjQ0NDgwMH0.signature',
  refreshToken = ''
} = {}) {
  const modal = page.locator('#supabase-auth-modal');
  await expect(modal).toBeVisible();
  await page.locator('#supabase-auth-token').fill(accessToken);
  if (refreshToken) await page.locator('#supabase-auth-refresh-token').fill(refreshToken);
  await page.locator('[data-auth-submit]').click();
  await expect(modal).not.toBeVisible();
}

test('opens Supabase auth modal when sharing is requested without a session', async ({ page }) => {
  await boot(page);
  await openSupabaseAuthModal(page);
  const authModal = page.locator('#supabase-auth-modal');
  await expect(authModal).toBeVisible();
  await page.locator('[data-auth-cancel]').click();
  await expect(authModal).not.toBeVisible();
  await expect(page.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
});

test('connects Supabase API token and marks sharing as ready', async ({ page }) => {
  await boot(page);
  await openSupabaseAuthModal(page);
  await connectTokenFromModal(page);

  await expect(page.locator('#supabase-auth-status')).toContainText('Supabase API token connected for private media.');
  await expect(page.locator('#btn-share')).toHaveAttribute('data-ipfs-state', 'ready');

  const hasSession = await page.evaluate(async () => {
    const session = await window.Blend.shareCurrentExperienceThroughIpfs();
    return !!session?.access_token;
  });
  expect(hasSession).toBeTruthy();
});

test('shows inline auth errors when API token is missing', async ({ page }) => {
  await boot(page);

  await openSupabaseAuthModal(page);
  const authModal = page.locator('#supabase-auth-modal');
  await expect(authModal).toBeVisible();
  await page.locator('#supabase-auth-token').fill('   ');
  await page.locator('[data-auth-submit]').click();

  await expect(page.locator('[data-auth-error]')).toContainText('API token is required.');
  await expect(authModal).toBeVisible();
  await page.locator('[data-auth-cancel]').click();
  await expect(authModal).not.toBeVisible();
  await expect(page.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
});

test('sign out clears the active Supabase session', async ({ page }) => {
  await boot(page);
  await openSupabaseAuthModal(page);
  await connectTokenFromModal(page);
  await expect(page.locator('#btn-share')).toHaveAttribute('data-ipfs-state', 'ready');

  await openConfig(page);
  await page.locator('#supabase-sign-out').click();
  await expect(page.locator('#supabase-auth-status')).toContainText('Provide API token to access private Supabase media.');
  await expect(page.locator('#btn-share')).toHaveAttribute('data-ipfs-state', 'unauthorized');
});
