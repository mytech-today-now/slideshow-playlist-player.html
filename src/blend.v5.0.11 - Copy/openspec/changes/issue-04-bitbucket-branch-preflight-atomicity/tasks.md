# Tasks

## 1. Provider write boundary

- [x] 1.1 Stop Bitbucket writes when no documented conditional operation exists, retain GitHub stale-SHA behavior, and cover stable preflight, moved-head, exact-review-retention, and no-POST cases in the regression suite. Verified with `node --test --test-isolation=none tests/regression/git-playlist-storage.test.mjs` (18/18).
- [x] 1.2 Update `GIT_PLAYLIST_STORAGE_DESIGN.md` with the verified Bitbucket read-only publish boundary and confirm the documented request contract matches the client behavior.

## 2. Review recovery and user flow

- [x] 2.1 Retain the exact reviewed JSON and observed revision after conflict or uncertain submission, add a user initiated JSON download, and cover conflict and download behavior in the E2E suite. Verified by the focused Playwright spec (5/5).
- [x] 2.2 Require a successful remote read and comparison before re-enabling publish after an uncertain submission; cover accepted-then-timeout, no automatic retry, comparison, and unchanged local playlist in E2E. Verified by the focused Playwright spec (5/5).
- [x] 2.3 Update README and accessible provider-specific status copy to state that Bitbucket writes are paused and describe the remote reconciliation and recovery steps.

## 3. Integration verification

- [x] 3.1 Run `npm run check`, `npm run test:regression`, and the focused Git playlist E2E spec; record each actual result and any provider-account limitation. Results: syntax check passed, regression 330/330, E2E 5/5. A live two-client test in a disposable Bitbucket repository was not run because no provider account was supplied; no live-provider behavior is claimed.
- [x] 3.2 Review the final diff and use `openspec validate "issue-04-bitbucket-branch-preflight-atomicity" --strict` to confirm the implementation and change artifacts match the spec. Final diff reviewed; strict validation passed after the implementation and documentation updates.
