import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.addInitScript(() => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => !!window.Blend && !!window.Blend.state);
}

async function configureKuboShareAndSeedRemoteVideo(page, endpoint) {
  return page.evaluate(async ({ endpoint: kuboApiEndpoint }) => {
    const { Blend } = window;
    const now = Date.now();
    const id = `e2e-remote-${now}`;
    const sourceUrl = 'https://media.example.test/nyc-01.mp4';

    Object.assign(Blend.state.settings, {
      ipfsEnabled: true,
      ipfsMode: 'kubo',
      ipfsKuboApiEndpoint: kuboApiEndpoint,
      ipfsTimeoutMs: 15000,
      showPublicUploadWarning: false
    });

    Blend.state.library.clear();
    Blend.state.playlist = [];
    Blend.state.slideshow = [];

    Blend.state.library.set(id, {
      id,
      handle: null,
      name: 'nyc-01.mp4',
      size: 2_600_000,
      type: 'video',
      duration: 10,
      pathHint: sourceUrl,
      sourceUrl,
      metadata: {},
      addedAt: now,
      lastVerified: now,
      stale: false
    });

    Blend.state.playlist.push({
      id,
      addedAt: now,
      path: sourceUrl,
      name: 'nyc-01.mp4',
      type: 'video',
      sourceUrl,
      available: true
    });

    Blend.renderLibrary();
    Blend.renderListEditor();
    await Blend.saveStateNow();
    return id;
  }, { endpoint });
}

test('shows setup guidance when IPFS is in gateway mode', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    Object.assign(window.Blend.state.settings, {
      ipfsEnabled: true,
      ipfsMode: 'gateway',
      showPublicUploadWarning: false
    });
    return window.Blend.shareCurrentExperienceThroughIpfs({ skipWarning: true });
  });
  expect(result).toBeNull();

  const setupDialog = page.locator('#ipfs-setup-required-modal');
  await expect(setupDialog).toBeVisible();
  await expect(setupDialog).toContainText('Gateway mode can retrieve IPFS content but cannot publish new content.');
});

test('shares a seeded experience through Kubo and returns a manifest CID', async ({ page }) => {
  await boot(page);
  const origin = new URL(page.url()).origin;
  await configureKuboShareAndSeedRemoteVideo(page, origin);

  const result = await page.evaluate(async () => {
    const out = await window.Blend.shareCurrentExperienceThroughIpfs({ skipWarning: true });
    return out ? { manifestCid: out.manifestCid, shareLink: out.shareLink } : null;
  });

  expect(result).toBeTruthy();
  expect(result.manifestCid).toBe('bafybeiab47tncsmv4ystfwwh3zujdipnfmgporoahsppz6g22t7uifpfqe');
  expect(result.shareLink).toContain('ipfsExperience=bafybeiab47tncsmv4ystfwwh3zujdipnfmgporoahsppz6g22t7uifpfqe');
  await expect(page.locator('#ipfs-operation-modal')).toContainText('IPFS Share Ready');
});

test('allows cancelling a slow IPFS share operation', async ({ page }) => {
  await boot(page);
  const origin = new URL(page.url()).origin;
  await configureKuboShareAndSeedRemoteVideo(page, `${origin}/slow`);

  await page.evaluate(() => {
    window.__sharePromise = window.Blend.shareCurrentExperienceThroughIpfs({ skipWarning: true });
  });
  const operationDialog = page.locator('#ipfs-operation-modal');
  await expect(operationDialog).toBeVisible();
  await operationDialog.locator('[data-cancel]').click();

  const shareResult = await page.evaluate(async () => {
    const result = await window.__sharePromise;
    window.__sharePromise = null;
    return result;
  });
  expect(shareResult).toBeNull();
  await expect(page.locator('#toast-container')).toContainText('IPFS sharing cancelled');
  await expect(page.locator('#ipfs-operation-modal')).toHaveCount(0);
});

test('reports a clean error state when Kubo is unavailable', async ({ page }) => {
  await boot(page);
  await configureKuboShareAndSeedRemoteVideo(page, 'http://127.0.0.1:65534');

  const result = await page.evaluate(async () => {
    return window.Blend.shareCurrentExperienceThroughIpfs({ skipWarning: true });
  });
  expect(result).toBeNull();
  await expect(page.locator('#ipfs-operation-modal')).toHaveCount(0);
  const setupDialog = page.locator('#ipfs-setup-required-modal');
  await expect(setupDialog).toBeVisible();
  await expect(setupDialog).toContainText(/Local IPFS node is not reachable|IPFS sharing is unavailable in this browser\./);
  await expect(page.locator('#toast-container')).toContainText(/Local IPFS node is not reachable|IPFS sharing is unavailable in this browser\./);
});
