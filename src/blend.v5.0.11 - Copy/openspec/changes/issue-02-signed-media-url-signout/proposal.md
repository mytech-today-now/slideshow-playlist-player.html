# Proposal

## Why

Blend can retain a fresh private Storage signed URL after the current tab signs out. The URL is a separate bearer capability, so clearing the Auth session or resolver cache alone does not stop Blend from reusing it.

## Evidence

- **Confirmed in this checkout:** `resolvePlayableUrlForItem` returns a fresh direct URL, and the signed-out listener cancels both playback requests and clears the resolver cache. Before this change, it left already resolved source fields and active media sources intact.
- **Confirmed in this checkout:** playback resolution schedules an IndexedDB snapshot after placing the signed URL in library/list records. Sign-out cleanup alone cannot prevent the URL from being durable before sign-out.
- **Confirmed configuration:** the default signed URL TTL is 1,209,600 seconds (14 days), and saved player settings can continue to supply that previous value.
- **Provider behavior documented by Supabase:** signed Storage URLs use a Storage signing key separate from Auth JWT keys and remain valid until expiry. Smart CDN caching can serve a cached response beyond token expiry until its cache duration ends.
- **Testable assumption:** a particular URL was copied outside Blend and remained usable for a specific production project. This change verifies local cleanup with synthetic browser fixtures; it does not test a production or disposable Supabase project.

## What Changes

- Clear app-held Supabase signed URLs with expiry metadata from library items, list references, saved experience references, and active media elements when the tab receives `SIGNED_OUT`.
- Use the owner-approved one-hour default for newly issued signed URLs, preserve explicit owner overrides, and migrate the old 14-day saved default.
- Remove resolver-issued signed URLs from IndexedDB snapshots without clearing their live playback source or portable recovery data; sanitize legacy saved URLs during startup.
- Cancel both playback layers, retain portable storage references and playback/experience position, and let a signed-in user retry resolution.
- Show accessible sign-out copy that distinguishes local cleanup from the lifetime of links copied before sign-out.
- If media-element cleanup or durable cleanup fails, report that cleanup is incomplete without displaying a URL and offer a retry.
- Keep explicitly imported public URLs and local media available.

## Capabilities

### New Capabilities
- `private-media-signout`: Local signed-out playback cleanup and authenticated recovery for private Storage media.

### Modified Capabilities

## Impact

Affected code includes `app.js`, `supabase-config.js`, the signed URL cleanup helper, IndexedDB snapshot persistence, the Config TTL control, documentation, and focused regression and Playwright coverage. The change adds a settings value for one-time migration tracking but no IndexedDB store/schema change, runtime dependency, or provider-side revocation path.

## Tracking

- Beads: `blend-ag8`
- Source report: `ai-prompts/pre-mortem-2026-10-17-21-05-36.html#issue-02`
