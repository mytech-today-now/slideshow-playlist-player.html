# Tasks

## 1. Lifecycle and status coverage

- [x] 1.1 Add an integration case where a hidden scan resumes after 250 items have been saved and directory access then raises `NotAllowedError`; verify one enumeration, 250 unique saved items, a partial result, and no completion message in Chromium and Firefox. The WebKit synthetic handle batch did not commit and remains unverified there.
- [x] 1.2 Exercise native tab hide/return/resume and a separate hide/return/cancel run; verify the same iterator or retained partial result, and record any native hidden-state skip with its browser engine and reason as unverified. Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6 never exposed `document.visibilityState === 'hidden'` in this run.
- [x] 1.3 Test the paused status at 320×480, 360×800, 375×667, 390×844, 430×932, 768×1024, 1024×768, and 1280×720; verify wrapping, no unintended horizontal overflow, unclipped status, keyboard focus visibility, and touch hit reachability/cancellation in Chromium, Firefox, and WebKit.

## 2. Verification and evidence

- [x] 2.1 Run `npm run check` and `npm run test:regression`; record actual exit status and test counts, classifying any pre-assertion process-launch error as Not run. Check passed; regressions passed 365/365.
- [x] 2.2 Run `npm run test:e2e -- tests/e2e/directory-scan-visibility.e2e.spec.mjs`; distinguish passed synthetic tests from skipped/unverified native cases and report physical-device checks separately. The requested run passed 8 tests and skipped 7 (six native hidden-state attempts and the WebKit synthetic saved-batch case). Physical-device checks were not run.

2026-10-21 follow-up for `ai-prompts/pre-mortem-2026-10-20-13-13-58.html#issue-09`, **Native background-tab scan pause and resume remains unverified**:

- `npm run sanity`: passed; syntax checks passed and regressions passed 373/373.
- The default-sandbox headed Chromium E2E attempt stopped before discovery with `spawn EPERM` (zero browser assertions). The process-enabled retry of `npm run test:e2e -- --project=chromium --workers=1 --headed tests/e2e/directory-scan-visibility.e2e.spec.mjs` used Chromium 153.0.8010.12 and finished with 2 passed, 2 skipped, and 1 failed.
- Synthetic injected-visibility pause/resume passed with 48 unique rows and one enumeration; the saved-batch permission-loss case passed with 250 retained rows. Both native tab hide/resume and hide/cancel cases skipped because Chromium did not expose `document.visibilityState === 'hidden'` within five seconds after the background page was foregrounded. Native behavior assertions and physical-device behavior remain Not run. The interactive browser inventory also returned no open apps or browser tabs, so a separate manually controlled tab switch was unavailable.
- The paused-status viewport test failed its focus-outline width assertion (`2px` expected, `1.6px` received). No app code was changed. Keep Beads `blend-pjk` in progress pending native evidence.
