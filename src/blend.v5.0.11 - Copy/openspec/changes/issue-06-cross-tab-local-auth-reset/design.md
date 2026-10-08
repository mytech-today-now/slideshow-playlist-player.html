# Design

## Context

See `proposal.md` for the user impact. `supabase-auth.js` already clears the current client, cancels its refresh timer and request, and checks a session generation before applying refresh results. `app.js` performs that local clear before taking its recoverable IndexedDB snapshot. Its normal sign-out path is separate and sends the documented remote logout request.

## Goals / Non-Goals

**Goals:**

- Coordinate same-origin auth clients during Clear Browser Storage and confirm each known peer handled the reset.
- Preserve the current order: local sign-out, peer confirmation, snapshot, database deletion, then in-memory data cleanup.
- Bound the confirmation wait and leave Blend data recoverable when a peer is unresponsive.
- Ensure updated installed clients fetch the coordination code.

**Non-Goals:**

- Remote provider revocation, cross-device sign-out, or changes to regular user sign-out.
- Sharing session or media data between tabs.
- Database schema changes or new runtime dependencies.

## Decisions

1. Use an origin-scoped `BroadcastChannel` named for the Blend auth storage key. Each client announces a random tab nonce and tracks peer announcements and departures. Before resetting, the initiator probes for 100 ms so an already-open tab whose initial announcement is still in transit can identify itself. Messages contain only `type` and `nonce`; reset acknowledgments correlate the reset nonce with the responding tab nonce. The sender counts an explicit departure as confirmation. A storage-event-only design was not selected because it does not provide a direct acknowledgment channel.
2. Add a cross-tab local-reset method to the auth client. It clears the initiating client, probes for peers, sends one reset event, and waits up to 1.5 seconds for every known or responding peer. A receiver clears in-memory and opted-in saved session state, aborts any active refresh, advances its session generation, and only then acknowledges. If channel creation or delivery cannot be confirmed, the method returns an unconfirmed result. Existing generation checks remain the final guard against a late refresh response.
3. Gate the app's recovery snapshot and IndexedDB deletion on the confirmation result. An unconfirmed peer produces the exact requested warning and leaves all Blend data in place. The reset does not call `signOut()`, while the ordinary sign-out path remains unchanged.
4. Advance `ASSET_VERSION` and `CACHE_VERSION`, and align the entrypoint and module query tags. This ensures a newly loaded installed client uses the new auth coordination code; the database version stays unchanged.

## Risks / Trade-offs

- [Risk] A suspended tab may not process the event before the confirmation deadline → Abort data deletion, show the requested warning, and let the user close that tab and retry.
- [Risk] A tab running an older already-loaded bundle does not participate in the new channel → New page loads receive the bumped cache version; an older page that is already open must be closed before reset can be confirmed.
- [Risk] BroadcastChannel may be unavailable or fail → Fail closed for the reset and preserve saved Blend data rather than claim browser-wide sign-out.

## Migration Plan

No data migration is needed. Advancing the asset and cache markers updates installed clients on their normal service-worker refresh path. Reverting the code restores the previous single-tab behavior without changing persisted data.
