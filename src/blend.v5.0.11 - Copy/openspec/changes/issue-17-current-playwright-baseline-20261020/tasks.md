# Tasks

## 1. Baseline identity and local checks

- [x] 1.1 Inspect the supplied Issue 17 request, current Git status, Playwright config, CI workflow, report verifier, modified E2E specs, README browser evidence, and existing output artifacts. Preserve unrelated dirty work and historical reports.
- [x] 1.2 Record revision `d85f7450148ce5d3ba1843651c13cab0a694cc3b`, dirty-worktree state, Node `v24.14.1`, Playwright `1.63.0`, and engine versions Chromium `153.0.8010.12`, Firefox `155.0`, and WebKit `26.6`.
- [x] 1.3 `npm run check` exited 0. `npm run test:regression` reported 371 tests: 369 passed, 2 failed, 0 skipped. Both failures are stale README workflow-contract expectations in `tests/regression/playwright-workflow-contract.test.mjs`; the separate Issue 16 record `blend-qlo` already tracks them. Their source was left unchanged.

## 2. Current browser baseline

- [x] 2.1 The sandbox invocation stopped before discovery with `Error: spawn EPERM` and executed no tests; its one-file no-tests report passed the verifier. The process-enabled full run on the same dirty worktree completed 315 tests in 10.3 minutes: 298 passed, 5 failed, 12 skipped. Per-project passed/failed/skipped counts were Chromium 246/3/4, Firefox 26/2/3, and WebKit 26/0/5. Live-provider smoke variables were absent. The report is under `%TEMP%\blend-issue17-final-full-20261020-9763df3b043442d596f0b1c5090ba788\playwright-report`.
- [x] 2.2 The first process-enabled run had 299 passed, 4 failed, and 12 skipped. Serial traced reruns passed the Add Files quota, list-reorder, and Firefox atomicity cases; the Bitbucket read-failure case reproduced because focus was lost after the busy button was disabled. `app.js` now restores focus only when the read button began focused and focus remains on `document.body`. The existing E2E case also had a 10-second expectation against a 21-second fixture delay and 20-second product timeout; only that wait was raised to 25 seconds. The focused case then passed 1/1 in 26.3 seconds. In the final full run, its Bitbucket case passed. All five final full-run failures passed isolated serial traced reruns: experience lifecycle (1/1), experience share/import (1/1), missing-media relink (1/1), Firefox Add Files (1/1), and Firefox thumbnail failure (1/1). The five were not reproduced serially.
- [x] 2.3 The final full HTML report displayed 298 passed, 5 failed, and 12 skipped and passed `node tests/e2e/verify-playwright-report.mjs` with 7 files and no credential-like values or private local paths. The sandbox no-tests report passed with 1 file. Trace-report verification rejected ZIP attachments in each traced output; all trace reports remain local in unique `%TEMP%` directories. No report was uploaded.

## 3. Tracking and validation

- [x] 3.1 Updated Beads `blend-6dw` with the current supported run, serial trace triage, report verification, and regression evidence; verified the record and closed it after acceptance.
- [x] 3.2 Strict validation passed; reviewed the final diff and status. Historical reports and pre-existing Issue 16 work remain untouched.

## 4. Report issue-07 current-tree revalidation (2026-10-21)

- [x] 4.1 Recheck the dirty worktree at revision `92e08696fe45b4b651661c20d68803add2433d21`; record Node `v24.14.1`, Playwright `1.63.0`, Chromium `153.0.8010.12`, Firefox `155.0`, and WebKit `26.6`. `npm run check` exited 0, `npm run test:regression` passed 373/373, and `npx playwright test --config=playwright.config.mjs --list` exited 0 with 318 discovered tests in 46 files (256 Chromium, 31 Firefox, 31 WebKit).
- [x] 4.2 The process-enabled `npm run test:e2e` executed all 318 tests in 9.2 minutes: 303 passed, 3 failed, and 12 skipped. Per project (passed/failed/skipped): Chromium 249/3/4, Firefox 28/0/3, WebKit 26/0/5. The three failures were Chromium assertions in two `missing-media-relink.e2e.spec.mjs` cases and one `player-controls.e2e.spec.mjs` case. No opt-in GitHub or Bitbucket smoke variables were set.
- [x] 4.3 The full HTML report at `%TEMP%\blend-issue07-full-process-bc16a59a7714469c9267c8feb2a6714a\playwright-report` passed `node tests/e2e/verify-playwright-report.mjs`: 5 files, no credential-like values or private local paths. The separate default-sandbox attempt stopped with `spawn EPERM` before discovery and ran zero assertions.
- [x] 4.4 Each of the three full-run failures passed a separate one-test Chromium rerun with `--workers=1 --trace=on`; none reproduced in isolation. The trace outputs remain in unique temporary directories. No app behavior or E2E assertion was changed in response to these failures.
- [x] 4.5 Updated the README and its workflow-contract regression to link the current evidence to `ai-prompts/pre-mortem-2026-10-20-13-13-58.html#issue-07`; updated the exact Beads record `blend-6dw`; reran `npm run check`, `npm run test:regression`, and Playwright discovery; strict OpenSpec validation passed.

## Workflow follow-up

- The current-tree browser baseline is now known and non-green. Keep the three non-reproduced full-run failures documented as flaky evidence; do not describe the run as a green suite or release pass.
