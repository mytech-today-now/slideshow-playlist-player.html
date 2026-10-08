# Tasks

## 1. Export Boundary and Regression Coverage

- [x] 1.1 Extend recursive media metadata sanitization to omit absolute Windows, UNC, and POSIX paths while preserving safe values; verify the focused media export sanitizer regression passes.
- [x] 1.2 Add regression cases for nested synthetic paths, credential markers, public versioned URLs, portable references, compressed round trips, and unchanged source records; verify with `node --test --test-isolation=none tests/regression/media-export-sanitizer.test.mjs`.

## 2. User Disclosure and Browser Coverage

- [x] 2.1 Thread an action-scoped omission signal through JSON export and share preparation, then announce the required accessible notice; verify app syntax with `npm run check`.
- [ ] 2.2 Extend the private-media export E2E fixtures with synthetic nested path sentinels, assert the sentinels are absent from full JSON and decompressed share payloads, and cover keyboard opening plus existing responsive widths; verify with `npx playwright test tests/e2e/private-media-export.e2e.spec.mjs --config=playwright.config.mjs`.
- [x] 2.3 Advance the PWA asset and cache version markers and verify the configured precache uses them with the focused PWA config regression test.

## 3. Integration Verification

- [ ] 3.1 Run `npm run check`, `npm run test:regression`, and `npm run test:e2e`; record exact outcomes and confirm no source or active user state changes in the browser scenario.
- [x] 3.2 Validate the OpenSpec change and verify its final task status and the linked Beads issue status; record the verified identifiers and outcomes.

## Verification Record

- 2026-10-07: `npm run check` passed. `npm run test:regression` could not start its worker processes (`Error: spawn EPERM`); the serial fallback `node --test --test-isolation=none --test-reporter=spec tests/regression/*.test.mjs` passed all 278 tests. `npm run test:e2e` stops before Playwright startup with `Error: spawn EPERM`, so browser state and responsive behavior remain unverified.
- 2026-10-07: `openspec validate issue-05-imported-metadata-export-sanitization --strict` passed. This change is at 5/7 tasks complete; E2E and complete integration verification remain pending.
- Linked Beads issue `blend-e6g` remains `in_progress` pending browser verification.
