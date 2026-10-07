import { gzipSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { compressExperience, URL_SHARE_DECOMPRESS_OUTPUT_LIMIT } from '../../url-share.js';
import { BlendAppPage } from './support/blend-app-page.mjs';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const TOO_LARGE_MESSAGE = 'This shared link is too large to load safely. Ask for a smaller link or a JSON export.';

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
      progressMessages: [],
      memoryBefore: performance.memory?.usedJSHeapSize ?? null
    };
    window.__urlShareOutputProbe = probe;

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
  await expect(receiver.getByRole('alert')).toHaveText(TOO_LARGE_MESSAGE);
  await expect(overlay).toBeVisible();
  await expect(receiver.locator('#exp-load-item-list .exp-load-item')).toHaveCount(0);
  await expect(receiver.locator('#btn-play')).not.toBeDisabled();
  await expect(receiver.locator('#btn-next')).not.toBeDisabled();
  await expect(receiver.locator('#btn-prev')).not.toBeDisabled();

  const rejected = await receiver.evaluate(() => ({
    activeId: window.Blend.state.activeExperienceId,
    activeName: window.Blend.state.projectName,
    experienceCount: window.Blend.state.experiences.length,
    probe: window.__urlShareOutputProbe,
    memoryAfter: performance.memory?.usedJSHeapSize ?? null
  }));
  expect(rejected.activeId).toBe(baseline.id);
  expect(rejected.activeName).toBe(baseline.name);
  expect(rejected.experienceCount).toBe(baseline.count);
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
  const recoveryUrl = new URL('/index.html', `http://127.0.0.1:${PLAYWRIGHT_PORT}`);
  recoveryUrl.searchParams.set('experience', recoveryPayload);
  await receiver.goto(recoveryUrl.toString(), { waitUntil: 'commit' });

  await expect(receiver.locator('#experience-load-overlay')).toBeVisible({ timeout: 12_000 });
  await receiver.waitForFunction(
    name => window.Blend?.state?.projectName === name &&
      window.Blend?.state?.experiences?.some(record => record.name === name),
    recoveryExperience.name,
    { timeout: 30_000 }
  );
  const recovered = await receiver.evaluate(() => ({
    probe: window.__urlShareOutputProbe,
    activeName: window.Blend.state.projectName
  }));
  expect(recovered.activeName).toBe(recoveryExperience.name);
  expect(recovered.probe.sharedExperienceFiles).toBe(1);
  expect(recovered.probe.dbWrites.length).toBeGreaterThan(0);
  expect(recovered.probe.progressMessages.some(message => message.includes('Decompressing share link'))).toBe(true);
  expect(recovered.probe.progressMessages.some(message => message.includes('Saving to storage'))).toBe(true);

  await receiver.close();
});
