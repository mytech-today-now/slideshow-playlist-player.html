# Spec Delta

## ADDED Requirements

### Requirement: Private Storage signing requires a trusted project policy scope
Blend MUST request a private Storage signed URL only when a source-controlled scope matches the configured project URL, current policy revision, and requested bucket. Runtime configuration and `SUPABASE_PUBLIC_BUCKETS` MUST NOT provide or broaden that scope.

#### Scenario: This build has no owner-reviewed scope
- **WHEN** private Storage media is requested while the trusted scope or current policy revision is absent
- **THEN** Blend MUST return a configuration error before using a caller access token, reusing a signed result, or sending a Storage request, and MUST announce: “Private Storage signing is unavailable until the project owner records a reviewed policy revision. You can play local files and direct public media URLs, and you can export JSON.”

#### Scenario: Project, policy revision, or bucket does not match
- **WHEN** a source-controlled scope exists but its project URL, current policy revision, or bucket does not match the request
- **THEN** Blend MUST refuse private signing even if runtime configuration lists the bucket as public

#### Scenario: A source-controlled scope matches exactly
- **WHEN** the trusted project URL, current policy revision, and requested bucket match the source-controlled scope
- **THEN** Blend MAY request a signed URL using the caller's access token and configured anon key, without introducing a service-role credential

### Requirement: Blocked private signing preserves portable media state
Blend MUST retain portable Supabase Storage references when private signing is unavailable and MUST keep local media, direct public HTTP media, and JSON export available.

#### Scenario: A saved private reference cannot currently resolve
- **WHEN** a saved `supabase://` reference is selected while no verified scope is available
- **THEN** playback MUST stop for that reference, its portable reference and saved list entry MUST remain intact, and local files, direct public HTTP URLs, and JSON export MUST remain usable

#### Scenario: Portable references are exported
- **WHEN** an experience containing a saved Supabase Storage reference is exported as JSON
- **THEN** the export MUST preserve the portable reference and MUST omit access tokens and signed URLs
