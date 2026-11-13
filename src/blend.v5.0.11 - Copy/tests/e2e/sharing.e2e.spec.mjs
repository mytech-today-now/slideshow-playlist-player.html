import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BlendAppPage } from './support/blend-app-page.mjs';

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
        SUPABASE_ANON_KEY: 'synthetic-browser-anon-key',
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

  await expect(page.locator('#supabase-auth-status')).toContainText('The connection is available for this tab only. Do not save credentials on this device.');
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
  await expect(page.locator('#supabase-auth-status')).toContainText(
    'The local session was cleared, but the provider sign-out outcome is unknown. Already issued access tokens may remain valid until expiry.'
  );
  await expect(page.locator('#btn-share')).toHaveAttribute('data-ipfs-state', 'unauthorized');
});

const UNSAFE_SHARE_NOTICE = 'Blend ignored an unsafe share address from this item and used the local experience link instead.';
const ITEM_NAME = 'Imported share destination sample';

function experienceWithShareUrl({ name, key, url }) {
  const itemId = `share-item-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const path = `C:\\BlendFixtures\\${itemId}.mp4`;
  return {
    version: '5.0.11',
    schema: 'player.blend.experience.v2',
    type: 'experience',
    name,
    settings: {},
    library: { order: [], items: [] },
    playlist: {
      schema: 'player.blend.list.v1',
      type: 'playlist',
      order: [itemId],
      items: [{
        id: itemId,
        path,
        fullPath: path,
        pathKind: 'absolute',
        name: ITEM_NAME,
        type: 'video',
        metadata: {
          [key]: { url, title: 'Imported share title' },
          preservedLabel: 'keep this metadata'
        }
      }]
    },
    slideshow: {
      schema: 'player.blend.list.v1',
      type: 'slideshow',
      order: [],
      items: []
    },
    ui: { activeList: 'playlist' }
  };
}

async function importExperience(page, payload) {
  const app = new BlendAppPage(page);
  await app.importExperience({
    name: `${payload.name}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload))
  });
  await page.waitForFunction(() => !!window.Blend?.state?.projectName);
  await expect(page.locator('#list-editor .list-item')).toContainText(ITEM_NAME);
}

async function captureClipboardWrites(page) {
  await page.evaluate(() => {
    window.__shareClipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async value => window.__shareClipboardWrites.push(String(value))
      }
    });
  });
}

async function copyRowShareLink(page) {
  const row = page.locator('#list-editor .list-item').filter({ hasText: ITEM_NAME });
  await row.getByRole('button', { name: `Share ${ITEM_NAME}` }).click();
  await page.getByRole('menuitem', { name: 'Copy share link' }).click();
  await page.waitForFunction(() => (window.__shareClipboardWrites || []).length > 0);
  return page.evaluate(() => window.__shareClipboardWrites.at(-1));
}

test('imported javascript social URL falls back to item link and preserves metadata', async ({ page }) => {
  const app = new BlendAppPage(page);
  await app.boot();
  await captureClipboardWrites(page);
  const payload = JSON.parse(await readFile(
    new URL('../fixtures/issue-04-unsafe-social-share-experience.json', import.meta.url),
    'utf8'
  ));
  await importExperience(page, payload);

  const storedMetadata = await page.evaluate(itemName => {
    const item = window.Blend.state.playlist.find(ref => ref.name === itemName);
    return item?.metadata || null;
  }, ITEM_NAME);
  expect(storedMetadata).toEqual({
    social: {
      url: 'javascript:alert(1)',
      href: 'https://evil.example/alternate',
      title: 'Imported share title'
    },
    preservedLabel: 'keep this metadata'
  });

  const originBeforeShare = new URL(page.url()).origin;
  const copied = await copyRowShareLink(page);
  expect(copied).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/index\.html\?/);
  expect(copied).not.toMatch(/^(?:javascript|data|blob|vbscript):/i);
  await expect(page.locator('#toast-container .toast[role="status"]')).toContainText(UNSAFE_SHARE_NOTICE);
  expect(new URL(page.url()).origin).toBe(originBeforeShare);
});

test('keeps an explicit external HTTPS metadata.share.url override by design', async ({ page }) => {
  const app = new BlendAppPage(page);
  await app.boot();
  await captureClipboardWrites(page);
  const payload = experienceWithShareUrl({
    name: 'External HTTPS Share Experience',
    key: 'share',
    url: 'https://evil.example'
  });
  await importExperience(page, payload);

  const copied = await copyRowShareLink(page);
  expect(copied).toBe('https://evil.example/');
});

test('unsafe contexts and platform builders never reach Web Share or navigation', async ({ page }) => {
  const app = new BlendAppPage(page);
  await app.boot();
  await captureClipboardWrites(page);

  const results = await page.evaluate(async () => {
    window.__shareOpens = [];
    window.open = url => {
      window.__shareOpens.push(String(url));
      return {};
    };
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async payload => { window.__nativeSharePayload = payload; }
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => true
    });

    const context = {
      experienceId: window.Blend.state.activeExperienceId,
      mediaLayer: 'playlist',
      mediaId: 'unsafe-share-item',
      pageTitle: 'Unsafe share test',
      shareText: 'Unsafe share test',
      pageLocation: 'javascript:alert(1)'
    };
    const expectedDeepLink = window.Blend.buildDeepLinkUrl({
      experienceId: context.experienceId,
      layer: context.mediaLayer,
      itemId: context.mediaId
    });
    await window.Blend.shareContextByMethod('native', context);

    window.Blend.registerSharePlatform('unsafe-test', {
      label: 'Unsafe test',
      buildUrl: () => 'data:text/html,blocked'
    });
    await window.Blend.shareContextByMethod('unsafe-test', {
      ...context,
      pageLocation: 'blob:https://example.test/unsafe'
    });

    return {
      expectedDeepLink,
      nativePayload: window.__nativeSharePayload,
      clipboardWrites: window.__shareClipboardWrites,
      openedUrls: window.__shareOpens
    };
  });

  expect(results.nativePayload.url).toBe(results.expectedDeepLink);
  expect(results.nativePayload.url).toMatch(/^https?:\/\//i);
  expect(results.clipboardWrites).toEqual([results.expectedDeepLink]);
  expect(results.clipboardWrites.join('\n')).not.toMatch(/^(?:javascript|data|blob|vbscript):/im);
  expect(results.openedUrls).toEqual([]);
});
