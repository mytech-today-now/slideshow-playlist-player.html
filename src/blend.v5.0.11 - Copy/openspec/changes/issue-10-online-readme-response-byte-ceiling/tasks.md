# Tasks

## 1. Bound and validate online README bodies

- [x] 1.1 Add a documented 512 KiB streamed byte limit, strict UTF-8 decoding, reader cancellation, and complete-response Markdown validation before cache writes; preserve timeout and cache/version behavior.
- [x] 1.2 Add regression coverage for just-under, exact-cap, and over-cap bodies; reader cancellation; unknown/misleading `Content-Length`; invalid UTF-8/Markdown; timeout or stream error after headers; timer cleanup; prior-cache retention; and local-first, expiry, retry, and version behavior.

## 2. Keep the Information dialog usable on failure

- [x] 2.1 Show the required installed-guide fallback copy with accessible status and retry, preserving selected source behavior and scroll state.
- [x] 2.2 Add an Information dialog E2E case proving an oversized online source is cancelled and leaves installed content readable; retain offline and online-success source-label coverage.
- [x] 2.3 Document the cap and local fallback in the standalone README without changing optional PWA README caching.

## 3. Verification and tracking

- [x] 3.1 Run `npm run check`, `npm run test:regression`, and `npm run test:e2e -- tests/e2e/information-dialog.e2e.spec.mjs`; report exact outcomes and any runner/browser limitation.
- [x] 3.2 Validate this OpenSpec change and verify the linked Beads record title, identifier, and final status.

## Verification Notes

- `node --test --test-isolation=none tests/regression/readme-fetcher.test.mjs`: 32/32 passed.
- `npm run check`: passed. `npm run test:regression`: 347/347 passed.
- The focused Information dialog E2E suite passed 14/14 in Chromium using `PLAYWRIGHT_PORT=4192`; the default port 4191 was already occupied. The first full attempt had one intermittent source-scroll assertion, which passed in the final full run after simplifying scroll restoration to one scheduled frame.
- `openspec validate issue-10-online-readme-response-byte-ceiling --strict`: valid. `git diff --check`: passed with only existing line-ending normalization warnings.
- Linked Beads issue `blend-18l` has the exact issue title and is closed after verification.
- The installed README is 58,418 bytes; the proposed cap is 524,288 bytes. An oversized mutable upstream README remains a testable assumption, not an observed live response.
- The service-worker optional README cache and offline help path were left unchanged.
