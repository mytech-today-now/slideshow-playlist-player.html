# Tasks

## 1. Deterministic save coordinator coverage

- [x] 1.1 Extend `tests/regression/save-state.test.mjs` with injected fake timers and deferred persistence to verify debounce coalescing, dirty status through delayed commits, edits during an in-flight commit, and overlapping flush calls without duplicate writes; run the focused test with the repository's serial fallback when worker creation is blocked.

## 2. Browser lifecycle boundary and guidance

- [x] 2.1 Extend `tests/e2e/save-lifecycle.e2e.spec.mjs` to compare a clean page's active and persisted snapshot after reload near 100 ms, 800 ms, and after the 850 ms debounce; keep pre-debounce expectations limited to either complete snapshot, retain controlled transition and failure-recovery assertions, and verify selection/playback state survives failure; focused Chromium Playwright run passed all 8 tests.
- [x] 2.2 Update the persistence guidance in `README.md` to state that shutdown flushes are best effort and keep the existing retry/export copy; verify the wording and accessible E2E status assertions.

## 3. Integration verification and tracker status

- [x] 3.1 Run `npm run check`, `npm run test:regression`, and `npm run test:e2e -- tests/e2e/save-lifecycle.e2e.spec.mjs`; record `check` passed, `regression` passed 331/331, and focused Chromium E2E passed 8/8 after the sandbox blocked the initial child-process launch.
- [x] 3.2 Validate this OpenSpec change with strict validation and verify Beads issue `blend-jtk`, the exact Issue 05 title, and final `closed` status with `bd show`.
