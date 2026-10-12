# Design

## Context

See `proposal.md` and `specs/missing-media-relink-recovery/spec.md`. The directory walker already reports unreadable branches and yields to the browser every 24 entries. Folder import uses a 250-media limit, but missing-media relink overrides it with Infinity and retains all handles before building the existing path and basename indexes.

## Goals / Non-Goals

**Goals:**

- Bound the relink scan's retained media handles to the existing 250-file folder limit.
- Make reaching the limit visibly partial and let users cancel while traversal yields to the browser.
- Preserve current path normalization, traversal order, ambiguity confirmation, and library/list persistence behavior.

**Non-Goals:**

- Change ordinary folder import, saved formats, database schema, media identity, or matching semantics.
- Add parallel traversal, a new service, or runtime dependencies.
- Claim a measured browser freeze or memory-exhaustion threshold.

## Decisions

- Reuse `MAX_FOLDER_MEDIA_FILES` as the relink ceiling. This keeps one documented media bound and uses the repository's established 250-file recovery guidance.
- Stop the relink traversal as soon as the ceiling is reached, even if the selected tree has exactly 250 supported files. Mark that result partial because the scanner cannot prove that unvisited branches contain no additional files. Ordinary folder import retains its current full-count behavior.
- Retain candidates in traversal order up to the ceiling and keep the existing index and matcher. This makes the memory bound direct and leaves successful below-limit matching deterministic; streaming fallback resolution is unnecessary for this scope.
- Give each relink progress toast a local `AbortController` and keyboard-operable Cancel scan button. The walker checks cancellation between entries and after its existing animation-frame yields so input can be handled during large scans.
- Report cap, cancellation, and access errors through the existing directory-scan status toast. Offer a new folder selection for retry/narrowing, keep the selected directory handle where persistence succeeds, and never delete unresolved list references or library records.

## Risks / Trade-offs

- [A folder with exactly 250 supported media files is reported partial] → This is deliberate and conservative; the UI provides a smaller-folder or narrower-search next step rather than claiming all branches were checked.
- [A pending filesystem iterator step may not settle immediately] → Cancellation is observed at each yielded entry and animation-frame boundary; native filesystem enumeration does not expose an abort signal.
- [A 250-file root can still be large on some devices] → The bound removes unbounded growth but does not prove a device-specific performance target; the actual freeze threshold remains a testable assumption.

## Migration Plan

No migration is needed. Rollback by removing the relink-only stop/cancel wiring and result messaging while retaining the existing folder-import ceiling; no saved directory handles or media records need removal.
