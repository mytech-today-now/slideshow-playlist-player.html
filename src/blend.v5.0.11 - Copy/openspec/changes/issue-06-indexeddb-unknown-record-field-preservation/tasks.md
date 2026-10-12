# Tasks

## 1. Transactional Merge and Regression Coverage

- [x] 1.1 Preserve unknown top-level fields when merging an existing library record and verify current app fields still win with `node --test --test-isolation=none tests/regression/experience-persistence.test.mjs`.
- [x] 1.2 Inject transaction read and post-merge write failures, then verify aborts leave all original snapshot stores and the revision unchanged with the focused persistence regression test.

## 2. Newer-Schema Browser Coverage

- [x] 2.1 Cover current-version and synthetic higher-version databases, edit and save through the app, and verify the future library property plus settings, aliases, directory handles, and media records after save with the focused newer-schema Playwright spec.
- [x] 2.2 Verify a changed required key path still produces startup recovery and leaves the complete source record unchanged with the focused newer-schema Playwright spec.

## 3. Integration Verification

- [x] 3.1 Run `npm run check`, `npm run test:regression`, `node --test --test-isolation=none tests/regression/indexeddb-open.test.mjs`, `npm run test:e2e -- tests/e2e/indexeddb-newer-schema.e2e.spec.mjs`, and `npm run test:e2e -- tests/e2e/save-lifecycle.e2e.spec.mjs`; record actual results, then verify `DB_VERSION` and the six-store migration path remain unchanged.
