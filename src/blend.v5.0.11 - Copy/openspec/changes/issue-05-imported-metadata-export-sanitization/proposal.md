# Proposal

## Why

Imported or legacy media metadata can contain absolute local paths that are not covered by the existing credential and bearer URL filters. Those paths can expose account, project, or folder names when a user exports or shares an experience, while the saved library should remain unchanged.

## What Changes

- Recursively omit absolute Windows, UNC, and POSIX filesystem path values from metadata at JSON and compressed share serialization boundaries.
- Preserve portable storage references, public URLs, relative paths, ordinary labels, existing credential filtering, and export schemas.
- Show an accessible notice when local path metadata is omitted, without changing saved records or playback state.
- Advance the PWA asset and cache versions so installed clients receive the updated sanitizer.
- Cover full JSON exports and decompressed share payloads with synthetic regression and browser tests.

## Capabilities

### New Capabilities

- `export-privacy`: Prevent private local filesystem path metadata from entering exports and shares while retaining safe portable metadata.

### Modified Capabilities

None. This checkout has no existing main specs.

## Impact

Affected code is `url-share.js`, export/share orchestration in `app.js`, the share dialog in `index.html`, PWA asset versioning, and focused regression and Playwright tests. No import, database schema, playback, or runtime dependency changes are intended.
