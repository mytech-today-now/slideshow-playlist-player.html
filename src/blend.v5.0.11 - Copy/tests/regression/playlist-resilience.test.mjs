import test from 'node:test';
import assert from 'node:assert/strict';

import { StorageResolverError } from '../../storage-url-resolver.js';

async function resolvePlaylistSources(items, resolver) {
  const output = [];
  const failed = [];
  for (const item of items) {
    try {
      const resolved = await resolver.resolve(item.reference);
      output.push({
        id: item.id,
        url: resolved.url
      });
    } catch (error) {
      failed.push({
        id: item.id,
        code: error?.code || 'unknown'
      });
    }
  }
  return { output, failed };
}

test('continues resolving playlist entries when one media item fails', async () => {
  const resolver = {
    async resolve(reference) {
      if (String(reference).includes('missing')) {
        throw new StorageResolverError('Missing media', { code: 'missing_media', status: 404 });
      }
      return { url: `https://cdn.example.com/${reference}` };
    }
  };

  const items = [
    { id: '1', reference: 'media/intro.mp4' },
    { id: '2', reference: 'media/missing.mp4' },
    { id: '3', reference: 'media/outro.mp4' }
  ];
  const result = await resolvePlaylistSources(items, resolver);
  assert.deepEqual(result.output.map(item => item.id), ['1', '3']);
  assert.deepEqual(result.failed, [{ id: '2', code: 'missing_media' }]);
});
