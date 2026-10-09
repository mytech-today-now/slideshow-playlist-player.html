# Spec Delta

## Purpose

The Information dialog provides documentation that matches the installed Blend Player version while keeping a clearly labeled online guide optional. It preserves offline access, source identity, safe rendering, and navigation state.

## ADDED Requirements

### Requirement: Installed version documentation is the default

The Information dialog SHALL display the same-folder README by default and show whether its declared app version matches the running app version.

#### Scenario: Installed guide matches the running app
- **WHEN** the Information dialog opens and the local README declares the running app version
- **THEN** the dialog displays that local README and identifies it as the installed-version guide

#### Scenario: Installed guide declares a different version
- **WHEN** the local README declares a version different from the running app
- **THEN** the dialog identifies the mismatch and does not silently replace the guide with online documentation

### Requirement: Online documentation is an explicit source

The dialog SHALL request mutable online documentation only after the user selects it and SHALL identify the displayed source and any declared document version.

#### Scenario: User selects current online documentation
- **WHEN** the user selects the online documentation source
- **THEN** the dialog displays it as current online documentation and makes any difference from the running app version visible

#### Scenario: Dialog opens with an older online cache
- **WHEN** a valid online cache contains a different app version and the dialog opens
- **THEN** the installed-version guide remains the default and the cached online document is not shown in its place

### Requirement: Online cache retains source version and age

The system SHALL associate cached online Markdown with its detected version and fetch timestamp, reuse it for no more than one hour, and let a user-triggered retry bypass it.

#### Scenario: Fresh cached online guide is selected
- **WHEN** the user selects online documentation and a cache entry is less than one hour old
- **THEN** the cached document is shown with its source, detected version, and cached timestamp

#### Scenario: Online cache has expired
- **WHEN** the user selects online documentation and its cache is at least one hour old
- **THEN** the system requests current online documentation instead of presenting the expired entry as current

#### Scenario: User retries online documentation
- **WHEN** the user activates the online retry control
- **THEN** the system bypasses the online cache and makes a new request

### Requirement: Installed documentation remains available offline

The same-folder README SHALL remain available through the app's offline documentation cache, and an online failure SHALL leave the installed guide available with a user-triggered retry.

#### Scenario: Online request fails
- **WHEN** online documentation cannot be fetched but the installed guide is available
- **THEN** the dialog displays the installed guide and the message "Online documentation is unavailable. This local guide describes the installed version."

#### Scenario: App is offline
- **WHEN** the user opens Information while offline after the app shell has been installed
- **THEN** the same-folder README is displayed from the offline cache

### Requirement: Source selection preserves navigation state

The source selector SHALL have an accessible name and keyboard operation, and changing documentation sources SHALL preserve the selected Information tab and a separate scroll position for each source.

#### Scenario: User switches documentation sources
- **WHEN** the user changes between installed and online documentation
- **THEN** the Information tab remains selected and returning to either source restores that source's prior scroll position

#### Scenario: User operates the source selector by keyboard
- **WHEN** the source selector receives keyboard focus
- **THEN** its accessible name identifies it as the documentation source and the user can select either source using native keyboard controls

### Requirement: Both documentation sources use safe Markdown rendering

Local and online Markdown SHALL use the existing safe renderer so raw HTML is escaped, unsafe links are neutralized, and external links retain opener protections.

#### Scenario: Unsafe Markdown is displayed
- **WHEN** either documentation source contains raw HTML or a javascript link
- **THEN** the dialog displays inert text and a neutralized link without executing or injecting the supplied HTML
