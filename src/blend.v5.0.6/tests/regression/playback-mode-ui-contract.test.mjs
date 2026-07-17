import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  assert.equal(html.includes('id="transition-overlap"'), true);
  assert.equal(html.includes('id="enabled-transitions-list"'), true);
  assert.equal(html.includes('id="quality-auto-adjust"'), true);
  assert.equal(html.includes('id="show-transition-fps"'), true);
});

test('app runtime includes completion modes and transition hooks', async () => {
  const app = await readFile(new URL('app.js', ROOT), 'utf8');
  assert.equal(app.includes('EXPERIENCE_PLAYBACK_MODE_LOOP'), true);
  assert.equal(app.includes('EXPERIENCE_PLAYBACK_MODE_STOP'), true);
  assert.equal(app.includes('EXPERIENCE_PLAYBACK_MODE_NEXT'), true);
  assert.equal(app.includes('handleExperienceCompletion'), true);
  assert.equal(app.includes('transitionOverlapMs'), true);
  assert.equal(app.includes('setupTransitionManager'), true);
});
