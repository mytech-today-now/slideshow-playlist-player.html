# Proposal

## Why

Playwright records the selected engine and runtime version, but those results do not establish behavior in the branded Chrome, Edge, or Safari applications. The current compatibility claims correctly preserve that boundary; a short, repeatable manual smoke procedure and explicit run record will make branded evidence possible without expanding the automated suite.

## What Changes

- Add one bounded desktop smoke procedure using disposable synthetic local media for import, playback, fullscreen, and offline-shell reload.
- Record exact installed browser versions and each workflow result; unavailable or unrun browsers remain partial and unverified.
- Keep the full Chromium suite and selected Firefox/WebKit smoke unchanged. Change product code only if a manual run reproduces a specific difference.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change documents a verification process and does not change application behavior or support guarantees.

## Impact

Documentation and issue tracking only: `README.md` and this OpenSpec change. No runtime code, Playwright configuration, test selection, manifest, service-worker behavior, dependencies, or persisted data contracts change. `skip_specs: true` is set because no spec-level behavior changes.
