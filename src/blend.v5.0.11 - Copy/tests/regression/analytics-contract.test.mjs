import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnalyticsConsentDecision } from '../../analytics-consent.js';
import { buildAnalyticsEventParams } from '../../analytics-event-params.js';

test('analytics event parameters allow only coarse product metrics', () => {
  const context = {
    media_type: 'video',
    media_layer: 'playlist',
    method: 'copy',
    outcome: 'success',
    experience_name: 'PRIVATE-EXPERIENCE-ALPHA',
    media_name: 'PRIVATE-FILE-BETA',
    experience_id: 'PRIVATE-EXPERIENCE-ID-GAMMA',
    media_id: 'PRIVATE-MEDIA-ID-DELTA',
    page_title: 'PRIVATE-TITLE-EPSILON',
    page_location: 'http://localhost/private/path?name=PRIVATE-FILE-BETA',
    page_path: '/private/path',
    source_kind: 'file-system',
    trigger: 'PRIVATE-TRIGGER-ZETA',
    arbitrary: { private: true }
  };

  assert.deepEqual(buildAnalyticsEventParams('experience_play', context), {
    media_type: 'video',
    media_layer: 'playlist'
  });
  assert.deepEqual(buildAnalyticsEventParams('share', context), {
    media_type: 'video',
    media_layer: 'playlist',
    method: 'copy',
    action_outcome: 'success'
  });
  assert.deepEqual(buildAnalyticsEventParams('page_view', context), {});
  assert.equal(buildAnalyticsEventParams('PRIVATE-EVENT', context), null);
});

test('analytics event parameters reject unknown metric values and extras', () => {
  assert.deepEqual(buildAnalyticsEventParams('experience_play', {
    media_type: 'PRIVATE-MEDIA-TYPE',
    media_layer: 'PRIVATE-LAYER',
    play_reason: 'PRIVATE-PLAY-REASON'
  }), {});
  assert.deepEqual(buildAnalyticsEventParams('share', {
    method: 'PRIVATE-SHARE-METHOD',
    outcome: 'PRIVATE-SHARE-OUTCOME',
    media_type: 'experience',
    media_layer: 'experience'
  }), {});
});

test('analytics requires affirmative consent before a loader can be requested', () => {
  assert.deepEqual(getAnalyticsConsentDecision(), {
    consent: false,
    allowed: false,
    blockedBySignal: false,
    shouldLoadScript: false
  });
  assert.equal(getAnalyticsConsentDecision({ consent: false }).shouldLoadScript, false);
  assert.equal(getAnalyticsConsentDecision({ consent: true }).shouldLoadScript, true);
});

test('DNT, GPC, and local-file safeguards block saved consent', () => {
  for (const signal of ['doNotTrack', 'globalPrivacyControl', 'localFileContext']) {
    const decision = getAnalyticsConsentDecision({ consent: true, [signal]: true });
    assert.equal(decision.allowed, false, signal);
    assert.equal(decision.shouldLoadScript, false, signal);
  }
});

test('a failed script gets one user-triggered retry through the same loader decision', () => {
  const failed = {
    consent: true,
    scriptStatus: 'failed',
    loadAttempts: 1
  };
  assert.equal(getAnalyticsConsentDecision(failed).shouldLoadScript, false);
  assert.equal(getAnalyticsConsentDecision({ ...failed, retryRequested: true }).shouldLoadScript, true);
  assert.equal(getAnalyticsConsentDecision({
    ...failed,
    loadAttempts: 2,
    retryRequested: true
  }).shouldLoadScript, false);
});

test('loading and loaded scripts are never duplicated', () => {
  assert.equal(getAnalyticsConsentDecision({ consent: true, scriptStatus: 'loading', loadAttempts: 1 }).shouldLoadScript, false);
  assert.equal(getAnalyticsConsentDecision({ consent: true, scriptStatus: 'loaded', loadAttempts: 1 }).shouldLoadScript, false);
});
