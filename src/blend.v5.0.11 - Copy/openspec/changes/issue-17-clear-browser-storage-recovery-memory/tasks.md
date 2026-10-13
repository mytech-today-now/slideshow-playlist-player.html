# Tasks

## 1. Synthetic profile measurements and fail-closed coverage

- [x] 1.1 Add small, typical, and large synthetic library profiles; record Chromium snapshot time and peak heap, and assert deletion begins only after snapshot transaction completion. Verify the profile E2E and record its metrics in `design.md`.
- [x] 1.2 Inject a read-transaction abort in each of the eight protected stores; verify the recovery-copy status, zero delete attempts, unchanged authored records and local session, then verify a successful retry with the focused per-store E2E.
- [x] 1.3 Run the full reset E2E to protect the existing post-snapshot auth, blocked-delete, timeout, rollback, thumbnail, configuration, and scoped cleanup behavior; final focused run passed 17/17.

## 2. Integration verification and tracker state

- [x] 2.1 Run `npm run check` and `npm run test:regression`; syntax check passed and regression passed 353/353.
- [x] 2.2 Validate this OpenSpec change with `openspec validate issue-17-clear-browser-storage-recovery-memory --strict` and verify Beads `blend-d58` status with `bd show`; strict validation passed and Beads is closed with the accepted-profile evidence and limits.

## Workflow follow-up

- Archive this measurement-only change after its verification record is complete.
