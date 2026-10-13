# Tasks

## 1. Visibility-aware yield

- [x] 1.1 Add an injectable visibility-aware task-yield module and regression tests for visible yielding, hidden pause/resume, abort while paused, and listener cleanup; verify with its focused Node test.
- [x] 1.2 Replace the directory walk's animation-frame wait, announce the required paused status, and add a keyboard-operable Cancel scan action; verify syntax and focused scan regressions.

## 2. Directory scan lifecycle coverage

- [x] 2.1 Add synthetic E2E coverage for a hidden pause and same-iterator resume after the 250-file batch; assert progress, existing limits, and no duplicate media.
- [x] 2.2 Add E2E coverage for keyboard cancellation while paused and permission loss on resume; assert accessible partial outcomes and retained committed data.

## 3. Verification

- [x] 3.1 Run `npm run check`, `npm run test:regression`, both requested directory scan E2E specs, and `openspec validate issue-16-directory-scan-visibility-pause --strict`; record actual results.
- [ ] 3.2 Attempt real foreground/background tab switching in Chromium, Firefox, and WebKit and compare progress behavior; record any unavailable browser or remaining manual/device coverage.

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
