# issue-14-mobile-safari-android-device-workflows

Issue 14: Mobile Safari and Android device workflows remain unverified

## Related current finding

The current report `ai-prompts/pre-mortem-2026-10-13-14-11-28.html` tracks the same named-device acceptance gap as stable finding `issue-11`: “Named physical iOS Safari and Android Chrome workflows remain unverified.” Reuse this active change for that acceptance work; do not create a duplicate OpenSpec change.

## Verification record for issue-11 (2026-10-13)

- `npm run test:e2e -- tests/e2e/browser-compatibility.e2e.spec.mjs --project=chromium --grep "file-input fallback|directory-input fallback|file and folder picker cancellation|directory input absence|denied folder picker|fullscreen API absence|responsive viewport"` — exit 1 before assertions with `spawn EPERM`; no browser version or Playwright report was produced.
- PWA offline E2E — not rerun after the same worker-process launch failure; the earlier task 3.1 entry records a historical 5/5 Chromium run, not a current device result.
- `npm run check` — exit 0.
- `npm run test:regression` — exit 0; 360 passed, 0 failed, 0 skipped.
- `openspec validate issue-14-mobile-safari-android-device-workflows --strict` — exit 0.
- Physical-device acceptance — not run; no named iOS Safari or Android Chrome device session was available. Keep task 2.2 open and the README support claims partial/unverified.
- Beads — `bd.exe` was unavailable in this environment, so the current record status could not be re-verified. The earlier task 3.1 entry records `blend-amv` as in progress.

## Verification refresh for issue-11 (2026-10-16)

- `npm run check`: passed.
- `npm run test:regression`: passed; 360 passed, 0 failed, 0 skipped.
- `npx playwright test --config=playwright.config.mjs tests/e2e/browser-compatibility.e2e.spec.mjs --project=chromium --project=firefox --project=webkit`: passed 30/30 on desktop Playwright Chromium, Firefox, and WebKit.
- `npx playwright test --config=playwright.config.mjs tests/e2e/pwa-offline.e2e.spec.mjs --project=chromium`: passed 5/5 on desktop Playwright Chromium.
- `openspec validate issue-14-mobile-safari-android-device-workflows --strict`: valid; the change remains 4/5 tasks complete, with physical-device task 2.2 open.
- Beads: existing record `blend-amv` was verified and remains `in_progress`; no duplicate was created.
- Physical-device acceptance: **Not run**. No iOS Safari or Android Chrome device session was available; `adb` was unavailable for Android device enumeration. The README records each mobile path as Not run for this attempt. No device data was accessed or cleared.
