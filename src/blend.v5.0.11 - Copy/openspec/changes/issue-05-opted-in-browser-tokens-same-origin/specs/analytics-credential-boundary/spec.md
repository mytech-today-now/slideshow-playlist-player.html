# Spec Delta

## MODIFIED Requirements

### Requirement: Analytics execution requires an empty and inspectable credential store
Blend SHALL load third-party analytics only after confirming that saved Git credential and Supabase session storage is inspectable and clear, browser privacy signals permit analytics, and the shared same-origin execution boundary is acquired.

#### Scenario: Consent is granted while a credential is remembered
- **WHEN** analytics consent is granted while a GitHub or Bitbucket credential is remembered
- **THEN** Blend SHALL preserve the consent choice, make no analytics script request, and show the accessible remembered-credential explanation while keeping the Git playlist feature available

#### Scenario: Consent is granted while a Supabase session is saved
- **WHEN** analytics consent is granted while a Supabase session is saved in this browser
- **THEN** Blend SHALL preserve the consent choice, make no analytics script request, and explain how to continue without analytics or sign out

#### Scenario: Credential storage cannot be inspected
- **WHEN** LocalStorage is unavailable or a Git credential or Supabase session key cannot be read
- **THEN** Blend SHALL fail closed without requesting third-party analytics and SHALL preserve any in-memory connection

#### Scenario: No credential is remembered and the boundary is acquired
- **WHEN** analytics consent is granted, browser privacy signals permit analytics, credential storage is clear, and the shared boundary is acquired
- **THEN** Blend MAY request the analytics script and SHALL retain the boundary while that script may execute in the page

### Requirement: Credential persistence requires the shared boundary
Blend SHALL persist a Git credential or Supabase session only after explicit opt-in and while holding the same boundary used by analytics execution; when persistence is declined or unavailable, the connection SHALL remain available in memory for this tab.

#### Scenario: Another Blend tab is executing analytics
- **WHEN** the user connects a repository with Remember on this device selected while another Blend tab holds the analytics boundary
- **THEN** Blend SHALL keep the connection in memory, SHALL NOT write the credential to LocalStorage, and SHALL explain how to switch modes

#### Scenario: Supabase persistence cannot acquire the shared boundary
- **WHEN** a user selects Save session in this browser while analytics holds the shared boundary or the browser cannot provide that boundary
- **THEN** Blend SHALL keep the Supabase session in memory, SHALL NOT persist it, and SHALL show `The connection is available for this tab only. Do not save credentials on this device.`

#### Scenario: Supabase storage is unavailable or rejects a write
- **WHEN** a user selects Save session in this browser and LocalStorage is unavailable or rejects the session write
- **THEN** Blend SHALL keep the session in memory, SHALL not report persistence as successful, and SHALL show `The connection is available for this tab only. Do not save credentials on this device.`

#### Scenario: The shared boundary is unavailable for Git persistence
- **WHEN** the browser cannot establish the shared boundary for a requested Git remember operation
- **THEN** Blend SHALL keep the connection in memory, SHALL NOT persist the credential, and SHALL leave consent and provider state unchanged

#### Scenario: The shared boundary is unavailable
- **WHEN** the browser cannot establish the shared boundary for a requested remember operation
- **THEN** Blend SHALL keep the connection in memory, SHALL NOT persist a credential, and SHALL leave consent and provider state unchanged

### Requirement: Credential changes re-evaluate analytics without changing user choices
Blend SHALL re-evaluate analytics permission after remembered Git credential or Supabase session changes in the current or another tab without changing analytics consent or exposing credential contents.

#### Scenario: A remembered credential is explicitly forgotten
- **WHEN** a remembered Git credential is removed while consent remains granted and browser privacy signals permit analytics
- **THEN** Blend SHALL re-check credential storage and MAY resume analytics only after acquiring the shared boundary

#### Scenario: A saved Supabase session is removed
- **WHEN** a saved Supabase session is removed while consent remains granted and browser privacy signals permit analytics
- **THEN** Blend SHALL re-check all credential storage and MAY resume analytics only after acquiring the shared boundary

#### Scenario: Credential state changes in another tab
- **WHEN** another Blend tab changes or clears a Git credential or Supabase session key
- **THEN** Blend SHALL re-evaluate analytics and SHALL NOT disclose credential contents in status text, logs, events, or analytics requests

### Requirement: The reversible blocking reason is accessible
Blend SHALL provide a live, credential-free explanation associated with analytics consent and the relevant remember control whenever saved credential state blocks analytics or persistence.

#### Scenario: Analytics is blocked by a remembered credential
- **WHEN** a repository credential is remembered on this device
- **THEN** Blend SHALL show: `Analytics is off while a repository credential is remembered on this device. Forget the credential or continue without analytics. The playlist connection remains available.`

#### Scenario: Analytics is blocked by a saved Supabase session
- **WHEN** a Supabase session is saved in this browser
- **THEN** Blend SHALL show an accessible explanation that sign-out or continuing without analytics is available while keeping the private-media connection available

#### Scenario: Analytics is blocked by unreadable credential storage
- **WHEN** saved credential storage cannot be inspected
- **THEN** Blend SHALL explain that analytics is off because credential storage could not be checked, without displaying stored data

#### Scenario: Supabase session disclosure and sign-out
- **WHEN** the user is asked whether to save a Supabase session or is shown sign-out guidance
- **THEN** Blend SHALL explain that same-origin scripts can read an opted-in LocalStorage session, LocalStorage is not a secure vault, local deletion is not provider-side revocation, and a Supabase access token may remain usable until its expiry

#### Scenario: Analytics script loading fails after acquiring the boundary
- **WHEN** the third-party analytics script fails to load after insertion
- **THEN** Blend SHALL keep analytics off, retain the shared boundary for the page lifetime, and keep any in-memory connection available
