# Tasks

## 1. Credential and analytics boundary

- [x] 1.1 Add a credential-store state inspector and extend the pure analytics decision to block present or unreadable state; verify focused regression tests cover clear, remembered, malformed, and unavailable storage states.
- [x] 1.2 Coordinate analytics script insertion and remembered credential persistence with one cross-tab browser lock; re-check storage while holding it, preserve session-only connections on lock failure, and re-evaluate same-tab and cross-tab changes; verify the focused consent and Git credential browser scenarios, including script-load failure.
- [x] 1.3 Associate the accessible boundary explanation with the consent and Remember controls, preserve consent and existing disconnect/forget semantics, and document mode switching in README; verify keyboard operation and confirm no synthetic credential marker enters analytics requests, logs, events, or DOM text.

## 2. Integration verification

- [x] 2.1 Run `npm run check`, `npm run test:regression`, the focused analytics and Git credential regressions, `npm run test:e2e -- tests/e2e/analytics-privacy.e2e.spec.mjs`, `npm run test:e2e -- tests/e2e/git-playlist-storage.e2e.spec.mjs`, and `openspec validate issue-03-remembered-git-credential-analytics-gate`; record exact results and any runner limitations in the tracker.
- [x] 2.2 Verify Beads issue `blend-dfj` and the OpenSpec change report matching identifiers and completion status; keep the Beads issue open if any acceptance check remains blocked or incomplete.
