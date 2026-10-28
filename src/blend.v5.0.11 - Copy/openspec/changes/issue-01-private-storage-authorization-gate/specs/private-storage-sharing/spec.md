# Spec Delta

## Purpose

This capability prevents compressed experience links from distributing unverified Supabase Storage references while preserving direct public URL sharing, local playback, and portable JSON export.

## ADDED Requirements

### Requirement: Supabase references require a trusted exact share scope
The app MUST block compressed experience URL sharing whenever a referenced Supabase Storage object is malformed, lacks a trusted scope, or the trusted scope does not match the exact current project and policy revision. The app MUST NOT use a user-editable public-bucket allowlist as owner authorization evidence.

#### Scenario: A referenced unverified Storage object blocks URL sharing
- **WHEN** a user starts compressed URL sharing for an experience containing a Supabase Storage reference and no current trusted scope covers it
- **THEN** the app MUST create or present no compressed share URL, MUST explain that Storage reference sharing is blocked until the project owner verifies the exact project and policy revision, and MUST preserve the user's active media and experience state

#### Scenario: A current trusted scope permits its listed references
- **WHEN** every referenced Supabase Storage object is well-formed, its bucket is listed in the source-controlled scope, and the current project and policy revision exactly match that scope
- **THEN** the app MAY include those references in a compressed URL without requiring a private-media session

#### Scenario: Missing, changed, or mismatched scope fails closed
- **WHEN** the scope, project identity, or current policy revision is missing, changed, stale, or mismatched
- **THEN** the app MUST block every referenced Supabase Storage object before compression, even if runtime configuration lists its bucket as public

#### Scenario: Malformed Storage references fail closed
- **WHEN** a referenced record declares an invalid Supabase Storage reference or incomplete bucket/path metadata
- **THEN** the app MUST block compressed URL creation before compression or dialog creation

#### Scenario: Unreferenced private library entries do not block direct public URL sharing
- **WHEN** an experience references only direct public HTTP media URLs but its unused library contains a Supabase Storage object
- **THEN** the app MUST share only the referenced payload under the existing URL-sharing contract

### Requirement: Public HTTP URL sharing and portable export remain available
The app MUST preserve direct public HTTP URL sharing, normal local and private-media playback, and portable Supabase references in JSON export while the compressed-reference scope is unavailable.

#### Scenario: A direct public URL remains shareable
- **WHEN** every referenced remote item is a direct public HTTP URL and no Supabase Storage reference is present in the referenced payload
- **THEN** the app MUST permit compressed URL sharing

#### Scenario: JSON export preserves portable Storage references
- **WHEN** an experience containing Supabase Storage references is exported as JSON
- **THEN** the app MUST preserve portable references and omit bearer tokens, signed URLs, and provider response bodies according to the existing export contract

### Requirement: Provider authorization remains an external release gate
Storage authorization MUST remain unverified until the policy owner reviews a redacted policy export, a reviewed rollback export, and all required principal/object outcomes pass in disposable staging.

#### Scenario: Missing or failing owner evidence keeps the release gate closed
- **WHEN** owner approval, current or rollback policy evidence, exact project/revision identity, rollback ownership/procedure, or any required staging outcome is missing or fails
- **THEN** the release record MUST remain not passed and compressed sharing of Supabase Storage references MUST remain blocked

#### Scenario: The complete disposable staging matrix is reviewed
- **WHEN** the owner reviews the current and rollback policy exports and all six principal/object outcomes pass for the exact disposable project and policy revision
- **THEN** the owner MAY record the release gate as passed for that project and point in time
