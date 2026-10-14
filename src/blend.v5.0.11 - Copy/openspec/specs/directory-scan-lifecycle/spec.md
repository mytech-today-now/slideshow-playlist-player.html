# Directory Scan Lifecycle Specification

## Purpose

Defines how long directory scans pause, resume, and cancel across document visibility changes while retaining user progress and saved media.

## Requirements

### Requirement: Hidden scans announce a pause
When an active directory scan pauses because its document is hidden, the app SHALL announce the pause in an accessible status region and SHALL NOT report the scan as complete.

#### Scenario: The document becomes hidden during a scan
- **WHEN** a directory scan reaches a cooperative yield while the document is hidden
- **THEN** the status says "Folder scanning is paused while this tab is in the background. Return to Blend to resume or cancel. Saved batches remain available."
- **AND** the scan remains incomplete and committed batches remain available

### Requirement: Resumption continues the existing scan
When the document becomes visible, the app SHALL continue the same directory enumeration from its next unprocessed entry, preserve committed batches exactly once, and retain the existing file and depth limits.

#### Scenario: A paused scan resumes after a batch was saved
- **WHEN** the user returns to Blend after a batch was committed and resumes scanning
- **THEN** scanning continues without repeating committed media and live progress continues
- **AND** no more than 250 supported media files are added and the existing depth limit remains in force

#### Scenario: Permission is lost when a paused scan resumes
- **WHEN** directory access fails after the document becomes visible again
- **THEN** the app reports a partial scan, keeps committed batches, and does not claim completion

### Requirement: Cancellation preserves partial results
An active directory scan SHALL expose a keyboard-operable cancel control and report cancellation accessibly while retaining committed batches and saving remaining discovered media once.

#### Scenario: The user cancels a paused scan
- **WHEN** the user cancels while a scan is paused or after returning to the tab
- **THEN** the app reports a canceled partial result, preserves committed batches, and does not show a success message
