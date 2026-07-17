import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRANSITION_EFFECTS,
  TransitionManager,
  fallbackEffectIdForSettings,
  normalizeTransitionSettings,
  transitionSelectionPreview
} from '../../transition-manager.js';

test('transition catalog exposes the expected 17 effects in cost order', () => {
  assert.equal(TRANSITION_EFFECTS.length, 17);
  for (let i = 1; i < TRANSITION_EFFECTS.length; i++) {
    assert.ok(
      TRANSITION_EFFECTS[i].cost >= TRANSITION_EFFECTS[i - 1].cost,
      `Effect ordering is not monotonic at index ${i}`
    );
  }
});

test('normalizeTransitionSettings clamps invalid values and preserves enabled list', () => {
  const normalized = normalizeTransitionSettings({
    transitionDurationMs: -100,
    transitionOverlapMs: 99999,
    enabledTransitionIds: ['crossfade', 'crossfade', 'invalid', 'luma-wipe'],
    transitionWeights: { crossfade: 4.5, 'luma-wipe': -2 },
    transitionRandomizeOrder: false,
    transitionMaxHeavyInRow: 99
  });
  assert.equal(normalized.transitionDurationMs, 200);
  assert.equal(normalized.transitionOverlapMs, 10000);
  assert.deepEqual(normalized.enabledTransitionIds, ['crossfade', 'luma-wipe']);
  assert.equal(normalized.transitionWeights.crossfade, 4.5);
  assert.equal(normalized.transitionWeights['luma-wipe'], 0);
  assert.equal(normalized.transitionRandomizeOrder, false);
  assert.equal(normalized.transitionMaxHeavyInRow, 8);
});

test('normalizeTransitionSettings preserves an explicit empty enabled list', () => {
  const normalized = normalizeTransitionSettings({
    enabledTransitionIds: []
  });
  assert.deepEqual(normalized.enabledTransitionIds, []);
});

test('fallbackEffectIdForSettings returns a safe non-heavy effect', () => {
  const fallback = fallbackEffectIdForSettings({
    enabledTransitionIds: ['displacement-ripple', 'luma-wipe']
  });
  assert.equal(typeof fallback, 'string');
  assert.notEqual(fallback, 'displacement-ripple');
  assert.notEqual(fallback, 'luma-wipe');
});

test('transitionSelectionPreview returns a preview sequence for active transitions', () => {
  const preview = transitionSelectionPreview({
    enabledTransitionIds: ['crossfade', 'simple-wipe', 'zoom-in-out'],
    transitionRandomizeOrder: false
  });
  assert.ok(Array.isArray(preview));
  assert.ok(preview.length >= 3);
  assert.deepEqual(preview.slice(0, 3), ['crossfade', 'simple-wipe', 'zoom-in-out']);
});

test('TransitionManager treats no enabled transitions as hard-cut only', () => {
  const manager = new TransitionManager({
    settings: {
      enabledTransitionIds: [],
      transitionRandomizeOrder: false
    },
    qualityTier: 'high'
  });
  assert.equal(manager.pickEffectId(), 'hard-cut');
  manager.destroy();
});

test('TransitionManager low tier fallback stays within enabled transitions', () => {
  const manager = new TransitionManager({
    settings: {
      enabledTransitionIds: ['displacement-ripple'],
      transitionRandomizeOrder: false
    },
    qualityTier: 'low'
  });
  assert.equal(manager.pickEffectId(), 'displacement-ripple');
  manager.destroy();
});
