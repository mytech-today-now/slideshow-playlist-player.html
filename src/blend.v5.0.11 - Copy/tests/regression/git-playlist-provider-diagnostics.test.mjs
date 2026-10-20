import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BITBUCKET_READ_ONLY_SCOPE_CONFIRMATION,
  formatBitbucketReadSmokeResult,
  isBitbucketReadSmokeConfigured
} from '../integration/git-playlist-provider-diagnostics.js';

test('Bitbucket live smoke requires disposable repository and read-only scope confirmations', () => {
  const base = {
    workspace: 'blend-workspace',
    repository: 'blend-smoke-private-fixture',
    token: 'synthetic-secret-sentinel',
    confirmation: 'I_CONFIRM_DISPOSABLE_PRIVATE_REPOSITORY:blend-workspace/blend-smoke-private-fixture',
    scopeConfirmation: BITBUCKET_READ_ONLY_SCOPE_CONFIRMATION
  };

  assert.equal(isBitbucketReadSmokeConfigured(base), true);
  assert.equal(isBitbucketReadSmokeConfigured({ ...base, scopeConfirmation: '' }), false);
  assert.equal(isBitbucketReadSmokeConfigured({ ...base, confirmation: '' }), false);
  assert.equal(isBitbucketReadSmokeConfigured({ ...base, repository: 'production-repository' }), false);
  assert.equal(isBitbucketReadSmokeConfigured({ ...base, token: '' }), false);
  assert.equal(isBitbucketReadSmokeConfigured({}), false);
});

test('Bitbucket smoke summary records only validated read metadata', () => {
  const text = formatBitbucketReadSmokeResult({
    configured: true,
    branch: 'feature/read-check',
    scopeConfirmed: true,
    checkedAt: '2026-10-20T14:00:00.000Z',
    outcome: 'success',
    readVerified: true,
    errorCode: null,
    repository: 'private-workspace/private-repository',
    path: 'blend-smoke/playlist.json',
    token: 'synthetic-secret-sentinel',
    responseBody: 'private-response-sentinel'
  });
  const result = JSON.parse(text);

  assert.deepEqual(result, {
    provider: 'bitbucket',
    branch: 'feature/read-check',
    scope: 'Repository Read (operator-confirmed)',
    checkedAt: '2026-10-20T14:00:00.000Z',
    status: 'success',
    readVerified: true,
    errorCode: null
  });
  for (const secret of ['private-workspace', 'private-repository', 'blend-smoke/playlist.json', 'synthetic-secret-sentinel', 'private-response-sentinel']) {
    assert.equal(text.includes(secret), false);
  }
});

test('Bitbucket smoke summary distinguishes skipped, unknown, and failed outcomes', () => {
  const cases = [
    [{}, { status: 'skipped', scope: 'unknown', checkedAt: null, errorCode: 'configuration_incomplete' }],
    [{ configured: true, scopeConfirmed: true, branch: 'main', outcome: 'failed', errorCode: 'request_timeout' }, { status: 'unknown', errorCode: 'request_timeout' }],
    [{ configured: true, scopeConfirmed: true, branch: 'main', outcome: 'failed', errorCode: 'permission_denied' }, { status: 'failed', errorCode: 'permission_denied' }]
  ];

  for (const [input, expected] of cases) {
    const result = JSON.parse(formatBitbucketReadSmokeResult(input));
    for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value);
  }
});

test('Bitbucket smoke summary rejects unsafe branch and error values', () => {
  const result = JSON.parse(formatBitbucketReadSmokeResult({
    configured: true,
    scopeConfirmed: true,
    branch: '../../private/repository',
    checkedAt: 'not-a-date',
    outcome: 'failed',
    errorCode: 'response body secret sentinel'
  }));

  assert.equal(result.branch, null);
  assert.equal(result.checkedAt, null);
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, null);
});
