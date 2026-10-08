# Proposal

## Why

Folder scans stop descending after six levels, but currently ignore child folders at that boundary without reporting that work was skipped. Users can therefore receive a complete-success message while supported media remains undiscovered.

## What Changes

- Count directories skipped at the depth cap separately from directories that fail to read.
- Treat any depth truncation as a partial scan and show an accessible recovery action that lets users choose a deeper folder.
- Preserve discovered media, existing read-error retries, cancellation, empty-folder messaging, and duplicate-free re-import behavior.
- Document the scan limit and recovery guidance.

## Capabilities

### New Capabilities

- `folder-scan`: Complete and recoverable reporting for recursive folder scans, including configured depth truncation.

### Modified Capabilities

None.

## Impact

- `app.js` directory traversal, folder import, and missing-media folder-scan summaries.
- `styles.css` status-toast wrapping and focus visibility.
- `tests/e2e/directory-scan-status.e2e.spec.mjs` synthetic directory-tree and recovery coverage.
- `README.md` folder-scan limits and recovery behavior.
