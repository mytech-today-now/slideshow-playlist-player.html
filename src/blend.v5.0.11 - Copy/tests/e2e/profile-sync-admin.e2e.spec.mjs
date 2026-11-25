import { test, expect } from '@playwright/test';

const GUID = '123e4567-e89b-42d3-a456-426614174000';
const ADMIN_KEY = 'S'.repeat(43);
const FIXTURE_ORIGIN = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_PORT || '4191')}`;

test('admin UI keeps the key in tab memory and exposes only authorized operations', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const seen = [];
  let deleted = false;
  await page.addInitScript(({ apiUrl }) => { window.BLEND_PROFILE_SYNC_ADMIN_API_URL = apiUrl; }, { apiUrl: `${FIXTURE_ORIGIN}/api/profile-sync` });
  await page.route('**/api/profile-sync/admin/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    seen.push({ path: url.pathname, method: request.method(), authorization: request.headers().authorization, cookie: request.headers().cookie || '' });
    if (request.headers().authorization !== `Bearer ${ADMIN_KEY}`) {
      await route.fulfill({ status: 401, json: { error: { code: 'admin_unauthorized', message: 'The admin key is invalid.' } } });
      return;
    }
    if (url.pathname.endsWith('/admin/health')) {
      await route.fulfill({ status: 200, json: { database: 'available', github: 'available', githubRepository: 'BlendPlayer/BlendPlayer', githubBranch: 'main', pendingSyncCount: 1 } });
      return;
    }
    if (url.pathname.endsWith(`/admin/profiles/${GUID}/delete/prepare`)) {
      await route.fulfill({ status: 200, json: { challengeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', challenge: 'C'.repeat(43), expiresInSeconds: 120 } });
      return;
    }
    if (url.pathname.endsWith(`/admin/profiles/${GUID}/delete`)) {
      expect(request.postDataJSON()).toMatchObject({ challenge: 'C'.repeat(43) });
      deleted = true;
      await route.fulfill({ status: 202, json: { accepted: true, revision: '9', status: 'delete_pending' } });
      return;
    }
    if (url.pathname.endsWith(`/admin/profiles/${GUID}/retry`)) {
      await route.fulfill({ status: 202, json: { status: deleted ? 'delete_pending' : 'pending', revision: deleted ? '9' : '8' } });
      return;
    }
    if (url.pathname.endsWith(`/admin/profiles/${GUID}`)) {
      await route.fulfill({ status: 200, json: {
        profileGuid: GUID,
        revision: deleted ? '9' : '8',
        github: { status: deleted ? 'delete_pending' : 'pending', sha: 'd'.repeat(40), syncedRevision: '7', errorCode: null },
        recoveryGeneration: 2,
        deleted,
        createdAt: '2026-11-14T00:00:00.000Z',
        updatedAt: '2026-11-14T00:00:00.000Z',
        outbox: deleted ? { operation: 'delete', desiredRevision: '9', attempts: 2, blockedByConflict: true } : { operation: 'put', desiredRevision: '8', attempts: 2, blockedByConflict: false }
      } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'fixture_route_missing', message: 'Unexpected admin fixture route.' } } });
  });
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.goto('/admin.html');
    await page.locator('#admin-sync-key').fill(ADMIN_KEY);
    await page.locator('#admin-sync-connect').click();
    await expect(page.locator('#admin-sync-key')).toHaveValue('');
    await expect(page.locator('#admin-sync-health')).toContainText('available');
    await page.locator('#admin-sync-guid').fill(GUID);
    await page.locator('#admin-sync-inspect').click();
    await expect(page.locator('#admin-sync-profile')).toContainText('pending');
    await page.locator('#admin-sync-retry').click();
    await expect(page.locator('#admin-sync-status')).toContainText('Retry accepted at revision 8');
    await page.locator('#admin-sync-delete').click();
    await expect(page.locator('#admin-sync-status')).toContainText('Deletion accepted at revision 9');
    await expect(page.locator('#admin-sync-profile')).toContainText('delete_pending');
    await expect(page.locator('#admin-sync-retry')).toBeEnabled();
    await page.locator('#admin-sync-retry').click();
    await expect(page.locator('#admin-sync-status')).toContainText('Retry accepted at revision 9');
    expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('blend-profile-sync-admin-key');
    expect(seen.length).toBeGreaterThanOrEqual(8);
    expect(seen.every(item => item.authorization === `Bearer ${ADMIN_KEY}`)).toBe(true);
    expect(seen.every(item => !item.cookie)).toBe(true);
    await page.locator('#admin-sync-disconnect').click();
    await expect(page.locator('#admin-sync-status')).toContainText('removed from this tab’s memory');
  } finally {
    await context.close();
  }
});
