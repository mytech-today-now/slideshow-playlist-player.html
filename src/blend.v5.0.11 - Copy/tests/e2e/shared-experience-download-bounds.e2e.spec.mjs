import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import {
  SHARED_EXPERIENCE_LIMIT_MESSAGE,
  SHARED_EXPERIENCE_MAX_BYTES
} from '../../shared-experience-download.js';

const SHARED_URL = 'https://shared-experience-fixture.invalid/experience.json?token=private-shared-token';
const EXPERIENCE_NAME = 'Bounded shared fixture';
const GENERIC_FAILURE = 'The shared experience could not be downloaded. Try again or import a local JSON file.';

function buildExperiencePayload(name = EXPERIENCE_NAME) {
  return {
    schema: 'player.blend.experience.v2',
    type: 'experience',
    id: `e2e-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    settings: { resumeOnLoad: false },
    playlist: { type: 'playlist', name: 'Playlist', items: [], order: [] },
    slideshow: { type: 'slideshow', name: 'Slideshow', items: [], order: [] }
  };
}

async function installFetchFixtures(page, plans) {
  await page.evaluate(initialPlans => {
    if (!window.__sharedDownloadNativeFetch) {
      window.__sharedDownloadNativeFetch = window.fetch.bind(window);
    }
    window.__sharedDownloadProbe = {
      plans: initialPlans,
      calls: 0,
      fetchAborted: false,
      readerCancelled: false,
      bytesQueued: 0,
      sharedFiles: 0,
      lastContentLength: null
    };
    if (!window.__sharedDownloadFileWrapped) {
      const NativeFile = window.File;
      window.File = new Proxy(NativeFile, {
        construct(target, args, newTarget) {
          if (args?.[1] === 'shared-experience.json') window.__sharedDownloadProbe.sharedFiles += 1;
          return Reflect.construct(target, args, newTarget);
        }
      });
      window.__sharedDownloadFileWrapped = true;
    }
    window.fetch = async (input, init = {}) => {
      const url = String(input || '');
      if (!url.startsWith('https://shared-experience-fixture.invalid/')) {
        return window.__sharedDownloadNativeFetch(input, init);
      }

      const probe = window.__sharedDownloadProbe;
      const plan = probe.plans.shift() || { mode: 'invalid-json' };
      const signal = init?.signal;
      probe.calls += 1;
      signal?.addEventListener('abort', () => { probe.fetchAborted = true; }, { once: true });
      probe.lastContentLength = plan.contentLength == null ? null : String(plan.contentLength);

      if (plan.mode === 'stall-headers') {
        return new Promise((_resolve, reject) => {
          const abort = () => reject(signal?.reason || new DOMException('Request aborted', 'AbortError'));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        });
      }

      const encoder = new TextEncoder();
      let text = plan.body ?? JSON.stringify(plan.payload || {});
      if (Number.isInteger(plan.bodyBytes)) text = text.padEnd(plan.bodyBytes, ' ');
      const bytes = encoder.encode(text);
      let offset = 0;
      let stalled = false;
      let releaseStalledPull = null;
      const chunkSize = Math.max(1, Number(plan.chunkSize) || 64 * 1024);
      const body = new ReadableStream({
        pull(controller) {
          if (plan.mode === 'stall-body') {
            if (!stalled) {
              stalled = true;
              const prefix = encoder.encode('{"schema":"player.blend.experience.v2","type":"experience"');
              probe.bytesQueued += prefix.byteLength;
              controller.enqueue(prefix);
              return;
            }
            return new Promise(resolve => { releaseStalledPull = resolve; });
          }
          if (offset >= bytes.byteLength) {
            if (plan.holdOpenAfterBytes) return new Promise(resolve => { releaseStalledPull = resolve; });
            controller.close();
            return;
          }
          const end = Math.min(bytes.byteLength, offset + chunkSize);
          const chunk = bytes.subarray(offset, end);
          offset = end;
          probe.bytesQueued += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          probe.readerCancelled = true;
          releaseStalledPull?.();
        }
      });

      const headers = { 'content-type': plan.contentType || 'application/json; charset=utf-8' };
      if (plan.contentLength != null) headers['content-length'] = String(plan.contentLength);
      return new Response(body, { status: plan.status || 200, headers });
    };
  }, plans);
}

async function startSharedLoad(page, reference = SHARED_URL) {
  await page.evaluate(url => {
    const current = new URL(window.location.href);
    current.searchParams.set('storageExperience', url);
    window.history.replaceState(window.history.state, '', `${current.pathname}${current.search}${current.hash}`);
    window.__sharedLoadFinished = false;
    window.__sharedLoadSucceeded = false;
    window.__sharedLoadPromise = window.Blend.loadSharedIpfsExperience({ reference: url });
    void window.__sharedLoadPromise.then(result => {
      window.__sharedLoadSucceeded = !!result;
      window.__sharedLoadFinished = true;
    });
  }, reference);
}

async function waitForSharedLoad(page) {
  await page.waitForFunction(() => window.__sharedLoadFinished === true, null, { timeout: 50_000 });
}

async function stateSnapshot(page) {
  return page.evaluate(() => {
    const state = window.Blend?.state;
    return {
      activeExperienceId: state?.activeExperienceId || '',
      projectName: state?.projectName || '',
      experiences: (state?.experiences || []).map(record => ({ id: record.id, name: record.name })),
      libraryIds: Array.from(state?.library?.keys?.() || []),
      playlist: (state?.playlist || []).map(item => item.id || item.path || ''),
      slideshow: (state?.slideshow || []).map(item => item.id || item.path || '')
    };
  });
}

async function bootBlank(page) {
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  return blendPage;
}

test('streams the exact byte boundary, ignores missing or false lengths, and rejects one byte over without writes', async ({ page }) => {
  const blendPage = await bootBlank(page);
  const payloadText = JSON.stringify(buildExperiencePayload());
  const acceptedCases = [
    { name: 'Below cap', bodyBytes: SHARED_EXPERIENCE_MAX_BYTES - 1, contentLength: null },
    { name: 'At cap', bodyBytes: SHARED_EXPERIENCE_MAX_BYTES, contentLength: 1 }
  ];

  for (const fixture of acceptedCases) {
    await installFetchFixtures(page, [{
      mode: 'body',
      body: JSON.stringify(buildExperiencePayload(fixture.name)),
      bodyBytes: fixture.bodyBytes,
      contentLength: fixture.contentLength,
      chunkSize: 64 * 1024
    }]);
    await startSharedLoad(page);
    await waitForSharedLoad(page);
    expect(await page.evaluate(() => window.__sharedLoadSucceeded)).toBeTruthy();
    await expect(blendPage.experienceSelect).toHaveValue(await blendPage.activeExperienceIdByName(fixture.name));
    expect(await page.evaluate(() => new URL(location.href).searchParams.has('storageExperience'))).toBeFalsy();
    const probe = await page.evaluate(() => window.__sharedDownloadProbe);
    expect(probe.bytesQueued).toBe(fixture.bodyBytes);
    expect(probe.sharedFiles).toBe(1);
  }

  const beforeOversize = await stateSnapshot(page);
  await installFetchFixtures(page, [{
    mode: 'body',
    body: payloadText,
    bodyBytes: SHARED_EXPERIENCE_MAX_BYTES + 1,
    contentLength: 1,
    chunkSize: 64 * 1024,
    holdOpenAfterBytes: true
  }]);
  await startSharedLoad(page);
  await waitForSharedLoad(page);

  const failure = page.locator('#toast-container .toast[role="alert"]');
  await expect(failure).toContainText(SHARED_EXPERIENCE_LIMIT_MESSAGE);
  await page.waitForFunction(() => window.__sharedDownloadProbe.readerCancelled === true);
  expect(await stateSnapshot(page)).toEqual(beforeOversize);
  expect(await page.evaluate(() => new URL(location.href).searchParams.has('storageExperience'))).toBeTruthy();
  const probe = await page.evaluate(() => window.__sharedDownloadProbe);
  expect(probe.fetchAborted).toBeTruthy();
  expect(probe.readerCancelled).toBeTruthy();
  expect(probe.bytesQueued).toBe(SHARED_EXPERIENCE_MAX_BYTES + 1);
  expect(probe.sharedFiles).toBe(0);

  await page.setViewportSize({ width: 320, height: 800 });
  const mobileBox = await failure.boundingBox();
  const mobileLayout = await failure.evaluate(node => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    textHeight: node.querySelector('span')?.getBoundingClientRect().height || 0,
    retryVisible: !!node.querySelector('button') && getComputedStyle(node.querySelector('button')).visibility !== 'hidden'
  }));
  expect(mobileBox.width).toBeLessThanOrEqual(320);
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth);
  expect(mobileLayout.textHeight).toBeGreaterThan(24);
  expect(mobileLayout.retryVisible).toBeTruthy();

  await page.setViewportSize({ width: 1366, height: 900 });
  const desktopBox = await failure.boundingBox();
  expect(desktopBox.width).toBeLessThanOrEqual(560);
  await expect(page.locator('#toast-container')).toHaveAttribute('aria-live', 'polite');
});

test('aborts stalls before headers and body, clears progress, preserves the URL, and supports retry', async ({ page }) => {
  test.setTimeout(50_000);
  const blendPage = await bootBlank(page);
  await installFetchFixtures(page, [
    { mode: 'stall-headers' },
    { mode: 'body', payload: buildExperiencePayload('Recovered after retry') }
  ]);
  const before = await stateSnapshot(page);
  await startSharedLoad(page);

  const progress = page.locator('#toast-container .toast[role="status"]');
  await expect(progress).toContainText('Downloading shared experience');
  await expect(page.locator('#toast-container')).toHaveAttribute('aria-live', 'polite');
  await waitForSharedLoad(page);
  const failure = page.locator('#toast-container .toast[role="alert"]');
  await expect(failure).toContainText(SHARED_EXPERIENCE_LIMIT_MESSAGE);
  await expect(progress).toHaveCount(0);
  expect(await stateSnapshot(page)).toEqual(before);
  expect(await page.evaluate(() => new URL(location.href).searchParams.has('storageExperience'))).toBeTruthy();
  expect(await page.evaluate(() => window.__sharedDownloadProbe.fetchAborted)).toBeTruthy();

  const retryButton = page.getByRole('button', { name: 'Retry' });
  await retryButton.focus();
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Retry');
  await retryButton.press('Enter');
  await page.waitForFunction(name => Array.from(document.querySelectorAll('#experience-select option'))
    .some(option => (option.textContent || '').trim() === name), 'Recovered after retry');
  await expect(blendPage.experienceSelect).toHaveValue(await blendPage.activeExperienceIdByName('Recovered after retry'));
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('storageExperience'));
  expect(await page.evaluate(() => window.__sharedDownloadProbe.calls)).toBe(2);
  expect(await page.evaluate(() => window.__sharedDownloadProbe.sharedFiles)).toBe(1);
  await expect(page.locator('#toast-container .toast[role="status"]')).toHaveCount(0);

  const beforeBodyStall = await stateSnapshot(page);
  await installFetchFixtures(page, [{ mode: 'stall-body' }]);
  await startSharedLoad(page);
  await expect(page.locator('#toast-container .toast[role="status"]')).toContainText('Downloading shared experience');
  await waitForSharedLoad(page);
  await expect(page.locator('#toast-container .toast[role="alert"]')).toContainText(SHARED_EXPERIENCE_LIMIT_MESSAGE);
  await page.waitForFunction(() => window.__sharedDownloadProbe.readerCancelled === true);
  expect(await stateSnapshot(page)).toEqual(beforeBodyStall);
  const bodyProbe = await page.evaluate(() => window.__sharedDownloadProbe);
  expect(bodyProbe.fetchAborted).toBeTruthy();
  expect(bodyProbe.readerCancelled).toBeTruthy();
  expect(bodyProbe.bytesQueued).toBeGreaterThan(0);
  expect(bodyProbe.sharedFiles).toBe(0);
});

test('rejects HTML and malformed JSON without mutation or sensitive logging', async ({ page }) => {
  await bootBlank(page);
  const before = await stateSnapshot(page);
  await installFetchFixtures(page, [
    { mode: 'body', body: '<html>private-html-fixture</html>', contentType: 'text/html' },
    { mode: 'body', body: 'malformed-private-fixture', contentType: 'application/json' },
    { mode: 'body', body: JSON.stringify({ schema: 'player.blend.list.v1', type: 'playlist' }) }
  ]);

  for (const privatePayloadMarker of ['private-html-fixture', 'malformed-private-fixture', 'player.blend.list.v1']) {
    await startSharedLoad(page);
    await waitForSharedLoad(page);
    await expect(page.locator('#toast-container .toast[role="alert"]')).toContainText(GENERIC_FAILURE);
    expect(await stateSnapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.__sharedDownloadProbe.sharedFiles)).toBe(0);
    const serializedLogs = await page.evaluate(() => JSON.stringify(window.Blend.log.entries()));
    expect(serializedLogs).not.toContain(privatePayloadMarker);
    expect(serializedLogs).not.toContain('private-shared-token');
    expect(serializedLogs).not.toContain('token=');
  }
});
