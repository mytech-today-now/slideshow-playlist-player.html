import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogger } from '../../logger.js';

test('logger preserves structured error codes and nested causes', () => {
  const rootCause = new Error('Version 5 is older than saved database version 6.');
  const cause = new Error('IndexedDB open failed', { cause: rootCause });
  cause.code = 'idb_open_error';
  const error = new Error('Blend startup failed', { cause });
  error.name = 'IndexedDBOpenError';
  error.code = 'idb_schema_incompatible';
  const logger = createLogger('logger-test', { persist: false, mirrorConsole: false });

  logger.error('[startup] failed', error);

  const savedError = logger.entries()[0].args[1];
  assert.equal(savedError.name, 'IndexedDBOpenError');
  assert.equal(savedError.code, 'idb_schema_incompatible');
  assert.equal(savedError.cause.name, 'Error');
  assert.equal(savedError.cause.code, 'idb_open_error');
  assert.equal(savedError.cause.cause.message, 'Version 5 is older than saved database version 6.');
  assert.match(savedError.stack, /Blend startup failed/);
});

test('logger bounds circular error causes', () => {
  const error = new Error('circular');
  error.cause = error;
  const logger = createLogger('logger-test', { persist: false, mirrorConsole: false });

  logger.error(error);

  assert.equal(logger.entries()[0].args[0].cause, '[Circular]');
});

test('logger removes URL query data and bearer credentials from error details', () => {
  const cause = new Error('authorization=secret-cause');
  const error = new Error(
    'Request failed for https://media.example.test/private/file?token=secret-query with Bearer secret-bearer',
    { cause }
  );
  const logger = createLogger('logger-test', { persist: false, mirrorConsole: false });

  logger.error('[startup] failed', error);

  const saved = JSON.stringify(logger.entries()[0]);
  assert.match(saved, /https:\/\/media\.example\.test\/private\/file/);
  assert.doesNotMatch(saved, /secret-query|secret-bearer|secret-cause/);
  assert.match(saved, /authorization=\[redacted\]/);
});
