import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUBLIC_UPLOAD_WARNING_KEY,
  isResetShareWarningRequested,
  isPublicUploadWarningSuppressed,
  rememberPublicUploadWarningChoice,
  resetPublicUploadWarning,
  shouldShowPublicUploadWarning
} from '../ipfs-share-warning.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
}

test('shows the public upload warning by default', () => {
  const storage = memoryStorage();
  const settings = { showPublicUploadWarning: true };
  assert.equal(shouldShowPublicUploadWarning({ storage, settings }), true);
  assert.equal(isPublicUploadWarningSuppressed(storage), false);
});

test('does not persist suppression when sharing is cancelled', () => {
  const storage = memoryStorage();
  const settings = { showPublicUploadWarning: true };
  const suppressed = rememberPublicUploadWarningChoice({
    confirmed: false,
    dontShowAgain: true,
    storage,
    settings
  });
  assert.equal(suppressed, false);
  assert.equal(storage.getItem(PUBLIC_UPLOAD_WARNING_KEY), null);
  assert.equal(settings.showPublicUploadWarning, true);
});

test('persists dont-show-again only after confirmation', () => {
  const storage = memoryStorage();
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
});

test('reset query and reset helper re-enable the warning', () => {
  const storage = memoryStorage();
  const settings = { showPublicUploadWarning: false };
  storage.setItem(PUBLIC_UPLOAD_WARNING_KEY, '1');
  assert.equal(isResetShareWarningRequested('?resetShareWarning=true'), true);
  assert.equal(shouldShowPublicUploadWarning({ storage, settings, search: '?resetShareWarning=true' }), true);
  assert.equal(storage.getItem(PUBLIC_UPLOAD_WARNING_KEY), null);
  assert.equal(settings.showPublicUploadWarning, true);

  rememberPublicUploadWarningChoice({ confirmed: true, dontShowAgain: true, storage, settings });
  resetPublicUploadWarning(storage, settings);
  assert.equal(storage.getItem(PUBLIC_UPLOAD_WARNING_KEY), null);
  assert.equal(settings.showPublicUploadWarning, true);
});
