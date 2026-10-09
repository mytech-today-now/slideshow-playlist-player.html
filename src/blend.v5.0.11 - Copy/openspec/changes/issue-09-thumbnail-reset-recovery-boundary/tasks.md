# Tasks

## 1. Reset Snapshot Policy

- [x] 1.1 Exclude only thumbnail records from the recovery snapshot and prepare the snapshot before local auth reset; focused E2E verified the exact snapshot-failure copy, no deletion attempt, preserved saved session/data, and successful retry.
- [x] 1.2 Exercise synthetic small, typical, and large cache fixtures. Observed respectively 10 records/10,240 Blob bytes, 512/4,194,304, and 4,096/67,108,864; every profile read the same 8 non-thumbnail stores (22 records total), with zero thumbnail records or bytes in the snapshot. Browser heap was 10,000,000 bytes before and after each profile (zero reported delta). Blocked deletion retained the seeded thumbnail cache and user-authored data.
- [x] 1.3 Verify a blocked deletion remains recoverable until explicit retry, lazy preview regeneration from a synthetic retained handle, and icon fallback when unavailable. README documents the cache tradeoff and recovery limits.
- [x] 1.4 Exercise the reset confirmation at 3840×2160, 1920×1080, 1024×768, 768×1024, 390×844, 844×390, and 360×800; all cases passed wrapping, visible keyboard focus, touch target, 200% text scaling, and no page-level horizontal overflow assertions.

## 2. Integration Verification

- [x] 2.1 Run `npm run check`, regression tests, focused and full E2E, and strict OpenSpec validation. `npm run check` passed. `npm run test:regression` stopped before assertions with `Error: spawn EPERM`; serial fallback `node --test --test-isolation=none --test-concurrency=1 tests/regression/*.test.mjs` passed 284/284. The sandboxed E2E command also stopped with `spawn EPERM`; the escalated full suite ran 189 tests and recorded 170 passed/19 failed before the final focused fixture corrections. The final focused command `npm run test:e2e -- tests/e2e/clear-browser-storage.e2e.spec.mjs --workers=1` passed 15/15. Strict OpenSpec validation passed.
