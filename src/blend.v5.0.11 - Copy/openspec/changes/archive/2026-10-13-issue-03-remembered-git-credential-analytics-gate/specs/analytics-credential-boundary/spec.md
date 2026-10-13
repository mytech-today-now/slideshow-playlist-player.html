# Spec Delta

## Purpose

This capability keeps remembered repository write credentials and unisolated third-party analytics execution mutually exclusive across Blend tabs that share the same origin.

## ADDED Requirements

### Requirement: Analytics execution requires an empty and inspectable credential store
Blend SHALL load third-party analytics only after confirming that remembered repository credential storage is inspectable and contains no credential, and after acquiring the shared same-origin execution boundary.

#### Scenario: Consent is granted while a credential is remembered
- **WHEN** analytics consent is granted while a GitHub or Bitbucket credential is remembered
- **THEN** Blend SHALL preserve the consent choice, make no analytics script request, and show the accessible remembered-credential explanation while keeping the Git playlist feature available

#### Scenario: Credential storage cannot be inspected
- **WHEN** LocalStorage is unavailable or the remembered credential key cannot be read
- **THEN** Blend SHALL fail closed without requesting third-party analytics and SHALL preserve any in-memory Git connection

#### Scenario: No credential is remembered and the boundary is acquired
- **WHEN** analytics consent is granted, browser privacy signals permit analytics, credential storage is clear, and the shared boundary is acquired
- **THEN** Blend MAY request the analytics script and SHALL retain the boundary while that script may execute in the page

### Requirement: Credential persistence requires the shared boundary
Blend SHALL save a repository credential only while holding the same boundary used by analytics execution; if the boundary cannot be acquired, the connection SHALL remain session-only and its provider operation SHALL remain available.

#### Scenario: Another Blend tab is executing analytics
- **WHEN** the user connects a repository with Remember on this device selected while another Blend tab holds the analytics boundary
- **THEN** Blend SHALL keep the connection in memory, SHALL NOT write the credential to LocalStorage, and SHALL explain how to switch modes

#### Scenario: The shared boundary is unavailable
- **WHEN** the browser cannot establish the shared boundary for a requested remember operation
- **THEN** Blend SHALL keep the connection in memory, SHALL NOT persist the credential, and SHALL leave consent and provider state unchanged

### Requirement: Credential changes re-evaluate analytics without changing user choices
Blend SHALL re-evaluate analytics permission after remembered credential changes in the current or another tab without changing consent or invoking Git disconnect or forget behavior itself.

#### Scenario: A remembered credential is explicitly forgotten
- **WHEN** a remembered credential is removed while consent remains granted and browser privacy signals permit analytics
- **THEN** Blend SHALL re-check credential storage and MAY resume analytics only after acquiring the shared boundary

#### Scenario: Credential state changes in another tab
- **WHEN** another Blend tab changes or clears the remembered credential key
- **THEN** Blend SHALL re-evaluate analytics and SHALL NOT disclose credential contents in status text, logs, events, or analytics requests

### Requirement: Privacy safeguards and event limits remain effective
The credential boundary SHALL preserve affirmative consent, DNT/GPC/local-file safeguards, and the existing analytics event allowlist regardless of credential state.

#### Scenario: DNT or GPC is active
- **WHEN** consent is granted and DNT or GPC blocks analytics
- **THEN** Blend SHALL make no third-party analytics request whether or not a credential is remembered

#### Scenario: Analytics runs without a remembered credential
- **WHEN** analytics is permitted and the shared boundary is held
- **THEN** Blend SHALL send only the existing allowlisted coarse event parameters and SHALL NOT include repository credentials

### Requirement: The reversible blocking reason is accessible
Blend SHALL provide a live, credential-free explanation associated with both analytics consent and the remember control whenever the credential boundary blocks an action.

#### Scenario: Analytics is blocked by a remembered credential
- **WHEN** a repository credential is remembered on this device
- **THEN** Blend SHALL show: "Analytics is off while a repository credential is remembered on this device. Forget the credential or continue without analytics. The playlist connection remains available."

#### Scenario: Analytics script loading fails after acquiring the boundary
- **WHEN** the third-party analytics script fails to load after insertion
- **THEN** Blend SHALL keep analytics off, retain the shared boundary for the page lifetime, and keep any in-memory Git connection available
