# Tasks

## 1. README source and version model

- [x] 1.1 Implement local-first and explicitly selected online loading, version-aware view models, and version/timestamp cache metadata; verify with focused tests for matching and mismatched versions, cached-old and expired entries, force retry, and online-to-local fallback.
- [x] 1.2 Update `readme-fetcher.test.mjs` to prove a seeded online cache never changes the default local source; run the readme-fetcher and Markdown safety regression tests.

## 2. Information dialog source selection

- [x] 2.1 Add the labeled source selector, source/version status, unavailable/retry state, and independent source scroll restoration; verify default-local, explicit-online, fallback, selected-tab retention, and keyboard operation in Information dialog E2E tests.
- [x] 2.2 Verify source labels and the selector wrap without horizontal overflow at narrow viewports, and verify switching between local and online restores both scroll positions in the Information dialog E2E tests.

## 3. Offline installed guide

- [x] 3.1 Route same-folder README requests through the existing service-worker documentation cache, precache the local README, and advance synchronized asset/cache versions; verify the PWA config and offline Information-dialog regression coverage.

## 4. Integration verification

- [x] 4.1 Run `npm run check`, `npm run test:regression`, and `npm run test:e2e`; record exact outcomes and any browser or offline gaps.
- [x] 4.2 Validate the OpenSpec change and verify the Beads issue and final status with `bd show blend-x5m`.
