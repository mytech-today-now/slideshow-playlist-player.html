import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';

// Representative breakpoints across the required device matrix.
const VIEWPORTS = [
  { label: '4K UHD desktop', width: 3840, height: 2160 },
  { label: 'HD desktop', width: 1920, height: 1080 },
  { label: 'tablet landscape', width: 1024, height: 768 },
  { label: 'tablet portrait', width: 768, height: 1024 },
  { label: 'iPhone portrait', width: 390, height: 844 },
  { label: 'iPhone landscape', width: 844, height: 390 },
  { label: 'Android portrait', width: 360, height: 800 }
];

for (const vp of VIEWPORTS) {
  test(`layout has no horizontal overflow and the config modal fits @ ${vp.label} (${vp.width}×${vp.height})`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const blendPage = new BlendAppPage(page);
    await blendPage.boot('/index.html');

    // No horizontal page overflow at any breakpoint.
    const pageOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(pageOverflow.clientWidth + 2);

    // Config modal stays within the viewport and scrolls vertically only.
    await blendPage.openConfig();
    const panel = await page.locator('#config-panel').evaluate(node => {
      const rect = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        vw: window.innerWidth,
        vh: window.innerHeight,
        overflowX: cs.overflowX,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth
      };
    });
    expect(panel.left).toBeGreaterThanOrEqual(-2);
    expect(panel.right).toBeLessThanOrEqual(panel.vw + 2);
    expect(panel.top).toBeGreaterThanOrEqual(-2);
    expect(panel.bottom).toBeLessThanOrEqual(panel.vh + 2);
    expect(panel.overflowX).toBe('hidden');
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
  });
}
