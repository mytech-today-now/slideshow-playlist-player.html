# Tasks

## 1. Isolate the experience boundary flow

- [x] 1.1 Split the experience below-limit, exact-limit, and over-limit cases from the list-import test; arm the chooser waiter before focus and keyboard activation, reset focus between cases, and preserve the existing assertions. Verify with `node --check tests/e2e/local-import-bounds.e2e.spec.mjs` and confirm no production file changed.
- [x] 1.2 Run `npm run test:e2e -- tests/e2e/local-import-bounds.e2e.spec.mjs`; verify the chooser flow reaches the exact-limit parser outcome and oversized input leaves state unchanged.

## 2. Validate and record

- [x] 2.1 Run `npm run check` and `npm run test:regression`; record their actual exit codes and assertion counts.
- [x] 2.2 Run `openspec validate issue-14-experience-import-boundary-test-reliability` and `bd show blend-djs`; verify the change artifacts and stable `issue-14` cross-reference.

## Verification record (2026-10-13)

- `npm run test:e2e -- tests/e2e/local-import-bounds.e2e.spec.mjs` (default sandbox): exit 1 before Playwright startup with `Error: spawn EPERM`; no browser or assertions ran.
- `npm run test:e2e -- tests/e2e/local-import-bounds.e2e.spec.mjs` (process-enabled run, first attempt): exit 1; 4 passed and the isolated experience case failed on the stale `window.__localImportReads.length === 3` counter. The successful import toast had already appeared; exact and oversized experience cases were not reached. The fresh fixture correctly starts that counter at 0.
- `npm run test:e2e -- tests/e2e/local-import-bounds.e2e.spec.mjs` (process-enabled final run): exit 0; 5 passed, 0 failed in Chromium 153.0.8010.12. The exact-limit experience import reached its parser/import outcome, and the over-limit case preserved state and did not read or parse the file.
- `npm run test:e2e -- tests/e2e/experience-import-atomicity.e2e.spec.mjs` (process-enabled supplemental baseline): exit 1; 6 passed and 1 failed across Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6. The malformed-import recovery case failed only its post-reload `libraryNames` ordering comparison at line 262: both entries remained, but their `Map` iteration order reversed. This is outside the issue-14 chooser boundary, and no production code was changed for it.
- `node --check tests/e2e/local-import-bounds.e2e.spec.mjs`: exit 0.
- `npm run check`: exit 0.
- `npm run test:regression`: exit 0; 360 passed, 0 failed, 0 skipped.
- `openspec validate issue-14-experience-import-boundary-test-reliability`: exit 0; valid with `skip_specs: true` because no system requirement changed.
- Playwright report artifact: `playwright-report/index.html` (contains the runner's report data and browser-engine-version attachment). The synthetic Playwright chooser does not verify the operating-system picker.
- `node tests/e2e/verify-playwright-report.mjs`: exit 0; verified the HTML report contains no credential-like values or private local paths.
- `openspec archive issue-14-experience-import-boundary-test-reliability --yes --json`: exit 0; archived as `2026-10-13-issue-14-experience-import-boundary-test-reliability`, with no main-spec updates.
- `bd close blend-djs --reason "Focused Chromium experience-import boundary E2E passed 5/5; npm check and all 360 regression tests passed. OpenSpec change archived after acceptance."`: closed, then verified with `bd show blend-djs`.

## Workflow follow-up

- Archived after the focused acceptance and required project checks passed; Beads issue `blend-djs` is closed and verified.
