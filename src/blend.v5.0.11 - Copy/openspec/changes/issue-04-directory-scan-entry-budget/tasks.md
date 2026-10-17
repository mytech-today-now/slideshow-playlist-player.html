# Tasks

## 1. Bound directory traversal

- [x] 1.1 Add a 2,000-entry scan limit and count files and directories across recursive traversal, including unsupported entries. Verify the finite limit constant with focused regression coverage.
- [x] 1.2 Return the visited-entry count and a distinct entry-cutoff flag, and ensure discovered media is committed before cutoff reporting. Verify the at-limit media batch and existing cancellation, permission, and depth behavior in focused scan coverage.

## 2. Report partial results and recovery

- [x] 2.1 Update folder-import and missing-media partial status to distinguish the entry ceiling, report observed counts, retain saved results, and offer narrower-folder recovery. Add E2E coverage with an injected tree containing unsupported entries and media at the cutoff; verify no complete status and no duplicate or lost committed media.
- [x] 2.2 Document the per-scan entry ceiling and smaller-folder recovery in README.md, then verify the documented limits agree with the code and status copy.

## 3. Integration verification

- [x] 3.1 Run `npm run check`, `npm run test:regression`, the focused directory-scan E2E spec where the runner permits browser and worker processes, and `openspec validate issue-04-directory-scan-entry-budget --strict`; record exact outcomes and any unavailable browser evidence.

## Verification record

- Synthetic unsupported-entry iterator with `directory-scan-yield.js`: 1,000 entries in 597 ms; 2,000 in 1,237 ms; 5,000 in 3,136 ms; 10,000 in 6,415 ms. These are Node measurements, not browser/device timings.
- `npm run check`: passed.
- `npm run test:regression`: passed, 360 tests.
- `node --check tests/e2e/directory-scan-status.e2e.spec.mjs` and `node --check tests/e2e/missing-media-relink.e2e.spec.mjs`: passed.
- Focused Chromium E2E: the default sandbox attempt stopped before test discovery with `Error: spawn EPERM`. The permitted one-worker rerun `npm run test:e2e -- --project=chromium --workers=1 tests/e2e/directory-scan-status.e2e.spec.mjs tests/e2e/missing-media-relink.e2e.spec.mjs` passed 27/27. Unique artifacts: `test-results/issue-02-entry-budget-2b0f711ede5e` and `playwright-report/issue-02-entry-budget-2b0f711ede5e`. The initial permitted run reproduced a benchmark sampling race in the 1,000-file case; after the test waited for the final rendered status, the complete rerun passed.
- `openspec validate issue-04-directory-scan-entry-budget --strict`: passed.

## Workflow follow-up

- Archive this change only after implementation and applicable review evidence are complete.
