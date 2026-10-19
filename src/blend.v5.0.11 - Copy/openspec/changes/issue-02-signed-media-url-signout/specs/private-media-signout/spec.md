# Spec Delta

## Purpose

Defines how Blend handles private media URLs when a tab signs out, keeping playback from reusing the cached bearer URL while retaining the portable reference needed for authenticated recovery.

## ADDED Requirements

### Requirement: Clear app-held signed media URLs on sign-out
When local auth changes to signed-out, Blend MUST remove signed Storage URLs carrying expiry metadata from its transient records and active media surfaces while preserving recoverable user state.

#### Scenario: Fresh private URL is cleared
- **WHEN** a tab receives `SIGNED_OUT` while its library or list records contain a signed Storage URL with expiry metadata
- **THEN** Blend clears the transient URL fields and active signed media sources, retains the portable storage reference, bucket, path, user metadata, experience selection, and list position, and does not remove the media item

#### Scenario: Public and local media remain available
- **WHEN** a tab receives `SIGNED_OUT` while its records contain an explicitly imported public URL or local media
- **THEN** Blend preserves those sources and leaves their playback behavior available

#### Scenario: Another tab receives local reset
- **WHEN** another open tab receives the existing local-reset notification and emits `SIGNED_OUT`
- **THEN** that tab also clears its own signed media URLs and active signed media sources without changing the current experience or list position

### Requirement: Prevent stale playback work from restoring a signed URL
After sign-out, Blend MUST cancel in-flight playback resolution for both layers and MUST NOT reattach a cleared signed URL through a late response or playback advance.

#### Scenario: Playback request is cancelled during sign-out
- **WHEN** a private media resolution is pending as sign-out begins
- **THEN** the request is cancelled and its late result cannot update item records or start playback

#### Scenario: Playback advances while signed out
- **WHEN** playback advances after a private signed URL was cleared and before the user signs in again
- **THEN** Blend does not start another private request with the old URL and keeps the portable private item available for recovery

### Requirement: Recover private media after authentication
Blend MUST retain a retry path for private media after sign-out and MUST resolve a fresh URL from the portable reference after authentication returns.

#### Scenario: Retry after sign-in
- **WHEN** a user signs in again and retries a retained private media item
- **THEN** Blend requests a fresh URL from its portable reference and may play the item without requiring reimport

#### Scenario: Missing auth or expired URL
- **WHEN** private media cannot be resolved because auth is missing or a signed URL has expired
- **THEN** Blend keeps the item and portable reference, reports a recoverable unavailable state, and offers retry

#### Scenario: Sign-out recovery message
- **WHEN** Blend reports that private media was cleared during sign-out
- **THEN** it displays the accessible message `Signing out stops playback in this tab. A copied link may still work until its provider and cache lifetime ends.` and provides a path to sign in and retry

### Requirement: Do not claim copied URLs were revoked
Blend MUST describe only local cleanup on sign-out and MUST NOT claim to revoke signed URLs copied outside the app.

#### Scenario: A copied link remains independent
- **WHEN** a signed URL was copied before local sign-out
- **THEN** the app does not claim that sign-out revoked the copied URL and explains that the link may remain valid until expiry

### Requirement: Bound the default lifetime of newly issued private URLs
Blend MUST request a signed URL lifetime of 3,600 seconds by default and MUST continue to honor a positive per-player TTL value explicitly selected in Config. Saved IndexedDB player settings that contain the former 1,209,600-second default without a current TTL policy marker MUST migrate to the 3,600-second default once. Imported experience settings with an explicit positive TTL MUST remain intact.

#### Scenario: Default and owner override
- **WHEN** a private reference is resolved with no owner TTL override, or with a positive owner-selected TTL override
- **THEN** Blend requests 3,600 seconds by default and sends the explicit override unchanged within the existing Config range

#### Scenario: Previous saved default is upgraded once
- **WHEN** Blend hydrates saved IndexedDB settings with TTL 1,209,600 and no current TTL policy marker
- **THEN** it uses 3,600 seconds and persists the current policy marker; a later explicit Config override survives reload

#### Scenario: Imported owner TTL is preserved
- **WHEN** Blend imports an experience with an explicit positive TTL setting
- **THEN** it retains that TTL rather than treating it as a legacy saved default

### Requirement: Keep resolver-issued bearer URLs out of durable player state
Blend MUST remove resolver-issued signed Storage URLs from IndexedDB snapshots while preserving the in-memory URL needed by active playback, portable storage references, and user-authored data. Startup MUST clean legacy persisted copies before playback can reuse them.

#### Scenario: Playback URL remains transient
- **WHEN** a fresh private URL is attached to the live media records and Blend saves its snapshot
- **THEN** IndexedDB contains no signed URL token in library, playlist, slideshow, generated social-preview image, or experience records, while the live playback URL and portable `storageReference` remain available

#### Scenario: Generated preview does not retain the bearer URL
- **WHEN** generated social preview metadata uses a resolver-issued signed URL as its image
- **THEN** Blend omits that image URL from the persistence clone while preserving its title and other user-authored metadata

#### Scenario: Legacy saved URL is removed at startup
- **WHEN** an older IndexedDB snapshot contains a resolver-issued signed URL with expiry metadata
- **THEN** Blend removes the URL from hydrated records and rewrites the snapshot while retaining the item, portable reference, bucket/path, and user metadata

#### Scenario: Legacy expiry metadata is missing
- **WHEN** an older IndexedDB media record contains a recognized Supabase signed-object URL but no `signedUrlExpiresAt`
- **THEN** Blend removes the URL from durable and hydrated records while retaining the item and its portable reference

### Requirement: Keep sign-out cleanup failures recoverable and private
An individual pause or media cleanup failure MUST NOT prevent remaining cleanup. If media-element cleanup or the IndexedDB cleanup save fails, Blend MUST report incomplete local cleanup and offer a retry. Diagnostics MUST exclude URL query tokens and private paths.

#### Scenario: One media element fails cleanup
- **WHEN** pausing or clearing one signed media element throws during sign-out
- **THEN** Blend continues clearing other records and elements and logs only sanitized operation and error-type details

#### Scenario: Cleanup save fails
- **WHEN** saving the sign-out cleanup snapshot fails
- **THEN** Blend retains the media item and portable reference, reports incomplete cleanup without displaying a URL, and offers a retry
