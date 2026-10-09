# Spec Delta

## Purpose

This capability keeps the installed documentation readable while the user explicitly requests an online update, including when the network is slow or unavailable.

## ADDED Requirements

### Requirement: Installed documentation stays visible during online refresh
When the user requests online documentation and no fresh online cache is available, the Information dialog SHALL render the installed guide before the remote request deadline and retain it until a complete online response succeeds.

#### Scenario: Cold online refresh is pending
- **WHEN** the user selects online documentation with no fresh cache and the installed README is available while the remote request remains pending
- **THEN** the installed README is visible before the remote timeout, with no loading-only content replacing it

#### Scenario: Online refresh succeeds
- **WHEN** a successful remote README response arrives after the installed guide is visible
- **THEN** the complete online document and its source status replace the installed guide atomically without mixed or blank content

#### Scenario: Online refresh fails
- **WHEN** the remote README request fails or reaches its deadline after the installed guide is visible
- **THEN** the installed guide remains visible with the message "Offline or online documentation is unavailable; this local guide remains available." and a user-triggered retry

### Requirement: Online refresh preserves Information navigation context
An online refresh SHALL keep the selected Information tab and the displayed guide's scroll position while pending or after failure.

#### Scenario: Refresh is pending or fails
- **WHEN** an online refresh starts while the README tab is selected and the user has scrolled the installed guide
- **THEN** the README tab remains selected and the installed guide's scroll position is preserved while it remains displayed
