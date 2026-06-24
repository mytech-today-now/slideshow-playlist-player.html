import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_IPFS_CONFIG,
  describeIpfsPublishReadiness,
  formatIpfsErrorForUser,
  normalizeIpfsConfig,
  parseGatewayList
} from '../../ipfs-service.js';

test('normalizes gateway URLs to explicit /ipfs/ paths', () => {
  const gateways = parseGatewayList('https://gateway.example, https://dweb.link/ipfs/');
  assert.deepEqual(gateways, [
    'https://gateway.example/ipfs/',
    'https://dweb.link/ipfs/'
  ]);
});

test('marks invalid kubo endpoint and falls back to default endpoint', () => {
  const config = normalizeIpfsConfig({
    mode: 'kubo',
    kuboApiEndpoint: 'not-a-valid-url'
  });

  assert.equal(config.kuboApiEndpointInvalid, true);
  assert.equal(config.kuboApiEndpoint, DEFAULT_IPFS_CONFIG.kuboApiEndpoint);
  const readiness = describeIpfsPublishReadiness(config);
  assert.equal(readiness.canPublish, false);
  assert.equal(readiness.state, 'needs_setup');
});

test('reports gateway mode as retrieval-only for publishing readiness', () => {
  const readiness = describeIpfsPublishReadiness({
    enabled: true,
    mode: 'gateway',
    gateways: ['https://ipfs.io/ipfs/']
  });

  assert.equal(readiness.canPublish, false);
  assert.equal(readiness.state, 'unavailable');
  assert.match(readiness.message, /cannot publish/i);
});

test('formats generic errors into user-facing IPFS guidance', () => {
  const out = formatIpfsErrorForUser(new Error('network timeout'));
  assert.equal(out.title, 'IPFS error');
  assert.equal(out.message, 'IPFS sharing failed.');
  assert.match(out.detail, /network timeout/i);
  assert.equal(out.retryable, true);
});

