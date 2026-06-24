import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IPFS_WORKER_ACTION,
  createIpfsWorkerRequest,
  sanitizeIpfsWorkerConfig,
  serializeIpfsWorkerError,
  validateIpfsWorkerRequest,
  validateIpfsWorkerResponse
} from '../../ipfs-worker-protocol.js';

test('sanitizes worker config to safe primitive fields', () => {
  const config = sanitizeIpfsWorkerConfig({
    mode: 'kubo',
    kuboApiEndpoint: 'http://127.0.0.1:5001',
    gateways: ['https://ipfs.io/ipfs/'],
    timeoutMs: 60000,
    unexpected: { nested: true }
  });

  assert.equal(config.mode, 'kubo');
  assert.equal(config.kuboApiEndpoint, 'http://127.0.0.1:5001');
  assert.deepEqual(config.gateways, ['https://ipfs.io/ipfs/']);
  assert.equal('unexpected' in config, false);
});

test('rejects invalid fetch request payloads without CID', () => {
  const request = createIpfsWorkerRequest(IPFS_WORKER_ACTION.FETCH_CID, {
    id: 'fetch-test',
    payload: { cid: 'not-a-cid' }
  });

  const validation = validateIpfsWorkerRequest(request);
  assert.equal(validation.ok, false);
  assert.match(validation.error, /invalid CID/i);
});

test('accepts addJson requests and strips non-serializable data', () => {
  const request = createIpfsWorkerRequest(IPFS_WORKER_ACTION.ADD_JSON, {
    id: 'json-test',
    payload: {
      json: {
        ok: true,
        fn: () => 'removed',
        nested: { keep: 'value' }
      }
    }
  });

  const validation = validateIpfsWorkerRequest(request);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.message.payload.json, {
    ok: true,
    nested: { keep: 'value' }
  });
});

test('serializes worker errors with user-facing fields', () => {
  const error = serializeIpfsWorkerError({
    name: 'TimeoutError',
    message: 'Request timed out',
    code: 'timeout',
    userMessage: 'IPFS request timed out'
  });

  assert.equal(error.name, 'TimeoutError');
  assert.equal(error.code, 'timeout');
  assert.equal(error.userMessage, 'IPFS request timed out');
  assert.equal(error.retryable, true);
});

test('flags malformed worker responses', () => {
  const validation = validateIpfsWorkerResponse({
    channel: 'wrong-channel',
    protocolVersion: 1,
    id: 'x',
    action: 'init',
    event: 'ready'
  });
  assert.equal(validation.ok, false);
});

