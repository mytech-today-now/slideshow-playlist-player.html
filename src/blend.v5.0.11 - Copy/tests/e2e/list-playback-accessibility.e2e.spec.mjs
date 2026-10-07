import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import { createRunSuffix } from './support/experience-lifecycle-utils.mjs';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

async function buildPlaybackExperience(page, testInfo) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const blendPage = new BlendAppPage(page);
  await blendPage.boot('/index.html');
  await blendPage.createExperience(`Current row ${createRunSuffix(testInfo)}`);
  await blendPage.dropListFile('playlist', {
    name: 'playlist.txt',
    text: `${FIXTURE_ORIGIN}/samples/nyc-01.mp4\n`,
    expectedMinimumCount: 1
  });
  await blendPage.dropListFile('slideshow', {
    name: 'slideshow.txt',
    text: `${FIXTURE_ORIGIN}/samples/IL.jpeg\n${FIXTURE_ORIGIN}/samples/blotter-01.png\n`,
    expectedMinimumCount: 2
  });
  await page.evaluate(() => {
    const { state } = window.Blend;
    const firstRef = state.playlist[0];
    const firstItem = state.library.get(firstRef.id);
    const secondId = `current-row-second-${Date.now()}`;
    state.library.set(secondId, {
      ...firstItem,
      id: secondId,
      name: 'Second playlist item.mp4',
      pathHint: 'Second playlist item.mp4'
    });
    state.playlist.push({
      ...firstRef,
      id: secondId,
      name: 'Second playlist item.mp4',
      path: 'Second playlist item.mp4'
    });
    state.playlist.push({
      id: 'unavailable-playback-row',
      name: 'Unavailable playlist item.mp4',
      path: 'missing/playlist-item.mp4',
      type: 'video',
      available: false,
      reason: 'Permission denied'
    });
    for (const ref of state.slideshow) ref.displayDuration = 120;
    window.Blend.renderListEditor();
  });
  await blendPage.closeConfig();
  return blendPage;
}

async function expectCurrentRow(page, which, index) {
  const rows = page.locator('#list-editor .list-item[aria-current="true"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-idx', String(index));
  await expect.poll(() => page.evaluate(expected => window.Blend.state.ui.activeList === expected, which)).toBe(true);
}

async function openList(blendPage, which) {
  await blendPage.switchListTab(which);
}

test('exposes one current playback row per layer through navigation, stop, selection, and virtualization', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildPlaybackExperience(page, testInfo);

  await page.locator('#btn-play').click();
  await page.waitForFunction(() => window.Blend?.transport === 'playing', null, { timeout: 10000 });

  await openList(blendPage, 'playlist');
  await expectCurrentRow(page, 'playlist', 0);
  const currentPlaylistRow = page.locator('#list-editor .list-item[data-idx="0"]');
  await expect(currentPlaylistRow).not.toHaveAttribute('aria-selected');
  await expect(currentPlaylistRow.locator('.list-item-select')).toHaveAttribute('aria-pressed', 'false');

  const secondPlaylistRow = page.locator('#list-editor .list-item[data-idx="1"]');
  await secondPlaylistRow.locator('.list-item-select').click();
  await expect(secondPlaylistRow.locator('.list-item-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(secondPlaylistRow).not.toHaveAttribute('aria-current');
  await expectCurrentRow(page, 'playlist', 0);

  const unavailableRow = page.locator('#list-editor .list-item[data-idx="2"]');
  await expect(unavailableRow).toHaveAttribute('aria-describedby', /list-playlist-item-2-availability/);
  await expect(page.locator('#list-playlist-item-2-availability-details')).toHaveText('Permission denied');
  await expect(unavailableRow).not.toHaveAttribute('aria-current');

  await blendPage.closeConfig();
  await page.locator('#btn-next').click();
  await expect.poll(() => page.evaluate(() => window.Blend.state.runtime.playlistIndex)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.Blend.state.runtime.slideshowIndex)).toBe(1);
  await openList(blendPage, 'playlist');
  await expectCurrentRow(page, 'playlist', 1);
  await openList(blendPage, 'slideshow');
  await expectCurrentRow(page, 'slideshow', 1);

  await blendPage.closeConfig();
  await page.locator('#btn-prev').click();
  await expect.poll(() => page.evaluate(() => window.Blend.state.runtime.playlistIndex)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.Blend.state.runtime.slideshowIndex)).toBe(0);
  await openList(blendPage, 'playlist');
  await expectCurrentRow(page, 'playlist', 0);
  await openList(blendPage, 'slideshow');
  await expectCurrentRow(page, 'slideshow', 0);

  await page.evaluate(() => {
    const { state } = window.Blend;
    for (let index = 0; index < 45; index++) {
      state.playlist.push({
        id: `virtual-unavailable-${index}`,
        name: `Unavailable ${index}.mp4`,
        path: `missing/${index}.mp4`,
        type: 'video',
        available: false,
        reason: 'Missing media'
      });
    }
    window.Blend.renderListEditor();
  });
  await openList(blendPage, 'playlist');
  const listEditor = page.locator('#list-editor');
  await listEditor.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.locator('#list-editor .list-item').count()).toBeLessThan(25);
  await expect(page.locator('#list-editor .list-item[aria-current="true"]')).toHaveCount(0);
  await listEditor.evaluate(element => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expectCurrentRow(page, 'playlist', 0);

  await blendPage.closeConfig();
  await page.locator('#btn-play').click();
  await page.waitForFunction(() => window.Blend?.transport === 'paused', null, { timeout: 5000 });
  await openList(blendPage, 'playlist');
  await expectCurrentRow(page, 'playlist', 0);
  await blendPage.closeConfig();
  await page.locator('#btn-play').click();
  await page.waitForFunction(() => window.Blend?.transport === 'playing', null, { timeout: 5000 });
  await blendPage.closeConfig();
  await page.locator('#btn-stop').click();
  await page.waitForFunction(() => window.Blend?.transport === 'stopped', null, { timeout: 5000 });
  await openList(blendPage, 'playlist');
  await expect(page.locator('#list-editor .list-item[aria-current="true"]')).toHaveCount(0);
  await openList(blendPage, 'slideshow');
  await expect(page.locator('#list-editor .list-item[aria-current="true"]')).toHaveCount(0);
});

test('experience switch clears the old playback marker and leaves new rows unmarked', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blendPage = await buildPlaybackExperience(page, testInfo);
  await page.locator('#btn-play').click();
  await page.waitForFunction(() => window.Blend?.transport === 'playing', null, { timeout: 10000 });
  await openList(blendPage, 'playlist');
  await expectCurrentRow(page, 'playlist', 0);

  await blendPage.createExperience(`Switched target ${createRunSuffix(testInfo)}`);
  await page.evaluate(() => {
    const { state, renderListEditor } = window.Blend;
    state.playlist = [{
      id: 'switched-unavailable-playlist',
      name: 'Unavailable target playlist item.mp4',
      path: 'missing/target-playlist-item.mp4',
      type: 'video',
      available: false,
      reason: 'Target item is unavailable'
    }];
    state.slideshow = [{
      id: 'switched-unavailable-slideshow',
      name: 'Unavailable target slideshow item.png',
      path: 'missing/target-slideshow-item.png',
      type: 'image',
      available: false,
      reason: 'Target item is unavailable'
    }];
    state.runtime.playlistIndex = 0;
    state.runtime.slideshowIndex = 0;
    state.ui.activeList = 'playlist';
    renderListEditor();
  });
  await expect(page.locator('#list-editor .list-item')).toHaveCount(1);
  await expect(page.locator('#list-editor .list-item[aria-current="true"]')).toHaveCount(0);
  await openList(blendPage, 'slideshow');
  await expect(page.locator('#list-editor .list-item')).toHaveCount(1);
  await expect(page.locator('#list-editor .list-item[aria-current="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.Blend.transport)).toBe('stopped');
});

// Manual screen-reader review is outstanding. These DOM assertions verify
// exposed semantics; they do not claim a human NVDA/VoiceOver audit.
