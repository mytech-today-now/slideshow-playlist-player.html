# Proposal

## Why

Blend can retain a fresh private Storage signed URL after the current tab signs out. The URL is a separate bearer capability, so clearing the Auth session or resolver cache alone does not stop Blend from reusing it.

## Evidence

- **Confirmed in this checkout:** `resolvePlayableUrlForItem` returns a fresh direct URL, and the signed-out listener cancels both playback requests and clears the resolver cache. Before this change, it left already resolved source fields and active media sources intact.
- **Provider behavior documented by Supabase:** signed Storage URLs use a Storage signing key separate from Auth JWT keys and remain valid until expiry. Smart CDN caching can serve a cached response beyond token expiry until its cache duration ends.
- **Testable assumption:** a particular URL was copied outside Blend and remained usable for a specific production project. This change verifies local cleanup with synthetic browser fixtures; it does not test a production or disposable Supabase project.

## What Changes

- Clear app-held Supabase signed URLs with expiry metadata from library items, list references, saved experience references, and active media elements when the tab receives `SIGNED_OUT`.
- Cancel both playback layers, retain portable storage references and playback/experience position, and let a signed-in user retry resolution.
- Show accessible sign-out copy that distinguishes local cleanup from the lifetime of links copied before sign-out.
- Keep explicitly imported public URLs and local media available.

## Capabilities

### New Capabilities
- `private-media-signout`: Local signed-out playback cleanup and authenticated recovery for private Storage media.

### Modified Capabilities

## Impact

Affected code includes `app.js`, a small side-effect-free signed URL cleanup helper, and focused regression and Playwright coverage. No persisted schema, runtime dependency, provider policy, or TTL setting changes are planned.
