# Tasks

## 1. Capability fallback behavior

- [x] 1.1 Clarify unavailable and denied folder selection status, preserve the current library, and verify with focused E2E assertions for absent and rejected picker APIs.
- [x] 1.2 Clarify unavailable and rejected fullscreen status and verify the visible control fallback in the compatibility E2E spec.

## 2. Evidence and documentation

- [x] 2.1 Qualify mobile capability claims and record iOS Safari and Android Chrome workflows as unverified until named device runs are available; verify the README separates device coverage from engine results.
- [ ] 2.2 Run named physical-device acceptance on iOS Safari and Android Chrome with synthetic media; record device, OS, browser, network, offline reload, library recovery, picker/fullscreen, rotation, quota/permission, and accessibility outcomes without clearing unrelated origin data.
  - 2026-10-16 attempt: physical acceptance was **Not run**. This Windows runner had no iOS Safari or Android Chrome device session; `adb` was unavailable for Android device enumeration. The README records each mobile workflow as Not run. The physical-device task remains open.
  - 2026-10-21 attempt: physical acceptance was **Not run** on either platform. `adb` was unavailable, and no iOS Safari or Android Chrome session or matching attached device was detected. File/folder selection, import/save/reload, playback, rotation/fullscreen, permission/quota, installation/offline reload, recovery, and accessibility were all Not run on named devices. Device network state is unknown because no session was available. No device origin data was accessed or cleared; task 2.2 remains open.

## 3. Integration verification

- [x] 3.1 Run the requested syntax, regression, browser-compatibility E2E, PWA offline E2E, and OpenSpec validation commands; verify Beads record `blend-amv`. Verification refresh (2026-10-16): syntax check passed; regression 360/360; browser-compatibility E2E 30/30 across desktop Playwright Chromium, Firefox, and WebKit; PWA offline E2E 5/5 in desktop Playwright Chromium; strict OpenSpec validation valid; `blend-amv` remains in progress.
  - Verification refresh (2026-10-20): `npm run check` passed. Focused desktop compatibility and PWA offline E2E passed 36 tests and skipped one WebKit offline-navigation case across Chromium, Firefox, and WebKit. The responsive matrix passed at 320×480, 360×800, 375×667, 390×844, 430×932, 768×1024, 1024×768, and 1280×720, plus the pre-existing viewports. `npm run test:regression` reported 363/365; its two failures are stale README workflow-contract expectations for the configured test inventory and prior launch-failure wording. Strict OpenSpec validation passed and `blend-amv` remains in progress. Physical-device acceptance remains Not run because `adb` is unavailable and no iOS Safari or Android Chrome device session is exposed in this runner.
  - Verification refresh (2026-10-21): `npm run sanity` passed syntax checks and 373/373 regression tests. The initial sandboxed browser-compatibility run exited with `spawn EPERM` before discovery (zero assertions); its process-enabled retry passed 30/30 across desktop Playwright Chromium, Firefox, and WebKit. Separate Chromium PWA offline E2E passed 5/5. Both HTML reports passed `node tests/e2e/verify-playwright-report.mjs`. `openspec validate issue-14-mobile-safari-android-device-workflows --strict` passed. Existing Beads record `blend-amv` links to report article `issue-11` and remains `in_progress`. Physical-device task 2.2 remains Not run and open.
