# Spec Delta

## Purpose

This capability prevents compressed experience links from distributing private Supabase Storage references while provider authorization remains unverified, while preserving sharing for public media.

## ADDED Requirements

### Requirement: Unverified private references cannot be shared by URL
The app MUST block compressed experience URL sharing whenever the referenced payload contains a Supabase object in a bucket outside the configured public bucket allowlist and provider authorization remains unverified.

#### Scenario: A referenced private object blocks URL sharing
- **WHEN** a user starts compressed URL sharing for an experience with a referenced private Supabase object
- **THEN** the app MUST create or present no compressed share URL, MUST show `Private media access could not be verified. Contact the project owner before sharing.`, and MUST preserve the user's active media and experience state

#### Scenario: Unreferenced private library entries do not block URL sharing
- **WHEN** an experience references only public or non-Supabase media but its unused library contains a private Supabase object
- **THEN** the app MUST share only the referenced payload under the existing URL-sharing contract

### Requirement: Public bucket sharing remains separate from private storage
The app MUST classify Supabase references as public only when their bucket is in the configured public bucket allowlist; no private bucket may be treated as public by the verification gate.

#### Scenario: An allowlisted public object remains shareable
- **WHEN** every referenced Supabase object belongs to an allowlisted public bucket
- **THEN** the app MUST permit compressed URL sharing without requiring a private-media session

#### Scenario: A private bucket is absent from the public allowlist
- **WHEN** a reference belongs to a bucket outside the configured public bucket allowlist
- **THEN** the app MUST treat it as private and block compressed URL sharing while authorization remains unverified

### Requirement: Provider authorization remains an external release gate
Private Storage authorization MUST remain unverified until the policy owner reviews a redacted policy export and all required principal and object outcomes pass in disposable staging.

#### Scenario: Missing or failing owner evidence keeps the release gate closed
- **WHEN** the redacted provider policy export, reviewed rollback copy, or any required staging outcome is missing or fails
- **THEN** the release record MUST remain not passed and compressed sharing of private Supabase references MUST remain blocked

#### Scenario: The complete disposable staging matrix is reviewed
- **WHEN** the owner reviews the redacted policy and rollback exports and all six principal/object outcomes pass in a disposable project
- **THEN** the owner MAY record the release gate as passed for that project and point in time
