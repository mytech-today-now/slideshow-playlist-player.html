import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

// ---------------------------------------------------------------------------
// Fixture markdown served in place of the live GitHub README. Long enough to
// produce a scrollable panel and contains everything the tests assert on:
//  • an <h1> and <h2> heading
//  • at least one external link (target="_blank")
//  • enough lines to make the panel taller than its viewport
// ---------------------------------------------------------------------------
const ONLINE_README_FIXTURE = [
  '# Blend Player Online',
  '',
  '- **Runtime app version string in code/UI:** `5.1.0`',
  '',
  'Current online guide marker.',
  '',
  ...Array.from({ length: 60 }, (_, i) => `Online paragraph line ${i + 1}: consectetur adipiscing elit.`),
].join('\n');

test.describe('Configuration dialog', () => {
  test('opens centered, scrolls vertically only, and traps focus', async ({ page }) => {
    test.setTimeout(60000);
    const blendPage = new BlendAppPage(page);
    await blendPage.boot('/index.html');
    await blendPage.openConfig();

    const panel = page.locator('#config-panel');
    await expect(panel).toHaveClass(/open/);

    const metrics = await panel.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth
      };
    });

    // Centered within a small tolerance.
    expect(Math.abs(metrics.centerX - metrics.vw / 2)).toBeLessThan(8);
    expect(Math.abs(metrics.centerY - metrics.vh / 2)).toBeLessThan(8);
    // ~90% of the viewport.
    expect(metrics.width).toBeGreaterThan(metrics.vw * 0.82);
    expect(metrics.height).toBeGreaterThan(metrics.vh * 0.82);
    // Vertical scroll only — no horizontal shift.
    expect(metrics.overflowY).toBe('auto');
    expect(metrics.overflowX).toBe('hidden');
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);

    // Focus moved into the dialog on open.
    const focusInside = await page.evaluate(() =>
      document.querySelector('#config-panel')?.contains(document.activeElement));
    expect(focusInside).toBe(true);

    // Esc closes and returns focus to the gear.
    await page.keyboard.press('Escape');
    await expect(panel).not.toHaveClass(/open/);
  });
});

test.describe('Information dialog', () => {
  // -------------------------------------------------------------------------
  // Intercept GitHub raw README requests before every test so the suite is
  // hermetic (no live network calls) and runs at consistent speed.
  // -------------------------------------------------------------------------
  test.beforeEach(async ({ page }) => {
    await page.route('https://raw.githubusercontent.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: ONLINE_README_FIXTURE,
      });
    });
  });

  async function openInfo(page) {
    const blendPage = new BlendAppPage(page);
    await blendPage.boot('/index.html');
    await blendPage.openConfig();
    await page.locator('#open-info').click();
    await expect(page.locator('#info-modal')).toBeVisible();
    return blendPage;
  }

  test('opens with the installed guide by default and loads online docs only when selected', async ({ page }) => {
    test.setTimeout(60000);
    const onlineRequests = [];
    page.on('request', request => {
      if (request.url().startsWith('https://raw.githubusercontent.com/')) onlineRequests.push(request.url());
    });
    await openInfo(page);

    const aboutPanel = page.locator('#info-panel-about');
    const readmePanel = page.locator('#info-panel-readme');
    await expect(aboutPanel).toBeVisible();
    await expect(readmePanel).toBeHidden();
    await expect(page.locator('#info-tab-about')).toHaveAttribute('aria-selected', 'true');

    // About marketing content + external link that opens in a new tab.
    await expect(aboutPanel).toContainText('myTech.Today');
    const aboutLink = aboutPanel.locator('a[href="https://mytech.today/"]').first();
    await expect(aboutLink).toHaveAttribute('target', '_blank');
    await expect(aboutLink).toHaveAttribute('rel', /noopener/);

    // Hero is centered and the CTA pill text is legible (white on accent),
    // not pink-on-pink (regression guard for the markdown `a` color override).
    const hero = await page.locator('.about-hero').evaluate(node => {
      const ctaEl = node.querySelector('.about-link-btn');
      const tagEl = node.querySelector('.about-tagline');
      const center = el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); };
      return {
        ctaText: ctaEl.textContent.trim(),
        ctaColor: getComputedStyle(ctaEl).color,
        heroCenter: center(node),
        ctaCenter: center(ctaEl),
        tagCenter: center(tagEl)
      };
    });
    expect(hero.ctaText).toContain('Visit mytech.today');
    expect(hero.ctaColor).toBe('rgb(255, 255, 255)');
    expect(Math.abs(hero.ctaCenter - hero.heroCenter)).toBeLessThan(2);
    expect(Math.abs(hero.tagCenter - hero.heroCenter)).toBeLessThan(2);

    // Switch to the README tab — markdown renders to real HTML from fixture.
    await page.locator('#info-tab-readme').click();
    await expect(readmePanel).toBeVisible();
    await expect(aboutPanel).toBeHidden();
    await expect(page.locator('#info-tab-readme')).toHaveAttribute('aria-selected', 'true');
    await page.waitForFunction(() => {
      const el = document.querySelector('#info-readme-content');
      return el && el.querySelector('h1, h2');
    }, null, { timeout: 8000 });
    await expect(readmePanel.locator('h1, h2').first()).toBeVisible();
    await expect(readmePanel).toContainText('Current Version Information');
    await expect(page.locator('#info-readme-source-status'))
      .toHaveAttribute('data-source', 'local');
    await expect(page.locator('#info-readme-source-status'))
      .toHaveAttribute('data-version', '5.0.11');
    await expect(page.locator('#info-readme-source-status'))
      .toHaveAttribute('data-version-matches', 'true');
    expect(onlineRequests).toHaveLength(0);

    // README external links are rendered with a new-tab target.
    const readmeExternal = readmePanel.locator('a[target="_blank"]');
    expect(await readmeExternal.count()).toBeGreaterThan(0);

    await page.locator('#info-readme-source').selectOption('online');
    await expect(readmePanel).toContainText('Current online guide marker');
    await expect(page.locator('#info-readme-source-status')).toContainText('Current online documentation');
    await expect(page.locator('#info-readme-source-status')).toHaveAttribute('data-version', '5.1.0');
    await expect(page.locator('#info-readme-source-status')).toHaveAttribute('data-version-matches', 'false');
    expect(onlineRequests).toHaveLength(1);
  });

  test('each tab scrolls independently and remembers its position', async ({ page }) => {
    test.setTimeout(60000);
    await openInfo(page);

    // Go to README and scroll down.
    await page.locator('#info-tab-readme').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('#info-panel-readme');
      return el && el.scrollHeight > el.clientHeight + 50;
    }, null, { timeout: 8000 });
    await page.locator('#info-panel-readme').evaluate(el => { el.scrollTop = 400; });
    const readmeScroll = await page.locator('#info-panel-readme').evaluate(el => el.scrollTop);
    expect(readmeScroll).toBeGreaterThan(100);

    // Switch away to About (scrollTop 0) and back — README position restored.
    await page.locator('#info-tab-about').click();
    await expect(page.locator('#info-panel-about')).toBeVisible();
    await page.locator('#info-tab-readme').click();
    await expect(page.locator('#info-panel-readme')).toBeVisible();
    await page.waitForTimeout(150);
    const restored = await page.locator('#info-panel-readme').evaluate(el => el.scrollTop);
    expect(Math.abs(restored - readmeScroll)).toBeLessThan(40);

    // Close and reopen: persisted via localStorage across dialog sessions.
    await page.keyboard.press('Escape');
    await expect(page.locator('#info-modal')).toBeHidden();
    const stored = await page.evaluate(() => localStorage.getItem('blend-info-scroll-v1'));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored).readme).toBeGreaterThan(100);

    await page.locator('#open-info').click();
    await expect(page.locator('#info-modal')).toBeVisible();
    await page.waitForTimeout(150);
    const reopened = await page.locator('#info-panel-readme').evaluate(el => el.scrollTop).catch(() => 0);
    // Active tab is remembered (README) and its scroll position restored.
    expect(await page.locator('#info-tab-readme').getAttribute('aria-selected')).toBe('true');
    expect(reopened).toBeGreaterThan(100);

    const localSourceScroll = await page.locator('#info-panel-readme').evaluate(el => el.scrollTop);
    await page.locator('#info-readme-source').selectOption('online');
    await expect(page.locator('#info-readme-content')).toContainText('Current online guide marker');
    await page.locator('#info-panel-readme').evaluate(el => { el.scrollTop = 260; });
    const onlineSourceScroll = await page.locator('#info-panel-readme').evaluate(el => el.scrollTop);

    await page.locator('#info-readme-source').selectOption('local');
    await expect(page.locator('#info-readme-content')).toContainText('Current Version Information');
    await page.waitForTimeout(100);
    const restoredLocalSourceScroll = await page.locator('#info-panel-readme').evaluate(el => el.scrollTop);
    expect(Math.abs(restoredLocalSourceScroll - localSourceScroll)).toBeLessThan(40);
    await expect(page.locator('#info-tab-readme')).toHaveAttribute('aria-selected', 'true');

    await page.locator('#info-readme-source').selectOption('online');
    await expect(page.locator('#info-readme-content')).toContainText('Current online guide marker');
    await page.waitForTimeout(100);
    const restoredOnlineSourceScroll = await page.locator('#info-panel-readme').evaluate(el => el.scrollTop);
    expect(Math.abs(restoredOnlineSourceScroll - onlineSourceScroll)).toBeLessThan(40);
  });

  test('is dismissible and returns focus to the info button', async ({ page }) => {
    test.setTimeout(60000);
    await openInfo(page);
    // Focus is inside the dialog.
    const focusInside = await page.evaluate(() =>
      document.querySelector('#info-modal')?.contains(document.activeElement));
    expect(focusInside).toBe(true);

    await page.locator('#info-close').click();
    await expect(page.locator('#info-modal')).toBeHidden();
    const activeId = await page.evaluate(() => document.activeElement?.id || '');
    expect(activeId).toBe('open-info');
  });

  test('arrow keys move between tabs (keyboard accessible)', async ({ page }) => {
    test.setTimeout(60000);
    await openInfo(page);
    await page.locator('#info-tab-about').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#info-tab-readme')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#info-tab-about')).toHaveAttribute('aria-selected', 'true');
  });

  test('documentation source has an accessible name, visible focus, and keyboard selection', async ({ page }) => {
    test.setTimeout(60000);
    await openInfo(page);
    await page.locator('#info-tab-readme').click();
    const source = page.getByLabel('Documentation source');
    await expect(source).toBeVisible();
    await source.focus();
    await source.press('ArrowDown');
    await source.press('Enter');
    await expect(source).toHaveValue('online');
    await expect(page.locator('#info-readme-source-status')).toContainText('Current online documentation');
    const focusState = await source.evaluate(node => ({
      focused: document.activeElement === node,
      focusVisible: node.matches(':focus-visible'),
      outlineStyle: getComputedStyle(node).outlineStyle,
      outlineWidth: getComputedStyle(node).outlineWidth
    }));
    expect(focusState.focused).toBe(true);
    expect(focusState.focusVisible).toBe(true);
    expect(focusState.outlineStyle).not.toBe('none');
    expect(parseFloat(focusState.outlineWidth)).toBeGreaterThan(0);
  });

  test('an older online cache never replaces the installed guide by default', async ({ page }) => {
    test.setTimeout(60000);
    const cachedGuide = [
      '# Cached Online Guide',
      '',
      '- **Runtime app version string in code/UI:** `5.0.10`',
      '',
      'Cached old online marker.'
    ].join('\n');
    await page.addInitScript(({ cacheKey, markdown }) => {
      localStorage.setItem(cacheKey, JSON.stringify({
        source: 'online',
        markdown,
        version: '5.0.10',
        fetchedAt: Date.now() - 5000
      }));
    }, { cacheKey: 'blend-readme-online-cache-v2', markdown: cachedGuide });
    const onlineRequests = [];
    page.on('request', request => {
      if (request.url().startsWith('https://raw.githubusercontent.com/')) onlineRequests.push(request.url());
    });

    await openInfo(page);
    await page.locator('#info-tab-readme').click();
    await expect(page.locator('#info-readme-content')).toContainText('Current Version Information');
    expect(onlineRequests).toHaveLength(0);

    await page.locator('#info-readme-source').selectOption('online');
    await expect(page.locator('#info-readme-content')).toContainText('Cached old online marker');
    await expect(page.locator('#info-readme-source-status')).toContainText('Current online documentation');
    await expect(page.locator('#info-readme-source-status')).toHaveAttribute('data-version', '5.0.10');
    await expect(page.locator('#info-readme-source-status')).toContainText('cached');
    expect(onlineRequests).toHaveLength(0);
  });

  test('an expired online cache is fetched only after selecting online documentation', async ({ page }) => {
    test.setTimeout(60000);
    await page.addInitScript(cacheKey => {
      localStorage.setItem(cacheKey, JSON.stringify({
        source: 'online',
        markdown: '# Expired\n\n- **Runtime app version string in code/UI:** `5.0.9`',
        version: '5.0.9',
        fetchedAt: Date.now() - 60 * 60 * 1000 - 1
      }));
    }, 'blend-readme-online-cache-v2');
    const onlineRequests = [];
    page.on('request', request => {
      if (request.url().startsWith('https://raw.githubusercontent.com/')) onlineRequests.push(request.url());
    });

    await openInfo(page);
    expect(onlineRequests).toHaveLength(0);
    await page.locator('#info-tab-readme').click();
    await expect(page.locator('#info-readme-content')).toContainText('Current Version Information');
    await page.locator('#info-readme-source').selectOption('online');
    await expect(page.locator('#info-readme-content')).toContainText('Current online guide marker');
    await expect(page.locator('#info-readme-source-status')).toHaveAttribute('data-version', '5.1.0');
    await expect(page.locator('#info-readme-source-status')).toContainText('fetched');
    expect(onlineRequests).toHaveLength(1);
  });

  test('keeps installed help visible and focused during a delayed online refresh', async ({ page }) => {
    test.setTimeout(60000);
    await page.unroute('https://raw.githubusercontent.com/**');
    let markRemoteStarted;
    const remoteStarted = new Promise(resolve => { markRemoteStarted = resolve; });
    await page.route('https://raw.githubusercontent.com/**', async route => {
      markRemoteStarted();
      await new Promise(resolve => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: ONLINE_README_FIXTURE,
      });
    });

    await openInfo(page);
    await page.locator('#info-tab-readme').click();
    const content = page.locator('#info-readme-content');
    const panel = page.locator('#info-panel-readme');
    await expect(content).toContainText('Current Version Information');
    const source = page.getByLabel('Documentation source');
    await source.focus();
    const localScrollTop = await panel.evaluate(node => {
      node.scrollTop = Math.min(180, node.scrollHeight - node.clientHeight);
      return node.scrollTop;
    });
    await page.evaluate(() => {
      const target = document.querySelector('#info-readme-content');
      window.__infoReadmeEmptyCommits = [];
      new MutationObserver(() => {
        if (!target.textContent.trim()) window.__infoReadmeEmptyCommits.push(true);
      }).observe(target, { childList: true, subtree: true, characterData: true });
    });

    await source.press('ArrowDown');
    await source.press('Enter');
    await remoteStarted;

    // This assertion must pass before the delayed remote response is released.
    await expect(content).toContainText('Current Version Information', { timeout: 500 });
    await expect(page.locator('#info-readme-content .info-readme-status')).toHaveCount(0);
    await expect(page.locator('#info-readme-source-status'))
      .toContainText('Checking current online documentation');
    await expect(page.locator('#info-tab-readme')).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('info-readme-source');
    expect(await panel.evaluate(node => node.scrollTop)).toBe(localScrollTop);

    await expect(content.locator('h1')).toHaveText('Blend Player Online');
    await expect(content).toContainText('Current online guide marker');
    await expect(content).not.toContainText('Current Version Information');
    await expect(page.locator('#info-readme-source-status')).toHaveAttribute('data-source', 'online');
    expect(await page.evaluate(() => window.__infoReadmeEmptyCommits)).toEqual([]);
  });

  test('source selector remains usable across the responsiveness matrix and scaled text', async ({ page }) => {
    test.setTimeout(90000);
    await openInfo(page);
    await page.locator('#info-tab-readme').click();
    const source = page.getByLabel('Documentation source');
    await expect(source).toBeVisible();

    const viewports = [
      { width: 3840, height: 2160 },
      { width: 1920, height: 1080 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 360, height: 800 }
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(source).toBeVisible();
      const metrics = await page.evaluate(() => {
        const panel = document.querySelector('#info-panel-readme');
        const select = document.querySelector('#info-readme-source');
        const label = document.querySelector('#info-readme-source-status');
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          panelWidth: panel.clientWidth,
          selectWidth: select.getBoundingClientRect().width,
          selectHeight: select.getBoundingClientRect().height,
          requiredTouchHeight: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--touch')),
          labelWidth: label.getBoundingClientRect().width,
          labelScrollWidth: label.scrollWidth,
          labelClientWidth: label.clientWidth
        };
      });
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
      expect(metrics.selectWidth).toBeLessThanOrEqual(metrics.panelWidth + 1);
      expect(metrics.selectHeight).toBeGreaterThanOrEqual(metrics.requiredTouchHeight - 1);
      expect(metrics.labelWidth).toBeLessThanOrEqual(metrics.panelWidth + 1);
      expect(metrics.labelScrollWidth).toBeLessThanOrEqual(metrics.labelClientWidth + 1);

      await source.selectOption('local');
      await source.focus();
      await source.press('ArrowDown');
      await source.press('Enter');
      await expect(source).toHaveValue('online');
      await expect(page.locator('#info-readme-source-status')).toContainText('Current online documentation');
    }

    await page.evaluate(() => { document.body.style.fontSize = '24px'; });
    const scaledMetrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      selectorHeight: document.querySelector('#info-readme-source').getBoundingClientRect().height,
      statusWidth: document.querySelector('#info-readme-source-status').clientWidth,
      statusScrollWidth: document.querySelector('#info-readme-source-status').scrollWidth
    }));
    expect(scaledMetrics.documentWidth).toBeLessThanOrEqual(scaledMetrics.viewportWidth + 1);
    expect(scaledMetrics.selectorHeight).toBeGreaterThanOrEqual(44);
    expect(scaledMetrics.statusScrollWidth).toBeLessThanOrEqual(scaledMetrics.statusWidth + 1);
  });

  test('documentation source remains operable by touch on a narrow viewport', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:4191',
      viewport: { width: 360, height: 800 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: ONLINE_README_FIXTURE,
    }));
    try {
      await openInfo(page);
      await page.locator('#info-tab-readme').tap();
      const source = page.getByLabel('Documentation source');
      await expect(source).toBeVisible();
      const height = await source.evaluate(node => node.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(40);
      await source.tap();
      await source.selectOption('online');
      await expect(page.locator('#info-readme-content')).toContainText('Current online guide marker');
    } finally {
      await context.close();
    }
  });

  test('installed README remains available when the app shell is offline', async ({ page, context }) => {
    test.setTimeout(90000);
    await page.unroute('https://raw.githubusercontent.com/**');
    const onlineRequests = [];
    page.on('request', request => {
      if (request.url().startsWith('https://raw.githubusercontent.com/')) onlineRequests.push(request.url());
    });

    const blendPage = new BlendAppPage(page);
    await blendPage.boot('/index.html');
    const serviceWorkerUrl = await page.evaluate(() => new URL('./service-worker.js', location.href).href);
    await page.waitForFunction(expected => (
      navigator.serviceWorker?.controller?.scriptURL === expected
    ), serviceWorkerUrl, { timeout: 20000 });
    await page.waitForFunction(async () => {
      const config = window.BlendPwaConfig;
      if (!config?.CACHE_NAMES?.docs) return false;
      const cache = await caches.open(config.CACHE_NAMES.docs);
      const readmeUrl = new URL('./README.md', location.href).href;
      return Boolean(await cache.match(readmeUrl));
    }, null, { timeout: 20000 });

    await context.setOffline(true);
    try {
      await blendPage.openConfig();
      await page.locator('#open-info').click();
      await expect(page.locator('#info-modal')).toBeVisible();
      await page.locator('#info-tab-readme').click();
      await expect(page.locator('#info-readme-source-status'))
        .toHaveAttribute('data-version', '5.0.11');
      await expect(page.locator('#info-readme-source-status'))
        .toHaveAttribute('data-version-matches', 'true');
      await expect(page.locator('#info-readme-content')).toContainText('Current Version Information');
      expect(onlineRequests).toHaveLength(0);
    } finally {
      await context.setOffline(false);
    }
  });

  test('keeps the installed guide after online failure and retries online on user action', async ({ page }) => {
    test.setTimeout(60000);
    // Fail online requests while keeping the installed guide available.
    await page.unroute('https://raw.githubusercontent.com/**');
    await page.route('https://raw.githubusercontent.com/**', route => route.abort());

    await openInfo(page);
    await page.locator('#info-tab-readme').click();
    await page.locator('#info-readme-source').selectOption('online');

    const fallbackNotice = page.getByRole('status').filter({
      hasText: 'Offline or online documentation is unavailable; this local guide remains available.'
    });
    await expect(fallbackNotice).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#info-readme-content')).toContainText('Current Version Information');
    await expect(page.locator('#info-readme-source')).toHaveValue('local');

    // Retry explicitly after restoring the online source.
    await page.unroute('https://raw.githubusercontent.com/**');
    await page.route('https://raw.githubusercontent.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: ONLINE_README_FIXTURE,
      });
    });

    const retry = page.getByRole('button', { name: 'Retry online documentation' });
    await retry.focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('#info-readme-content')).toContainText('Current online guide marker');
    await expect(page.locator('#info-readme-source')).toHaveValue('online');
    await expect(page.locator('#info-readme-source-status')).toHaveAttribute('data-version', '5.1.0');
    await expect(page.locator('.info-readme-retry-online')).toHaveCount(0);
  });
});
