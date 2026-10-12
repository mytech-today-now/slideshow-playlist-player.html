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
- **THEN** it displays the accessible message `You are signed out. Sign in again to play private media. Copied links can remain usable until they expire, and cached responses may remain available longer.` and provides a path to sign in and retry

### Requirement: Do not claim copied URLs were revoked
Blend MUST describe only local cleanup on sign-out and MUST NOT claim to revoke signed URLs copied outside the app.

#### Scenario: A copied link remains independent
- **WHEN** a signed URL was copied before local sign-out
- **THEN** the app does not claim that sign-out revoked the copied URL and explains that the link may remain valid until expiry

### Requirement: Keep sign-out cleanup failures recoverable and private
An individual pause or media cleanup failure MUST NOT prevent remaining cleanup, and diagnostics MUST exclude URL query tokens and private paths.

#### Scenario: One media element fails cleanup
- **WHEN** pausing or clearing one signed media element throws during sign-out
- **THEN** Blend continues clearing other records and elements and logs only sanitized operation and error-type details
