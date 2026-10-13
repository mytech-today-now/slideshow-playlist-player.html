# Proposal

## Why

The folder picker limits supported media imports to 250 files and nesting to six levels, but a tree with mostly unsupported entries can still keep the iterator running without a total-work bound. Synthetic measurements with the current cooperative yield show 2,000 unsupported entries taking about 1.24 seconds and 10,000 taking about 6.41 seconds in Node; a deterministic entry ceiling gives the scan a fixed upper bound while preserving useful partial results.

## What Changes

- Bound each folder-picker traversal by a total number of visited file and directory entries, including unsupported files.
- Report the exact partial scan counts when that ceiling is reached, preserve any committed media, and offer a smaller-folder action.
- Keep the 250 supported-media limit, depth-six behavior, cooperative yielding, cancellation, same-iterator visibility resume, and permission recovery intact.
- Add focused regression and directory-scan E2E coverage and document the new folder-scan limit.

## Capabilities

### New Capabilities

- `directory-scan-bounds`: Defines the total-work bound and partial-result behavior for folder scans.

### Modified Capabilities

None. The repository has no main specs yet; the existing active visibility change covers pause, resume, and cancellation lifecycle behavior.

## Impact

The change affects `app.js`, the local import limits module, directory-scan regression/E2E coverage, and `README.md`. It adds no runtime dependency, persistence change, or import/export format change.
