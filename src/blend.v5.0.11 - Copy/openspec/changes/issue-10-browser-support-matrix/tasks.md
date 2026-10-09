# Tasks

## 1. Accessible browser API fallbacks and smoke coverage

- [x] 1.1 Label file inputs, handle browsers without directory input or fullscreen APIs, announce offline-shell limitations, and report whether fallback file bytes were saved; verify with synthetic Playwright assertions for success, unavailable, and failure branches.
- [x] 1.2 Add a focused compatibility spec that records engine/version and checks file and directory fallback, picker cancellation state, list-editor keyboard/focus, all seven required viewports, fullscreen feedback, and service-worker behavior; verify it in the existing Chromium default project.
- [x] 1.3 Exercise an expired synthetic private-media URL without an authenticated session in Chromium, Firefox, and WebKit; assert preserved portable media state and no private path or bearer URL/token in status, console, or persisted diagnostics.

## 2. Browser matrix, CI, and support claims

- [x] 2.1 Keep all existing tests in Chromium and select only the compatibility spec for Firefox and WebKit; explicitly install all three engines in CI and retain version evidence in the uploaded report. Verify project selection and report contents.
- [x] 2.2 Update README browser claims to distinguish Chromium, Firefox/WebKit engine smoke evidence, and untested branded or mobile browsers. Verify no mobile or Safari application coverage is implied.

## 3. Integration verification

- [x] 3.1 Run the requested syntax, regression, E2E, report-safety, and OpenSpec checks; inspect the final diff and verify pre-existing user changes remain intact.
