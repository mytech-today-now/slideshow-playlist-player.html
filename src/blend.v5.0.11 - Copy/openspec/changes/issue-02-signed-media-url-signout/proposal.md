# Proposal

## Why

Blend can retain a fresh private Storage signed URL after the current tab signs out. The URL is a separate bearer capability, so clearing the Auth session or resolver cache alone does not stop Blend from reusing it.

## Evidence

- **Confirmed in this checkout:** `resolvePlayableUrlForItem` returns a fresh direct URL, and the signed-out listener cancels both playback requests and clears the resolver cache. Before this change, it left already resolved source fields and active media sources intact.
- **Confirmed in this checkout:** playback resolution schedules an IndexedDB snapshot after placing the signed URL in library/list records. Sign-out cleanup alone cannot prevent the URL from being durable before sign-out.
- **Confirmed configuration:** the default signed URL TTL is 1,209,600 seconds (14 days), and saved player settings can continue to supply that previous value.
- **Provider behavior documented by Supabase:** signed Storage URLs use a Storage signing key separate from Auth JWT keys and remain valid until expiry. Smart CDN caching can serve a cached response beyond token expiry until its cache duration ends.
- **Testable assumption:** a particular URL was copied outside Blend and remained usable for a specific production project. This change verifies local cleanup with synthetic browser fixtures; it does not test a production or disposable Supabase project.
- **Confirmed in this checkout:** the service worker sends audio/video and Range requests directly to the network, but a same-origin signed image request can be classified as cacheable before this follow-up.

## What Changes

- Clear app-held Supabase signed URLs with expiry metadata from library items, list references, saved experience references, and active media elements when the tab receives `SIGNED_OUT`.
- Use the owner-approved one-hour default for newly issued signed URLs, preserve explicit owner overrides, and migrate the old 14-day saved default.
- Remove resolver-issued signed URLs from IndexedDB snapshots without clearing their live playback source or portable recovery data; sanitize legacy saved URLs during startup.
- Cancel both playback layers, retain portable storage references and playback/experience position, and let a signed-in user retry resolution.
- Show durable accessible sign-out copy that explains copied-link lifetime (3,600-second default) even when there are no signed in-app fields to clear.
- Keep signed Supabase object URLs out of Blend Cache Storage: route recognized signed-object requests through the service worker without Cache Storage, and remove any matching legacy entries from Blend-managed caches during local sign-out. Report Cache Storage cleanup failures as incomplete local side effects without undoing the local session clear.
- If media-element cleanup or durable cleanup fails, report that cleanup is incomplete without displaying a URL and offer a retry.
- Keep explicitly imported public URLs and local media available.

## Capabilities

### New Capabilities
- `private-media-signout`: Local signed-out playback cleanup and authenticated recovery for private Storage media.

### Modified Capabilities

## Impact

Affected code includes `app.js`, `service-worker.js`, `pwa-config.js`, the signed URL cleanup helper, IndexedDB snapshot persistence, the Config TTL control, documentation, and focused regression and Playwright coverage. The change adds no IndexedDB store/schema change, runtime dependency, clipboard wipe, or provider-side revocation path.

## Tracking

- Beads: `blend-ag8`
- Original source report: `ai-prompts/pre-mortem-2026-10-17-21-05-36.html#issue-02`
- Current review: `ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-02` (stable article ID `issue-02`; title: A copied signed Storage URL can outlive local sign-out)
- Follow-up review: `Pasted text.txt#issue-08` (stable article ID `issue-08`; title: Copied signed URLs and possibly cached responses remain usable after local sign-out). Beads: `blend-t32`.
