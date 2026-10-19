import { gzipSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { compressExperience, URL_SHARE_DECOMPRESS_OUTPUT_LIMIT } from '../../url-share.js';
import { BlendAppPage } from './support/blend-app-page.mjs';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const SHARE_RECOVERY_MESSAGE = 'This shared experience could not be loaded. Your current experience and share link are unchanged; ask for a smaller link or import a JSON backup.';
const RECOVERY_VIEWPORTS = [
  { width: 320, height: 480 },
  { width: 360, height: 800 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 }
];

function buildOversizedSharePayload() {
  const experience = {
    schema: 'player.blend.experience.v2',
    type: 'experience',
    id: 'oversized-output-fixture',
    name: 'Oversized output fixture'
  };
  const bytes = Buffer.alloc(URL_SHARE_DECOMPRESS_OUTPUT_LIMIT + 1, 0x20);
  Buffer.from(JSON.stringify(experience)).copy(bytes);
  const payload = gzipSync(bytes).toString('base64url');
  if (payload.length >= 4 * 1024 * 1024) {
    throw new Error('Synthetic share fixture unexpectedly exceeds the compressed input ceiling');
  }
  return payload;
}

test('oversized startup share rejects safely, preserves local state, and a later valid share imports', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const localExperienceName = 'Local Experience Before Oversized Link';
  const baselinePage = new BlendAppPage(page);
  await baselinePage.boot();
  await baselinePage.createExperience(localExperienceName);

  const baseline = await page.evaluate(() => ({
    id: window.Blend.state.activeExperienceId,
    name: window.Blend.state.projectName,
    count: window.Blend.state.experiences.length
  }));
  const receiver = await context.newPage();
  const oversizedPayload = buildOversizedSharePayload();
  await receiver.addInitScript(({ sharePayload }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
    // Keep the fixture HTTP request small while giving app bootstrap the full
    // oversized share URL in location.search before app.js runs.
    if (new URL(location.href).searchParams.has('e2e')) {
      history.replaceState(null, '', `${location.pathname}?experience=${sharePayload}`);
    }
    const probe = {
      armed: false,
      sharedExperienceFiles: 0,
      dbWrites: [],
      transactionAbortInjected: false,
      transactionAborted: false,
      progressMessages: [],
      memoryBefore: performance.memory?.usedJSHeapSize ?? null
    };
    window.__urlShareOutputProbe = probe;

    if (new URL(location.href).searchParams.has('transactionFailure')) {
      window.__BLEND_TEST_HOOKS__ = {
        afterSnapshotWriteQueued({ storeName, operation, transaction }) {
          if (storeName !== 'experiences' || operation !== 'put') return;
          probe.transactionAbortInjected = true;
          transaction.addEventListener('abort', () => { probe.transactionAborted = true; }, { once: true });
          throw Object.assign(new Error('Synthetic Issue 07 IndexedDB abort'), { name: 'QuotaExceededError' });
        }
      };
    }

    const NativeFile = window.File;
    window.File = new Proxy(NativeFile, {
      construct(target, args, newTarget) {
        if (args?.[1] === 'shared-experience.json') probe.sharedExperienceFiles++;
        return Reflect.construct(target, args, newTarget);
      }
    });

    for (const method of ['put', 'add', 'delete', 'clear']) {
      const original = IDBObjectStore.prototype[method];
      Object.defineProperty(IDBObjectStore.prototype, method, {
        configurable: true,
        writable: true,
        value: function (...args) {
          if (probe.armed) probe.dbWrites.push({ store: this.name, method });
          return Reflect.apply(original, this, args);
        }
      });
    }

    const observeProgress = () => {
      const text = document.querySelector('#exp-load-status-text')?.textContent?.trim() || '';
      if (text && probe.progressMessages.at(-1) !== text) probe.progressMessages.push(text);
      if (text.includes('Decompressing share link')) probe.armed = true;
    };
    new MutationObserver(observeProgress).observe(document, {
      subtree: true, childList: true, attributes: true, characterData: true
    });
  }, { sharePayload: oversizedPayload });

  const pageErrors = [];
  receiver.on('pageerror', error => pageErrors.push(error.message));
  await receiver.goto('/index.html?e2e=oversized-startup-share', { waitUntil: 'commit' });
  await receiver.waitForFunction(() => !!window.Blend, null, { timeout: 30_000 }).catch(async () => {
    const startup = await receiver.evaluate(() => ({
      title: document.title,
      readyState: document.readyState,
      overlayPresent: !!document.querySelector('#experience-load-overlay'),
      queryLength: location.search.length
    })).catch(() => null);
    throw new Error(`App did not finish processing the shared link; pageErrors=${JSON.stringify(pageErrors)} startup=${JSON.stringify(startup)}`);
  });

  const overlay = receiver.locator('#experience-load-overlay');
  await expect(overlay).toHaveClass(/exp-load--error/, { timeout: 30_000 });
  await expect(receiver.locator('#exp-load-error')).toHaveAttribute('role', 'alert');
  await expect(receiver.getByRole('alert')).toHaveText(SHARE_RECOVERY_MESSAGE);
  await expect(receiver.locator('#toast-container').getByText(SHARE_RECOVERY_MESSAGE, { exact: true })).toHaveCount(0);
  await expect(overlay).toBeVisible();
  await expect(receiver.locator('#exp-load-item-list .exp-load-item')).toHaveCount(0);
  await expect(receiver.locator('#btn-play')).not.toBeDisabled();
  await expect(receiver.locator('#btn-next')).not.toBeDisabled();
  await expect(receiver.locator('#btn-prev')).not.toBeDisabled();

  const rejected = await receiver.evaluate(() => ({
    activeId: window.Blend.state.activeExperienceId,
    activeName: window.Blend.state.projectName,
    experienceCount: window.Blend.state.experiences.length,
    sourcePayload: new URLSearchParams(location.search).get('experience'),
    probe: window.__urlShareOutputProbe,
    memoryAfter: performance.memory?.usedJSHeapSize ?? null
  }));
  expect(rejected.activeId).toBe(baseline.id);
  expect(rejected.activeName).toBe(baseline.name);
  expect(rejected.experienceCount).toBe(baseline.count);
  expect(rejected.sourcePayload).toBe(oversizedPayload);
  expect(rejected.probe.sharedExperienceFiles).toBe(0);
  expect(rejected.probe.dbWrites).toEqual([]);
  expect(rejected.probe.progressMessages.some(message => message.includes('Decompressing share link'))).toBe(true);

  const memoryObservation = {
    available: Number.isFinite(rejected.probe.memoryBefore) && Number.isFinite(rejected.memoryAfter),
    beforeBytes: rejected.probe.memoryBefore,
    afterRejectionBytes: rejected.memoryAfter,
    note: 'Informational browser heap readings; not an allocation-bound measurement.'
  };
  await testInfo.attach('share-decompression-memory-observation.json', {
    body: Buffer.from(JSON.stringify(memoryObservation, null, 2)),
    contentType: 'application/json'
  });
  if (memoryObservation.available) {
    console.log(`Informational browser heap reading after rejection: ${memoryObservation.beforeBytes} -> ${memoryObservation.afterRejectionBytes} bytes.`);
  }

  const recoveryExperience = {
    version: '5.0.11', schema: 'player.blend.experience.v2', type: 'experience',
    id: 'valid-share-after-output-rejection', name: 'Valid Share After Rejection',
    settings: {},
    library: { order: [], items: [] },
    playlist: { type: 'playlist', order: [], items: [] },
    slideshow: { type: 'slideshow', order: [], items: [] }
  };
  const recoveryPayload = await compressExperience(recoveryExperience);
  const failedImportUrl = new URL('/index.html', `http://127.0.0.1:${PLAYWRIGHT_PORT}`);
  failedImportUrl.searchParams.set('experience', recoveryPayload);
  failedImportUrl.searchParams.set('transactionFailure', '1');
  await receiver.goto(failedImportUrl.toString(), { waitUntil: 'commit' });

  const failedImportOverlay = receiver.locator('#experience-load-overlay');
  await expect(failedImportOverlay).toHaveClass(/exp-load--error/, { timeout: 30_000 });
  const failedImport = await receiver.evaluate(() => ({
    activeId: window.Blend.state.activeExperienceId,
    activeName: window.Blend.state.projectName,
    experienceCount: window.Blend.state.experiences.length,
    sourcePayload: new URLSearchParams(location.search).get('experience'),
    retryFlag: new URLSearchParams(location.search).get('transactionFailure'),
    probe: window.__urlShareOutputProbe,
    logs: window.Blend.log.exportJson()
  }));
  expect(failedImport.activeId).toBe(baseline.id);
  expect(failedImport.activeName).toBe(baseline.name);
  expect(failedImport.experienceCount).toBe(baseline.count);
  expect(failedImport.sourcePayload).toBe(recoveryPayload);
  expect(failedImport.retryFlag).toBe('1');
  expect(failedImport.probe.sharedExperienceFiles).toBe(1);
  expect(failedImport.probe.dbWrites.length).toBeGreaterThan(0);
  expect(failedImport.probe.transactionAbortInjected).toBe(true);
  expect(failedImport.probe.transactionAborted).toBe(true);
  expect(failedImport.probe.progressMessages.some(message => message.includes('Saving to storage'))).toBe(true);
  expect(failedImport.logs).not.toContain('Synthetic Issue 07 IndexedDB abort');
  await expect(receiver.getByRole('alert')).toHaveText(SHARE_RECOVERY_MESSAGE);

  const persistedAfterAbort = await receiver.evaluate(() => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open('player-blend-v1');
    openRequest.onerror = () => reject(openRequest.error || new Error('Could not open Blend database'));
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction('experiences', 'readonly');
      const request = transaction.objectStore('experiences').getAll();
      transaction.oncomplete = () => {
        database.close();
        resolve((request.result || []).map(record => record.id));
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error('Could not read saved experiences'));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error('Saved experience read was aborted'));
      };
    };
  }));
  expect(persistedAfterAbort).not.toContain(recoveryExperience.id);

  await receiver.evaluate(() => {
    delete window.__BLEND_TEST_HOOKS__;
    const retryUrl = new URL(location.href);
    retryUrl.searchParams.delete('transactionFailure');
    history.replaceState(null, '', retryUrl.toString());
  });
  await receiver.reload({ waitUntil: 'commit' });

  await expect(receiver.locator('#experience-load-overlay')).toBeVisible({ timeout: 12_000 });
  await receiver.waitForFunction(
    name => window.Blend?.state?.projectName === name &&
      window.Blend?.state?.experiences?.some(record => record.name === name),
    recoveryExperience.name,
    { timeout: 30_000 }
  );
  const recovered = await receiver.evaluate(() => ({
    probe: window.__urlShareOutputProbe,
    activeName: window.Blend.state.projectName,
    remainingSearch: location.search
  }));
  expect(recovered.activeName).toBe(recoveryExperience.name);
  expect(await receiver.evaluate(() => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open('player-blend-v1');
    openRequest.onerror = () => reject(openRequest.error || new Error('Could not open Blend database'));
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction('experiences', 'readonly');
      const request = transaction.objectStore('experiences').getAll();
      transaction.oncomplete = () => {
        database.close();
        resolve((request.result || []).some(record => record.name === 'Valid Share After Rejection'));
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error('Could not read saved experiences'));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error('Saved experience read was aborted'));
      };
    };
  }))).toBe(true);
  expect(recovered.remainingSearch).not.toMatch(/(?:experience|data)=/);
  expect(recovered.probe.sharedExperienceFiles).toBe(1);
  expect(recovered.probe.dbWrites.length).toBeGreaterThan(0);
  expect(recovered.probe.progressMessages.some(message => message.includes('Decompressing share link'))).toBe(true);
  expect(recovered.probe.progressMessages.some(message => message.includes('Saving to storage'))).toBe(true);

  await receiver.close();
});

test('share failure recovery wraps and stays reachable across the requested viewports', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: RECOVERY_VIEWPORTS[0] });
  const page = await context.newPage();
  const payload = buildOversizedSharePayload();
  const shareUrl = new URL('/index.html', `http://127.0.0.1:${PLAYWRIGHT_PORT}`);
  shareUrl.searchParams.set('experience', payload);

  try {
    await page.addInitScript(() => {
      localStorage.setItem('blend-welcome-v4', '1');
      localStorage.setItem('blend-install-banner-hidden-v4', '1');
      localStorage.setItem('blend-analytics-consent-v1', '0');
    });
    await page.goto(shareUrl.toString(), { waitUntil: 'commit' });
    await page.waitForFunction(() => !!window.Blend, null, { timeout: 30_000 });
    await expect(page.locator('#experience-load-overlay')).toHaveClass(/exp-load--error/);
    await expect(page.getByRole('alert')).toHaveText(SHARE_RECOVERY_MESSAGE);
    await expect(page.locator('#toast-container').getByText(SHARE_RECOVERY_MESSAGE, { exact: true })).toHaveCount(0);

    for (const viewport of RECOVERY_VIEWPORTS) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const overlay = document.querySelector('#experience-load-overlay');
        const error = document.querySelector('#exp-load-error');
        const status = document.querySelector('#exp-load-status-text');
        const errorRange = document.createRange();
        errorRange.selectNodeContents(error);
        const errorRect = error.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        return {
          viewport: { width: innerWidth, height: innerHeight },
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          overlay: { top: overlayRect.top, bottom: overlayRect.bottom, left: overlayRect.left, right: overlayRect.right },
          error: {
            text: error.textContent.trim(),
            left: errorRect.left,
            right: errorRect.right,
            top: errorRect.top,
            bottom: errorRect.bottom,
            scrollWidth: error.scrollWidth,
            clientWidth: error.clientWidth,
            lineCount: errorRange.getClientRects().length
          },
          status: {
            text: status.textContent.trim(),
            scrollWidth: status.scrollWidth,
            clientWidth: status.clientWidth
          }
        };
      });

      expect(layout.documentWidth, `${viewport.width}x${viewport.height} document width`).toBeLessThanOrEqual(viewport.width);
      expect(layout.bodyWidth, `${viewport.width}x${viewport.height} body width`).toBeLessThanOrEqual(viewport.width);
      expect(layout.overlay.left).toBeGreaterThanOrEqual(0);
      expect(layout.overlay.right).toBeLessThanOrEqual(viewport.width);
      expect(layout.overlay.top).toBeGreaterThanOrEqual(0);
      expect(layout.overlay.bottom).toBeLessThanOrEqual(viewport.height);
      expect(layout.error.text).toBe(SHARE_RECOVERY_MESSAGE);
      expect(layout.error.scrollWidth).toBeLessThanOrEqual(layout.error.clientWidth + 1);
      expect(layout.error.left).toBeGreaterThanOrEqual(0);
      expect(layout.error.right).toBeLessThanOrEqual(viewport.width);
      expect(layout.error.top).toBeGreaterThanOrEqual(0);
      expect(layout.error.bottom).toBeLessThanOrEqual(viewport.height);
      expect(layout.error.lineCount, `${viewport.width}x${viewport.height} recovery copy wraps`).toBeGreaterThan(1);
      expect(layout.status.text).toBe('Loading failed');
      expect(layout.status.scrollWidth).toBeLessThanOrEqual(layout.status.clientWidth);
    }

    await page.setViewportSize(RECOVERY_VIEWPORTS[0]);
    await page.screenshot({ path: testInfo.outputPath('issue-07-share-recovery-320x480.png') });
    await page.keyboard.press('Tab');
    const skipFocus = await page.evaluate(() => ({
      className: document.activeElement?.className,
      visible: document.activeElement?.matches(':focus-visible') === true,
      bounds: (() => {
        const rect = document.activeElement?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
      })()
    }));
    expect(skipFocus.className).toContain('skip-link');
    expect(skipFocus.visible).toBe(true);
    expect(skipFocus.bounds.left).toBeGreaterThanOrEqual(0);
    expect(skipFocus.bounds.right).toBeLessThanOrEqual(RECOVERY_VIEWPORTS[0].width);
    let gearFocused = false;
    for (let index = 0; index < 20 && !gearFocused; index++) {
      await page.keyboard.press('Tab');
      gearFocused = await page.evaluate(() => document.activeElement?.id === 'config-gear');
    }
    expect(gearFocused, 'the configuration control remains keyboard reachable').toBe(true);
    await expect(page.locator('#config-gear')).toBeFocused();
    await expect(page.locator('#config-gear')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(page.locator('#config-panel')).toHaveClass(/open/);

    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true
    });
    const touchPage = await touchContext.newPage();
    try {
      await touchPage.addInitScript(() => {
        localStorage.setItem('blend-welcome-v4', '1');
        localStorage.setItem('blend-install-banner-hidden-v4', '1');
        localStorage.setItem('blend-analytics-consent-v1', '0');
      });
      await touchPage.goto(shareUrl.toString(), { waitUntil: 'commit' });
      await touchPage.waitForFunction(() => !!window.Blend, null, { timeout: 30_000 });
      await expect(touchPage.getByRole('alert')).toHaveText(SHARE_RECOVERY_MESSAGE);
      const gear = touchPage.locator('#config-gear');
      const bounds = await gear.boundingBox();
      expect(bounds).not.toBeNull();
      await touchPage.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await expect(touchPage.locator('#config-panel')).toHaveClass(/open/);
    } finally {
      await touchContext.close();
    }
  } finally {
    await context.close();
  }
});
