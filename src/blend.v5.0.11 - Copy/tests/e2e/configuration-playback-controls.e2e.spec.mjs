import { expect, test } from '@playwright/test';

test('opening configuration before first-run welcome does not cover the panel', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('blend-welcome-v4');
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.__deferredWelcomeCallbacks = [];
    window.setTimeout = (callback, delay, ...args) => {
      if (Number(delay) === 900 && typeof callback === 'function') {
        window.__deferredWelcomeCallbacks.push(() => callback(...args));
        return nativeSetTimeout(() => {}, delay);
      }
      return nativeSetTimeout(callback, delay, ...args);
    };
  });

  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.Blend?.state));
  const gear = page.locator('#config-gear');
  const panel = page.locator('#config-panel');
  const welcome = page.locator('#welcome-modal');

  await gear.click();
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => window.__deferredWelcomeCallbacks.length)).toBe(1);
  await page.evaluate(() => window.__deferredWelcomeCallbacks.splice(0).forEach(run => run()));
  await page.waitForFunction(() => window.BlendDebug?.getRecentEvents(50)
    .some(event => event.message === '[startup] welcome dialog skipped after configuration was opened'));

  await expect(panel).toBeVisible();
  await expect(welcome).toBeHidden();
  const state = await page.evaluate(() => window.BlendDebug.getStatus());
  expect(state.startup.configOpenedBeforeWelcomeDecision).toBe(true);
});

test('playback toolbar overlays the experience, reveals on hover, and stays usable', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.Blend?.state));
  await expect(page.locator('#welcome-modal')).toBeVisible();

  const gear = page.locator('#config-gear');
  const panel = page.locator('#config-panel');
  const transport = page.locator('#transport');
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#welcome-dismiss').click();

  expect(await transport.evaluate(element => element.closest('#viewport')?.id)).toBe('viewport');
  expect(await transport.evaluate(element => element.closest('#config-panel')?.id || null)).toBeNull();
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(-10, -10);
  await expect(transport).toHaveCSS('opacity', '0');
  await expect(transport).toHaveCSS('pointer-events', 'none');
  await page.locator('#btn-play').focus();
  await expect(transport).toHaveCSS('opacity', '1');
  await page.locator('#btn-play').evaluate(element => element.blur());
  await page.mouse.move(-10, -10);
  await expect(transport).toHaveCSS('opacity', '0');

  await page.locator('#viewport').hover({ position: { x: 640, y: 450 } });
  await expect(transport).toHaveCSS('opacity', '1');
  await expect(transport).toHaveCSS('pointer-events', 'auto');

  for (const id of [
    'btn-prev',
    'btn-play',
    'btn-next',
    'btn-stop',
    'btn-share',
    'blend-slider',
    'btn-fullscreen',
    'btn-mute',
    'vol-master'
  ]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }

  const slider = page.locator('#blend-slider');
  await slider.focus();
  await page.keyboard.press('End');
  await expect(page.locator('#blend-value')).toHaveText('100%');
  await expect.poll(() => page.evaluate(() => window.Blend.state.settings.opacity)).toBe(1);

  await gear.click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(gear).toHaveAttribute('aria-expanded', 'true');
  await expect(gear).toHaveAttribute('aria-label', 'Close configuration panel');
  const configDiagnostics = await page.evaluate(() => ({
    status: window.BlendDebug?.getStatus(),
    events: window.BlendDebug?.getRecentEvents(20)
  }));
  expect(configDiagnostics.status?.gear.handlerBound).toBe(true);
  expect(configDiagnostics.status?.panel.open).toBe(true);
  expect(configDiagnostics.events?.some(event =>
    event.message === '[config] gear activation settled' && event.args?.[1]?.panel?.open === true
  )).toBe(true);
  expect(await transport.evaluate(element => element.closest('#config-panel')?.id || null)).toBeNull();
  await expect(page.locator('#vol-playlist')).toBeVisible();
  await expect(page.locator('#vol-slideshow')).toBeVisible();
  await page.locator('#close-config').focus();
  const panelBox = await panel.boundingBox();
  await page.mouse.move(panelBox.x + 12, panelBox.y + 12);
  await expect(transport).toHaveCSS('opacity', '0');
  await expect(transport).toHaveCSS('pointer-events', 'none');

  await page.locator('#close-config').click();
  await expect(panel).not.toBeVisible();
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await expect(gear).toHaveAttribute('aria-label', 'Open configuration panel');
  await expect(transport).toHaveCSS('opacity', '1');

  await gear.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();

  await gear.click();
  expect(await page.locator('#transport').count()).toBe(1);
  const duplicateIds = await page.locator('[id]').evaluateAll(elements => {
    const ids = elements.map(element => element.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.Blend?.state));
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(-10, -10);
  await expect(transport).toHaveCSS('opacity', '0');
  await page.locator('#viewport').hover({ position: { x: 640, y: 450 } });
  await expect(transport).toHaveCSS('opacity', '1');
  expect(await page.locator('#transport').count()).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('touch layouts keep playback controls available without hover', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });

  try {
    const page = await context.newPage();
    await page.goto('/index.html');
    await page.waitForFunction(() => Boolean(window.Blend?.state));

    const controls = await page.locator('#transport').evaluate(element => ({
      noHover: matchMedia('(hover: none)').matches,
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      opacity: getComputedStyle(element).opacity,
      pointerEvents: getComputedStyle(element).pointerEvents
    }));

    expect(controls.noHover).toBe(true);
    expect(controls.coarsePointer).toBe(true);
    expect(controls.opacity).toBe('1');
    expect(controls.pointerEvents).toBe('auto');
  } finally {
    await context.close();
  }
});

test('playback control colors keep at least 4.5:1 contrast in both themes', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.Blend?.state));
  await page.locator('#viewport').hover({ position: { x: 640, y: 450 } });

  const measureContrast = () => page.evaluate(() => {
    const parseColor = value => value.match(/[\d.]+/g).map(Number);
    const luminance = ([red, green, blue]) => {
      const linear = [red, green, blue].map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const ratioFor = id => {
      const style = getComputedStyle(document.querySelector(`#${id}`));
      const foreground = parseColor(style.color);
      const background = parseColor(style.backgroundColor);
      const alpha = background[3] ?? 1;
      const compositedBackground = background.slice(0, 3).map(channel => channel * alpha + 255 * (1 - alpha));
      const [lighter, darker] = [luminance(foreground), luminance(compositedBackground)].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };
    return {
      play: ratioFor('btn-play'),
      regular: ratioFor('btn-prev')
    };
  });

  let ratios = await measureContrast();
  expect(ratios.play).toBeGreaterThanOrEqual(4.5);
  expect(ratios.regular).toBeGreaterThanOrEqual(4.5);

  await page.locator('#btn-play').hover();
  ratios = await measureContrast();
  expect(ratios.play).toBeGreaterThanOrEqual(4.5);

  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.locator('#viewport').hover({ position: { x: 640, y: 450 } });
  ratios = await measureContrast();
  expect(ratios.play).toBeGreaterThanOrEqual(4.5);
  expect(ratios.regular).toBeGreaterThanOrEqual(4.5);
});
