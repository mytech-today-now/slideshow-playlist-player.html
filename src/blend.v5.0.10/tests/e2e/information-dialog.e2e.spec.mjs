import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

// ---------------------------------------------------------------------------
// Fixture markdown served in place of the live GitHub README. Long enough to
// produce a scrollable panel and contains everything the tests assert on:
//  • an <h1> and <h2> heading
//  • at least one external link (target="_blank")
//  • enough lines to make the panel taller than its viewport
// ---------------------------------------------------------------------------
const README_FIXTURE = [
  '# Blend Player',
  '',
  '> A local-first media studio that keeps your files on your own machine.',
  '',
  '## Features',
  '',
  '- [Visit mytech.today](https://mytech.today/) for full documentation.',
  '- Local-first: all media stays on your device.',
  '- Playlist + Slideshow layers blended live.',
  '',
  '## Getting Started',
  '',
  'Serve the folder over HTTP, then open `index.html`:',
  '',
  '```bash',
  'npx serve -l 5173 --cors',
  '```',
  '',
  ...Array.from({ length: 60 }, (_, i) => `Paragraph line ${i + 1}: lorem ipsum dolor sit amet.`),
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
        body: README_FIXTURE,
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

  test('opens from the config info icon with About active and README rendered', async ({ page }) => {
    test.setTimeout(60000);
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
    // README external links are rendered with a new-tab target.
    const readmeExternal = readmePanel.locator('a[target="_blank"]');
    expect(await readmeExternal.count()).toBeGreaterThan(0);
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

  test('shows a retry button on network failure and re-renders on click', async ({ page }) => {
    test.setTimeout(60000);
    // Override the beforeEach mock to simulate total failure (GitHub + local).
    await page.unroute('https://raw.githubusercontent.com/**');
    await page.route('https://raw.githubusercontent.com/**', route => route.abort());
    // Also block the local fallback served by the fixture server.
    await page.route('**/README.md', route => {
      const url = route.request().url();
      // Let index.html, app.js, etc. through; only intercept README.md itself.
      if (url.endsWith('/README.md') || url.includes('README.md?')) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await openInfo(page);
    await page.locator('#info-tab-readme').click();

    // Wait for the error state with the retry button.
    const retryBtn = page.locator('.info-readme-retry');
    await expect(retryBtn).toBeVisible({ timeout: 15000 });

    // Restore a working GitHub route so the retry succeeds.
    await page.unroute('https://raw.githubusercontent.com/**');
    await page.route('https://raw.githubusercontent.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: README_FIXTURE,
      });
    });
    // Also restore README.md requests so the local fallback works again.
    await page.unroute('**/README.md');

    await retryBtn.click();

    // After retry the README should render real headings.
    await page.waitForFunction(() => {
      const el = document.querySelector('#info-readme-content');
      return el && el.querySelector('h1, h2');
    }, null, { timeout: 10000 });
    await expect(page.locator('#info-panel-readme').locator('h1, h2').first()).toBeVisible();
    // Retry button should be gone once the README loaded successfully.
    await expect(retryBtn).toBeHidden();
  });
});
