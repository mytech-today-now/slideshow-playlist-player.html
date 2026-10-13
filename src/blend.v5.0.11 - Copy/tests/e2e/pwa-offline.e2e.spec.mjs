import { expect, test } from '@playwright/test';
import { attachBrowserEngineEvidence } from './support/browser-engine-evidence.mjs';

const deployments = [
  { name: 'root', appPath: '/index.html', appScopePath: '/' },
  { name: 'nested', appPath: '/nested/blend/index.html', appScopePath: '/nested/blend/' }
];

function registrationIdentity(baseURL, pagePath) {
  const pageUrl = new URL(pagePath, baseURL);
  const scriptUrl = new URL('./service-worker.js', pageUrl);
  return {
    scriptUrl: scriptUrl.href,
    scope: new URL('./', scriptUrl).href
  };
}

async function waitForController(page, scriptUrl) {
  await page.waitForFunction(expected => (
    navigator.serviceWorker?.controller?.scriptURL === expected
  ), scriptUrl);
}

async function installOtherAppWorker(page, baseURL) {
  const otherIdentity = registrationIdentity(baseURL, '/other-app/index.html');
  await page.goto('/other-app/index.html', { waitUntil: 'domcontentloaded' });
  await waitForController(page, otherIdentity.scriptUrl);
  await expect(page.locator('#worker-status')).toContainText(otherIdentity.scriptUrl);
  return otherIdentity;
}

async function openBlendAndReset(page, deployment, otherIdentity) {
  const baseURL = test.info().project.use.baseURL;
  const identity = registrationIdentity(baseURL, deployment.appPath);
  expect(identity.scope).toBe(new URL(deployment.appScopePath, baseURL).href);
  await page.goto(deployment.appPath, { waitUntil: 'domcontentloaded' });
  await waitForController(page, identity.scriptUrl);

  const registeredIdentity = await page.evaluate(async expected => {
    const registration = await navigator.serviceWorker.getRegistration(expected.scope);
    return {
      scope: registration?.scope || null,
      scriptUrl: [registration?.active, registration?.waiting, registration?.installing]
        .find(worker => worker?.scriptURL)?.scriptURL || null
    };
  }, identity);
  expect(registeredIdentity).toEqual(identity);
  const sameOriginRegistrations = await page.evaluate(async () => (
    (await navigator.serviceWorker.getRegistrations()).map(registration => ({
      scope: registration.scope,
      scriptUrl: [registration.active, registration.waiting, registration.installing]
        .find(worker => worker?.scriptURL)?.scriptURL || null
    }))
  ));
  expect(sameOriginRegistrations).toContainEqual(otherIdentity);
  expect(identity.scope).not.toBe(otherIdentity.scope);

  await page.locator('#config-gear').click();
  await page.locator('#clear-browser-storage').click();
  await expect(page.locator('#experience-modal')).toBeVisible();
  await page.locator('#experience-modal-ok').click();
  return identity;
}

for (const deployment of deployments) {
  test(`Clear Browser Storage unregisters only Blend's ${deployment.name} worker`, async ({ page }) => {
    const baseURL = test.info().project.use.baseURL;
    const otherIdentity = await installOtherAppWorker(page, baseURL);
    const blendIdentity = await openBlendAndReset(page, deployment, otherIdentity);

    await expect(page.locator('#toast-container .toast').last())
      .toHaveText('Browser data cleared. Saved Supabase and Git credentials, Git repository settings, and public Git catalog settings were removed. Runtime configuration was preserved, and other apps on this site were left alone.');

    const registrationsAfterReset = await page.evaluate(async () => (
      (await navigator.serviceWorker.getRegistrations()).map(registration => registration.scope)
    ));
    expect(registrationsAfterReset).not.toContain(blendIdentity.scope);
    expect(registrationsAfterReset).toContain(otherIdentity.scope);
    expect((await page.evaluate(() => caches.keys())).filter(name => name.startsWith('blend-'))).toEqual([]);
    expect(await page.evaluate(() => caches.has('other-app-shell-v1'))).toBe(true);

    await page.goto('/other-app/index.html', { waitUntil: 'domcontentloaded' });
    await waitForController(page, otherIdentity.scriptUrl);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForController(page, otherIdentity.scriptUrl);
    await expect(page.locator('#worker-status')).toContainText(otherIdentity.scriptUrl);

    await page.goto(deployment.appPath, { waitUntil: 'domcontentloaded' });
    await waitForController(page, blendIdentity.scriptUrl);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForController(page, blendIdentity.scriptUrl);
    await expect(page.locator('#app-version')).toHaveText('v5.0.11');
  });

  test(`Clear Browser Storage reports when Blend's ${deployment.name} worker cannot unregister`, async ({ page }) => {
    const baseURL = test.info().project.use.baseURL;
    const blendIdentity = registrationIdentity(baseURL, deployment.appPath);
    await page.addInitScript(scope => {
      const originalUnregister = ServiceWorkerRegistration.prototype.unregister;
      ServiceWorkerRegistration.prototype.unregister = function unregister() {
        if (this.scope === scope) return Promise.resolve(false);
        return originalUnregister.call(this);
      };
    }, blendIdentity.scope);

    const otherIdentity = await installOtherAppWorker(page, baseURL);
    await openBlendAndReset(page, deployment, otherIdentity);

    await expect(page.locator('#toast-container .toast').last())
      .toContainText('Cleanup still needs attention: Blend service worker registration.');
    const registrationsAfterReset = await page.evaluate(async () => (
      (await navigator.serviceWorker.getRegistrations()).map(registration => registration.scope)
    ));
    expect(registrationsAfterReset).toContain(blendIdentity.scope);
    expect(registrationsAfterReset).toContain(otherIdentity.scope);
    expect(await page.evaluate(() => caches.has('other-app-shell-v1'))).toBe(true);

    await page.goto('/other-app/index.html', { waitUntil: 'domcontentloaded' });
    await waitForController(page, otherIdentity.scriptUrl);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForController(page, otherIdentity.scriptUrl);
    await expect(page.locator('#worker-status')).toContainText(otherIdentity.scriptUrl);
  });
}

test('installed PWA shell reloads from cache after a navigation network failure', {
  tag: '@cross-engine-smoke'
}, async ({ page, context, browser }, testInfo) => {
  await attachBrowserEngineEvidence(browser, testInfo);
  test.skip(
    testInfo.project.name === 'webkit' && browser.version() === '26.6',
    'Playwright WebKit 26.6 returns an internal navigation error when reloading an active service-worker page offline; offline shell behavior remains unverified for this engine.'
  );
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  const identity = registrationIdentity(testInfo.project.use.baseURL, '/index.html');
  await waitForController(page, identity.scriptUrl);

  // The initial navigation can register the worker after its response was
  // already fetched. Reload once online under service-worker control so the
  // navigation is in the shell cache before checking offline recovery.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-version')).toHaveText('v5.0.11');

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app-version')).toHaveText('v5.0.11');
  } finally {
    await context.setOffline(false);
  }
});
