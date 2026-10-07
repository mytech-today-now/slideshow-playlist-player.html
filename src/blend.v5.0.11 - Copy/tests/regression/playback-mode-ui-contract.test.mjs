import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeLayerPlaybackMode,
  normalizeLayerPlaybackSettings,
  selectNextLayerIndex,
  selectPreviousLayerIndex
} from '../../playback-mode.js';

const ROOT = new URL('../../', import.meta.url);

/**
 * Playback and transition QA matrix (manual + E2E):
 * 1. Playback modes:
 *    - Loop: single experience restarts from index 0 for playlist + slideshow.
 *    - Stop at End: playback halts and transport returns to play icon.
 *    - Go to Next Experience: advances to next experience; optional catalog loop.
 * 2. Transition coverage:
 *    - Validate each transition id individually in enabled list.
 *    - Validate mixed pools with randomize on/off and weighted sliders.
 * 3. Heavy throttling:
 *    - Max heavy effects in row = 0, 1, 2 under random pools.
 * 4. Overlap values:
 *    - 0ms, 10ms, 50ms, 250ms, 500ms, 1000ms, 3000ms.
 * 5. Edge cases:
 *    - Empty playlist/slideshow, single item lists, rapid mode toggles.
 *    - Sleep/resume or tab backgrounding, low-memory devices.
 * 6. Performance:
 *    - Verify FPS monitor updates and auto-quality downgrade/upgrade.
 */

test('index settings include playback/transition controls', async () => {
  const html = await readFile(new URL('index.html', ROOT), 'utf8');
  assert.equal(html.includes('id="experience-playback-mode"'), true);
  assert.match(html, /<option value="loop" selected>Loop<\/option>/);
  assert.match(html, /<option value="stop">Stop at End<\/option>/);
  assert.match(html, /<option value="next-experience">Go to Next Experience<\/option>/);
  assert.match(html, /<label for="playlist-order">Playlist order<\/label>/);
  assert.match(html, /<label for="slideshow-order">Slideshow order<\/label>/);
  assert.match(html, /<option value="sequential" selected>Sequential<\/option>/);
  assert.match(html, /<option value="random">Random<\/option>/);
  assert.equal(html.includes('id="transition-overlap"'), true);
  assert.equal(html.includes('id="enabled-transitions-list"'), true);
  assert.equal(html.includes('id="quality-auto-adjust"'), true);
  assert.equal(html.includes('id="show-transition-fps"'), true);
});

test('layer mode normalization keeps old and invalid settings sequential', () => {
  assert.equal(normalizeLayerPlaybackMode('sequential'), 'sequential');
  assert.equal(normalizeLayerPlaybackMode('random'), 'random');
  assert.deepEqual(normalizeLayerPlaybackSettings(), {
    playbackModePlaylist: 'sequential',
    playbackModeSlideshow: 'sequential'
  });
  assert.deepEqual(normalizeLayerPlaybackSettings({ playbackModePlaylist: 'random' }), {
    playbackModePlaylist: 'random',
    playbackModeSlideshow: 'sequential'
  });
  assert.deepEqual(normalizeLayerPlaybackSettings({
    playbackModePlaylist: 'shuffle-ish',
    playbackModeSlideshow: null
  }), {
    playbackModePlaylist: 'sequential',
    playbackModeSlideshow: 'sequential'
  });
});

test('sequential and random next decisions handle empty and one-item lists', () => {
  assert.equal(selectNextLayerIndex({ mode: 'sequential', currentIndex: 0, playableIndices: [0, 2] }), 2);
  assert.equal(selectNextLayerIndex({ mode: 'sequential', currentIndex: 2, playableIndices: [0, 2] }), -1);
  assert.equal(selectNextLayerIndex({ mode: 'random', currentIndex: 0, playableIndices: [0, 2], random: () => 0 }), 2);
  assert.equal(selectNextLayerIndex({ mode: 'random', currentIndex: 4, playableIndices: [0], random: () => 0.8 }), 0);
  assert.equal(selectNextLayerIndex({ mode: 'random', currentIndex: 0, playableIndices: [], random: () => 0 }), -1);

  for (const sample of [0, 0.25, 0.75, 0.999]) {
    const choice = selectNextLayerIndex({ mode: 'random', currentIndex: 1, playableIndices: [0, 1, 2], random: () => sample });
    assert.ok([0, 2].includes(choice), `random choice ${choice} excludes current index`);
  }
});

test('random previous follows the most recent playable history entry', () => {
  assert.deepEqual(selectPreviousLayerIndex({
    currentIndex: 2,
    playableIndices: [0, 2],
    history: [0, 1]
  }), { index: 0, historyIndex: 0 });
  assert.deepEqual(selectPreviousLayerIndex({
    currentIndex: 0,
    playableIndices: [0],
    history: [0]
  }), { index: 0, historyIndex: 0 });
  assert.deepEqual(selectPreviousLayerIndex({
    currentIndex: 2,
    playableIndices: [0, 2],
    history: []
  }), { index: 0, historyIndex: -1 });
  assert.deepEqual(selectPreviousLayerIndex({
    currentIndex: 2,
    playableIndices: [0, 2],
    history: [0]
  }), { index: 0, historyIndex: 0 });
  assert.deepEqual(selectPreviousLayerIndex({ playableIndices: [], history: [0] }), {
    index: -1,
    historyIndex: -1
  });
});

test('app runtime includes completion modes and transition hooks', async () => {
  const app = await readFile(new URL('app.js', ROOT), 'utf8');
  assert.equal(app.includes('EXPERIENCE_PLAYBACK_MODE_LOOP'), true);
  assert.equal(app.includes('EXPERIENCE_PLAYBACK_MODE_STOP'), true);
  assert.equal(app.includes('EXPERIENCE_PLAYBACK_MODE_NEXT'), true);
  assert.equal(app.includes('handleExperienceCompletion'), true);
  assert.equal(app.includes('transitionOverlapMs'), true);
  assert.equal(app.includes('setupTransitionManager'), true);
  assert.match(app, /normalizeLayerPlaybackSettings\(merged\)/);
  assert.match(app, /normalizeLayerPlaybackMode\(state\.settings\.playbackModeSlideshow\)/);
  assert.match(app, /selectPreviousLayerIndex\(/);
  assert.match(app, /playbackModePlaylist:\s*legacySettings\?\.playbackModePlaylist\s*\?\?\s*legacyPlaylist\?\.mode/);
  assert.match(app, /playbackModeSlideshow:\s*legacySettings\?\.playbackModeSlideshow\s*\?\?\s*legacySlideshow\?\.mode/);
});
