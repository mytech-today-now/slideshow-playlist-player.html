# Tasks

## 1. Bounded decompression

- [x] 1.1 Reduce the maximum output to 8 MiB while keeping the existing output-limit error code.
- [x] 1.2 Replace chunk retention plus full concatenation with bounded geometric buffer growth and release temporary output references on failure.
- [x] 1.3 Cover below-cap, exact-cap, and cap-plus-one behavior, cancellation, and output allocation growth in regression tests.

## 2. Atomic failure and recovery

- [x] 2.1 Preserve share URL parameters after every failed import and clear them only after a committed import.
- [x] 2.2 Use the specified accessible over-limit recovery message.
- [x] 2.3 Verify oversized rejection and injected persistence abort leave state unchanged and keep the URL retryable; verify successful retry clears it.

## 3. Compatibility, performance, and verification

- [x] 3.1 Preserve the gzip/Base64URL format, parameter names, error code, and ordinary round trips.
- [x] 3.2 Run focused regression, output-limit E2E, and share-import/playback E2E coverage; record exact outcomes.
- [x] 3.3 Advance the asset/cache generation consistently and run the PWA version contract checks.
- [ ] 3.4 Measure peak memory for representative 1 MiB, 10 MiB, and cap-sized payloads on an owner-agreed low-memory browser/device profile and compare against its agreed budget. Desktop informational heap readings do not complete this task.

## Tracking

- Source report: `Pasted text.txt`, Issue 09, “The 50 MiB share decompression ceiling can still create multiple large memory copies”.
- Beads issue: `blend-lmg`.

## Verification record (2026-10-12)

- `npm run check` passed.
- `npm run test:regression` passed all 335 tests, including URL-share round trip, corruption, schema, exact boundary, cancellation, allocation growth, and URL diagnostics coverage.
- `npm run test:e2e -- tests/e2e/url-share-output-limit.e2e.spec.mjs` passed 1/1 in Chromium. Oversized and transaction-abort failures retained state and URL; retry succeeded and cleared the parameters after commit.
- `npm run test:e2e -- tests/e2e/experience-share-import-playback.e2e.spec.mjs` passed 2/2 in Chromium.
- `openspec validate issue-09-share-decompression-memory` passed.
- The E2E `performance.memory` reading was `10,000,000` bytes before and after the rejected share. This browser reading is informational and is not a peak allocation measurement. No owner-agreed low-memory profile or budget is available; task 3.4 and the Beads issue remain in progress.
