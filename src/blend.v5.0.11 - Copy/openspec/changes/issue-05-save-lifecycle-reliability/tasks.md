# Tasks

## 1. Deterministic save coordinator coverage

- [x] 1.1 Extend `tests/regression/save-state.test.mjs` with injected fake timers and deferred persistence to verify debounce coalescing, dirty status through delayed commits, edits during an in-flight commit, and overlapping flush calls without duplicate writes; run the focused test with the repository's serial fallback when worker creation is blocked.

## 2. Browser lifecycle boundary and guidance

- [x] 2.1 Extend `tests/e2e/save-lifecycle.e2e.spec.mjs` to compare a clean page's active and persisted snapshot after reload near 100 ms, 800 ms, and after the 850 ms debounce; keep pre-debounce expectations limited to either complete snapshot, retain controlled transition and failure-recovery assertions, and verify selection/playback state survives failure; focused Chromium Playwright run passed all 8 tests.
- [x] 2.2 Update the persistence guidance in `README.md` to state that shutdown flushes are best effort and keep the existing retry/export copy; verify the wording and accessible E2E status assertions.
- [x] 2.3 Inject a failure after the first IndexedDB snapshot write is queued in the browser E2E; assert the atomic transaction aborts while Retry and Export Backup retain and recover the dirty edit, and verify reflow, overflow, scroll, and focus at the report viewports and a 200% zoom equivalent; process-enabled Chromium, Firefox, and WebKit run passed 10/10.

## 3. Integration verification and tracker status

- [x] 3.1 Run `npm run check`, `npm run test:regression`, and `npm run test:e2e -- tests/e2e/save-lifecycle.e2e.spec.mjs`; record `check` passed, `regression` passed 361/361, and process-enabled save-lifecycle E2E passed 10/10 across Chromium, Firefox, and WebKit in unique output `test-results/issue-03-save-lifecycle-20261018-233257046`.
- [x] 3.2 Validate this OpenSpec change with strict validation and verify Beads issue `blend-jtk`, the exact Issue 05 title, and final `closed` status with `bd show`.
