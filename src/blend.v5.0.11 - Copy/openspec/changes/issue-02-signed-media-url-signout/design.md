# Design

## Context

See `proposal.md` for motivation and `specs/private-media-signout/spec.md` for observable behavior. The app already cancels per-layer playback requests and clears the resolver cache on `SIGNED_OUT`; direct signed URLs are also copied into library/list records and media elements. Keep changes in this standalone static app and preserve its IndexedDB/import formats.

## Goals / Non-Goals

**Goals:** Keep resolver-issued signed Supabase Storage URLs out of durable snapshots while leaving the live URL available to the current playback operation. Remove older persisted copies during startup, retain portable references and user data, and ensure cleanup errors are isolated with diagnostics limited to sanitized operation/error types. Default newly issued URLs to the owner-approved 3,600 seconds while retaining explicit per-player TTL overrides.

**Non-Goals:** Revoke links at Supabase, change the signed URL format or import/export formats, alter the existing cross-tab reset contract, or migrate IndexedDB stores/schema.

## Decisions

- Put record and element cleanup in a side-effect-free module. This allows deterministic unit coverage without importing the browser-only orchestrator; add the module to the versioned app-shell precache so offline loading remains complete. Advance `ASSET_VERSION` and `CACHE_VERSION` together and synchronize the HTML and manifest URLs so installed clients fetch the new hook. Keeping this in `app.js` would make the logic harder to test; placing it in the URL resolver would mix state cleanup with URL resolution.
- During live sign-out, clear only signed Storage URL fields paired with `signedUrlExpiresAt`, which identifies URLs issued by this resolver. At the persistence boundary, remove any URL matching the recognized Supabase signed-object route even when old expiry metadata is missing, including the app-generated `metadata.socialResolved.image` field. Preserve public HTTP URLs, local handles, storage references, bucket/path metadata, other generated preview metadata, and user-authored metadata; a broad recursive URL scrub could change user data.
- Sanitize cloned records at the shared persistence boundary. Keep the in-memory record and media element URL available to the current playback operation; preserve `storageReference` and metadata for refresh. On startup, sanitize the read snapshot and rewrite it through the same boundary before treating legacy URLs as durable state.
- Migrate the previous 1,209,600-second default only when loading saved IndexedDB player settings. Record the TTL policy version in player settings so an owner who later selects a longer TTL keeps that explicit choice across reloads; imported experience settings with a current explicit value remain intact.
- Run the hook from each tab's `SIGNED_OUT` listener, after reusing both existing playback cancellation helpers. Handle active playlist/slideshow media independently so clearing one private source does not stop unrelated public or local media or reset the selected experience/list index. A full `stopPlayback()` would reset list positions and affect unrelated media.
- Wait for the sign-out cleanup snapshot to settle before reporting success. When element cleanup or IndexedDB persistence fails, keep the record and portable reference, show an incomplete status, and offer a retry that does not place a bearer URL in copy or diagnostics.
- Keep each tab's existing auth semantics. The established local-reset broadcast already causes peer tabs to emit `SIGNED_OUT`; ordinary sign-out does not gain a new cross-tab message. Broadcasting a new sign-out event would change the separate auth coordination contract.
- Mark references whose signed URL was cleared temporarily unavailable, render the existing accessible Retry control, and show a role=alert message. After sign-in, retry uses the retained portable reference through the existing resolver. A new recovery dialog is unnecessary because the item-row retry control already exists and is keyboard accessible.

## Risks / Trade-offs

- A copied URL remains a separate provider capability. Keep the copy clear that local cleanup is not revocation; Supabase documents that signed URLs can remain valid through their expiry, and CDN caching policy may affect delivery beyond token expiry.
- Some non-Supabase bearer URL formats may not be recognized. Restricting cleanup to the resolver's Supabase signed-object route with expiry metadata avoids clearing unrelated imported URLs and matches the affected code path.
- One-hour URLs can expire during a long playback session that needs later range requests. The Config TTL remains an explicit owner-controlled setting, and the app refreshes only when it resolves the portable reference again.
- Browser workers/processes may be restricted in this environment. Use the repository's serial Node regression mode when the default runner fails before assertions, and report Playwright startup failures without treating them as product failures.

## Rollback

If public or local playback regresses, remove only the new signed-URL cleanup helper/hook and retain existing auth cancellation, resolver-cache clearing, and portable references. No persisted-format migration is needed.
