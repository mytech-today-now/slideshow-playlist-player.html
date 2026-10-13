# Design

## Context

See `proposal.md` for the current gap. `playwright.config.mjs` has a full default Chromium project and four focused Firefox/WebKit spec files. The browser-compatibility suite already records project and runtime browser version; the CI workflow installs all three engines and verifies the HTML report after the Playwright step fails unless the job is cancelled. The fixture server and test specs run serially.

## Goals / Non-Goals

**Goals:**

- Preserve the existing cross-engine smoke selection and add only one representative import rollback/retry case, one save failure/retry case, and one real offline shell reload for engines where the Playwright run can exercise offline navigation.
- Filter the added cases with a Playwright tag so Firefox/WebKit do not run the rest of their larger Chromium specs.
- Record engine and version evidence on every selected cross-engine test result, with Playwright's report summary retaining passed, failed, and skipped counts.

**Non-Goals:**

- Change runtime app behavior, auth policy, IndexedDB format, service-worker cache policy, or fixtures.
- Run the full suite in Firefox or WebKit, add reset coverage, or claim branded Safari/mobile verification.

## Decisions

### Reuse existing scenarios and select by tag

Keep the full `browser-compatibility`, `add-files-selection-limit`, `thumbnail-failures`, and `directory-scan-visibility` selections by tagging each existing suite. Add `@cross-engine-smoke` only to the queued-library-write import fault case, the failed-save keyboard-retry case, and the offline-shell reload case in their existing specs. Add those three spec files to Firefox/WebKit `testMatch` and apply a project-level `grep` for the tag. Chromium has no project-level filter, so it continues to run every test in every spec.

This reuses the existing synthetic fixtures and recovery assertions. A second standalone copy of each workflow would drift from the Chromium baseline; including the whole import, save, and PWA files would make the non-Chromium matrix broader than the selected risks require.

### Attach version evidence in the selected specs

Use a small Playwright support helper to add the project name and `browser.version()` as both a test annotation and a plain-text attachment. The existing compatibility hook will use the same helper; the three added cases will attach evidence directly. The HTML reporter supplies per-project outcomes and skip counts. An engine launch failure remains a failed or not-run execution in the report and is never converted to a pass.

### Keep CI and browser claims unchanged

The focused WebKit offline reload produced `WebKit encountered an internal error` both with `page.goto()` and with `page.reload()` while offline. Keep that test as an explicit WebKit skip with the engine version and reason attached; do not turn it into a pass or claim that WebKit offline-shell behavior is verified. The existing compatibility smoke still tests the accessible service-worker limitation branch.

The existing workflow already installs Chromium, Firefox, and WebKit, runs the configured matrix, and verifies report safety after a failed test step. Leave that workflow logic intact. Update the README matrix and compatibility notes to name the cross-engine workflows and state that WebKit evidence describes the engine build only.

## Risks / Trade-offs

- [The selected synthetic recovery cases may not expose every OS-specific browser difference] → Keep the selection risk-based, retain the complete Chromium suite, and report engine-only evidence without claiming branded or mobile coverage.
- [A future rename or removal of a tagged test can silently shrink a project selection] → Verify the configured project list and selected test count with Playwright `--list` before relying on the report.
- [A browser may fail to launch in a constrained runner] → Preserve the failed/not-run result and report the launch limitation; do not mark the engine passed.
- [Playwright WebKit cannot complete an offline navigation with the active service worker in this runner] → Skip that single case with its explicit reason, keep offline reload covered in Chromium and Firefox, and leave WebKit offline behavior unverified.

## Migration Plan

No runtime migration is needed. Rollback removes the added project selection and tags, the evidence helper, and README wording; it does not touch user data or service-worker state.
