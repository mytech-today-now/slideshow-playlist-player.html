import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_EXPERIENCE_END_TARGET,
  EXPERIENCE_END_TARGET_PLAYLIST,
  EXPERIENCE_END_TARGET_SLIDESHOW,
  isExperienceEndSatisfied,
  normalizeLayerPlaybackMode,
  normalizeLayerPlaybackSettings,
  normalizeExperienceEndTarget,
  getPlayableListIndices,
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
  assert.match(html, /<label for="experience-end-target">Experience end target<\/label>/);
  assert.match(html, /<option value="playlist" selected>Playlist<\/option>/);
  assert.match(html, /<option value="slideshow">Slideshow<\/option>/);
  assert.match(html, /<option value="loop" selected>Loop<\/option>/);
  assert.match(html, /<option value="stop">Stop at End<\/option>/);
  assert.match(html, /<option value="next-experience">Go to Next Experience<\/option>/);
  assert.match(html, /<label for="playlist-order">Playlist order<\/label>/);
  assert.match(html, /<label for="slideshow-order">Slideshow order<\/label>/);
  assert.match(html, /<p id="experience-random-cycle-help" class="setting__hint setting--wide">With Random order, each playable item plays once per cycle\./);
  for (const id of ['experience-playback-mode', 'experience-end-target', 'playlist-order', 'slideshow-order']) {
    assert.match(html, new RegExp(`<select id="${id}" aria-describedby="experience-random-cycle-help">`));
  }
  assert.doesNotMatch(html, /id="experience-random-cycle-help"[^>]*\bhidden\b/);
  assert.match(html, /<option value="sequential" selected>Sequential<\/option>/);
  assert.match(html, /<option value="random">Random<\/option>/);
  assert.equal(html.includes('id="transition-overlap"'), true);
  assert.equal(html.includes('id="enabled-transitions-list"'), true);
  assert.equal(html.includes('id="quality-auto-adjust"'), true);
  assert.equal(html.includes('id="show-transition-fps"'), true);
});

test('experience end target normalization defaults missing and invalid settings to Playlist', () => {
  assert.equal(DEFAULT_EXPERIENCE_END_TARGET, EXPERIENCE_END_TARGET_PLAYLIST);
  assert.equal(normalizeExperienceEndTarget(undefined), EXPERIENCE_END_TARGET_PLAYLIST);
  assert.equal(normalizeExperienceEndTarget(null), EXPERIENCE_END_TARGET_PLAYLIST);
  assert.equal(normalizeExperienceEndTarget('invalid'), EXPERIENCE_END_TARGET_PLAYLIST);
  assert.equal(normalizeExperienceEndTarget(EXPERIENCE_END_TARGET_SLIDESHOW), EXPERIENCE_END_TARGET_SLIDESHOW);
});

test('experience completion follows only the selected playable layer and falls back safely', () => {
  assert.equal(isExperienceEndSatisfied({
    endTarget: EXPERIENCE_END_TARGET_PLAYLIST,
    playlistDone: true,
    slideshowDone: false,
    playlistHasPlayableItems: true,
    slideshowHasPlayableItems: true
  }), true);
  assert.equal(isExperienceEndSatisfied({
    endTarget: EXPERIENCE_END_TARGET_PLAYLIST,
    playlistDone: false,
    slideshowDone: true,
    playlistHasPlayableItems: true,
    slideshowHasPlayableItems: true
  }), false);
  assert.equal(isExperienceEndSatisfied({
    endTarget: EXPERIENCE_END_TARGET_SLIDESHOW,
    playlistDone: false,
    slideshowDone: true,
    playlistHasPlayableItems: true,
    slideshowHasPlayableItems: true
  }), true);
  assert.equal(isExperienceEndSatisfied({
    endTarget: EXPERIENCE_END_TARGET_SLIDESHOW,
    playlistDone: true,
    slideshowDone: false,
    playlistHasPlayableItems: true,
    slideshowHasPlayableItems: true
  }), false);
  assert.equal(isExperienceEndSatisfied({
    endTarget: EXPERIENCE_END_TARGET_PLAYLIST,
    playlistDone: false,
    slideshowDone: true,
    playlistHasPlayableItems: false,
    slideshowHasPlayableItems: true
  }), true);
  assert.equal(isExperienceEndSatisfied({
    endTarget: EXPERIENCE_END_TARGET_SLIDESHOW,
    playlistDone: false,
    slideshowDone: false,
    playlistHasPlayableItems: true,
    slideshowHasPlayableItems: false
  }), false);
  assert.equal(isExperienceEndSatisfied({
    endTarget: EXPERIENCE_END_TARGET_SLIDESHOW,
    playlistHasPlayableItems: false,
    slideshowHasPlayableItems: false
  }), true);
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

test('random cycles select only unused playable indices and terminate when not wrapping', () => {
  const playableIndices = [0, 2];
  const firstRandomNext = selectNextLayerIndex({
    mode: 'random',
    currentIndex: 0,
    playableIndices,
    visitedIndices: [0],
    random: () => 0,
    wrap: false
  });
  assert.equal(firstRandomNext, 2);
  assert.equal(selectNextLayerIndex({
    mode: 'random',
    currentIndex: firstRandomNext,
    playableIndices,
    visitedIndices: new Set([0, 2]),
    random: () => 0.5,
    wrap: false
  }), -1);

  assert.equal(selectNextLayerIndex({
    mode: 'random',
    currentIndex: 0,
    playableIndices: [0],
    visitedIndices: [],
    random: () => 0.8,
    wrap: false
  }), 0);
  assert.equal(selectNextLayerIndex({
    mode: 'random',
    currentIndex: 0,
    playableIndices: [0],
    visitedIndices: [0],
    random: () => 0.8,
    wrap: false
  }), -1);
  assert.equal(selectNextLayerIndex({
    mode: 'random',
    currentIndex: 2,
    playableIndices,
    visitedIndices: [0, 2],
    random: () => 0.99,
    wrap: true
  }), 2);
  assert.equal(selectNextLayerIndex({
    mode: 'random',
    currentIndex: 0,
    playableIndices: [],
    visitedIndices: [],
    random: () => 0,
    wrap: true
  }), -1);
});

test('playable list indices define sequential boundaries around unavailable entries', () => {
  const isPlayable = item => item?.available === true;
  const empty = [];
  const allUnavailable = [{ available: false }, null];
  const trailingUnavailable = [{ available: true }, { available: false }, null];
  const interspersedUnavailable = [
    { available: false },
    { available: true },
    { available: false },
    { available: true },
    { available: false }
  ];
  const surroundedSinglePlayable = [{ available: false }, { available: true }, { available: false }];

  assert.deepEqual(getPlayableListIndices(empty, isPlayable), []);
  assert.deepEqual(getPlayableListIndices(allUnavailable, isPlayable), []);
  assert.deepEqual(getPlayableListIndices(trailingUnavailable, isPlayable), [0]);
  assert.deepEqual(getPlayableListIndices(interspersedUnavailable, isPlayable), [1, 3]);
  assert.deepEqual(getPlayableListIndices(surroundedSinglePlayable, isPlayable), [1]);
  assert.deepEqual(getPlayableListIndices({ length: 3 }, isPlayable), []);
  assert.deepEqual(getPlayableListIndices(trailingUnavailable, null), []);

  assert.equal(selectNextLayerIndex({ currentIndex: -1, playableIndices: [1] }), 1);
  assert.equal(selectNextLayerIndex({ currentIndex: 0, playableIndices: [0] }), -1);
  assert.equal(selectNextLayerIndex({ currentIndex: 1, playableIndices: [1, 3] }), 3);
  assert.equal(selectNextLayerIndex({ currentIndex: 3, playableIndices: [1, 3] }), -1);
  assert.equal(selectNextLayerIndex({ currentIndex: 3, playableIndices: [1, 3], wrap: true }), 1);

  assert.equal(trailingUnavailable.length, 3);
  assert.equal(interspersedUnavailable.length, 5);
  assert.equal(surroundedSinglePlayable.length, 3);
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
  assert.match(app, /experienceEndTarget:\s*DEFAULT_EXPERIENCE_END_TARGET/);
  assert.match(app, /isExperienceEndSatisfied\(\{/);
  assert.match(app, /function playableIndicesForLayer\(which\)[\s\S]*?getPlayableListIndices\(listFor\(which\), ref => isPlayableListRef\(which, ref\)\)/);
  assert.match(app, /const playable = playableIndicesForLayer\('playlist'\)/);
  assert.match(app, /const playable = playableIndicesForLayer\('slideshow'\)/);
  assert.match(app, /function nextRandomLayerIndex\(which, currentIndex, playableIndices/);
  assert.match(app, /function randomLayerPreloadIndex\(which, playableIndices, currentIndex\)/);
  assert.match(app, /function preloadUpcomingPlaylistItems\(requestContext = null\)[\s\S]*?randomLayerPreloadIndex\('playlist'/);
  assert.match(app, /function preloadUpcomingSlideshowItems\(requestContext = null\)[\s\S]*?randomLayerPreloadIndex\('slideshow'/);
  assert.match(app, /randomCycleCompletionSatisfiesExperience\('playlist'\)/);
  assert.match(app, /randomCycleCompletionSatisfiesExperience\('slideshow'\)/);
  assert.match(app, /markLayerComplete\('playlist', 'random_cycle_end'\)/);
  assert.match(app, /markLayerComplete\('slideshow', 'random_cycle_end'\)/);
  assert.match(app, /Random order finished its current cycle\. Playback will stop, loop, or move to the next experience according to Experience playback mode\./);
  assert.match(app, /function failRandomLayerCycle\(which\)/);
  assert.match(app, /maybeHandleExperienceCompletion\('end_target_changed'\)/);
  assert.match(app, /reason === 'manual_next'/);
  assert.match(app, /await transitionManager\?\.cancelActiveTransitions\?\./);
  assert.equal(app.includes('transitionOverlapMs'), true);
  assert.equal(app.includes('setupTransitionManager'), true);
  assert.match(app, /normalizeLayerPlaybackSettings\(merged\)/);
  assert.match(app, /normalizeLayerPlaybackMode\(state\.settings\.playbackModeSlideshow\)/);
  assert.match(app, /selectPreviousLayerIndex\(/);
  assert.match(app, /playbackModePlaylist:\s*legacySettings\?\.playbackModePlaylist\s*\?\?\s*legacyPlaylist\?\.mode/);
  assert.match(app, /playbackModeSlideshow:\s*legacySettings\?\.playbackModeSlideshow\s*\?\?\s*legacySlideshow\?\.mode/);
});
