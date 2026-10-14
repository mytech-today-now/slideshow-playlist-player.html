# Tasks

## 1. Visibility-aware yield

- [x] 1.1 Add an injectable visibility-aware task-yield module and regression tests for visible yielding, hidden pause/resume, abort while paused, and listener cleanup; verify with its focused Node test.
- [x] 1.2 Replace the directory walk's animation-frame wait, announce the required paused status, and add a keyboard-operable Cancel scan action; verify syntax and focused scan regressions.

## 2. Directory scan lifecycle coverage

- [x] 2.1 Add synthetic E2E coverage for a hidden pause and same-iterator resume after the 250-file batch; assert progress, existing limits, and no duplicate media.
- [x] 2.2 Add E2E coverage for keyboard cancellation while paused and permission loss on resume; assert accessible partial outcomes and retained committed data.

## 3. Verification

- [x] 3.1 Run `npm run check`, `npm run test:regression`, both requested directory scan E2E specs, and `openspec validate issue-16-directory-scan-visibility-pause --strict`; record actual results.
- [x] 3.2 Attempt real foreground/background tab switching in Chromium, Firefox, and WebKit and compare progress behavior; record any unavailable browser or remaining manual/device coverage.

## Workflow follow-up

- Archive the OpenSpec change only after implementation and applicable review evidence are complete.

## Verification record

- `npm run check`: passed.
- `node --test tests/regression/directory-scan-yield.test.mjs`: passed, 4/4 tests.
- `npm run test:regression`: passed, 353/353 tests.
- `npm run test:e2e -- tests/e2e/directory-scan-status.e2e.spec.mjs tests/e2e/directory-scan-visibility.e2e.spec.mjs --workers=1`: passed, 17; skipped, 3 native background-tab cases. Simulated visibility pause/resume passed in Chromium, Firefox, and WebKit. The native cases attempted to move the scan page to the background, but this Playwright session did not expose `document.visibilityState === "hidden"` in any engine, so actual native progress behavior remains unverified.
- `npm run test:e2e -- tests/e2e/pwa-offline.e2e.spec.mjs`: passed, 5/5 tests.
- `npm run test:e2e -- tests/e2e/local-import-bounds.e2e.spec.mjs`: 3/4 passed. One repeated-file-chooser case timed out waiting for the chooser in both the full run and focused rerun; no related import-input code was changed.
- `openspec validate issue-16-directory-scan-visibility-pause --strict`: passed.
- Manual tab switching, screen-reader announcement, and mobile background/resume remain device/browser coverage gaps. Do not treat the simulated visibility tests as proof of those behaviors.

### Issue 13 native visibility follow-up (2026-10-13)

- Environment: Microsoft Windows 10.0.26300.0; Playwright 1.63.0; Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6.
- `npm run test:e2e -- tests/e2e/directory-scan-visibility.e2e.spec.mjs --workers=1`: exit 0; 3 passed and 3 skipped. The synthetic pause/resume case passed in all three engines. Each native case opened a second page and brought it to the foreground, but the scan page never reported `document.visibilityState === "hidden"`; native pause/progress/resume assertions did not run.
- `npm run test:e2e -- tests/e2e/directory-scan-visibility.e2e.spec.mjs --workers=1 --headed`: exit 0; 3 passed and 3 skipped with the same native visibility result in all engines.
- The initial sandboxed focused E2E invocation exited 1 with `spawn EPERM` before tests started. The exact focused command then completed in a process-enabled session as recorded above.
- `npm run test:e2e -- tests/e2e/directory-scan-status.e2e.spec.mjs tests/e2e/directory-scan-visibility.e2e.spec.mjs --workers=1`: exit 1; 16 passed, 3 skipped, and 2 failed. The 250-file boundary case passed with 250 imported files. The two failures were a directory-toast viewport assertion (bottom 392.35 px against a 391 px limit) and the 1,000-file benchmark's `finalProgressCount` assertion (expected 1,000, measured 0 after the expected final status text appeared).
- `npm run test:e2e -- tests/e2e/directory-scan-status.e2e.spec.mjs --project=chromium --grep 'a limited scan reports pending files|broad six-level folder respects media and entry bounds \(1000\)' --workers=1`: exit 1; the viewport/recovery case passed in isolation and the 1,000-file benchmark assertion failed again with the same expected 1,000, measured 0 result. These adjacent scan-status assertions remain unresolved and were not changed in this visibility review.
- `node --test tests/regression/directory-scan-yield.test.mjs`: exit 1 before assertions with `spawn EPERM`; `node --test --test-isolation=none tests/regression/directory-scan-yield.test.mjs`: exit 0, 4/4 passed.
- `npm run check`: exit 0. `npm run test:regression`: exit 0, 360/360 passed.
- Issue 13 remains unverified for native hidden-tab behavior. The supplied tracking artifact remains `ai-prompts/pre-mortem-2026-10-13-14-11-28.html#issue-13`; manual/device tab switching is still needed. No lifecycle defect was reproduced, so the scan helper and Cancel/partial-result behavior were not changed.
