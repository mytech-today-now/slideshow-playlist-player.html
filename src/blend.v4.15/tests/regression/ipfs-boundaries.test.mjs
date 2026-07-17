import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_IPFS_CONFIG,
  normalizeIpfsConfig,
  parseGatewayList,
  sanitizeCid,
  validateCid
} from '../../ipfs-service.js';
import {
  IPFS_WORKER_ACTION,
  createIpfsWorkerRequest,
  sanitizeIpfsWorkerConfig,
  validateIpfsWorkerRequest
} from '../../ipfs-worker-protocol.js';

const VALID_V0_CID = `Qm${'a'.repeat(44)}`;
const VALID_V1_CID = `b${'a'.repeat(20)}`;

test('normalizeIpfsConfig clamps numeric values to lower bounds', () => {
  const config = normalizeIpfsConfig({
    timeoutMs: 1,
    fetchTimeoutMs: 2,
    maxManifestBytes: 1,
    maxItemBytes: 1
  });

  assert.equal(config.timeoutMs, 3000);
  assert.equal(config.fetchTimeoutMs, 3000);
  assert.equal(config.maxManifestBytes, 1024);
  assert.equal(config.maxItemBytes, 1024 * 1024);
});

test('normalizeIpfsConfig clamps numeric values to upper bounds', () => {
  const config = normalizeIpfsConfig({
    timeoutMs: 99_999_999,
    fetchTimeoutMs: 99_999_999,
    maxManifestBytes: 99_999_999,
    maxItemBytes: 99_999_999_999
  });

  assert.equal(config.timeoutMs, 10 * 60 * 1000);
  assert.equal(config.fetchTimeoutMs, 10 * 60 * 1000);
  assert.equal(config.maxManifestBytes, 50 * 1024 * 1024);
  assert.equal(config.maxItemBytes, 20 * 1024 * 1024 * 1024);
});

test('normalizeIpfsConfig falls back invalid mode to default mode', () => {
  const config = normalizeIpfsConfig({ mode: 'unknown-mode' });
  assert.equal(config.mode, DEFAULT_IPFS_CONFIG.mode);
});

test('CID validation accepts valid boundaries and rejects just-outside values', () => {
  assert.equal(validateCid(VALID_V0_CID), true);
  assert.equal(validateCid(VALID_V1_CID), true);
  assert.equal(sanitizeCid(VALID_V0_CID), VALID_V0_CID);

  const shortV1 = `b${'a'.repeat(19)}`;
  assert.equal(validateCid(shortV1), false);
  assert.equal(sanitizeCid(shortV1), '');
});

test('parseGatewayList falls back to defaults when all candidates are invalid', () => {
  const gateways = parseGatewayList('notaurl, ftp://invalid.example');
  assert.deepEqual(gateways, DEFAULT_IPFS_CONFIG.gateways);
});

test('sanitizeIpfsWorkerConfig clamps worker numeric boundaries', () => {
  const min = sanitizeIpfsWorkerConfig({
    timeoutMs: 1,
    fetchTimeoutMs: 1,
    maxManifestBytes: 1,
    maxItemBytes: 1
  });
  assert.equal(min.timeoutMs, 3000);
  assert.equal(min.fetchTimeoutMs, 3000);
  assert.equal(min.maxManifestBytes, 1024);
  assert.equal(min.maxItemBytes, 1024 * 1024);

  const max = sanitizeIpfsWorkerConfig({
    timeoutMs: 99_999_999,
    fetchTimeoutMs: 99_999_999,
    maxManifestBytes: 99_999_999,
    maxItemBytes: 99_999_999_999
  });
  assert.equal(max.timeoutMs, 10 * 60 * 1000);
  assert.equal(max.fetchTimeoutMs, 10 * 60 * 1000);
  assert.equal(max.maxManifestBytes, 50 * 1024 * 1024);
  assert.equal(max.maxItemBytes, 20 * 1024 * 1024 * 1024);
});

test('worker fetch request options are clamped at option boundaries', () => {
  const request = createIpfsWorkerRequest(IPFS_WORKER_ACTION.FETCH_CID, {
    id: 'boundary-fetch',
    payload: {
      cid: VALID_V1_CID,
      options: {
        timeoutMs: 0,
        maxBytes: 0
      }
    }
  });
  const validation = validateIpfsWorkerRequest(request);
  assert.equal(validation.ok, true);
  assert.equal(validation.message.payload.options.timeoutMs, 100);
  assert.equal(validation.message.payload.options.maxBytes, 1);
});
