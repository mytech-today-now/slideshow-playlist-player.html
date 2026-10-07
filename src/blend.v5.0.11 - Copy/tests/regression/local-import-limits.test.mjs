import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertLocalImportFileSize,
  LocalImportLimitError,
  LOCAL_IMPORT_MAX_ARRAY_ITEMS,
  LOCAL_IMPORT_MAX_BYTES,
  LOCAL_IMPORT_SIZE_LIMIT_MESSAGE,
  parseBoundedImportJson,
  readLocalImportFile
} from '../../local-import-limits.js';

test('file-size boundary accepts exactly 10 MiB and rejects the first byte above without reading', async () => {
  assert.equal(assertLocalImportFileSize({ size: LOCAL_IMPORT_MAX_BYTES - 1 }), LOCAL_IMPORT_MAX_BYTES - 1);
  assert.equal(assertLocalImportFileSize({ size: LOCAL_IMPORT_MAX_BYTES }), LOCAL_IMPORT_MAX_BYTES);

  let reads = 0;
  const exact = await readLocalImportFile({
    size: LOCAL_IMPORT_MAX_BYTES,
    text: async () => { reads += 1; return 'accepted'; }
  });
  assert.equal(exact, 'accepted');
  assert.equal(reads, 1);

  await assert.rejects(
    () => readLocalImportFile({
      size: LOCAL_IMPORT_MAX_BYTES + 1,
      text: async () => { reads += 1; return 'must not be read'; }
    }),
    error => error instanceof LocalImportLimitError
      && error.code === 'file_size'
      && error.message === LOCAL_IMPORT_SIZE_LIMIT_MESSAGE
  );
  assert.equal(reads, 1);
});

test('bounded JSON rejects malformed, too-deep, and excessive arrays before import normalization', () => {
  assert.throws(() => parseBoundedImportJson('{"items":'), SyntaxError);

  const excessiveDepth = `${'['.repeat(65)}0${']'.repeat(65)}`;
  assert.throws(
    () => parseBoundedImportJson(excessiveDepth),
    error => error instanceof LocalImportLimitError && error.code === 'structure_limit'
  );

  const exactArray = `[${Array.from({ length: LOCAL_IMPORT_MAX_ARRAY_ITEMS }, () => '"track.mp3"').join(',')}]`;
  assert.equal(parseBoundedImportJson(exactArray).length, LOCAL_IMPORT_MAX_ARRAY_ITEMS);

  const excessiveArray = `[${Array.from({ length: LOCAL_IMPORT_MAX_ARRAY_ITEMS + 1 }, () => '"track.mp3"').join(',')}]`;
  assert.throws(
    () => parseBoundedImportJson(excessiveArray),
    error => error instanceof LocalImportLimitError && error.code === 'structure_limit'
  );

  const repeatedArrays = `[${Array.from({ length: 6 }, () => `[${Array.from({ length: 9_000 }, () => '0').join(',')}]`).join(',')}]`;
  assert.throws(
    () => parseBoundedImportJson(repeatedArrays),
    error => error instanceof LocalImportLimitError && error.code === 'structure_limit'
  );
});

test('bounded JSON keeps the legacy player.blend.list.v1 fixture intact', async () => {
  const fixtureText = await readFile(new URL('../fixtures/legacy-private-media-experience.v2.json', import.meta.url), 'utf8');
  const payload = parseBoundedImportJson(fixtureText);

  assert.equal(payload.schema, 'player.blend.experience.v2');
  assert.equal(payload.type, 'experience');
  assert.equal(payload.playlist.schema, 'player.blend.list.v1');
  assert.equal(payload.slideshow.schema, 'player.blend.list.v1');
  assert.ok(payload.playlist.items.length > 0);
  assert.deepEqual(payload.slideshow.items, []);
  assert.ok(payload.playlist.items.every(item => typeof (item.fullPath || item.path) === 'string'));
});
