# Tasks

## 1. Signed URL cleanup helper

- [x] 1.1 Add the side-effect-free cleanup helper and unit tests for signed URL clearing, portable-reference preservation, missing/expired expiry metadata, public/local boundaries, and cleanup failures; verify with the focused Node test.
- [x] 1.2 Advance `ASSET_VERSION` and `CACHE_VERSION` together, add the helper to the versioned app-shell precache, and verify the PWA asset invariant tests pass.

## 2. Sign-out integration and recovery

- [x] 2.1 Wire cleanup into the signed-out event, preserve current position and experience, and expose the accessible sign-out/retry copy; verify both media layers clear signed sources while public/local playback stays available in the focused auth E2E spec.
- [x] 2.2 Add E2E coverage for cancellation/late playback advance, retry after sign-in, multi-tab local reset, and a copied URL that remains independently usable; verify the focused auth E2E spec.

## 3. Integration verification

- [x] 3.1 Run the package syntax check, regression suite, auth E2E spec, and private-media-export E2E spec; report any runner startup failures separately from assertion results.
- [x] 3.2 Validate the OpenSpec change and Beads link/status with supported CLI commands; verify this issue is separate from the existing local-media-root issue.

## Workflow follow-up

- Review and archive this OpenSpec change only after the expanded issue-02 acceptance and verification pass.

## 4. Signed URL lifetime, durable state, and cleanup recovery

- [x] 4.1 Set the owner-approved 3,600-second default across runtime config, resolver fallbacks, Config UI, and documentation; migrate only the legacy default and test explicit overrides.
- [x] 4.2 Strip resolver-issued signed URLs from cloned persistence snapshots and sanitize legacy IndexedDB records during startup without changing live playback, portable references, or user data; add regression and E2E coverage.
- [x] 4.3 Wait for media and IndexedDB cleanup outcomes on sign-out, show retryable incomplete-cleanup copy on failure, and verify sanitized diagnostics plus public/local/authenticated recovery in E2E.

## 5. Expanded verification and tracking

- [x] 5.1 Run the focused signed URL regression test and focused Supabase auth E2E spec; record exact command outcomes and browser details.
  - Evidence: `node --test --test-isolation=none tests/regression/signed-url-cleanup.test.mjs` exited 0 with 6/6 passing. `npm run test:e2e -- tests/e2e/supabase-auth.e2e.spec.mjs tests/e2e/private-media-export.e2e.spec.mjs` exited 0 with 11/11 passing in Chromium; the runner output did not include the browser version. Sign-out UI checks covered 320x480, 320x568, 360x800, 375x667, 390x844, 430x932, 768x1024, 1024x768, and 1280x720, plus an effective 160x240 CSS viewport for 200% zoom reflow, keyboard focus, wrapping, scroll reachability, and overflow.
- [x] 5.2 Run `npm run check` and `npm run test:regression`; record exact command outcomes and assertion counts.
  - Evidence: `npm run check` exited 0. `npm run test:regression` exited 0 with 361/361 passing.
- [ ] 5.3 Validate the reused OpenSpec change and Beads `blend-ag8` status, then archive only after all acceptance checks pass.
  - Pending archive: keep the change active until owner-approved synthetic staging records direct-object and CDN responses separately before and after a staging-controlled URL expiry. Owner approval for a disposable staging target was not provided in this request, so those outcomes remain Not run and no provider requests were made. Beads `blend-ag8` remains in progress and links to `ai-prompts/pre-mortem-2026-10-20-13-13-58.html#issue-02` (A copied signed Storage URL can outlive local sign-out).
- [x] 5.4 Link the current Issue 02 report finding and add focused synthetic assertions for the copied-link warning, expired-reference recovery, both-layer sign-out cleanup, playback-state preservation on cleanup failure, and private signed URL/token absence from status, logs, and persistence.
  - Evidence: `npm run test:e2e -- tests/e2e/supabase-auth.e2e.spec.mjs` exited 0 with 9/9 Chromium tests. `node --test --test-isolation=none tests/regression/signed-url-cleanup.test.mjs` exited 0 with 6/6 tests. The first `npm run sanity` run exited 1 with 370/372 regressions because the README matrix inventory and launch-failure wording were stale. After updating those workflow-contract expectations and README evidence, the final `npm run sanity` passed 373/373. Provider/CDN lifetime was Not run.

## Staging expiry follow-up (2026-10-19)

- Result: Not run. No staging confirmation or staging settings were present. `BLEND_STORAGE_STAGING_CONFIRM` and the required `BLEND_STORAGE_STAGING_*` settings were absent, and the checkout contains `.env.example` only. No provider requests were sent. The existing `tests/integration/storage-policy-staging.mjs` covers storage authorization policy, not signed URL expiry through a CDN.
- Prerequisites: owner-authorized disposable Supabase staging project; private synthetic object; an approved CDN route for that same object, if CDN behavior is in scope; a short staging-only signed URL lifetime; and permission to remove the fixture after the run.
- Operator sequence:
  1. Create one synthetic private object under a unique test prefix and mint one signed URL with an approved short TTL, such as 60 seconds. Keep the URL only in the test process memory. Do not print it, write it to a file, capture it in a screenshot, or include it in logs or reports.
  2. At baseline, at the configured expiry, and five seconds after expiry, issue a one-byte range GET to the direct Storage object route and separately to the configured CDN route. Preserve the signed query only in memory when using the approved CDN route. Do not use local sign-out as a revocation step or expected result.
  3. For each route and observation time, record sanitized UTC time, HTTP status, and only relevant cache headers present: `Date`, `Cache-Control`, `Age`, `Expires`, `Via`, `X-Cache`, and `CF-Cache-Status`. Do not record request URLs, query strings, response bodies, authorization values, or screenshots.
  4. Delete the synthetic object using the authorized staging procedure and discard the in-memory URL. Record direct-object and CDN outcomes separately. Do not infer CDN expiry from the direct-object response.
- Result template: `baseline`, `configured expiry`, and `expiry + 5 seconds` rows, with separate direct-object and CDN status/cache-header fields. If no approved CDN route exists, mark only the CDN observations Not run and keep acceptance pending.
- OpenSpec task 5.3 remains open. Beads `blend-ag8` remains in progress pending staging evidence and owner acceptance.
