import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import { createRunSuffix } from './support/experience-lifecycle-utils.mjs';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');

function samplePath(file) {
  return path.resolve(process.cwd(), 'samples', file);
}

test.describe('experience URL load progress overlay (v5.0.11)', () => {
  /**
   * Verifies that navigating to a ?exp= share URL:
   *  - shows the #experience-load-overlay while loading
   *  - freezes all transport controls (play, next, prev) during loading
   *  - keeps #config-gear enabled throughout loading
   *  - auto-dismisses the overlay on success
   *  - unfreezes transport controls after loading
   */
  test('shows overlay, freezes transport, keeps config gear live, then cleans up on success', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const runSuffix = createRunSuffix(testInfo);
    const experienceName = `URL Progress Test ${runSuffix}`;
    const blendPage = new BlendAppPage(page);

    // Build a small experience to share
    await blendPage.boot('/index.html');
    await blendPage.createExperience(experienceName);
    await blendPage.addLocalFiles([
      samplePath('IL.jpeg'),
      samplePath('blotter-01.png'),
      samplePath('its-a-trap.jpg'),
    ]);
    await blendPage.selectLibraryItemsByNames(['IL.jpeg', 'blotter-01.png', 'its-a-trap.jpg']);
    await blendPage.addSelectedLibraryToList('slideshow', 3);

    const shareUrl = await blendPage.buildUrlShareLinkForCurrentExperience();
    expect(shareUrl, 'share URL must contain the ?experience= param').toMatch(/[?&]experience=/);

    // Open the share URL in a fresh tab. Use 'commit' so we can race to observe
    // the overlay before it auto-dismisses.
    const receiverTab = await context.newPage();

    await receiverTab.addInitScript(({ port }) => {
      localStorage.setItem('blend-welcome-v4', '1');
      localStorage.setItem('blend-install-banner-hidden-v4', '1');
      localStorage.setItem('blend-analytics-consent-v1', '0');
      // Mirror the fixture origin so Supabase config resolves correctly.
      const cfgKey = 'blend-runtime-config-v1';
      try {
        const origin = `http://127.0.0.1:${port}`;
        localStorage.setItem(cfgKey, JSON.stringify({
          SUPABASE_URL: origin,
          SUPABASE_AUTH_REDIRECT_URL: `${origin}/index.html`,
          SUPABASE_MEDIA_BUCKET: 'media',
          SUPABASE_PUBLIC_BUCKETS: 'public'
        }));
      } catch (_) {}
    }, { port: PLAYWRIGHT_PORT });

    await receiverTab.goto(shareUrl, { waitUntil: 'commit' });

    // ---- Phase 1: loading in progress ----------------------------------------

    const overlay   = receiverTab.locator('#experience-load-overlay');
    const playBtn   = receiverTab.locator('#btn-play');
    const nextBtn   = receiverTab.locator('#btn-next');
    const prevBtn   = receiverTab.locator('#btn-prev');
    const configGear = receiverTab.locator('#config-gear');

    // Overlay must appear while app.js processes the ?exp= payload
    await expect(overlay, 'loading overlay must appear').toBeVisible({ timeout: 12_000 });

    // Transport controls must be frozen
    await expect(playBtn, 'play must be disabled during load').toBeDisabled({ timeout: 3_000 });
    await expect(nextBtn, 'next must be disabled during load').toBeDisabled({ timeout: 3_000 });
    await expect(prevBtn, 'prev must be disabled during load').toBeDisabled({ timeout: 3_000 });

    // Config gear is NOT inside #transport so it must stay enabled
    await expect(configGear, 'config gear must stay enabled during load').not.toBeDisabled();

    // Progress bar fill element should be present
    await expect(receiverTab.locator('.exp-load-bar-fill'), 'progress bar fill must be visible').toBeVisible();

    // ---- Phase 2: loading complete + auto-dismiss ----------------------------

    // Overlay auto-dismisses 2.6 s after success (generous timeout for slow CI)
    await expect(overlay, 'overlay must dismiss after success').toBeHidden({ timeout: 60_000 });

    // Transport controls must be re-enabled
    await expect(playBtn, 'play must be re-enabled after load').not.toBeDisabled({ timeout: 5_000 });
    await expect(nextBtn, 'next must be re-enabled after load').not.toBeDisabled({ timeout: 5_000 });
    await expect(prevBtn, 'prev must be re-enabled after load').not.toBeDisabled({ timeout: 5_000 });

    // Experience must be present in state
    const loaded = await receiverTab.waitForFunction(
      name => (window.Blend?.state?.experiences || []).some(e => e.name === name),
      experienceName,
      { timeout: 5_000 }
    ).catch(() => null);
    expect(loaded, `experience "${experienceName}" must be in state after import`).not.toBeNull();

    await receiverTab.close();
  });

  /**
   * Verifies error handling: an invalid ?exp= payload shows the error state on
   * the overlay and does NOT auto-dismiss (so the user can read the message).
   */
  test('shows error state and does not auto-dismiss when payload is invalid', async ({ page, context }, testInfo) => {
    test.setTimeout(60_000);
    const receiverTab = await context.newPage();

    await receiverTab.addInitScript(() => {
      localStorage.setItem('blend-welcome-v4', '1');
      localStorage.setItem('blend-install-banner-hidden-v4', '1');
      localStorage.setItem('blend-analytics-consent-v1', '0');
    });

    // Navigate with a deliberately broken compressed URL-share payload.
    await receiverTab.goto('/index.html?experience=INVALID_GARBAGE_PAYLOAD', { waitUntil: 'commit' });

    const overlay  = receiverTab.locator('#experience-load-overlay');
    const errorBox = receiverTab.locator('#exp-load-error');

    // Overlay must appear
    await expect(overlay).toBeVisible({ timeout: 12_000 });

    // Error state must be shown
    await expect(overlay, 'error class must be present').toHaveClass(/exp-load--error/, { timeout: 30_000 });
    await expect(errorBox, 'error message box must be visible').toBeVisible({ timeout: 5_000 });

    // Overlay must persist (error state does NOT auto-dismiss)
    await receiverTab.waitForTimeout(3_500);
    await expect(overlay, 'overlay must not auto-dismiss on error').toBeVisible();

    // Transport controls should be re-enabled (finally block always runs)
    await expect(receiverTab.locator('#btn-play'), 'controls re-enabled after error').not.toBeDisabled({ timeout: 5_000 });

    await receiverTab.close();
  });
});
