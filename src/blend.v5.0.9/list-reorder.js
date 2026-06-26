// =====================================================
// list-reorder.js
// Pure, DOM-free reordering math shared by the playlist and
// slideshow editors. Kept side-effect free so it can be unit
// tested in node without a browser (see tests/regression).
//
// The core model: given a list length, a set of currently selected
// indices, and an "insert before" gap index in ORIGINAL list
// coordinates (0..length), produce the new ordering as an array of
// original indices. Selected items keep their relative order and are
// placed as a contiguous block at the insertion point; everything at
// or after the insertion point shifts down by the size of the block.
// =====================================================

/**
 * Normalize an arbitrary selection into a sorted, de-duplicated array
 * of in-range integer indices (ascending = list order).
 * @param {number} length
 * @param {Iterable<number>} selected
 * @returns {number[]}
 */
export function normalizeSelection(length, selected) {
  const len = Math.max(0, Math.trunc(Number(length)) || 0);
  const seen = new Set();
  const out = [];
  for (const raw of selected || []) {
    const i = Math.trunc(Number(raw));
    if (Number.isInteger(i) && i >= 0 && i < len && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Compute the new ordering after moving the selected indices so that
 * the block begins at the given insertion gap.
 * @param {number} length total item count
 * @param {Iterable<number>} selected indices being moved
 * @param {number} insertBefore gap index in original coordinates (0..length)
 * @returns {number[]} new order expressed as original indices
 */
export function computeMoveOrder(length, selected, insertBefore) {
  const len = Math.max(0, Math.trunc(Number(length)) || 0);
  const order = Array.from({ length: len }, (_, i) => i);
  const sel = normalizeSelection(len, selected);
  if (!sel.length || sel.length === len) return order;

  let gap = Math.trunc(Number(insertBefore));
  if (!Number.isFinite(gap)) gap = len;
  gap = Math.max(0, Math.min(gap, len));

  const selSet = new Set(sel);
  const remaining = order.filter(i => !selSet.has(i));
  // How many selected items sit before the gap — they vacate those
  // slots, so the insertion position within `remaining` shifts left.
  const numBefore = sel.reduce((count, i) => (i < gap ? count + 1 : count), 0);
  const pos = gap - numBefore;
  return remaining.slice(0, pos).concat(sel, remaining.slice(pos));
}

/**
 * True when an order array is the identity permutation (no movement).
 * @param {number[]} order
 * @returns {boolean}
 */
export function isIdentityOrder(order) {
  if (!Array.isArray(order)) return true;
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== i) return false;
  }
  return true;
}

/**
 * Apply an order array to a concrete list, returning a new array.
 * @template T
 * @param {T[]} list
 * @param {number[]} order
 * @returns {T[]}
 */
export function applyOrder(list, order) {
  if (!Array.isArray(list) || !Array.isArray(order)) return Array.isArray(list) ? list.slice() : [];
  return order.map(i => list[i]);
}

/**
 * Map original index -> new index for an order array. Useful for
 * remapping a "currently playing" pointer or navigation history after
 * a reorder.
 * @param {number[]} order
 * @returns {Map<number, number>}
 */
export function buildIndexRemap(order) {
  const map = new Map();
  if (!Array.isArray(order)) return map;
  order.forEach((oldIndex, newIndex) => map.set(oldIndex, newIndex));
  return map;
}
