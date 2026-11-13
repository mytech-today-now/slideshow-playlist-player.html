# supabase-configuration Specification

## Purpose

This capability keeps Supabase-dependent features disconnected until an operator configures a project, while preserving Blend's local-first playback and portable media references.

## Requirements

### Requirement: Supabase defaults are inert and runtime precedence is stable
Blend SHALL resolve Supabase configuration from explicit overrides, LocalStorage runtime configuration, global runtime configuration, then inert defaults, in that order.

#### Scenario: No operator configuration is supplied
- **WHEN** a fresh copy starts without explicit, LocalStorage, or global Supabase configuration
- **THEN** its resolved project URL and anon key SHALL be empty and SHALL NOT identify a Supabase project

#### Scenario: Runtime configuration sources overlap
- **WHEN** explicit overrides, LocalStorage, and global runtime configuration provide different values
- **THEN** explicit overrides SHALL win over LocalStorage, LocalStorage SHALL win over global runtime configuration, and global runtime configuration SHALL win over defaults

### Requirement: Supabase requests require a configured project URL and anon key
Blend SHALL NOT send Auth or Storage requests unless both a Supabase project URL and anon key are present in runtime configuration.

#### Scenario: Auth runs without complete project configuration
- **WHEN** password sign-in, session refresh, or provider sign-out is requested while either required value is missing
- **THEN** Blend SHALL send no Auth request and SHALL report that Supabase is not configured

#### Scenario: Storage references are resolved without complete project configuration
- **WHEN** a Supabase Storage reference is resolved while either required value is missing
- **THEN** Blend SHALL send no Storage request and SHALL return a clear not-configured error

#### Scenario: Direct public media is used while Supabase is disconnected
- **WHEN** the user resolves a direct HTTP(S) media URL while Supabase is not configured
- **THEN** Blend SHALL return that URL without requiring Supabase configuration

### Requirement: Supabase settings disclose configuration status accessibly
Blend SHALL expose a live, credential-free configuration status near the Supabase controls and SHALL identify the configured project URL when one is present.

#### Scenario: Supabase is not configured
- **WHEN** the project URL or anon key is missing
- **THEN** the status SHALL explain that local files and direct public media URLs still play and that runtime configuration is required for private Storage

#### Scenario: An operator project is configured
- **WHEN** runtime configuration supplies a project URL and anon key
- **THEN** the status SHALL show the project URL without showing the anon key

### Requirement: Disconnected Supabase preserves portable media state
Blend SHALL preserve saved library entries and portable Supabase references when runtime project configuration is missing.

#### Scenario: A saved Supabase reference cannot currently resolve
- **WHEN** a saved portable Supabase reference is selected while Supabase is not configured
- **THEN** playback SHALL fail with the not-configured status while the reference remains in the user's saved lists and can resolve after configuration is supplied
