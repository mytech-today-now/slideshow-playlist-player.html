import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUBLIC_UPLOAD_WARNING_KEY,
  isPublicUploadWarningSuppressed,
  isResetShareWarningRequested,
  rememberPublicUploadWarningChoice,
  resetPublicUploadWarning,
  shouldShowPublicUploadWarning
} from '../../ipfs-share-warning.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

test('suppresses warning when user confirms dont-show-again', () => {
  const storage = createMemoryStorage();
  const settings = { showPublicUploadWarning: true };

  const suppressed = rememberPublicUploadWarningChoice({
    confirmed: true,
    dontShowAgain: true,
    storage,
    settings
  });

  assert.equal(suppressed, true);
  assert.equal(storage.getItem(PUBLIC_UPLOAD_WARNING_KEY), '1');
  assert.equal(settings.showPublicUploadWarning, false);
  assert.equal(shouldShowPublicUploadWarning({ storage, settings }), false);
  assert.equal(isPublicUploadWarningSuppressed(storage), true);
});

test('reset flag in URL clears suppression and re-enables warning', () => {
  const storage = createMemoryStorage();
  const settings = { showPublicUploadWarning: false };

  storage.setItem(PUBLIC_UPLOAD_WARNING_KEY, '1');
  assert.equal(isResetShareWarningRequested('?resetShareWarning=yes'), true);
  assert.equal(shouldShowPublicUploadWarning({ storage, settings, search: '?resetShareWarning=true' }), true);
  assert.equal(storage.getItem(PUBLIC_UPLOAD_WARNING_KEY), null);
  assert.equal(settings.showPublicUploadWarning, true);
});

test('reset helper always restores default warning visibility', () => {
  const storage = createMemoryStorage();
  const settings = { showPublicUploadWarning: false };

  storage.setItem(PUBLIC_UPLOAD_WARNING_KEY, '1');
  assert.equal(resetPublicUploadWarning(storage, settings), true);
  assert.equal(storage.getItem(PUBLIC_UPLOAD_WARNING_KEY), null);
  assert.equal(settings.showPublicUploadWarning, true);
});

