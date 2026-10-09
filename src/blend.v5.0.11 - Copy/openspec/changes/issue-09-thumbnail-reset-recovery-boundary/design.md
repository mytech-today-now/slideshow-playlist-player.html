# Design

## Context

See [proposal.md](proposal.md) for motivation and [specs/browser-storage-reset/spec.md](specs/browser-storage-reset/spec.md) for the observable contract. The database contains authored state, saved media handles, aliases, and generated thumbnail Blobs. Local thumbnails are keyed from media metadata and generated from file handles on demand; remote image sources use their URL, and unavailable sources use the existing media icon.

## Goals / Non-Goals

**Goals:**

- Make thumbnail cache size irrelevant to the recovery snapshot's record and Blob counts.
- Keep all non-thumbnail object stores in rollback recovery.
- Make snapshot failure a preflight abort before local auth or saved state changes.
- State accurately when a timed-out deletion may leave previews to be regenerated.

**Non-Goals:**

- Bound snapshot memory for user-authored records or redesign rollback as an export/import pipeline.
- Change the database schema, media references, thumbnail generation format, or normal playback.
- Claim regeneration succeeds when the original file handle is unavailable.

## Decisions

1. **Exclude only `thumbnails` from the rollback snapshot.** This removes every cached Blob and its per-record key/value wrapper from the snapshot. All other stores, including aliases and directory handles, continue through the current snapshot and restore path. A bounded JSON export was rejected because it still materializes database contents and cannot safely encode file handles or Blobs.

2. **Prepare the snapshot before clearing the local session.** This makes snapshot failure a true no-op for persisted user state and auth state, and allows the requested recovery-copy message to stay exact. The current auth status remains visible separately. Once a snapshot exists, existing local sign-out, database deletion, and commit ordering remain in place; no remote logout is added.

3. **Describe cache recovery as conditional.** A timed-out database delete can finish after the UI reports failure. The recovery snapshot can restore authored records without restoring thumbnail Blobs. Copy will say cached previews may regenerate when the retained source is available; it will not claim thumbnails or media files were restored. The library already uses lazy thumbnail generation and an icon fallback.

4. **Measure record and byte boundaries with synthetic data.** E2E fixtures will seed small (10 × 1 KiB), typical (512 × 8 KiB), and large (4,096 × 16 KiB) thumbnail caches: 10 KiB, 4 MiB, and 64 MiB respectively. Tests will record the seeded count and total Blob bytes, instrument snapshot reads, and capture JavaScript heap values when the browser exposes them. The enforced cache-specific recovery budget is zero thumbnail records and zero thumbnail Blob bytes in the snapshot; the overall snapshot still scales with authored records.

## Risks / Trade-offs

- [A retained file handle may no longer grant access] → The library item and lists remain available, and the existing media icon stays visible when preview generation returns no Blob.
- [A timed-out database deletion may remove cached previews before authored records are restored] → Report possible cache-only regeneration and test recovery without expecting thumbnail restoration.
- [Non-thumbnail stores can still be large] → Keep this change narrowly scoped to the demonstrated thumbnail cache boundary; do not imply a bound on total snapshot memory.

## Migration Plan

No schema migration is needed. Existing stores remain readable. Run syntax, regression, reset E2E, and the reset dialog viewport matrix. A reset that successfully deletes IndexedDB continues to clear the thumbnail store; a timed-out deletion that later removes the database restores all snapshotted non-thumbnail stores and can leave only the derived thumbnail cache empty.
