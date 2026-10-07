import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createResumeOnLoadPlan,
  isResumeOnLoadEnabled,
  normalizeResumeOnLoadSettings,
  RESUME_ON_LOAD_READY_MESSAGE
} from '../../resume-on-load.js';

test('a saved true without an explicit user choice keeps the stopped default', () => {
  assert.equal(isResumeOnLoadEnabled({ resumeOnLoad: true }), false);
  assert.equal(isResumeOnLoadEnabled({ resumeOnLoad: true, resumeOnLoadExplicit: false }), false);
  assert.equal(isResumeOnLoadEnabled({ resumeOnLoad: false, resumeOnLoadExplicit: true }), false);
  assert.deepEqual(normalizeResumeOnLoadSettings({ resumeOnLoad: true }), {
    resumeOnLoad: false,
    resumeOnLoadExplicit: false
  });
});

test('checked resume prepares valid playlist and slideshow indices in a paused state', () => {
  const plan = createResumeOnLoadPlan({
    enabled: true,
    playlist: { present: true, ready: true },
    slideshow: { present: true, ready: true }
  });

  assert.equal(plan.shouldPrepare, true);
  assert.equal(plan.transport, 'paused');
  assert.deepEqual(plan.readyLayers, ['playlist', 'slideshow']);
  assert.deepEqual(plan.failedLayers, []);
  assert.equal(plan.message, RESUME_ON_LOAD_READY_MESSAGE);
  assert.equal(isResumeOnLoadEnabled({ resumeOnLoad: true, resumeOnLoadExplicit: true }), true);
});

test('unchecked resume always selects stopped startup without preparing media', () => {
  const plan = createResumeOnLoadPlan({
    enabled: false,
    playlist: { present: true, ready: true },
    slideshow: { present: true, ready: true }
  });

  assert.equal(plan.shouldPrepare, false);
  assert.equal(plan.transport, 'stopped');
  assert.equal(plan.message, '');
});

test('missing media leaves the saved playlist intact and explains the failure', () => {
  const plan = createResumeOnLoadPlan({
    enabled: true,
    playlist: { present: true, ready: false },
    slideshow: { present: false, ready: false }
  });

  assert.equal(plan.transport, 'stopped');
  assert.deepEqual(plan.failedLayers, ['playlist']);
  assert.match(plan.message, /saved playlist media could not be restored/i);
  assert.match(plan.message, /saved lists are intact/i);
});

test('an expired remote URL is reported per layer without clearing either saved list', () => {
  const plan = createResumeOnLoadPlan({
    enabled: true,
    playlist: { present: true, ready: false },
    slideshow: { present: true, ready: true }
  });

  assert.equal(plan.transport, 'paused');
  assert.deepEqual(plan.readyLayers, ['slideshow']);
  assert.deepEqual(plan.failedLayers, ['playlist']);
  assert.match(plan.message, /playlist media could not be restored/i);
  assert.match(plan.message, /saved lists are intact/i);
});

test('autoplay rejection returns the exact user-gesture fallback copy', () => {
  const plan = createResumeOnLoadPlan({
    enabled: true,
    playlist: { present: true, ready: true },
    slideshow: { present: false, ready: false }
  });

  assert.equal(plan.message, 'Your last session is ready. Select Play to resume.');
  assert.equal(plan.message, RESUME_ON_LOAD_READY_MESSAGE);
});
