export const DIRECTORY_SCAN_PAUSED_MESSAGE = 'Folder scanning is paused while this tab is in the background. Return to Blend to resume or cancel. Saved batches remain available.';

function yieldToTask() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function getDocumentVisibility() {
  return globalThis.document?.visibilityState || 'visible';
}

function subscribeToDocumentVisibility(listener) {
  const documentObject = globalThis.document;
  if (typeof documentObject?.addEventListener !== 'function') return () => {};
  documentObject.addEventListener('visibilitychange', listener);
  return () => documentObject.removeEventListener('visibilitychange', listener);
}

function waitForVisible({ getVisibilityState, subscribeVisibilityChange, signal }) {
  return new Promise(resolve => {
    let settled = false;
    let unsubscribe = () => {};

    const finish = visible => {
      if (settled) return;
      settled = true;
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      resolve(visible);
    };
    const onVisibilityChange = () => {
      if (getVisibilityState() !== 'hidden') finish(true);
    };
    const onAbort = () => finish(false);

    if (signal?.aborted) {
      finish(false);
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = subscribeVisibilityChange(onVisibilityChange);
    if (typeof cleanup === 'function') unsubscribe = cleanup;
    if (settled) unsubscribe();
    onVisibilityChange();
  });
}

/**
 * Creates an injectable cooperative yield for directory scans. Hidden scans
 * pause without polling until the document is visible or the caller aborts.
 */
export function createDirectoryScanYield({
  getVisibilityState = getDocumentVisibility,
  subscribeVisibilityChange = subscribeToDocumentVisibility,
  yieldToTaskQueue = yieldToTask
} = {}) {
  if (typeof getVisibilityState !== 'function'
      || typeof subscribeVisibilityChange !== 'function'
      || typeof yieldToTaskQueue !== 'function') {
    throw new TypeError('Directory scan yield dependencies must be functions');
  }

  return async function yieldDirectoryScan({ signal, onVisibilityChange } = {}) {
    await yieldToTaskQueue();
    if (signal?.aborted) return false;

    while (getVisibilityState() === 'hidden') {
      onVisibilityChange?.('hidden');
      const visible = await waitForVisible({
        getVisibilityState,
        subscribeVisibilityChange,
        signal
      });
      if (!visible || signal?.aborted) return false;
      onVisibilityChange?.('visible');
    }

    return true;
  };
}
