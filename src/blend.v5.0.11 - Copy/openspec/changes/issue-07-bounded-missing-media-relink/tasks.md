# Tasks

## 1. Bound and cancel relink traversal

- [x] 1.1 Reuse the 250-media folder limit for missing-media scans, stop at the limit with a partial summary, and add an accessible Cancel scan action that stops between yielded entries; verify below-limit matching and at/over-limit counts with synthetic E2E fixtures.
- [x] 1.2 Preserve traversal-order candidates and exact-path precedence while bounding retained handles; verify duplicate basenames, exact-path selection, and unresolved references remain unchanged in the relink E2E suite.

## 2. Make interrupted recovery explicit and retryable

- [x] 2.1 Report the required smaller-folder guidance at the cap and offer a retry/narrowing action; cover permission/read failures, root loss, and cancellation with synthetic E2E fault injection and assert saved records and unresolved references remain.
- [x] 2.2 Verify keyboard cancellation, live progress announcements, and browser yielding during a large deterministic scan in `tests/e2e/missing-media-relink.e2e.spec.mjs`.

## 3. Run integration checks and reconcile tracking

- [x] 3.1 Run `npm run check`, `npm run test:regression`, `npm run test:e2e -- tests/e2e/missing-media-relink.e2e.spec.mjs`, and `npm run test:e2e -- tests/e2e/directory-scan-status.e2e.spec.mjs`; record actual outcomes and keep browser-runner failures distinct from assertion failures.
- [x] 3.2 Verify OpenSpec and Beads reference the same Issue 07 title and change, then close the Beads issue only when implementation and all achievable verification tasks are complete.

## Verification record (2026-10-12)

- `npm run check`: passed.
- `npm run test:regression`: passed, 334/334.
- `node --test --test-isolation=none tests/regression/media-relink.test.mjs`: passed, 4/4.
- `npm run test:e2e -- tests/e2e/missing-media-relink.e2e.spec.mjs`: passed, 11/11.
- `npm run test:e2e -- tests/e2e/directory-scan-status.e2e.spec.mjs`: 10 passed, 1 failed. The remaining failure is the normal folder-import toast viewport-fit assertion at `directory-scan-status.e2e.spec.mjs:294` / `:398`; it repeated in isolation with the toast extending 4.3 px below a 390 px viewport. All other scan/status cases passed.
- `node --test tests/regression/media-relink.test.mjs`: runner stopped with `spawn EPERM` before assertions. The repository serial regression command includes this file and passed.
- Beads `blend-q4g` is closed with the exact Issue 07 title and points to this OpenSpec change; the OpenSpec proposal links back to `blend-q4g`.
