const DEFAULTS = {
  longPressMs: 160,
  moveThreshold: 8,
  itemSelector: '.list-item',
  handleSelector: '.drag',
  ignoreSelector: 'input,button,select,textarea,label,a,[contenteditable="true"],[role="button"]'
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPointedRow(container, itemSelector, clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const row = el?.closest?.(itemSelector) || null;
  return row && container.contains(row) ? row : null;
}

function getRowIndex(row, fallback = -1) {
  const idx = Number.parseInt(row?.dataset?.idx ?? '', 10);
  return Number.isFinite(idx) ? idx : fallback;
}

function clearDropClasses(container, itemSelector) {
  container.classList.remove('list-drop-active');
  const target = container.querySelector(`${itemSelector}.drop-target`);
  if (target) {
    target.classList.remove('drop-target');
    target.removeAttribute('data-drop-position');
  }
  container.querySelector(`${itemSelector}.dragging`)?.classList.remove('dragging');
}

/**
 * Pointer-driven sortable fallback for virtualized list editors.
 * This handles mouse, pen, and touch reordering without relying on
 * HTML5 drag-and-drop so the insertion marker stays consistent.
 * @param {HTMLElement} container
 * @param {{
 *  itemSelector?: string,
 *  handleSelector?: string,
 *  ignoreSelector?: string,
 *  longPressMs?: number,
 *  moveThreshold?: number,
 *  getItemCount?: () => number,
 *  onReorder?: (info: {fromIndex: number, toIndex: number, sourceRow: HTMLElement, dropRow: HTMLElement | null, pointerType: string}) => void
 * }} options
 */
export function createPointerReorderFallback(container, options = {}) {
  const itemSelector = options.itemSelector || DEFAULTS.itemSelector;
  const handleSelector = options.handleSelector || DEFAULTS.handleSelector;
  const ignoreSelector = options.ignoreSelector || DEFAULTS.ignoreSelector;
  const longPressMs = Number.isFinite(options.longPressMs) ? options.longPressMs : DEFAULTS.longPressMs;
  const moveThreshold = Number.isFinite(options.moveThreshold) ? options.moveThreshold : DEFAULTS.moveThreshold;

  const state = {
    pending: null,
    active: null,
    timer: 0
  };

  function getCount() {
    const raw = options.getItemCount?.();
    return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : container.querySelectorAll(itemSelector).length;
  }

  function finish() {
    const pointerId = state.active?.pointerId ?? state.pending?.pointerId;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = 0;
    }
    if (state.pending?.row) {
      state.pending.row.classList.remove('dragging');
    }
    if (state.active?.row) {
      state.active.row.classList.remove('dragging');
    }
    clearDropClasses(container, itemSelector);
    state.pending = null;
    state.active = null;
    if (pointerId != null) {
      try { container.releasePointerCapture?.(pointerId); } catch (_) {}
    }
  }

  function setDropTarget(row, before) {
    const prior = container.querySelector(`${itemSelector}.drop-target`);
    if (prior && prior !== row) {
      prior.classList.remove('drop-target');
      prior.removeAttribute('data-drop-position');
    }
    if (!row) {
      container.classList.remove('list-drop-active');
      return;
    }
    container.classList.add('list-drop-active');
    row.classList.add('drop-target');
    row.dataset.dropPosition = before ? 'before' : 'after';
  }

  function computeInsertIndex(targetRow, clientY) {
    const count = getCount();
    if (!count) return 0;
    const rows = Array.from(container.querySelectorAll(itemSelector));
    if (!targetRow || !container.contains(targetRow)) {
      if (!rows.length) return 0;
      const firstRect = rows[0].getBoundingClientRect();
      const lastRect = rows[rows.length - 1].getBoundingClientRect();
      if (clientY <= firstRect.top) return 0;
      if (clientY >= lastRect.bottom) return count;
      targetRow = rows.reduce((best, row) => {
        if (!best) return row;
        const bestRect = best.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const bestCenter = bestRect.top + bestRect.height / 2;
        const rowCenter = rowRect.top + rowRect.height / 2;
        return Math.abs(clientY - rowCenter) < Math.abs(clientY - bestCenter) ? row : best;
      }, null);
    }

    const rowIndex = getRowIndex(targetRow, count);
    const rect = targetRow?.getBoundingClientRect?.();
    const before = !rect || clientY <= rect.top + rect.height / 2;
    // Return the insertion *gap* in original list coordinates (0..count).
    // The caller (which may move a multi-item selection) is responsible
    // for accounting for items removed from earlier positions, so we do
    // not pre-adjust for the dragged source here.
    const insertIndex = before ? rowIndex : rowIndex + 1;
    return clamp(insertIndex, 0, count);
  }

  function updateFromPoint(event) {
    const row = getPointedRow(container, itemSelector, event.clientX, event.clientY);
    if (!row) {
      container.querySelector(`${itemSelector}.drop-target`)?.classList.remove('drop-target');
      container.classList.add('list-drop-active');
      return;
    }
    const rect = row.getBoundingClientRect();
    const before = event.clientY <= rect.top + rect.height / 2;
    setDropTarget(row, before);
  }

  function beginDrag() {
    const pending = state.pending;
    if (!pending) return;
    state.active = pending;
    state.pending = null;
    // Capture only once a drag truly starts. Capturing on pointerdown
    // would retarget the synthetic click that follows a plain tap to the
    // container, breaking click-to-select / click-to-play.
    try { container.setPointerCapture?.(pending.pointerId); } catch (_) {}
    pending.row.classList.add('dragging');
    container.classList.add('list-drop-active');
    options.onDragStart?.({ fromIndex: pending.fromIndex, sourceRow: pending.row, pointerType: pending.pointerType });
    updateFromPoint(pending.event);
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    const row = event.target?.closest?.(itemSelector);
    if (!row || !container.contains(row)) return;
    if (event.target?.closest?.(ignoreSelector) && !event.target?.closest?.(handleSelector)) return;

    const fromIndex = getRowIndex(row, -1);
    if (fromIndex < 0) return;

    const fromHandle = !!event.target?.closest?.(handleSelector);

    if (state.timer) clearTimeout(state.timer);
    state.pending = {
      row,
      fromIndex,
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'touch',
      fromHandle,
      startX: event.clientX,
      startY: event.clientY,
      event
    };

    // Mouse drags begin on the first move past threshold. Touch/pen
    // drags begun from the dedicated handle (which is touch-action:none,
    // so the page will not scroll) also begin on move; otherwise we wait
    // for a long-press so a plain swipe can still scroll the list.
    if (state.pending.pointerType === 'mouse' || fromHandle) {
      state.timer = 0;
      return;
    }
    state.timer = setTimeout(beginDrag, longPressMs);
  }

  function onPointerMove(event) {
    if (state.pending && event.pointerId === state.pending.pointerId) {
      const dx = Math.abs(event.clientX - state.pending.startX);
      const dy = Math.abs(event.clientY - state.pending.startY);
      const moved = dx > moveThreshold || dy > moveThreshold;
      if (state.pending.pointerType === 'mouse' || state.pending.fromHandle) {
        if (moved) {
          beginDrag();
          event.preventDefault();
          updateFromPoint(event);
        }
        return;
      }
      if (moved) {
        finish();
      }
      return;
    }

    if (!state.active || event.pointerId !== state.active.pointerId) return;
    event.preventDefault();
    state.active.event = event;
    updateFromPoint(event);
  }

  function commit(event) {
    if (!state.active || event.pointerId !== state.active.pointerId) {
      finish();
      return;
    }

    const targetRow = getPointedRow(container, itemSelector, event.clientX, event.clientY);
    const insertIndex = computeInsertIndex(targetRow, event.clientY);
    const info = {
      fromIndex: state.active.fromIndex,
      // `insertIndex` is the gap in original coordinates; `toIndex` is
      // kept as an alias for backwards compatibility.
      insertIndex,
      toIndex: insertIndex,
      sourceRow: state.active.row,
      dropRow: targetRow,
      pointerType: state.active.pointerType
    };

    finish(true);

    // A real drag occurred (movement past threshold). Always notify so
    // callers can suppress the synthetic click that follows pointerup.
    options.onDragEnd?.(info);

    if (Number.isFinite(insertIndex) && insertIndex >= 0) {
      options.onReorder?.(info);
    }
  }

  function onPointerUp(event) {
    if (state.active && event.pointerId === state.active.pointerId) {
      commit(event);
      return;
    }
    if (state.pending && event.pointerId === state.pending.pointerId) {
      finish();
    }
  }

  function onPointerCancel(event) {
    if ((state.active && event.pointerId === state.active.pointerId) || (state.pending && event.pointerId === state.pending.pointerId)) {
      finish();
    }
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove, { passive: false });
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);

  return {
    refresh() {
      if (!state.active && !state.pending) {
        clearDropClasses(container, itemSelector);
      }
    },
    destroy() {
      finish();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
    }
  };
}
