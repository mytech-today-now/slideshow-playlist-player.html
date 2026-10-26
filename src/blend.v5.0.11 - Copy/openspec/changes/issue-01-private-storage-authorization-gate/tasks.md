# Tasks

## 1. Gate private compressed sharing

- [x] 1.1 Add and regression-test a pure helper that finds referenced Supabase buckets outside the configured public allowlist, including private and public fixtures; verify existing bearer URL sanitization and portable reference assertions remain intact.
- [x] 1.2 Block the app's compressed URL share action before compression when the helper finds a private reference, show the existing warning, refresh the shell/module cache versions, and add browser coverage proving private links are not created, user state is preserved, and public-only sharing still works.

## 2. Complete the provider matrix record

- [x] 2.1 Extend the opt-in staging script to check and report all six principal/object outcomes using aliases and HTTP status codes only; verify absent and inexact confirmation report `SKIP` before reading credentials or sending requests.
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

### 2026-10-20 report-linked follow-up

Finding: `ai-prompts/pre-mortem-2026-10-20-13-13-58.html#issue-01`: **Private Storage authorization remains an unpassed release gate**.

- `node --test --test-isolation=none --test-name-pattern="staging command skips" tests/regression/storage-policy-contract.test.mjs`: 2 passed for absent and inexact confirmation; only the confirmation setting was read and no fetch was called.
- `npm run sanity`: syntax check passed; 370/372 regressions passed. The two failures are README workflow-contract assertions in `tests/regression/playwright-workflow-contract.test.mjs`.
- `npm run test:storage-policy-staging` with a deliberately non-matching confirmation: `SKIP`; no requests sent.
- Provider behavior: **NOT RUN**. All six provider cells remain **NOT RUN** and the release gate remains **NOT PASSED**.

### 2026-10-23 report-linked follow-up

Finding: `ai-prompts/pre-mortem-2026-10-22-23-55-46.html#issue-01`: **Private Storage authorization remains an unpassed release gate**.

- `node --test --test-isolation=none --test-name-pattern="staging command skips" tests/regression/storage-policy-contract.test.mjs`: 2 passed for absent and inexact confirmation. The synthetic environment proxy observed only the confirmation setting, and the fetch spy observed no requests.
- `npm run sanity` and `npm run test:storage-policy-staging` were not run for this follow-up. The current regression verifies only the local skip path.
- Provider behavior: **NOT RUN**. The verification record still has all six cells **NOT RUN**, owner and rollback evidence **NOT RECORDED**, and the release gate **NOT PASSED**. Private-reference URL sharing remains blocked.
- Beads `blend-5qc` remains `IN_PROGRESS`; this OpenSpec change remains unarchived pending owner-reviewed evidence.

### 2026-10-23 assumption-draft follow-up

Finding: `ai-prompts/pre-mortem-2026-10-22-23-55-46.html#issue-01`: **Private Storage authorization remains an unpassed release gate**.

- Added `STORAGE_POLICY_ASSUMPTIONS_DRAFT.md` as a clearly labeled hypothetical owner-review draft. It is not a current export, rollback copy, or deployment artifact; the example SQL is commented out.
- No provider behavior was tested. All six cells remain **NOT RUN**, owner and rollback evidence remain **NOT RECORDED**, and the release gate remains **NOT PASSED**.

### 2026-10-25 report-linked follow-up

Finding: `ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-01`: **Private Storage authorization remains an unpassed release gate**.

- `node --test --test-isolation=none --test-name-pattern="staging command skips" tests/regression/storage-policy-contract.test.mjs`: 2 passed for absent and inexact confirmation. The environment proxy observed only the confirmation setting, the fetch spy observed no requests, and the output contained no credential values.
- `npm run sanity`: passed; syntax checks passed and all 383 regressions passed.
- `npm run test:storage-policy-staging`: not run because no owner-approved disposable project, redacted current and rollback exports, or synthetic fixtures were supplied.
- Provider behavior: **NOT RUN**. All six cells remain **NOT RUN**, owner and rollback evidence remain **NOT RECORDED**, and the release gate remains **NOT PASSED**. Private-reference URL sharing remains blocked.
- Added an explicit finding assessment linked to the same report article: no provider policy defect or exposure was observed, the policy remains unknown, and possible over-permission or owner denial is a testable assumption. Regression coverage checks that wording without treating it as provider evidence.
- Beads `blend-5qc` remains `IN_PROGRESS`; this OpenSpec change remains unarchived pending owner-reviewed evidence.

## Workflow follow-up

- The policy owner must review the redacted policy and rollback exports and all six disposable-staging outcomes before authorizing a later release change that opens private-reference URL sharing.
- Keep the Beads issue open until the provider owner records that evidence; do not archive this OpenSpec change before implementation review.
