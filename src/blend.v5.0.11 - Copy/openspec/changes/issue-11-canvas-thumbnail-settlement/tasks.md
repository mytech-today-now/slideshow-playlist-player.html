# Tasks

## 1. Settle helpers and isolate failures

- [x] 1.1 Add one-shot settlement, a bounded deadline, callback catches, best-effort media cleanup, and sanitized exception-type diagnostics; verify syntax with `npm run check`.
- [x] 1.2 Add browser fault-injection coverage for image and video success, null context, draw failure, null Blob, media error, timeout, duplicate callbacks, and cleanup errors; verify the focused E2E spec passes.

## 2. Verify queue and user-visible behavior

- [x] 2.1 Fail the first of multiple imported image previews and assert later jobs complete, queue counts return to zero, source object URLs are revoked, and no unhandled browser error is emitted; verify in Chromium, Firefox, and WebKit.
- [x] 2.2 Assert the fallback icon and accessible filename remain available, then play the failed-preview item; verify rows and playback survive.
- [x] 2.3 Run `npm run test:e2e -- tests/e2e/local-import-bounds.e2e.spec.mjs` to protect the surrounding local-import workflow.

## 3. Verify change record

- [x] 3.1 Run `npm run check`, `npm run test:regression`, focused thumbnail E2E, and strict OpenSpec validation; record exact outcomes and browser limitations.
- [x] 3.2 Verify the Beads record `blend-tu3` title and final status with `bd show`.
