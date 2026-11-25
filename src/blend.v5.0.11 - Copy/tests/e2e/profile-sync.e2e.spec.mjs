import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const GUID = '123e4567-e89b-42d3-a456-426614174000';
const PREVIOUS_GUID = '123e4567-e89b-42d3-b456-426614174001';
const DEVICE_COOKIE = `blend_profile_device_v1=${'a'.repeat(43)}; Path=/api/profile-sync; Secure; HttpOnly; SameSite=Strict`;
const FIXTURE_ORIGIN = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_PORT || '4191')}`;
const FIXTURE_EXPERIENCE = {
  schema: 'player.blend.experience.v2',
  type: 'experience',
  version: '5.0.11',
  id: 'exp-extension-fixture',
  name: 'Extension fixture',
  settings: { defaultImageDuration: 7, futureSetting: { retain: true } },
  ui: { activeList: 'playlist', futureUiField: 'retain' },
  library: { schema: 'player.blend.library.v1', type: 'library', futureLibraryField: 'retain', items: [] },
  playlist: { schema: 'player.blend.list.v1', type: 'playlist', futureListField: 'retain', items: [], order: [] },
  slideshow: { schema: 'player.blend.list.v1', type: 'slideshow', futureSlideField: 'retain', items: [], order: [] },
  providerExtension: { source: 'fixture', flags: ['keep', 'all'] }
};

async function makePage(browser) {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
  });
  await page.addInitScript(({ fixtureOrigin }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
    window.BLEND_RUNTIME_CONFIG = {
      SUPABASE_URL: fixtureOrigin,
      SUPABASE_ANON_KEY: 'synthetic-browser-anon-key',
      SUPABASE_AUTH_REDIRECT_URL: `${fixtureOrigin}/index.html`,
      SUPABASE_MEDIA_BUCKET: 'media',
      SUPABASE_PUBLIC_BUCKETS: 'public'
    };
  }, { fixtureOrigin: FIXTURE_ORIGIN });
  return { context, page };
}

async function bootApp(page, url = '/index.html') {
  await page.goto(url);
  try { await page.waitForFunction(() => !!window.Blend && !!window.Blend.state, null, { timeout: 10000 }); }
  catch (error) {
    const diagnostics = await page.evaluate(() => ({
      status: window.BlendDebug?.getStatus?.() || null,
      recentEvents: window.BlendDebug?.getRecentEvents?.(15) || []
    }));
    console.error('[profile-sync e2e bootstrap diagnostics]', JSON.stringify(diagnostics));
    throw error;
  }
}

test('stores and re-exports top-level, settings, UI, and branch Experience extensions', async ({ browser }) => {
  const { context, page } = await makePage(browser);
  try {
    await bootApp(page);
    const imported = await page.evaluate(async payload => {
      return await window.Blend.importExperiencePayload(payload, { replaceActive: true, suppressToast: true });
    }, FIXTURE_EXPERIENCE);
    expect(imported).toBeTruthy();
    const exported = await page.evaluate(() => window.Blend.getExperienceExportPayload());
    expect(exported.providerExtension).toEqual(FIXTURE_EXPERIENCE.providerExtension);
    expect(exported.settings.futureSetting).toEqual({ retain: true });
    expect(exported.ui.futureUiField).toBe('retain');
    expect(exported.library.futureLibraryField).toBe('retain');
    expect(exported.playlist.futureListField).toBe('retain');
    expect(exported.slideshow.futureSlideField).toBe('retain');
    expect(exported.id).toBe(FIXTURE_EXPERIENCE.id);
    expect(await page.evaluate(() => window.Blend.flushSaveState())).toBe(true);
  } finally {
    await context.close();
  }
});

test('creates a profile, downloads one recovery file, and syncs the complete local Experience', async ({ browser }) => {
  const { context, page } = await makePage(browser);
  page.on('dialog', dialog => dialog.accept());
  const state = { revision: 0, experience: null, lock: '', writes: 0 };
  let loseFirstWriteResponse = true;
  await page.addInitScript(({ apiUrl }) => { window.BLEND_PROFILE_SYNC_API_URL = apiUrl; }, { apiUrl: `${FIXTURE_ORIGIN}/api/profile-sync` });
  await page.route('**/api/profile-sync/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path.endsWith('/initialize') && method === 'POST') {
      await route.fulfill({ status: 201, headers: { 'Set-Cookie': DEVICE_COOKIE, 'Cache-Control': 'no-store' }, json: {
        profileGuid: path.split('/').at(-2),
        recoveryKeys: Array.from({ length: 10 }, (_, index) => `BLD1-${String(index + 1).padStart(27, 'A')}`),
        recoveryGeneration: 1,
        revision: '0',
        experience: null,
        github: { status: 'local_only', sha: null, syncedRevision: '0' }
      } });
      return;
    }
    if (path.endsWith('/experience') && method === 'LOCK') {
      state.lock = '<urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa>';
      await route.fulfill({ status: 200, headers: { 'Lock-Token': state.lock, 'Access-Control-Expose-Headers': 'Lock-Token', 'Cache-Control': 'no-store' }, json: { revision: String(state.revision) } });
      return;
    }
    if (path.endsWith('/experience') && method === 'PUT') {
      expect(request.headers()['lock-token']).toBe(state.lock);
      const body = request.postDataJSON();
      expect(body.baseRevision).toBe(String(state.revision));
      state.experience = body.experience;
      state.revision += 1;
      state.writes += 1;
      if (loseFirstWriteResponse) {
        loseFirstWriteResponse = false;
        await route.abort('failed');
        return;
      }
      await route.fulfill({ status: 202, headers: { 'Cache-Control': 'no-store' }, json: {
        revision: String(state.revision),
        github: { status: 'synced', sha: 'b'.repeat(40), syncedRevision: String(state.revision) }
      } });
      return;
    }
    if (path.endsWith('/experience') && method === 'UNLOCK') {
      await route.fulfill({ status: 204, headers: { 'Cache-Control': 'no-store' } });
      return;
    }
    if (/\/profiles\/[0-9a-f-]{36}$/.test(path) && method === 'GET') {
      await route.fulfill({ status: 200, headers: { 'Cache-Control': 'no-store' }, json: {
        profileGuid: path.split('/').at(-1), revision: String(state.revision), experience: state.experience,
        github: { status: state.writes ? 'synced' : 'local_only', sha: state.writes ? 'b'.repeat(40) : null, syncedRevision: String(state.revision) }
      } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'fixture_route_missing', message: 'Unexpected profile sync fixture route.' } } });
  });
  try {
    await bootApp(page);
    await page.locator('#config-gear').click();
    await page.locator('#profile-sync-details > summary').click();
    await page.locator('#profile-sync-initialize').click();
    await expect(page.locator('#profile-sync-recovery-save')).toBeVisible();
    const recoveryDownload = page.locator('#profile-sync-recovery-download');
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
    await recoveryDownload.click();
    const download = await downloadPromise;
    const recoveryText = await readFile(await download.path(), 'utf8');
    expect((recoveryText.match(/^BLD1-/gm) || []).length).toBe(10);
    await expect(page.locator('#profile-sync-recovery-cancel')).toBeHidden();
    await page.locator('#profile-sync-recovery-confirm').click();
    await expect.poll(() => state.writes).toBe(1);
    await expect(page.locator('#profile-sync-error')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('#profile-sync-remote-status')).toContainText('Remote GitHub sync is current.', { timeout: 10000 });
    const saved = state.experience;
    expect(saved.schema).toBe('player.blend.experience.v2');
    expect(saved.type).toBe('experience');
    expect(saved.settings).toBeTruthy();
  } finally {
    await context.close();
  }
});

test('strips the share token from the address before using it with the profile GUID', async ({ browser }) => {
  const { context, page } = await makePage(browser);
  await page.addInitScript(({ apiUrl }) => { window.BLEND_PROFILE_SYNC_API_URL = apiUrl; }, { apiUrl: `${FIXTURE_ORIGIN}/api/profile-sync` });
  await page.addInitScript(({ previousGuid }) => localStorage.setItem('blend-profile-sync-guid-v1', previousGuid), { previousGuid: PREVIOUS_GUID });
  let enrollmentBody = null;
  const dialogs = [];
  const token = 'T'.repeat(43);
  await page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  await page.route('**/api/profile-sync/**', async route => {
    const request = route.request();
    if (request.method() === 'POST' && request.url().endsWith(`/profiles/${GUID}/enroll`)) {
      enrollmentBody = request.postDataJSON();
      await route.fulfill({ status: 200, headers: { 'Set-Cookie': DEVICE_COOKIE, 'Cache-Control': 'no-store' }, json: {
        profileGuid: GUID,
        revision: '2',
        experience: null,
        github: { status: 'synced', sha: 'c'.repeat(40), syncedRevision: '2' }
      } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'fixture_route_missing', message: 'Unexpected profile sync fixture route.' } } });
  });
  try {
    await bootApp(page, `/index.html#blend-profile-share=${token}&blend-profile-guid=${GUID}`);
    await expect.poll(() => enrollmentBody).toEqual({ shareToken: token });
    expect(dialogs[0]).toContain('different public profile');
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    expect(new URL(page.url()).href).not.toContain(token);
  } finally {
    await context.close();
  }
});
