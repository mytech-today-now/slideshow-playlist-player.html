// experience-load-progress.js — Loading progress overlay for shared experiences (v5.0.8)
//
// Manages an accessible, animated progress banner shown while a URL-shared
// experience is being decompressed, validated, and imported into IndexedDB.
//
// Public API:
//   createExperienceLoadProgress(overlayEl)  → tracker
//
// The tracker exposes:
//   tracker.start()                  Show overlay, start elapsed timer
//   tracker.update(pct, text)        Update progress bar percentage + status line
//   tracker.addItem(id, name, status) Append an item row to the scrolling item list
//   tracker.complete(ok, msg)        Transition to success or error state, auto-dismiss
//   tracker.dismiss()                Immediately hide and reset the overlay
//
// Item status values (re-exported as ITEM_STATUS):
//   pending · loading · loaded · missing · error
//
// The overlay HTML is authored in index.html; this module only manages its state.
// It has no dependency on app.js internals and can be tested in isolation.

/** Item status constants used by tracker.addItem() and tracker.complete(). */
export const ITEM_STATUS = {
  PENDING:  'pending',
  LOADING:  'loading',
  LOADED:   'loaded',
  MISSING:  'missing',
  ERROR:    'error'
};

// Maximum item rows shown at once — oldest rows are removed as new ones arrive
// to keep the panel compact even for large experiences.
const MAX_VISIBLE_ITEMS = 7;

/**
 * Bind a progress tracker to the #experience-load-overlay element.
 * Must be called after the overlay is present in the DOM.
 *
 * @param {HTMLElement} overlay  The #experience-load-overlay element
 * @returns {{ start, update, addItem, complete, dismiss }}
 */
export function createExperienceLoadProgress(overlay) {
  if (!overlay) {
    // Graceful no-op when the element is absent (e.g. during unit tests).
    const noop = () => {};
    return { start: noop, update: noop, addItem: noop, complete: noop, dismiss: noop };
  }

  const fillEl    = overlay.querySelector('#exp-load-fill');
  const statusEl  = overlay.querySelector('#exp-load-status-text');
  const pctEl     = overlay.querySelector('#exp-load-pct');
  const timerEl   = overlay.querySelector('#exp-load-elapsed');
  const itemsEl   = overlay.querySelector('#exp-load-item-list');
  const errorEl   = overlay.querySelector('#exp-load-error');
  const trackEl   = overlay.querySelector('[role="progressbar"]');
  const spinnerEl = overlay.querySelector('.exp-load-spinner');

  let startMs      = 0;
  let timerHandle  = null;

  // ---- public API ----------------------------------------------------------

  /**
   * Show the overlay and start the elapsed-time counter.
   * Resets all state from any previous run.
   */
  function start() {
    startMs = Date.now();

    // Reset dynamic content.
    if (itemsEl) itemsEl.innerHTML = '';
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
    if (spinnerEl) { spinnerEl.textContent = '↻'; spinnerEl.className = 'exp-load-spinner'; }

    // Clear completion classes from any previous run.
    overlay.classList.remove('exp-load--complete', 'exp-load--error');
    overlay.hidden = false;

    _setProgress(0, 'Preparing…');

    // Tick every second; first tick fires immediately via the setProgress call.
    clearInterval(timerHandle);
    timerHandle = setInterval(_tickTimer, 1000);
  }

  /**
   * Update the progress bar and status text.
   *
   * @param {number} percent   0 – 100
   * @param {string} statusText Short human-readable description of the current step
   */
  function update(percent, statusText) {
    _setProgress(percent, statusText);
  }

  /**
   * Append a media-item row to the scrolling item list.
   * Oldest rows are automatically removed once MAX_VISIBLE_ITEMS is exceeded.
   *
   * @param {string} id     Unique key for deduplication (not shown to user)
   * @param {string} name   Display name (filename / title)
   * @param {string} status One of ITEM_STATUS values
   */
  function addItem(id, name, status) {
    if (!itemsEl) return;

    // Evict the oldest item when we're at capacity.
    while (itemsEl.children.length >= MAX_VISIBLE_ITEMS) {
      itemsEl.removeChild(itemsEl.firstChild);
    }

    const row = document.createElement('div');
    row.className = `exp-load-item exp-load-item--${status}`;
    row.setAttribute('role', 'listitem');
    row.dataset.itemId = String(id);

    const iconEl = document.createElement('span');
    iconEl.className = 'exp-load-item__icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = _icon(status);

    const nameEl = document.createElement('span');
    nameEl.className = 'exp-load-item__name';
    nameEl.textContent = name;
    nameEl.title = name;

    const badgeEl = document.createElement('span');
    badgeEl.className = 'exp-load-item__badge';
    badgeEl.textContent = _badge(status);

    row.append(iconEl, nameEl, badgeEl);
    itemsEl.appendChild(row);

    // Keep the latest item visible.
    itemsEl.scrollTop = itemsEl.scrollHeight;
  }

  /**
   * Transition to the terminal state (success or error) and auto-dismiss on success.
   *
   * @param {boolean} success  true = green completion, false = red error state
   * @param {string}  message  Summary shown in the status line (success) or error box (failure)
   */
  function complete(success, message) {
    clearInterval(timerHandle);
    timerHandle = null;

    if (success) {
      overlay.classList.add('exp-load--complete');
      _setProgress(100, message || 'Done');
      if (spinnerEl) {
        spinnerEl.textContent = '✓'; // ✓
        spinnerEl.className = 'exp-load-spinner exp-load-spinner--done';
      }
      // Auto-dismiss after a brief pause so users can read the completion state.
      setTimeout(dismiss, 2600);
    } else {
      overlay.classList.add('exp-load--error');
      _setProgress(100, 'Loading failed');
      if (errorEl) {
        errorEl.textContent = message || 'An error occurred while loading the shared experience.';
        errorEl.hidden = false;
      }
      // Error state persists until the user reloads or navigates away.
    }
  }

  /**
   * Immediately hide and fully reset the overlay (called on success auto-dismiss,
   * or programmatically when the caller wants to clear the UI before completion).
   */
  function dismiss() {
    clearInterval(timerHandle);
    timerHandle = null;
    overlay.hidden = true;
    overlay.classList.remove('exp-load--complete', 'exp-load--error');
    if (itemsEl) itemsEl.innerHTML = '';
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
    if (spinnerEl) { spinnerEl.textContent = '↻'; spinnerEl.className = 'exp-load-spinner'; } // ↻
    _setProgress(0, '');
  }

  // ---- private helpers -----------------------------------------------------

  function _setProgress(percent, text) {
    const pct = Math.round(Math.max(0, Math.min(100, percent)));
    if (fillEl)   fillEl.style.width  = `${pct}%`;
    if (pctEl)    pctEl.textContent   = `${pct}%`;
    if (statusEl) statusEl.textContent = text || '';
    if (trackEl) {
      trackEl.setAttribute('aria-valuenow', pct);
      trackEl.setAttribute('aria-valuetext', `${pct}%${text ? ` — ${text}` : ''}`);
    }
  }

  function _tickTimer() {
    if (!timerEl || !startMs) return;
    const total = Math.floor((Date.now() - startMs) / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  function _icon(status) {
    return (
      status === ITEM_STATUS.LOADED  ? '✓' :  // ✓
      status === ITEM_STATUS.ERROR   ? '✕' :  // ✕
      status === ITEM_STATUS.MISSING ? '?' :
      status === ITEM_STATUS.LOADING ? '↻' :  // ↻
      '·'                                     // · (pending)
    );
  }

  function _badge(status) {
    return (
      status === ITEM_STATUS.LOADED  ? 'Loaded'    :
      status === ITEM_STATUS.ERROR   ? 'Error'     :
      status === ITEM_STATUS.MISSING ? 'Not Found' :
      status === ITEM_STATUS.LOADING ? 'Loading…' :
      'Queued'
    );
  }

  return { start, update, addItem, complete, dismiss };
}
