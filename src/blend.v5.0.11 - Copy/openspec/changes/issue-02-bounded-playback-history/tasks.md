# Tasks

## 1. Bounded History Helpers and Regression Coverage

- [x] 1.1 Add pure append and compaction helpers to `playback-mode.js`; verify they retain the newest entries up to the supplied cap and safely handle missing or non-array history.
- [x] 1.2 Extend `tests/regression/playback-mode-ui-contract.test.mjs` to cover 1,000 advances for both layers, newest-entry Previous selection, malformed and out-of-range legacy indices, unchanged playlist/slideshow items, and non-linear snapshot JSON size; add a short manual QA checklist and run the focused regression file.

## 2. Runtime, Snapshot, and Accessible Status Integration

- [x] 2.1 Add the named 256-entry cap beside runtime state and use the helpers in both random advance paths, `experienceSnapshotFromState`, and `normalizeExperienceSnapshot`; verify sequential clear behavior and that full-experience exports omit runtime history.
- [x] 2.2 Add a visible polite status near and associated with Previous controls, reveal it when the cap trims entries, and extend `tests/e2e/player-controls.e2e.spec.mjs` to exercise overflow and assert bounded histories plus accessible copy.
- [x] 2.3 Advance the shared asset/cache generation and synchronize active versioned asset URLs; verify `pwa-config.test.mjs` passes and service-worker cache policies remain unchanged.

## 3. Verification and Tracking

- [x] 3.1 Run `npm run check` and the focused playback and PWA regression files; run the focused Playwright history case when worker processes are available and record any blocked or unrun result accurately.
- [x] 3.2 Run strict OpenSpec validation, verify the linked Beads record, and close it only after code and acceptance checks are complete; otherwise keep it open with the remaining verification gap recorded.
