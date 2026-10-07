export function createSaveRevisionCoordinator({
  persist,
  delayMs = 850,
  onStatus = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  if (typeof persist !== 'function') throw new TypeError('persist must be a function');

  let dirtyRevision = 0;
  let savedRevision = 0;
  let timer = null;
  let inFlight = null;
  let saving = false;
  let failed = false;

  const isDirty = () => dirtyRevision !== savedRevision;
  const status = () => ({
    dirtyRevision,
    savedRevision,
    dirty: isDirty(),
    saving,
    failed
  });
  const notify = () => {
    try { onStatus(status()); } catch (_) {}
  };

  function cancelTimer() {
    if (timer == null) return;
    clearTimeoutFn(timer);
    timer = null;
  }

  function markDirty() {
    dirtyRevision += 1;
    failed = false;
    schedule();
    notify();
    return dirtyRevision;
  }

  function schedule() {
    if (!isDirty()) return;
    cancelTimer();
    timer = setTimeoutFn(() => {
      timer = null;
      void flush();
    }, delayMs);
  }

  function flush({ force = false } = {}) {
    cancelTimer();
    if (force) {
      dirtyRevision += 1;
      failed = false;
      notify();
    }

    if (inFlight) {
      const pending = inFlight;
      return pending.then(result => {
        if (result !== true) return false;
        return isDirty() ? flush() : true;
      });
    }
    if (!isDirty()) return Promise.resolve(true);

    const revision = dirtyRevision;
    saving = true;
    failed = false;
    notify();

    let operation;
    try {
      operation = Promise.resolve(persist({ revision }));
    } catch (error) {
      operation = Promise.reject(error);
    }

    let task;
    task = (async () => {
      let committed = false;
      try { committed = (await operation) === true; } catch (_) {}

      saving = false;
      if (committed) savedRevision = Math.max(savedRevision, revision);
      failed = !committed;
      notify();

      if (inFlight === task) inFlight = null;
      if (!committed) return false;
      return isDirty() ? flush() : true;
    })();
    inFlight = task;
    return task;
  }

  function saveNow() {
    return flush({ force: true });
  }

  function cancel() {
    cancelTimer();
  }

  function markClean() {
    cancelTimer();
    if (inFlight) return false;
    savedRevision = dirtyRevision;
    failed = false;
    notify();
    return true;
  }

  return {
    markDirty,
    flush,
    saveNow,
    cancel,
    schedule,
    markClean,
    isDirty,
    getStatus: status
  };
}
