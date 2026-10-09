# Proposal

## Why

Clear Browser Storage currently loads keys and values from every IndexedDB store into an in-memory rollback snapshot. The thumbnails store contains regenerable Blob previews, so including it makes recovery memory grow with the preview cache even though the media and user-authored records live elsewhere.

## What Changes

- Exclude only the `thumbnails` object store from rollback snapshots; keep all library, playlist, slideshow, experience, settings, and directory-handle records in the snapshot.
- Prepare the snapshot before changing the local Supabase session or deleting IndexedDB. If preparation fails, keep the saved data and session intact and show the specified recovery-copy message.
- Explain that a preview cache may be regenerated after timed-out deletion recovery, without implying that media files or cached previews were restored.
- Measure synthetic small, typical, and large thumbnail profiles and cover rollback, snapshot failure, blocked deletion, and lazy preview regeneration.

## Capabilities

### New Capabilities

- `browser-storage-reset`: destructive reset ordering, bounded thumbnail-cache recovery, and truthful partial-reset outcomes.

### Modified Capabilities

None. This checkout has no existing OpenSpec capability specs.

## Impact

The change affects `app.js`, reset documentation in `README.md`, and `tests/e2e/clear-browser-storage.e2e.spec.mjs`. It adds no runtime dependency and does not change the IndexedDB schema or persisted media/list formats.
