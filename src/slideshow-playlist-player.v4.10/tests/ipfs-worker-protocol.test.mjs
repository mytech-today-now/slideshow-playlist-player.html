import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IPFS_WORKER_ACTION,
  IPFS_WORKER_EVENT,
  createIpfsWorkerRequest,
  createIpfsWorkerResponse,
  sanitizeIpfsUploadResult,
  validateIpfsWorkerRequest,
  validateIpfsWorkerResponse
} from '../ipfs-worker-protocol.js';

const CID = 'QmWmyoMoctfbdiQcRVLda5D4gA7D6Drb5St9Qf7N9YJ5dA';

test('validates addFile requests and strips non-cloneable config fields', () => {
  const blob = new Blob(['abc'], { type: 'video/mp4' });
  const request = createIpfsWorkerRequest(IPFS_WORKER_ACTION.ADD_FILE, {
    id: 'upload:1',
    config: {
      mode: 'helia',
      heliaModuleUrl: './ipfs-helia-provider.js',
      heliaProvider() {},
      gateways: ['https://example.test/ipfs/']
    },
    payload: {
      blob,
      filename: 'clip.mp4',
      mimeType: 'video/mp4',
      kind: 'item',
      itemType: 'video'
    }
  });

  const validation = validateIpfsWorkerRequest(request);
  assert.equal(validation.ok, true, validation.error);
  assert.equal(validation.message.payload.blob, blob);
  assert.equal(validation.message.config.heliaProvider, undefined);
  assert.equal(validation.message.payload.filename, 'clip.mp4');
});

test('rejects malformed fetch requests at the protocol boundary', () => {
  const request = createIpfsWorkerRequest(IPFS_WORKER_ACTION.FETCH_CID, {
    id: 'fetch:1',
    payload: { cid: 'not-a-cid' }
  });
  const validation = validateIpfsWorkerRequest(request);
  assert.equal(validation.ok, false);
  assert.match(validation.error, /invalid CID/);
});

test('validates worker success responses and normalizes upload metadata', () => {
  const request = createIpfsWorkerRequest(IPFS_WORKER_ACTION.ADD_FILE, {
    id: 'upload:2',
    payload: { blob: new Blob(['abc']), filename: 'clip.mp4' }
  });
  const response = createIpfsWorkerResponse(IPFS_WORKER_EVENT.SUCCESS, request, {
    payload: {
      cid: CID,
      provider: 'helia',
      byteSize: 3,
      mimeType: 'video/mp4',
      itemType: 'video',
      gatewayUrl: 'https://example.test/ipfs/QmWmyoMoctfbdiQcRVLda5D4gA7D6Drb5St9Qf7N9YJ5dA'
    }
  });

  const validation = validateIpfsWorkerResponse(response);
  assert.equal(validation.ok, true, validation.error);
  assert.equal(validation.message.payload.cid, CID);
  assert.equal(validation.message.payload.byteSize, 3);
  assert.equal(validation.message.payload.contentType, 'video/mp4');
  assert.match(validation.message.payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('sanitizes upload results from untrusted worker payloads', () => {
  const result = sanitizeIpfsUploadResult({
    cid: CID,
    provider: 'helia<script>',
    byteSize: '12',
    mimeType: 'image/png',
    timestamp: '2026-06-19T12:00:00.000Z',
    gatewayUrl: 'javascript:alert(1)'
  });

  assert.equal(result.cid, CID);
  assert.equal(result.byteSize, 12);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.gatewayUrl, '');
});
