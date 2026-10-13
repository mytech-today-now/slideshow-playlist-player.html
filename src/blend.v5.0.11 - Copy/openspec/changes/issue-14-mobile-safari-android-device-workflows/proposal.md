# Proposal

## Why

The current README correctly reports no named iOS Safari or Android Chrome device runs, but broad mobile guidance and generic picker-denial feedback can still leave users unsure which workflows work or how to continue. This change makes the fallback actionable, separates desktop-engine results from mobile-device evidence, and records the physical-device acceptance still required.

## What Changes

- Clarify folder-picker denial and fullscreen-unavailable messages while preserving the current library and usable playback controls.
- Add focused browser tests for denied and unavailable APIs, asserting the fallback and retained library state.
- Qualify mobile support claims and list the required device workflows as unverified until a named physical device run records OS, browser, and network details.
- Keep physical-device acceptance open because no approved iOS or Android device session is available in this run.

## Capabilities

### New Capabilities

- `mobile-device-acceptance`: Defines truthful mobile support evidence, required device workflows, and safe capability fallbacks.

### Modified Capabilities

None.

## Impact

The static app's folder and fullscreen status messages, the existing Playwright browser-compatibility tests, and README mobile/browser evidence. No runtime dependency, storage schema, persisted format, or service-worker cache behavior changes. Source report: `ai-prompts/pre-mortem-2026-10-12-00-11-24.html`, Issue 14.
