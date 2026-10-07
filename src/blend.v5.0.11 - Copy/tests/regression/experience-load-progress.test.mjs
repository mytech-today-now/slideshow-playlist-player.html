import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM stub — experience-load-progress.js only touches document.createElement
// inside addItem(); everything else is passed-in element references.
function makeEl() {
  const attrs = Object.create(null);
  const classes = new Set();
  const kids = [];
  let _innerHTML = '';
  return {
    textContent: '',
    get innerHTML()  { return _innerHTML; },
    set innerHTML(v) { _innerHTML = v; if (v === '') kids.length = 0; },
    hidden:    false,
    style:     {},
    className: '',
    title:     '',
    dataset:   {},
    scrollTop: 0,
    get scrollHeight() { return kids.length * 10; },
    get children()    { return kids; },
    get firstChild()  { return kids[0] ?? null; },
    getAttribute(k)   { return attrs[k] ?? null; },
    setAttribute(k,v) { attrs[k] = String(v); },
    removeChild(c)    { const i = kids.indexOf(c); if (i >= 0) kids.splice(i, 1); },
    appendChild(c)    { kids.push(c); return c; },
    append(...ns)     { ns.forEach(n => kids.push(n)); },
    classList: {
      add(...c)     { c.forEach(x => classes.add(x)); },
      remove(...c)  { c.forEach(x => classes.delete(x)); },
      contains(c)   { return classes.has(c); }
    }
  };
}

globalThis.document = { createElement() { return makeEl(); } };

import { ITEM_STATUS, createExperienceLoadProgress } from '../../experience-load-progress.js';

// Build a fully-wired mock overlay for use in tests.
function makeOverlay() {
  const fill    = makeEl();
  const status  = makeEl();
  const pct     = makeEl();
  const elapsed = makeEl();
  const items   = makeEl();
  const error   = makeEl();
  const track   = makeEl();
  const spinner = makeEl();
  const overlay = makeEl();
  overlay.querySelector = sel => ({
    '#exp-load-fill':          fill,
    '#exp-load-status-text':   status,
    '#exp-load-pct':           pct,
    '#exp-load-elapsed':       elapsed,
    '#exp-load-item-list':     items,
    '#exp-load-error':         error,
    '[role="progressbar"]':    track,
    '.exp-load-spinner':       spinner
  }[sel] ?? null);
  return { overlay, fill, status, pct, elapsed, items, error, track, spinner };
}

// ---- ITEM_STATUS ------------------------------------------------------------

test('ITEM_STATUS exports the five canonical status strings', () => {
  assert.equal(ITEM_STATUS.PENDING,  'pending');
  assert.equal(ITEM_STATUS.LOADING,  'loading');
  assert.equal(ITEM_STATUS.LOADED,   'loaded');
  assert.equal(ITEM_STATUS.MISSING,  'missing');
  assert.equal(ITEM_STATUS.ERROR,    'error');
  assert.equal(Object.keys(ITEM_STATUS).length, 5);
});

// ---- null overlay (graceful degradation) ------------------------------------

test('null overlay returns a callable no-op tracker', () => {
  const tracker = createExperienceLoadProgress(null);
  assert.equal(typeof tracker.start,    'function');
  assert.equal(typeof tracker.update,   'function');
  assert.equal(typeof tracker.addItem,  'function');
  assert.equal(typeof tracker.complete, 'function');
  assert.equal(typeof tracker.dismiss,  'function');
  assert.doesNotThrow(() => {
    tracker.start();
    tracker.update(50, 'halfway');
    tracker.addItem('id', 'name.jpg', ITEM_STATUS.LOADED);
    tracker.complete(true, 'done');
    tracker.complete(false, 'failed');
    tracker.dismiss();
  });
});

// ---- start() ----------------------------------------------------------------

test('start() makes overlay visible and resets display to 0%', (t) => {
  t.mock.timers.enable(['setInterval', 'setTimeout']);
  const { overlay, fill, pct, status, track, spinner } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);

  overlay.hidden = true;
  tracker.start();

  assert.equal(overlay.hidden, false,  'overlay becomes visible');
  assert.equal(fill.style.width, '0%', 'fill reset to 0%');
  assert.equal(pct.textContent,  '0%', 'pct text reset');
  assert.equal(status.textContent, 'Preparing…', 'status reset');
  assert.equal(track.getAttribute('aria-valuenow'), '0');
  assert.equal(spinner.textContent, '↻');
  assert.ok(!overlay.classList.contains('exp-load--complete'));
  assert.ok(!overlay.classList.contains('exp-load--error'));

  tracker.dismiss();
});

test('repeated start() clears items and completion classes from a prior run', (t) => {
  t.mock.timers.enable(['setInterval', 'setTimeout']);
  const { overlay, items, spinner } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);

  tracker.start();
  tracker.addItem('a', 'a.jpg', ITEM_STATUS.LOADED);
  overlay.classList.add('exp-load--complete');

  tracker.start(); // second run

  assert.equal(items.children.length, 0, 'items list cleared on restart');
  assert.ok(!overlay.classList.contains('exp-load--complete'), 'complete class cleared');
  assert.equal(spinner.textContent, '↻');

  tracker.dismiss();
});

// ---- update() ---------------------------------------------------------------

test('update() clamps percent to [0, 100] and sets ARIA attributes', (t) => {
  t.mock.timers.enable(['setInterval', 'setTimeout']);
  const { overlay, fill, pct, status, track } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);
  tracker.start();

  tracker.update(45, 'Validating schema…');
  assert.equal(fill.style.width,  '45%');
  assert.equal(pct.textContent,   '45%');
  assert.equal(status.textContent,'Validating schema…');
  assert.equal(track.getAttribute('aria-valuenow'), '45');
  const vt = track.getAttribute('aria-valuetext');
  assert.ok(vt.includes('45%'));
  assert.ok(vt.includes('Validating schema…'));

  tracker.update(150, 'Over');
  assert.equal(fill.style.width, '100%', 'clamped to 100');

  tracker.update(-10, 'Under');
  assert.equal(fill.style.width, '0%',  'clamped to 0');

  tracker.dismiss();
});

test('update() rounds fractional percentages', (t) => {
  t.mock.timers.enable(['setInterval', 'setTimeout']);
  const { overlay, fill, pct } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);
  tracker.start();

  tracker.update(33.7, 'Fractional');
  assert.equal(fill.style.width, '34%');
  assert.equal(pct.textContent,  '34%');

  tracker.dismiss();
});

// ---- addItem() --------------------------------------------------------------

test('addItem() appends a row with status class, icon and badge', () => {
  const cases = [
    [ITEM_STATUS.LOADED,  '✓', 'Loaded'],
    [ITEM_STATUS.ERROR,   '✕', 'Error'],
    [ITEM_STATUS.MISSING, '?', 'Not Found'],
    [ITEM_STATUS.LOADING, '↻', 'Loading…'],
    [ITEM_STATUS.PENDING, '·', 'Queued']
  ];
  for (const [status, expectedIcon, expectedBadge] of cases) {
    const { overlay, items } = makeOverlay();
    const tracker = createExperienceLoadProgress(overlay);
    tracker.addItem(`${status}-id`, 'test.jpg', status);

    assert.equal(items.children.length, 1, `one row for status=${status}`);
    const row = items.children[0];
    assert.ok(row.className.includes(`exp-load-item--${status}`));
    assert.equal(row.children[0].textContent, expectedIcon,  `icon for ${status}`);
    assert.equal(row.children[row.children.length - 1].textContent, expectedBadge, `badge for ${status}`);
  }
});

test('addItem() evicts the oldest row once MAX_VISIBLE_ITEMS (7) is exceeded', () => {
  const { overlay, items } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);

  for (let i = 0; i < 7; i++) {
    tracker.addItem(`id-${i}`, `file-${i}.jpg`, ITEM_STATUS.LOADED);
  }
  assert.equal(items.children.length, 7, 'seven items present at capacity');
  const firstDataId = items.children[0].dataset.itemId;

  // 8th item → oldest evicted
  tracker.addItem('id-7', 'file-7.jpg', ITEM_STATUS.MISSING);
  assert.equal(items.children.length, 7, 'still seven after eviction');
  assert.notEqual(items.children[0].dataset.itemId, firstDataId, 'oldest row was removed');

  const last = items.children[items.children.length - 1];
  assert.ok(last.className.includes('exp-load-item--missing'), 'newest row has correct status');
});

test('addItem() stores itemId in dataset for deduplication support', () => {
  const { overlay, items } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);

  tracker.addItem('my-unique-id', 'photo.jpg', ITEM_STATUS.LOADED);
  assert.equal(items.children[0].dataset.itemId, 'my-unique-id');
});

// ---- complete() -------------------------------------------------------------

test('complete(true) adds success class, sets 100% and changes spinner to ✓', (t) => {
  t.mock.timers.enable(['setInterval', 'setTimeout']);
  const { overlay, fill, pct, spinner } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);
  tracker.start();

  tracker.complete(true, 'Loaded "Test" — 3 playlist, 5 slideshow items');

  assert.ok(overlay.classList.contains('exp-load--complete'));
  assert.ok(!overlay.classList.contains('exp-load--error'));
  assert.equal(fill.style.width, '100%');
  assert.equal(pct.textContent,  '100%');
  assert.equal(spinner.textContent, '✓');
  assert.ok(spinner.className.includes('exp-load-spinner--done'));
  assert.equal(overlay.hidden, false, 'still visible before auto-dismiss delay');

  tracker.dismiss(); // cancel pending auto-dismiss
});

test('complete(true) auto-dismisses after 2600 ms', (t) => {
  t.mock.timers.enable(['setInterval', 'setTimeout']);
  const { overlay } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);
  tracker.start();

  tracker.complete(true, 'Done');

  assert.equal(overlay.hidden, false);
  t.mock.timers.tick(2599);
  assert.equal(overlay.hidden, false, 'not dismissed before 2600 ms');
  t.mock.timers.tick(1);
  assert.equal(overlay.hidden, true,  'dismissed at exactly 2600 ms');
});

test('complete(false) adds error class and shows error message, never auto-dismisses', (t) => {
  t.mock.timers.enable(['setInterval', 'setTimeout']);
  const { overlay, fill, pct, error } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);
  tracker.start();

  tracker.complete(false, 'Could not decode share link: invalid payload');

  assert.ok(overlay.classList.contains('exp-load--error'));
  assert.ok(!overlay.classList.contains('exp-load--complete'));
  assert.equal(fill.style.width, '100%');
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, 'Could not decode share link: invalid payload');
  assert.equal(overlay.hidden, false, 'error state persists');

  t.mock.timers.tick(10000);
  assert.equal(overlay.hidden, false, 'error state must not auto-dismiss');
});

// ---- dismiss() --------------------------------------------------------------

test('dismiss() hides overlay and fully resets visible state', (t) => {
  t.mock.timers.enable(['setInterval', 'setTimeout']);
  const { overlay, items, error, spinner, fill, pct } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);
  tracker.start();
  tracker.addItem('a', 'a.jpg', ITEM_STATUS.LOADED);

  tracker.dismiss();

  assert.equal(overlay.hidden, true);
  assert.ok(!overlay.classList.contains('exp-load--complete'));
  assert.ok(!overlay.classList.contains('exp-load--error'));
  assert.equal(items.children.length, 0);
  assert.equal(error.hidden, true);
  assert.equal(error.textContent, '');
  assert.equal(spinner.textContent, '↻');
  assert.equal(fill.style.width, '0%');
  assert.equal(pct.textContent,  '0%');
});

test('dismiss() is idempotent — calling it twice does not throw', (t) => {
  t.mock.timers.enable(['setInterval', 'setTimeout']);
  const { overlay } = makeOverlay();
  const tracker = createExperienceLoadProgress(overlay);
  tracker.start();

  assert.doesNotThrow(() => {
    tracker.dismiss();
    tracker.dismiss();
  });
});
