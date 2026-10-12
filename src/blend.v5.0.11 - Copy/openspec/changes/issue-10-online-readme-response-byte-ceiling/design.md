# Design

## Context

`readme-fetcher.js` currently creates an `AbortController`, applies a ten-second request deadline, checks the HTTP status, and calls `Response.text()`. The request deadline covers body consumption, but it does not cap bytes. The Information dialog already renders the installed guide first for uncached online requests and only switches to online content after `fetchReadme` succeeds.

The current installed README is 58,418 bytes. A 512 KiB (524,288-byte) limit is about nine times that size. The claim that the mutable upstream README may grow unexpectedly is a testable assumption; no oversized upstream response was observed or needed to justify bounding the client.

## Decisions

- Export a documented 512 KiB ceiling for the optional remote README. Measure actual stream bytes, ignoring `Content-Length` as an authority.
- Read with `ReadableStreamDefaultReader`, increment the byte count before decoding each chunk, and cancel as soon as the count exceeds the limit. Do not call `Response.text()` when a body is unknown or unavailable.
- Decode incrementally with fatal UTF-8 handling so an invalid sequence rejects the document instead of silently inserting replacement characters.
- Keep the existing injected fetch, timer, storage, and clock boundaries. Preserve the same-folder README request before a cold online request and preserve cache TTL/version metadata.
- Validate complete Markdown before writing the online cache. Overflow, timeout, stream, decoding, or validation failures leave an existing cache entry untouched and resolve to the installed guide when available.
- Keep the service-worker `PRECACHE_OPTIONAL` README route unchanged. That same-origin asset remains the offline help source.
- Change only the fallback status wording and retry label. The existing status role and source selector provide the announcement and local selection; existing request-sequence and scroll preservation continue to apply.

## Risks and Trade-offs

- A future maintained README larger than 512 KiB will use the installed guide until the cap is intentionally adjusted from measured document sizes. Stream cancellation and local fallback remain required.
- Markdown validation renders once before cache commit and again when the dialog displays the accepted document. The input is bounded to 512 KiB, which bounds this optional duplicate work.
- Browser E2E verifies the DOM status and local content, not human screen-reader speech or deployed upstream behavior.

## Rollback

Remove the byte-limited online body reader, its cap, validation and regression cases, fallback wording, E2E case, and the documentation sentence. Keep the existing local-first README workflow and service-worker offline README cache intact.
