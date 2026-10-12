# Proposal

## Why

Missing-media relink currently passes an unbounded limit to the recursive directory scanner and retains every discovered file handle before matching. That code path can consume unbounded memory for a broad selected tree; an actual browser freeze or memory exhaustion remains a testable assumption, not an observed incident.

## What Changes

- Bound each relink scan to 250 supported media files and report reaching the bound as a partial, retryable result.
- Add an accessible cancel action to relink progress and keep saved library entries and unresolved list references intact on partial, cancelled, or unreadable scans.
- Preserve exact relative-path precedence, deterministic candidate order, ambiguity confirmation, and existing retry context.
- Add synthetic boundary, permission-failure, cancellation, matching, and progress coverage.

## Capabilities

### New Capabilities

- `missing-media-relink-recovery`: Bounded, cancellable relink scans with safe partial results and retry guidance.

### Modified Capabilities

None.

## Impact

- `app.js` directory traversal, relink progress, cancellation, and result messaging.
- `tests/regression/media-relink.test.mjs` and `tests/e2e/missing-media-relink.e2e.spec.mjs`.
- No data schema, saved media format, runtime dependency, or parallel traversal changes.

## Tracking

- Source report: `Pasted text.txt`, Issue 07, “Missing-media relink scans an unbounded number of handles into memory”.
- Beads issue: `blend-q4g`, linked to this change through `spec_id`.
- The separate completed Issue 07, `blend-n1s` / `issue-07-directory-walk-file-limit`, covers ordinary folder import and is not this relink issue.
