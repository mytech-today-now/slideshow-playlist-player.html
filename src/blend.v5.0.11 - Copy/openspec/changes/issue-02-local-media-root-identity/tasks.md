# Tasks

## 1. Root-scoped local identity

- [x] 1.1 Preserve path case and require equal opaque root IDs plus exact relative paths for local deduplication; add Node regression coverage for same-root, different-root, missing-root legacy, case-distinct paths, and same-source URLs.
- [x] 1.2 Reuse directory IDs only for the same handle or a positive `isSameEntry` result; create separate IDs when root sameness is unavailable, and verify distinct same-named roots through Playwright.

## 2. Ambiguous duplicate handling

- [x] 2.1 Keep uncertain same-path items and show the required focusable, wrapping duplicate explanation; verify the exact copy and keyboard access in Playwright.

## 3. Persistence and compatibility coverage

- [x] 3.1 Add Playwright coverage for two same-named roots with equal-size different file contents, both playlist references and contents after reload, relative path labels, and exports without absolute paths or root identities.
- [x] 3.2 Verify exact same-root repeats and normalized source URL repeats deduplicate, and legacy path-only records remain importable without an invented absolute path.

## 4. Integration verification

- [x] 4.1 Run `npm run check`, `npm run test:regression`, and `npm run test:e2e`; exercise the required seven viewport sizes and verify wrapping, keyboard reachability, and that cards remain visible or scroll-reachable outside the explanation.

## Verification note

- `npm run check` passed. The default regression runner hit `spawn EPERM` before assertions; `node --test --test-isolation=none tests/regression/*.test.mjs` passed all 276 tests.
- Focused Issue 02 and exact-case relinking browser checks passed after updating the old mixed-case path fixture.
- The full Playwright run completed with 110 passed and 21 failed. One failure was the existing relink fixture's differently cased path; after correcting that fixture, all five focused folder-identity and relinking scenarios passed. The broad suite was not rerun after that fixture correction.

## Workflow follow-up

- Archive this change after implementation and verification are complete.
