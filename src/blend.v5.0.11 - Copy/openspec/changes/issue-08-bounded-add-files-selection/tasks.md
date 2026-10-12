# Tasks

## 1. Shared selection boundary

- [x] 1.1 Add a shared 250-file limit and count helper, reuse the limit for the existing folder cap, and verify exact-cap and cap-plus-one outcomes in `local-import-limits.test.mjs`.

## 2. Direct Add Files behavior and recovery

- [x] 2.1 Gate native, untyped native retry, and input-fallback selections before `addHandles`; verify oversized counts are announced and library state is unchanged in focused E2E coverage.
- [x] 2.2 Continue a direct import after one unreadable handle, report counts, and offer retry for only failed handles; verify persisted rows in Chromium/Firefox and session-only rows plus no duplicates in WebKit.
- [x] 2.3 Inject a one-shot quota failure after a direct import in Chromium and verify successful rows remain in session, the existing save Retry persists them, and no duplicate rows appear.

## 3. Compatibility and verification

- [x] 3.1 Cover native and input cancellation, keyboard activation, media filtering, duplicate behavior, and narrow/zoomed accessible status; run the synthetic picker-path E2E tests in Chromium, Firefox, and WebKit.
- [x] 3.2 Run `npm run check`, `npm run test:regression`, `npm run test:e2e -- tests/e2e/local-import-bounds.e2e.spec.mjs`, and the focused Add Files E2E matrix; record actual outcomes and any unavailable manual screen-reader or real OS-picker checks.
- [x] 3.3 Advance the shared asset/cache generation and all matching app, HTML, and manifest URL references; verify the PWA URL/version contract.

### Verification record (2026-10-12)

- `npm run check` passed; `npm run test:regression` passed all 335 tests.
- The PWA regression assertions passed with asset/cache generation `20261012-v5.0.11-bounded-add-files-selection` synchronized across the app imports, entry HTML, manifests, precache configuration, README, and version inventory.
- `npm run test:e2e -- tests/e2e/add-files-selection-limit.e2e.spec.mjs` passed 25 tests and skipped 2 quota-injection cases in Firefox and WebKit. The exact 250-file native selection imported without truncation in all three engines; the quota-recovery case passed in Chromium; selection bounds, cancellation, filtering, duplicates, and unreadable-file retry passed across Chromium, Firefox, and WebKit.
- `npm run test:e2e -- tests/e2e/local-import-bounds.e2e.spec.mjs` passed 3 tests and failed 1 picker flow while waiting for a file chooser. An isolated rerun of that picker flow also timed out waiting for a later chooser event.
- The focused existing directory-scan cases passed the 250-file import (250 imported), directory-input fallback, and cancellation cases; the smaller-folder recovery case failed its existing keyboard-focus assertion for the “Choose smaller folder” button.
- Manual screen-reader review and real operating-system picker verification were unavailable. The E2E picker paths use synthetic selections and do not establish OS picker behavior.
