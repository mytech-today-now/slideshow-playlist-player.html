export const PUBLIC_UPLOAD_WARNING_KEY = 'blend-ipfs-public-upload-warning-suppressed-v1';

function hasStorage(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}

export function resetPublicUploadWarning(storage = globalThis.localStorage, settings = null) {
  if (hasStorage(storage) && typeof storage.removeItem === 'function') {
    try { storage.removeItem(PUBLIC_UPLOAD_WARNING_KEY); } catch (_) {}
  }
  if (settings && typeof settings === 'object') {
    settings.showPublicUploadWarning = true;
  }
  return true;
}

export function isResetShareWarningRequested(search = globalThis.location?.search || '') {
  try {
    const params = new URLSearchParams(String(search || ''));
    const value = String(params.get('resetShareWarning') || '').toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  } catch (_) {
    return false;
  }
}

export function isPublicUploadWarningSuppressed(storage = globalThis.localStorage) {
  if (!hasStorage(storage)) return false;
  try {
    return storage.getItem(PUBLIC_UPLOAD_WARNING_KEY) === '1';
  } catch (_) {
    return false;
  }
}

export function shouldShowPublicUploadWarning({
  storage = globalThis.localStorage,
  settings = null,
  search = globalThis.location?.search || ''
} = {}) {
  if (isResetShareWarningRequested(search)) {
    resetPublicUploadWarning(storage, settings);
    return true;
  }
  if (settings && settings.showPublicUploadWarning === false) return false;
  return !isPublicUploadWarningSuppressed(storage);
}

export function rememberPublicUploadWarningChoice({
  confirmed,
  dontShowAgain,
  storage = globalThis.localStorage,
  settings = null
} = {}) {
  if (!confirmed) return false;
  const suppress = !!dontShowAgain;
  if (settings && typeof settings === 'object') {
    settings.showPublicUploadWarning = !suppress;
  }
  if (hasStorage(storage)) {
    try {
      if (suppress) storage.setItem(PUBLIC_UPLOAD_WARNING_KEY, '1');
      else if (typeof storage.removeItem === 'function') storage.removeItem(PUBLIC_UPLOAD_WARNING_KEY);
    } catch (_) {}
  }
  return suppress;
}
