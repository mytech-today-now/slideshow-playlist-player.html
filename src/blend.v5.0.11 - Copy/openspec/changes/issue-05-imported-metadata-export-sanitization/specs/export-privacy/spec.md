# Spec Delta

## Purpose

Protect users from exposing local filesystem details when they export or share experiences, while keeping saved metadata and portable media references intact.

## ADDED Requirements

### Requirement: Absolute filesystem paths are omitted from exported metadata
The app MUST recursively omit absolute Windows, UNC, and POSIX filesystem path values from media metadata in JSON exports and compressed experience shares, while preserving relative paths, ordinary labels, public URLs, and portable `supabase://` references.

#### Scenario: Nested platform paths are omitted
- **WHEN** a referenced or exported media record contains nested metadata with Windows, UNC, or POSIX absolute paths
- **THEN** no such path value appears in the JSON export or decompressed share payload

#### Scenario: Safe metadata remains portable
- **WHEN** metadata also contains ordinary labels, relative paths, a public URL with a harmless version query, or a portable `supabase://` reference
- **THEN** those safe values remain in the serialized record

#### Scenario: Existing credential protections remain active
- **WHEN** metadata contains credential-named fields or bearer URLs
- **THEN** those values remain omitted under the existing export privacy rules

### Requirement: Export sanitization preserves saved user state
The app MUST sanitize a serialized copy and MUST NOT rewrite imported metadata, saved library records, active experience state, ordering, selection, or playback state as a side effect of exporting or sharing.

#### Scenario: Export omits metadata without changing its source
- **WHEN** a user exports or shares a record whose metadata contains an absolute path
- **THEN** the output omits the path and the source metadata and active user state remain unchanged

#### Scenario: Export transport fails after sanitization
- **WHEN** a download or share transport fails after the export payload is prepared
- **THEN** the source metadata and active user state remain unchanged

### Requirement: The app discloses omitted local path metadata
When an export or share omits an absolute local filesystem path from metadata, the app MUST show an accessible notice associated with that action stating: `Local file path details were omitted from this export for privacy. Media references and the saved library were not changed.`

#### Scenario: Share dialog discloses omitted paths
- **WHEN** a user opens the share dialog for an experience whose referenced metadata contained an absolute path
- **THEN** the dialog exposes the notice to assistive technology and keyboard users

#### Scenario: JSON export discloses omitted paths
- **WHEN** a user downloads a JSON export whose media metadata contained an absolute path
- **THEN** the app announces the notice through an accessible status message
