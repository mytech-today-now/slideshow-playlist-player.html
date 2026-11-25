# Spec Delta

## MODIFIED Requirements

### Requirement: Supabase defaults are inert and runtime precedence is stable
Blend SHALL resolve Supabase configuration from explicit overrides, host-injected runtime configuration, operator-reviewed LocalStorage runtime configuration, then inert defaults, in that order. Unreviewed browser-stored connection settings SHALL remain pending and SHALL NOT be used for Auth or Storage requests.

#### Scenario: No operator configuration is supplied
- **WHEN** a fresh copy starts without explicit, host-injected, or reviewed LocalStorage Supabase configuration
- **THEN** its resolved project URL and anon key SHALL be empty and SHALL NOT identify a Supabase project

#### Scenario: Runtime configuration sources overlap
- **WHEN** explicit overrides, host-injected configuration, reviewed LocalStorage configuration, and defaults provide different values
- **THEN** explicit overrides SHALL win over host-injected configuration, host-injected configuration SHALL win over reviewed LocalStorage configuration, and reviewed LocalStorage configuration SHALL win over defaults

#### Scenario: Browser-stored connection settings have not been reviewed
- **WHEN** LocalStorage contains a project URL and anon key but the operator has not confirmed those settings in the current tab
- **THEN** Blend SHALL leave the stored settings pending, SHALL use host-injected configuration or inert defaults, and SHALL send no Auth or Storage request to the pending project

#### Scenario: Operator reviews browser-stored settings
- **WHEN** the operator confirms the displayed browser-stored connection settings in Configuration
- **THEN** Blend SHALL use those settings in that tab and SHALL retain the review only for that tab's session

## ADDED Requirements

### Requirement: Supabase project and Auth redirect URLs are constrained
Blend SHALL accept only HTTP(S) project URLs and SHALL use an Auth redirect URL only when it is an HTTP(S) URL on the current app origin. Invalid URLs SHALL be ignored and reported without sending Auth credentials to a rejected destination.

#### Scenario: A project URL uses a non-HTTP(S) scheme
- **WHEN** runtime configuration supplies a project URL such as `javascript:` or `ftp:`
- **THEN** Blend SHALL ignore that URL and report that the connection settings are invalid

#### Scenario: An Auth redirect uses a different origin
- **WHEN** runtime configuration supplies an Auth redirect on an origin other than the current app origin
- **THEN** Blend SHALL ignore the redirect and report the rejected destination

#### Scenario: An Auth redirect uses the app origin
- **WHEN** runtime configuration supplies a valid HTTP(S) Auth redirect on the current app origin
- **THEN** Blend SHALL retain that redirect for Auth flows

### Requirement: Supabase connection settings are visible and require review
Blend SHALL show the active project URL and any pending saved destination in Configuration, and SHALL require an accessible, labelled operator confirmation before saving or activating browser-stored project URL, anon key, or redirect changes.

#### Scenario: A saved connection setting is pending review
- **WHEN** Configuration displays browser-stored connection settings that are not yet active in the tab
- **THEN** the operator SHALL be able to inspect the project URL and redirect destination and SHALL receive a clear status that Supabase requests are blocked pending review

#### Scenario: Operator confirms connection settings
- **WHEN** the operator checks the labelled confirmation and saves valid connection settings
- **THEN** Blend SHALL activate the settings for the current tab and SHALL save them for later tabs only when LocalStorage accepts the write

#### Scenario: Saving connection settings fails
- **WHEN** LocalStorage rejects a valid connection-settings write
- **THEN** Blend SHALL retain the entered settings in the current tab, SHALL explain that they were not saved, and SHALL NOT claim that they will survive a reload

#### Scenario: Stored connection settings cannot be read
- **WHEN** saved runtime configuration is malformed or LocalStorage cannot be read
- **THEN** Blend SHALL fall back to host-injected configuration or inert defaults and SHALL announce: “Saved connection settings could not be read. Blend is using the built-in unconfigured defaults for this tab. Re-enter your project URL from Configuration if you use private Storage.”

### Requirement: Clear Browser Storage removes saved runtime connection settings
Blend SHALL remove browser-stored and tab-scoped runtime connection settings during a default Clear Browser Storage reset, accurately describe that removal, and report when LocalStorage cleanup cannot be confirmed. The reset SHALL leave media files on disk untouched.

#### Scenario: Default browser reset succeeds
- **WHEN** the operator confirms Clear Browser Storage and LocalStorage cleanup succeeds
- **THEN** the saved runtime configuration and tab-scoped review state SHALL be removed with Blend-origin data and the completion message SHALL say the connection settings were cleared

#### Scenario: LocalStorage cleanup cannot be confirmed
- **WHEN** the runtime configuration key cannot be removed or browser storage cannot be accessed
- **THEN** the reset SHALL report that connection settings could not be confirmed cleared and SHALL NOT claim that they were preserved or cleared

#### Scenario: Browser reset completes
- **WHEN** Clear Browser Storage removes browser data
- **THEN** files on disk SHALL remain untouched
