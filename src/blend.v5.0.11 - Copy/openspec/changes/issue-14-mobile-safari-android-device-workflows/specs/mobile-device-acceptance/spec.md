# Spec Delta

## Purpose

Defines how Blend records mobile browser support evidence and keeps local playback recoverable when mobile browser capabilities are unavailable or denied.

## ADDED Requirements

### Requirement: Mobile support evidence identifies the tested device and browser
The project SHALL distinguish physical-device results from desktop browser-engine tests and SHALL mark each untested mobile workflow as unverified.

#### Scenario: No physical device run is recorded
- **WHEN** the support matrix has no named iOS Safari or Android Chrome run
- **THEN** it identifies the relevant mobile workflows as unverified and does not present desktop Playwright engines as mobile evidence

#### Scenario: A mobile workflow is reported as verified
- **WHEN** a result is recorded for iOS Safari or Android Chrome
- **THEN** the result names the device model, operating system version, browser version, network state, workflow, and outcome

### Requirement: Folder picker limitations preserve the current library
When folder selection is unavailable or denied, the app SHALL announce an actionable individual-file fallback and leave the current library unchanged.

#### Scenario: Folder input capability is absent
- **WHEN** the user requests a folder in a browser without a usable folder picker
- **THEN** an accessible status explains that the browser cannot open a folder and directs the user to choose files individually or continue with saved items

#### Scenario: Folder access is denied
- **WHEN** the browser rejects the folder picker with a permission or security error
- **THEN** an accessible status explains the denial and available next action, and the current library remains unchanged

### Requirement: Fullscreen limitations preserve visible playback controls
When fullscreen is unavailable or cannot start, the app SHALL explain the limitation and keep playback controls usable in the current window.

#### Scenario: Fullscreen API is unavailable
- **WHEN** the user requests fullscreen in a browser without the required API
- **THEN** an accessible status says fullscreen is unavailable and playback controls remain on screen

#### Scenario: Fullscreen request is rejected
- **WHEN** the browser rejects a fullscreen request
- **THEN** an accessible status says fullscreen could not start and playback controls remain on screen

### Requirement: Mobile device acceptance covers local recovery and accessibility
Before a mobile workflow is described as verified, its acceptance run SHALL cover local media playback, offline shell reload with saved state, relevant capability fallbacks, orientation, and essential control access.

#### Scenario: iOS Safari acceptance is recorded
- **WHEN** acceptance is run on a named iOS device
- **THEN** the record covers synthetic media import and playback, installed-shell offline reload with saved state, picker and fullscreen limitations, rotation, and keyboard or assistive-technology access at 200 percent text zoom

#### Scenario: Android Chrome acceptance is recorded
- **WHEN** acceptance is run on a named Android device
- **THEN** the record covers synthetic media import and playback, installed-shell offline reload with saved state, picker and fullscreen limitations, rotation, touch and keyboard access at 200 percent text zoom, and quota or permission-denial recovery

#### Scenario: Acceptance uses isolated test data
- **WHEN** device acceptance is prepared
- **THEN** it uses synthetic media and preserves the device's existing app data and offline state outside the test origin
