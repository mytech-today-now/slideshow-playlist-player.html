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

## Report-finding verification follow-up

- Linked report finding: `ai-prompts/pre-mortem-2026-10-20-13-13-58.html#issue-03`: **Folder scans stop at 2,000 visited entries and leave a partial result**.
- `npm run sanity`: syntax check passed; regression exited 1 with 370/372 passing and two failures in `tests/regression/playwright-workflow-contract.test.mjs` for a stale browser-matrix count and README launch-failure wording.
- Focused Chromium E2E passed 30/30 with unique output `test-results/issue-03-folder-scan-20261021042214801` and report `playwright-report/issue-03-folder-scan-20261021042214801`. The mixed folder cases cover 1,999, 2,000, and 2,001 available entries; no case yielded over 2,000. Relink recovery, row preservation, keyboard activation, cancellation, permission recovery, and viewport-fit assertions passed.
- The cutoff message now says entries beyond the ceiling, if any, were not visited or inspected, avoiding a false claim when a fixture contains exactly 2,000 entries while retaining partial status and smaller-folder recovery.
- `tests/e2e/verify-playwright-report.mjs` passed for the HTML report; `git diff --check` passed.
- A real native Directory Picker scan over an on-disk folder exceeding 2,000 entries remains Not run. Evidence here is synthetic Chromium fixture coverage; keep Beads `blend-c1s` in progress.

## 2026-10-26 verification linked to the current report

- Current report finding: `ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-03`: **Folder scans stop at 2,000 visited entries and leave a partial result**.
- Before any product-code change, `npm run test:e2e -- --project=chromium --workers=1 --reporter=html,list tests/e2e/directory-scan-status.e2e.spec.mjs tests/e2e/missing-media-relink.e2e.spec.mjs` passed 30/30 in the process-enabled runner. Coverage includes mixed 1,999/2,000/2,001-entry folders, exact cutoff counts, keyboard recovery, retained rows, no duplicates or unintended list-reference changes, and 360x800 toast fit. Unique artifacts: `test-results/issue-03-20261026-prechange` and `playwright-report/issue-03-20261026-prechange`.
- `npm run sanity` passed: syntax checks and 383/383 Node regressions. `node tests/e2e/verify-playwright-report.mjs` passed for the unique HTML report. `openspec validate issue-04-directory-scan-entry-budget --strict` passed.
- No product-code mismatch reproduced, so no app source changes were needed. A real native Directory Picker scan over an on-disk folder exceeding 2,000 entries remains Not run; keep Beads `blend-c1s` in progress.
