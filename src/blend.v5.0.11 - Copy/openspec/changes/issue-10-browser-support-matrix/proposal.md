# Proposal

## Why

The README lists Firefox, Safari, iOS Safari, and Android Chrome as supported while Playwright currently runs only its implicit Chromium project. Engine-specific picker, fullscreen, and service-worker branches therefore lack repeatable evidence. Users also need an announced limitation when a browser cannot provide a folder or fullscreen API.

## What Changes

- Keep the complete Chromium E2E suite and add focused Firefox and WebKit projects for compatibility smoke coverage.
- Install the three Playwright engines in CI and include engine/version evidence in the browser report.
- Verify file and directory input fallbacks, picker cancellation state, keyboard/focus and viewport behavior, fullscreen limitations, and the service-worker shell where supported.
- Verify that an expired private-media URL without an authenticated session does not expose a local path, signed bearer URL, or token in status messages or diagnostics.
- Announce unavailable browser features and explain the local persistence behavior of file-input imports.
- Qualify README claims so Playwright Firefox/WebKit results are not described as branded Firefox/Safari or mobile-device verification.

## Capabilities

### New Capabilities

- `browser-compatibility`: Accessible file, folder, fullscreen, and offline-shell behavior when browser APIs are available or unavailable.

### Modified Capabilities

None.

## Impact

Changes are limited to the static app's file-picker and fullscreen handlers, PWA status copy, Playwright configuration and smoke tests, the existing GitHub Actions workflow, and README browser compatibility language. No runtime dependency, persisted schema, media format, or playback contract changes.
