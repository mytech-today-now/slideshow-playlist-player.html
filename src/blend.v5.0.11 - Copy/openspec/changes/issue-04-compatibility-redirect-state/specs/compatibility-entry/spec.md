# Spec Delta

## Purpose

This capability preserves shared playback and sign-in state when users open the legacy compatibility filename, while keeping navigation local and providing an honest recovery path when automatic forwarding is unavailable.

## ADDED Requirements

### Requirement: Compatibility navigation preserves URL state
The compatibility entry SHALL forward the current query string and fragment unchanged to the application entry before its deep-link or authentication handlers run.

#### Scenario: Shared playback deep link
- **WHEN** a user opens the compatibility entry with supported experience, layer, item, and autoplay parameters
- **THEN** the first `index.html` load receives the original query string and the app applies the requested playback target

#### Scenario: Authentication callback fragment
- **WHEN** a user opens the compatibility entry with a synthetic or provider-issued auth fragment
- **THEN** the first `index.html` load receives the original fragment before the existing auth callback handles it, and only that callback flow removes it

### Requirement: Compatibility navigation stays on the local application entry
The compatibility entry SHALL navigate to its fixed same-origin `index.html` destination and SHALL NOT accept a query value as a destination.

#### Scenario: External-looking return parameter
- **WHEN** the incoming query contains a value that resembles an external return URL
- **THEN** navigation remains on the current origin at `index.html`

#### Scenario: Direct application entry
- **WHEN** a user opens `index.html` directly
- **THEN** the application loads without passing through the compatibility entry

### Requirement: Compatibility navigation replaces its history entry
The compatibility entry SHALL replace its current history entry when forwarding to `index.html`.

#### Scenario: Browser Back after forwarding
- **WHEN** a user navigates to the compatibility entry from another page and then presses Back after forwarding
- **THEN** the browser returns to the preceding page without reopening the compatibility entry in a redirect loop

### Requirement: Compatibility fallback explains lost state without exposing secrets
When forwarding cannot run or construct its local destination, the compatibility page SHALL explain that shared playback or sign-in details may not be preserved and provide a safe way to recover the original compatibility URL without rendering auth values.

#### Scenario: JavaScript is disabled
- **WHEN** a user opens the compatibility entry with JavaScript disabled
- **THEN** the page explains that automatic forwarding is unavailable, tells the user to copy the full original URL from the address bar, and offers a direct link that warns shared details may not carry

#### Scenario: Destination construction fails
- **WHEN** the compatibility page cannot construct or use its fixed local destination
- **THEN** it displays `This compatibility link could not keep its shared playback or sign-in details. Open the original link in index.html or request a fresh link.`, offers a copyable link to the exact original URL, and does not log or render auth values
