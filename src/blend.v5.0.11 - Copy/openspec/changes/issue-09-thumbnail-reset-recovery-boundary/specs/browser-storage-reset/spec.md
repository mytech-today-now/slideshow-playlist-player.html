# Spec Delta

## Purpose

Defines how Clear Browser Storage bounds rollback memory while preserving user-authored data and reporting partial reset outcomes accurately.

## ADDED Requirements

### Requirement: Reset recovery excludes only the thumbnail cache

The system SHALL omit thumbnail-cache records from the IndexedDB recovery snapshot and SHALL include records from every other object store in that snapshot.

#### Scenario: Snapshot a populated thumbnail cache
- **WHEN** Clear Browser Storage prepares a recovery snapshot while thumbnails are stored
- **THEN** no thumbnail records or Blob bytes are materialized in the snapshot, and all other object stores remain eligible for recovery

### Requirement: Snapshot preparation precedes reset side effects

The system SHALL keep IndexedDB records, in-memory Blend state, and the saved local Supabase session unchanged until recovery-snapshot preparation succeeds.

#### Scenario: Recovery snapshot cannot be prepared
- **WHEN** opening the snapshot transaction or reading a required store fails
- **THEN** database deletion does not begin, saved data and local session remain intact, and the user sees “Browser reset could not create a recovery copy. Your saved Blend data was kept; close other Blend tabs and retry.”

### Requirement: User-authored data remains recoverable after delete failure

The system SHALL restore library, playlist, slideshow, experience, settings, and directory-handle records from the recovery snapshot when a timed-out deletion later removes the database.

#### Scenario: Blocked deletion remains recoverable until an explicit retry
- **WHEN** another Blend tab holds the database and Clear Browser Storage reports an incomplete reset
- **THEN** the current experience and persisted user-authored data remain available; after the holder releases the database, only an explicit user retry clears them

### Requirement: Missing cached previews do not imply missing media

The system SHALL treat thumbnail records as derived cache data, allow previews to regenerate lazily from retained media handles, and use the existing media icon when a source is unavailable. Reset failure copy SHALL identify possible preview-cache regeneration without claiming cached previews or media files were restored.

#### Scenario: Recovery omits cached previews
- **WHEN** a timed-out deletion removes the database before the recovery snapshot is restored
- **THEN** user-authored media references remain available, a later library render can request a preview from its retained handle, and unavailable sources keep the existing icon fallback

### Requirement: In-memory state commits only after database deletion

The system SHALL keep the current Blend screen and saved user-authored data intact until IndexedDB confirms deletion.

#### Scenario: Database deletion fails
- **WHEN** IndexedDB reports an error or remains blocked past the reset timeout
- **THEN** the current experience remains active and the reset reports an incomplete outcome rather than success
