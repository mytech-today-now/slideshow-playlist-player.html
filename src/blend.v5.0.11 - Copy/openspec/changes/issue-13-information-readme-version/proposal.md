# Proposal

## Why

The Information dialog currently lets a mutable repository-root README replace the documentation shipped with this standalone Blend Player v5.0.11 folder. The installed copy must open its own version guide first, while any online guide remains an explicit, clearly identified choice.

## What Changes

- Load the same-folder README as the default Information guide and verify its declared app version against the running app version.
- Offer the mutable main-branch README only through a keyboard-accessible source selector labeled as current online documentation.
- Associate online cache entries with their detected document version and fetch timestamp, retain the one-hour lifetime, and keep retry user-triggered.
- Keep the installed guide available when online documentation fails, and preserve independent scroll positions when switching sources.
- Cache the same-folder README for offline Information help through the existing service-worker documentation cache.

## Capabilities

### New Capabilities

- `information-documentation`: Version-aware installed and optional online documentation in the Information dialog, including offline availability and source-specific navigation state.

### Modified Capabilities

None.

## Impact

The implementation affects `readme-fetcher.js`, Information dialog wiring in `app.js` and `index.html`, related styles, `pwa-config.js` and `service-worker.js`, and their regression and Playwright coverage. Markdown rendering and its existing HTML escaping and link protections remain the rendering boundary. No runtime dependency or persisted application-data schema is added.
