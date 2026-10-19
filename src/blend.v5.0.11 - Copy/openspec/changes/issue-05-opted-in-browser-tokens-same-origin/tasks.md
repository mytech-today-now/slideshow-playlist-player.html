# Tasks

## 1. Supabase session persistence

- [x] 1.1 Add safe current/legacy session-key inspection and use the shared credential boundary for Supabase sign-in and refresh writes; verify present, clear, unavailable, denied-lock, and storage-failure outcomes with focused regression tests.
- [x] 1.2 Preserve valid Supabase sessions in memory when persistence is declined or unavailable; verify tab-only state and no sentinel output in the focused auth regression tests.

## 2. Analytics credential boundary

- [x] 2.1 Include Supabase session state in the analytics decision, re-evaluate after auth and cross-tab storage changes, and keep the UI status credential-free; verify the analytics contract and targeted privacy E2E assertions.
- [x] 2.2 Verify persisted and unreadable Supabase session keys block analytics requests, while a session remains usable in memory when the lock prevents persistence; assert sentinels do not appear in captured output.

## 3. Disclosure and revocation outcomes

- [x] 3.1 Update the Supabase save-session disclosure, exact tab-only fallback copy, and README privacy notes; verify both user-facing text paths and token-free rendered output.
- [x] 3.2 Distinguish confirmed, unknown, skipped, and incomplete local sign-out outcomes without logging tokens; verify mocked network and storage failures plus keyboard, wrapping, zoom, scroll, and overflow behavior at the report's relevant viewports.

## 4. Integration verification

- [x] 4.1 Run `npm run check` and `npm run test:regression`; record exit codes and assertion counts.
- [x] 4.2 Run `tests/e2e/analytics-consent.e2e.spec.mjs`, `tests/e2e/analytics-privacy.e2e.spec.mjs`, and `tests/e2e/supabase-auth.e2e.spec.mjs` in an available browser runner; classify any pre-assertion launch failure as Not run.
- [x] 4.3 Validate the OpenSpec change and verify the linked Beads issue remains open until acceptance.

## Verification record (2026-10-19)

- `npm run sanity` passed syntax checking and all 365 regression tests.
- The serial Chromium run covered the three specified E2E specs in the 17 changed-spec run. All analytics consent, analytics privacy, and Supabase auth cases passed. The overall run passed 118/122; four later lifecycle and playback cases failed in the full run, then passed 4/4 in an isolated rerun.
- Strict OpenSpec validation passed. Beads `blend-6qf` remains in progress and was not changed.

## Workflow follow-up

- Archive this OpenSpec change only after all acceptance checks pass.
