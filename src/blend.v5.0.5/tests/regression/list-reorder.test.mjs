import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSelection,
  computeMoveOrder,
  isIdentityOrder,
  applyOrder,
  buildIndexRemap
} from '../../list-reorder.js';

const LIST = ['A', 'B', 'C', 'D', 'E'];

function move(list, selected, insertBefore) {
  return applyOrder(list, computeMoveOrder(list.length, selected, insertBefore));
}

test('normalizeSelection sorts, de-dupes and drops out-of-range indices', () => {
  assert.deepEqual(normalizeSelection(5, [3, 1, 1, 3]), [1, 3]);
  assert.deepEqual(normalizeSelection(5, [-1, 0, 4, 5, 99]), [0, 4]);
  assert.deepEqual(normalizeSelection(5, ['2', 2.9, NaN, undefined]), [2]);
  assert.deepEqual(normalizeSelection(0, [0, 1]), []);
});

test('single item moves down to the requested slot', () => {
  // Drag A (index 0) to after D (gap 4).
  assert.deepEqual(computeMoveOrder(5, [0], 4), [1, 2, 3, 0, 4]);
  assert.deepEqual(move(LIST, [0], 4), ['B', 'C', 'D', 'A', 'E']);
});

test('single item moves up to the front', () => {
  // Drag E (index 4) to the very top (gap 0).
  assert.deepEqual(computeMoveOrder(5, [4], 0), [4, 0, 1, 2, 3]);
  assert.deepEqual(move(LIST, [4], 0), ['E', 'A', 'B', 'C', 'D']);
});

test('dropping an item onto itself is a no-op', () => {
  assert.ok(isIdentityOrder(computeMoveOrder(5, [2], 2)));
  assert.ok(isIdentityOrder(computeMoveOrder(5, [2], 3)));
  assert.deepEqual(move(LIST, [2], 2), LIST);
});

test('a contiguous group moves together and keeps its order', () => {
  // Select B,C (1,2) and drop at the end. D,E shift up, B,C stay B,C.
  assert.deepEqual(computeMoveOrder(5, [1, 2], 5), [0, 3, 4, 1, 2]);
  assert.deepEqual(move(LIST, [1, 2], 5), ['A', 'D', 'E', 'B', 'C']);
});

test('a group dropped mid-list shifts everything at/after the gap down', () => {
  // Select A,B (0,1) and insert before D (gap 3). C bubbles to the top.
  assert.deepEqual(computeMoveOrder(5, [0, 1], 3), [2, 0, 1, 3, 4]);
  assert.deepEqual(move(LIST, [0, 1], 3), ['C', 'A', 'B', 'D', 'E']);
});

test('a non-contiguous selection collapses into one ordered block', () => {
  // Select A,C (0,2) and drop at the end; they keep list order A then C.
  assert.deepEqual(computeMoveOrder(5, [0, 2], 5), [1, 3, 4, 0, 2]);
  assert.deepEqual(move(LIST, [0, 2], 5), ['B', 'D', 'E', 'A', 'C']);
});

test('selection order is normalized to list order regardless of input order', () => {
  assert.deepEqual(move(LIST, [2, 1], 5), move(LIST, [1, 2], 5));
});

test('selecting every item is a no-op', () => {
  assert.ok(isIdentityOrder(computeMoveOrder(5, [0, 1, 2, 3, 4], 0)));
});

test('empty selection is a no-op', () => {
  assert.ok(isIdentityOrder(computeMoveOrder(5, [], 3)));
});

test('insertion index is clamped into range', () => {
  assert.deepEqual(move(LIST, [0], 999), ['B', 'C', 'D', 'E', 'A']);
  assert.deepEqual(move(LIST, [4], -10), ['E', 'A', 'B', 'C', 'D']);
  assert.ok(isIdentityOrder(computeMoveOrder(5, [0], NaN)) === false);
});

test('buildIndexRemap maps original indices to their new positions', () => {
  const order = computeMoveOrder(5, [0], 4); // [1,2,3,0,4]
  const remap = buildIndexRemap(order);
  assert.equal(remap.get(0), 3); // moved item
  assert.equal(remap.get(1), 0);
  assert.equal(remap.get(4), 4);
  // A "currently playing" pointer at index 3 should follow to index 2.
  assert.equal(remap.get(3), 2);
});

test('applyOrder returns a new array and never mutates the input', () => {
  const original = LIST.slice();
  const result = applyOrder(LIST, computeMoveOrder(5, [0], 4));
  assert.notEqual(result, LIST);
  assert.deepEqual(LIST, original);
});
