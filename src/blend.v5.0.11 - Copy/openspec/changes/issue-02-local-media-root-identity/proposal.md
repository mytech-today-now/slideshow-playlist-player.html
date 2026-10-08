# Proposal

## Why

Folder imports identify media by a relative display path whose first segment is only the selected root's visible name. When two different roots share that name and descendant path, the library can silently keep the first file and treat the second as already present. The library must keep those sources distinct so equal-sized files and their playlist references survive saving and reload.

## What Changes

- Give every selected folder root an opaque identity and reuse it only when the same directory handle is proven by object identity or `isSameEntry`.
- Require matching root identity and exact-case relative paths to deduplicate local media; preserve same-source URL deduplication.
- Keep ambiguous local items as separate records and show the specified duplicate explanation.
- Keep path hints relative for display and relinking, and keep root identities out of exported media records.

## Capabilities

### New Capabilities

- `local-media-identity`: Root-scoped local media identity and safe library deduplication.

### Modified Capabilities

None. No existing OpenSpec capabilities are defined in this checkout.

## Impact

The change affects folder handle tracking and local library identity in `app.js`, path normalization and identity decisions in `media-relink.js`, and focused Node/Playwright tests. It reuses the current `directoryId` field and directory-handle store, so no IndexedDB version or import/export schema change is needed. Absolute filesystem paths are not stored.
