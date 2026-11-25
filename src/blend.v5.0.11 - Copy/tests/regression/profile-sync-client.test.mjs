import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileSyncClient } from '../../profile-sync-client.js';

test('a blocked LocalStorage boundary leaves the application boot path usable', () => {
  const windowObject = {};
  Object.defineProperty(windowObject, 'localStorage', {
    get() { throw new Error('synthetic storage denial'); }
  });
  assert.equal(createProfileSyncClient({
    windowObject,
    documentObject: {},
    fetchImpl: async () => new Response('{}')
  }), null);
});
