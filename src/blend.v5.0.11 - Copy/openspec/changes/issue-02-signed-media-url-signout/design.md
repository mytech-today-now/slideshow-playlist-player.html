# Design

## Context

See `proposal.md` for motivation and `specs/private-media-signout/spec.md` for observable behavior. The app already cancels per-layer playback requests and clears the resolver cache on `SIGNED_OUT`; direct signed URLs are also copied into library/list records and media elements. Keep changes in this standalone static app and preserve its IndexedDB/import formats.

## Goals / Non-Goals

**Goals:** Add a small, testable cleanup boundary that recognizes signed Supabase Storage URLs only when expiry metadata identifies them as resolver-issued values. Ensure cleanup errors are isolated and diagnostics contain only sanitized operation/error types.

**Non-Goals:** Change TTL limits, revoke links at Supabase, alter the existing normal-sign-out or cross-tab reset contracts, or migrate saved data.

## Decisions

- Put record and element cleanup in a side-effect-free module. This allows deterministic unit coverage without importing the browser-only orchestrator; add the module to the versioned app-shell precache so offline loading remains complete. Advance `ASSET_VERSION` and `CACHE_VERSION` together and synchronize the HTML and manifest URLs so installed clients fetch the new hook. Keeping this in `app.js` would make the logic harder to test; placing it in the URL resolver would mix state cleanup with URL resolution.
- Clean only signed Storage URL fields paired with `signedUrlExpiresAt`. Preserve other source fields, including public HTTP URLs, local handles, storage references, bucket/path metadata, and user metadata. A broad recursive URL scrub could change user data; clearing any HTTP URL would break explicitly imported public media.
- Run the hook from each tab's `SIGNED_OUT` listener, after reusing both existing playback cancellation helpers. Handle active playlist/slideshow media independently so clearing one private source does not stop unrelated public or local media or reset the selected experience/list index. A full `stopPlayback()` would reset list positions and affect unrelated media.
- Keep each tab's existing auth semantics. The established local-reset broadcast already causes peer tabs to emit `SIGNED_OUT`; ordinary sign-out does not gain a new cross-tab message. Broadcasting a new sign-out event would change the separate auth coordination contract.
- Mark references whose signed URL was cleared temporarily unavailable, render the existing accessible Retry control, and show a role=alert message. After sign-in, retry uses the retained portable reference through the existing resolver. A new recovery dialog is unnecessary because the item-row retry control already exists and is keyboard accessible.

## Risks / Trade-offs

- A copied URL remains a separate provider capability. Keep the copy clear that local cleanup is not revocation; Supabase documents that signed URLs can remain valid through their expiry, and CDN caching policy may affect delivery beyond token expiry.
- Some non-Supabase bearer URL formats may not be recognized. Restricting cleanup to the resolver's Supabase signed-object route avoids clearing unrelated imported URLs and matches the affected code path.
- Browser workers/processes may be restricted in this environment. Use the repository's serial Node regression mode when the default runner fails before assertions, and report Playwright startup failures without treating them as product failures.

## Rollback

If public or local playback regresses, remove only the new signed-URL cleanup helper/hook and retain existing auth cancellation, resolver-cache clearing, and portable references. No persisted-format migration is needed.
