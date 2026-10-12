# Proposal

## Why

The optional online README fetch has a deadline, but currently buffers the response with `Response.text()` and has no byte ceiling. A fast, unexpectedly large response can therefore consume memory before the timeout helps. The installed version guide is already shown first and must remain available when the remote body is rejected or malformed.

## What Changes

- Limit the explicitly requested online README to 512 KiB of streamed response bytes, regardless of `Content-Length`.
- Decode the complete stream as strict UTF-8 and validate Markdown before caching it.
- Cancel an over-limit body and retain the installed guide, its scroll state, and any previously valid online cache.
- Show an accessible sanitized fallback status and a keyboard-operable retry action.
- Cover stream boundaries, misleading or missing length metadata, timeout after headers, body/encoding/Markdown failures, and the Information dialog fallback.

## Capabilities

### New Capabilities

- `online-readme-response-bounds`: Bounds optional remote documentation and defines complete-response caching and installed-guide fallback behavior.

### Modified Capabilities

None. The existing local-first refresh capability remains unchanged.

## Impact

The change affects `readme-fetcher.js`, its regression tests, the Information dialog fallback copy in `app.js`, its Playwright coverage, and the developer documentation in `README.md`. The service-worker's optional same-origin README cache remains the offline source. No runtime dependencies, persisted formats, or PWA cache policies are added.
