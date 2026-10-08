# Tasks

## 1. Bound folder collection and persistence

- [x] 1.1 Add the single 250-file folder limit, traverse directories with depth-bounded memory, and commit the first bounded picker batch through `addHandles` after remembering the selected root. Verify synthetic boundary, deep-tree, cancellation, read-error, persistence, and duplicate-free retry coverage.
- [x] 1.2 Apply the same limit and pending-file accounting to the directory-input fallback, and document the selected limit and narrower-folder recovery in README.md. Verify the fallback fixture and ensure per-file imports and the existing JSON byte limit remain unchanged.

## 2. Report and verify partial scans

- [x] 2.1 Show accurate added, skipped, and pending counts with an accessible smaller-folder action; throttle live `role="status"` progress updates. Verify 1,000- and 10,000-file synthetic six-level runs, retained-handle ceiling, first-write timing, recovery IDs, and the seven-viewport responsiveness matrix.

## 3. Integration verification

- [x] 3.1 Run `npm run check`, `npm run test:regression`, `npm run test:e2e`, and `openspec validate issue-07-directory-walk-file-limit`; record exact outcomes and remaining browser or performance limits.
