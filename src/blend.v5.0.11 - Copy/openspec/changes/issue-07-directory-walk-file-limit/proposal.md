# Proposal

## Why

Folder scans retain every supported media handle until traversal ends, then build and save library state for the full collection. A broad tree can grow retained memory and delay the first write without a count bound. Synthetic measurements are needed to choose a useful per-scan limit and verify the impact before describing it as a production incident.

## What Changes

- Measure synthetic six-level scans and imports at 1,000 and 10,000 supported files before selecting the product limit.
- Bound the supported media retained and imported by one folder selection, including the directory-input fallback, while counting additional discovered media as pending.
- Report added, already-present or skipped, and pending counts, with a smaller-folder recovery action that preserves existing records and retry identity.
- Keep depth, supported-file filtering, cancellation, read-error handling, import formats, and the existing persistence boundary intact.
- Document the selected limit and recovery guidance, and verify progress and recovery presentation in the browser.

## Capabilities

### New Capabilities

- `folder-import-bounds`: Per-scan media limit, truthful partial counts, persistence, and narrower-folder recovery.

### Modified Capabilities

None.

## Impact

- `app.js` folder traversal, progress reporting, and both folder-picker import paths.
- `tests/e2e/directory-scan-status.e2e.spec.mjs` synthetic limit, recovery, and responsiveness coverage.
- `README.md` import limits and recovery guidance.
- No schema changes, runtime dependencies, or import/export format changes.
