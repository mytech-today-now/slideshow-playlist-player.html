# Proposal

## Why

The current Playwright matrix already checks the expired private-media authorization fallback in Chromium, Firefox, and WebKit, and CI already installs those engines and verifies the HTML report after a failed test step. Import recovery, save retry, and an actual offline shell reload remain selected only in Chromium. Issue 09 treats engine-specific differences as a testable risk, not a reproduced app defect.

## What Changes

- Keep the complete configured test selection in Chromium.
- Keep the current Firefox/WebKit compatibility, file-selection-limit, thumbnail-failure, and directory-visibility smoke suites.
- Add tagged Firefox/WebKit cases for atomic experience-import recovery and failed-save retry, plus an actual offline service-worker shell reload where Playwright can exercise it. Playwright WebKit's offline navigation currently returns an internal error, so that result must remain an explicit skip rather than a pass.
- Attach each added smoke result's Playwright project and browser engine version to the HTML report.
- Update the README matrix with the exact smoke workflows and keep WebKit, branded Safari, and mobile claims distinct.
- Leave the existing CI browser installation, serial fixture behavior, and report-safety verification in place.

## Capabilities

### New Capabilities

None. This change updates test selection, test-result evidence, and documentation; it does not change app behavior.

### Modified Capabilities

None. There is no app-level requirement change. The existing browser-support matrix change is complete and remains untouched.

## Impact

The change affects `playwright.config.mjs`, focused Playwright specs and their support helper, and the browser-compatibility section in `README.md`. No runtime dependency, application source, stored data, workflow service, or deployment behavior changes. This is tracked by Beads `blend-d9n` and sourced from `ai-prompts/pre-mortem-2026-10-13-14-11-28.html#issue-09`.
