# Design

## Context

See `proposal.md` for the motivation and `specs/playback-history/spec.md` for the behavior contract. `app.js` owns the runtime history arrays, random-advance append sites, snapshot creation, and snapshot normalization. `playback-mode.js` already contains the pure Previous selector and its Node regression coverage. IndexedDB writes already use the existing atomic snapshot transaction. The separate full-experience JSON exporter omits runtime state and must continue to do so.

## Goals / Non-Goals

**Goals:**

- Keep runtime history bounded even when Random order runs for hours.
- Ensure snapshot and legacy-load compaction use the same maximum and retain valid recent entries.
- Surface a visible accessible message when older history is dropped.
- Verify the behavior with side-effect-free regression tests.

**Non-Goals:**

- Changing the Previous selection algorithm, random-cycle completion, or sequential clear/restart behavior.
- Suppressing saves on random advances or changing IndexedDB atomicity and recovery.
- Changing persisted schemas, full-experience/share formats, or service-worker cache policy.

## Decisions

1. **Use a fixed 256-entry limit in `app.js`.** Place `MAX_PLAYBACK_HISTORY_ENTRIES` beside the runtime state and pass it to helpers in the existing `playback-mode.js` module. A fixed cap keeps Previous behavior predictable and avoids a history allocation proportional to the media library. A playable-list-sized cap was considered, but it could still grow with very large lists and is less explicit.

2. **Keep history operations pure and testable.** Add helpers that accept a history array, the cap, and the current list length. They return a compacted copy plus whether valid older entries were dropped; non-array input returns an empty history. Normalization keeps only integer indices within list bounds. Runtime appends continue to occur only for currently playable indices, and the existing Previous selector continues to skip entries that are no longer playable.

3. **Apply the same helper at every snapshot boundary.** Random advance uses the append helper for each layer. `experienceSnapshotFromState` compacts the copied arrays, and `normalizeExperienceSnapshot` compacts legacy arrays before applying them. The source lists and all unrelated snapshot fields are left intact. The separate full-experience JSON builder continues to omit runtime history entirely; a regression assertion protects this existing format behavior.

4. **Keep trim-notice state out of persistence.** A small in-memory `WeakSet` can associate normalized snapshots with a trim result until `applyExperienceSnapshot` updates the status. Runtime overflow reveals the same status directly. The notice itself remains in HTML as a hidden polite live region near the viewport Previous control and is referenced by both Previous buttons; no marker is added to experience JSON.

5. **Leave save scheduling intact.** Successful random playback still uses the current debounced atomic save path, including Retry and Export Backup on failure. Bounding the arrays prevents history growth from increasing the saved payload over time; suppressing these saves was considered but would change the existing save contract and recovery timing.

6. **Advance the shared asset/cache generation.** The service worker caches versioned JavaScript and app-shell assets as immutable content. Reusing the current generation could leave installed players running the old history logic, so update the generation and every active versioned URL while preserving all cache strategies and policies.

## Risks / Trade-offs

- [Older Previous steps fall off after 256 recorded entries per layer] → Retain the newest entries, and announce the trim with the required visible status.
- [Legacy records can contain malformed or stale indices] → Filter to in-range integers during normalization and keep list items untouched.
- [A future persistence path could bypass snapshot compaction] → Keep cap enforcement in runtime append, snapshot creation, and normalization, with tests covering the shared helper and all app call sites.

## Migration Plan

No database migration is required. Existing oversized histories are compacted when normalized and again at snapshot creation; the next successful save contains the bounded arrays, and full exports continue omitting runtime history. The asset/cache generation makes the updated files eligible for the existing install/update flow. Rollback requires reverting the cap/helper use and restoring the prior asset/cache generation; saved arrays remain data-compatible because older readers already accept history arrays of varying length.
