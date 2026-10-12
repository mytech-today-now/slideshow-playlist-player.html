# Proposal

## Why

The Add Files native picker and input fallback pass the full selected array to the import pipeline, with no direct-selection count check. Very large selections could increase import work or transient storage pressure; this impact is a testable assumption and has not been reproduced in a large-selection failure.

## What Changes

- Apply the same finite 250-file cap to native and input-fallback Add Files selections before library mutation.
- Reject an oversized selection as a whole and announce selected, accepted, and remaining counts. Do not truncate or start a partial import.
- Preserve ordinary import behavior, cancellation, folder-import policy, single-file imports, duplicate handling, media filtering, and persistence formats.
- Add boundary regression and browser workflow coverage for both picker paths.

## Capabilities

### New Capabilities

- `direct-file-import-limits`: Finite, accessible limits for direct multi-file selections.

### Modified Capabilities

None.

## Impact

- `app.js` direct picker and input-fallback entry points.
- `local-import-limits.js` and its regression tests for the shared selection boundary.
- Focused Add Files end-to-end coverage; existing folder-import bounds remain a baseline.
- No runtime dependency, persisted-data change, folder-policy change, or single-file import change.

## Tracking

- Source report: `Pasted text.txt`, Issue 08, “The Add Files picker accepts an unbounded multi-selection before processing”.
- Beads issue: `blend-52r`.
