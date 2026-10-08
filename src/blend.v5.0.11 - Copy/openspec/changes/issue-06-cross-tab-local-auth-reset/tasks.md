# Tasks

## 1. Auth Coordination and Regression Coverage

- [x] 1.1 Add nonce-only same-origin tab presence, reset, acknowledgment, and departure messages to the auth client; verify the focused auth regression tests cover peer clearing, shutdown, and back-forward cache lifecycle.
- [x] 1.2 Add a deferred synthetic refresh-response regression proving a cleared opted-in session cannot be restored after its reset generation changes; verify with `node --test --test-isolation=none tests/regression/supabase-auth.test.mjs`.

## 2. Reset Flow and Browser Coverage

- [x] 2.1 Gate the reset snapshot and database deletion on bounded peer confirmation and show the required unconfirmed-tab warning while preserving Blend data; verify the focused reset E2E spec covers the warning and keyboard focus.
- [x] 2.2 Add two-page E2E coverage for memory-only and opted-in sessions, refresh cancellation, credential-free messages, blocked-delete recovery, and no remote logout; verify with the focused Playwright specs.

## 3. Installed Client and Integration Verification

- [x] 3.1 Advance and align the asset/cache markers and verify the precache configuration uses the new version with the focused PWA config regression test.
- [x] 3.2 Run `npm run check`, `npm run test:regression`, and `npm run test:e2e`; record exact results, including the process-spawn restriction and supported fallback.
- [x] 3.3 Validate the OpenSpec change and verify the linked Beads issue and OpenSpec task statuses with their supported CLIs.

## Workflow follow-up

- Archive the OpenSpec change after all implementation and browser verification requirements are complete.

## Verification Record

- 2026-10-07: `npm run check` passed; `node --check tests/e2e/clear-browser-storage.e2e.spec.mjs` passed.
- 2026-10-07: `node --test --test-isolation=none tests/regression/supabase-auth.test.mjs` passed 34/34 tests; `node --test --test-isolation=none tests/regression/pwa-config.test.mjs` passed 4/4 tests.
- 2026-10-07: `npm run test:regression` failed before assertions with `Error: spawn EPERM`; final serial fallback `node --test --test-isolation=none tests/regression/*.test.mjs` passed 282/282 tests.
- 2026-10-08: Final `npx playwright test --config=playwright.config.mjs tests/e2e/clear-browser-storage.e2e.spec.mjs --workers=1` passed 12/12. This includes memory-only tabs, two tabs restoring an opted-in session with refreshes pending, credential-free messages, no provider logout, desktop/mobile unconfirmed-peer warning and retry with focus return, and blocked-delete recovery.
- 2026-10-08: `npm run test:e2e` failed before startup inside the workspace sandbox with `Error: spawn EPERM`. An escalated final-tree run launched 148 tests and finished with 125 passed and 23 failed. All 12 Clear Browser Storage cases passed in that run. Remaining failures are in other app flows, including unrelated experience/import, PWA worker, and auth refresh-outage scenarios; the full aggregate is not green, so this change remains unarchived.
- 2026-10-07: `openspec validate issue-06-cross-tab-local-auth-reset --strict` passed. Beads issue `blend-aax` is verified as `in_progress` and linked to this change through `spec-id`. The change remains unarchived while the full E2E suite is non-green.
