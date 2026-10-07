# Tasks

## 1. Gate private compressed sharing

- [x] 1.1 Add and regression-test a pure helper that finds referenced Supabase buckets outside the configured public allowlist, including private and public fixtures; verify existing bearer URL sanitization and portable reference assertions remain intact.
- [x] 1.2 Block the app's compressed URL share action before compression when the helper finds a private reference, show the existing warning, refresh the shell/module cache versions, and add browser coverage proving private links are not created, user state is preserved, and public-only sharing still works.

## 2. Complete the provider matrix record

- [x] 2.1 Extend the opt-in staging script to check and report all six principal/object outcomes using aliases and HTTP status codes only; verify the no-confirmation path reports `SKIP` before reading credentials or sending requests.
- [x] 2.2 Update the verification record and README to explain the app share gate, all six staging outcomes, owner-reviewed policy and rollback exports, and the distinction between local mock evidence and provider proof.

## 3. Verify and report

- [x] 3.1 Run `npm run check`, `npm run test:regression`, `npm run test:e2e`, the no-confirmation staging command, and OpenSpec validation; record exact outcomes and keep the Beads issue open while owner evidence is outstanding.

### Verification results

- `npm run check`: passed.
- `npm run test:regression`: Node's test runner stopped before assertions with `spawn EPERM`; serial fallback `node --test --test-isolation=none tests/regression/*.test.mjs`: 276 passed, 0 failed. The focused storage/share/PWA regression set: 72 passed, 0 failed.
- `npm run test:e2e`: 105 passed, 23 failed. All three Issue 01 private-media export tests passed in the full run. The failures were in other E2E flows and remain for separate triage. Focused `npm run test:e2e -- tests/e2e/private-media-export.e2e.spec.mjs`: 3 passed, 0 failed.
- `npm run test:storage-policy-staging`: skipped before credential access or network requests because the exact confirmation was absent.
- `openspec validate issue-01-private-storage-authorization-gate --strict`: passed.
- The in-app Browser was unavailable; the authorized Playwright fallback exercised the local HTTP fixture. Private share showed the expected alert without opening the dialog; public-only share opened with only the referenced public item. No relevant console errors were observed.

## Workflow follow-up

- The policy owner must review the redacted policy and rollback exports and all six disposable-staging outcomes before authorizing a later release change that opens private-reference URL sharing.
- Keep the Beads issue open until the provider owner records that evidence; do not archive this OpenSpec change before implementation review.
