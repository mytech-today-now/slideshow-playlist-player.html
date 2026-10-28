# Proposal

## Why

The URL-share importer accepts up to 50 MiB of decompressed JSON and currently retains stream chunks while allocating a second contiguous output buffer, then decodes and parses the result. No out-of-memory failure has been observed, but this peak is a testable low-memory-browser availability risk; this change narrows the accepted output and removes the full chunk-list concatenation copy.

## What Changes

- Lower the decompressed share output limit from 50 MiB to 8 MiB while preserving the existing error code and share format.
- Accumulate decompressed bytes in one bounded, geometrically grown buffer and release it before JSON parsing.
- Keep the active experience and source URL parameters unchanged after oversized, malformed, or uncommitted imports; clear the URL only after a successful persisted import.
- Show a specific accessible recovery message for over-limit links.
- Add exact-boundary, allocation-growth, failed-transaction, URL-retry, and compatibility coverage.

## Capabilities

### New Capabilities

- `bounded-url-share-decompression`: Bounded decompression, rejection, and recovery behavior for URL-shared experiences.

### Modified Capabilities

None.

## Impact

- `url-share.js` bounded decompression and exported output-limit constant.
- `app.js` URL-share error copy and URL cleanup timing.
- URL-share regression and output-limit E2E coverage.
- PWA asset/cache generation references, because the browser module and app behavior change.
- No compression-format, query-parameter, persisted-schema, or runtime-dependency change.

## Tracking

- Current report finding: `ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-04`, stable article ID `issue-04`, “An 8 MiB shared experience lacks low-memory peak measurements”.
- Original implementation source: `Pasted text.txt`, Issue 09, “The 50 MiB share decompression ceiling can still create multiple large memory copies”.
- Beads issue: `blend-lmg`.
