# Spec Delta

## Purpose

Defines accessible browser API fallbacks and repeatable engine-level smoke evidence while keeping browser and mobile support claims within what has actually been tested.

## ADDED Requirements

### Requirement: File-input imports expose persistence outcomes
The import controls MUST remain operable when native file-picker APIs are absent. File-input imports MUST announce whether media bytes were saved for reload and explain any source-access limitation without exposing local paths.

#### Scenario: Native file picker is unavailable
- **WHEN** a user chooses Add Files in a browser without the native picker API
- **THEN** a labelled file input accepts the selected media and Blend reports whether its local save succeeded

#### Scenario: File-input media is saved
- **WHEN** Blend successfully saves media selected through a file input
- **THEN** the accessible status says the file data is saved in this browser and that source-folder permissions are not retained

#### Scenario: File-input save fails
- **WHEN** Blend cannot confirm saving media selected through a file input
- **THEN** the accessible status says the media is available only for the current session and must be selected again after reload

### Requirement: Folder import reports available fallbacks
Folder import MUST use a directory picker or directory-capable input when available. If neither is available, the app MUST explain the limitation and point users to individual file selection.

#### Scenario: Directory picker falls back to directory input
- **WHEN** the directory picker API is unavailable and directory input is supported
- **THEN** selected media is imported, its saved file data is reported, and folder access is not claimed to persist

#### Scenario: Directory input is unavailable
- **WHEN** neither a directory picker nor a directory-capable input is available
- **THEN** an accessible status explains that folder selection is unavailable and identifies Add Files as the alternative

### Requirement: Canceled pickers preserve editing state
Canceling a file or folder picker MUST leave the current library, playlist, slideshow, and library selection unchanged and MUST NOT announce a successful import.

#### Scenario: File picker is canceled
- **WHEN** a user cancels a file picker while media and selection state already exist
- **THEN** the library, both lists, and selection remain unchanged and no success status is shown

#### Scenario: Folder picker is canceled
- **WHEN** a user cancels a folder picker while media and selection state already exist
- **THEN** the library, both lists, and selection remain unchanged and no success status is shown

### Requirement: Fullscreen limitations are announced
The fullscreen control MUST have an accessible name and MUST report through an accessible status when fullscreen is unavailable or cannot be started or exited.

#### Scenario: Fullscreen API is unavailable
- **WHEN** a user activates the fullscreen control in a browser without the required API
- **THEN** the app announces that fullscreen is unavailable while leaving playback controls usable

#### Scenario: Fullscreen request is rejected
- **WHEN** the browser rejects a fullscreen request
- **THEN** the app announces that fullscreen could not be started without an uncaught error

### Requirement: Offline-shell limitations are announced
The app MUST expose an accessible explanation when service-worker support is unavailable and MUST continue to serve the cached application shell offline when the browser supports service workers.

#### Scenario: Service workers are unavailable
- **WHEN** the app starts in a browser without service-worker support
- **THEN** an accessible status explains that offline shell caching is unavailable

#### Scenario: Cached shell is available offline
- **WHEN** the service worker controls the app and the network becomes unavailable
- **THEN** the app shell reloads from its cache

### Requirement: Browser smoke evidence matches the support claims
The browser test configuration MUST retain the full Chromium suite, run focused Firefox and WebKit smoke coverage in CI, and attach the tested engine and version to each smoke result.

#### Scenario: CI runs the configured engine matrix
- **WHEN** the browser test workflow runs
- **THEN** it installs Chromium, Firefox, and WebKit, runs the full suite in Chromium and focused compatibility smoke tests in Firefox and WebKit, and retains engine/version evidence in the report

#### Scenario: Mobile browser claims remain unverified
- **WHEN** README compatibility claims are reviewed
- **THEN** iOS Safari and Android Chrome are explicitly marked as lacking device-specific automated coverage

### Requirement: Private media authorization failures do not expose private references
When an expired private-media URL cannot be renewed because no authenticated session is available, the app MUST preserve the media reference and MUST NOT expose absolute local paths, signed bearer URLs, or bearer-token values in accessible status messages, console diagnostics, or persisted debug logs.

#### Scenario: Expired synthetic private URL has no authenticated session
- **WHEN** a synthetic private media item has an expired signed URL and no authenticated session
- **THEN** Blend leaves the portable storage reference available, reports the need to connect Supabase, and omits the local path, signed URL, and token from visible or persisted diagnostics
