# Spec Delta

## Purpose

This capability lets users recover missing local media from a selected folder while keeping scans bounded, cancellable, and safe to retry. It preserves existing library entries and unresolved list references when a scan cannot finish.

## ADDED Requirements

### Requirement: Relink scans have a finite media-handle bound
The relink workflow SHALL retain no more than 250 supported media file handles in one scan and SHALL report a partial result when the bound is reached.

#### Scenario: Folder remains below the bound
- **WHEN** a selected folder contains fewer than 250 supported media files and can be fully read
- **THEN** relink completes with existing exact-path and basename matching behavior

#### Scenario: Scan reaches the bound
- **WHEN** enumeration reaches 250 supported media files
- **THEN** the workflow stops enumeration, reports a partial result with the required smaller-folder guidance, and leaves unresolved entries and saved library records intact

### Requirement: Partial and cancelled scans preserve recoverable media state
The relink workflow SHALL preserve unresolved references and current library records when enumeration is cancelled, a directory cannot be read, or a selected root becomes unavailable, and SHALL present a retry action when the failure can be retried.

#### Scenario: User cancels during enumeration
- **WHEN** the user activates the keyboard-accessible Cancel scan control
- **THEN** enumeration stops, the outcome is reported as cancelled, and no unresolved reference or existing library record is removed

#### Scenario: Directory access fails
- **WHEN** enumeration encounters a permission, readability, or missing-root failure
- **THEN** the workflow reports a partial result with a retry action and does not present the scan as a complete no-match

### Requirement: Relink matching remains deterministic and path-first
For scans that complete below the bound, the workflow SHALL prefer an exact normalized relative-path match over basename fallback, preserve traversal order among candidates, and require user confirmation when fallback matching is ambiguous.

#### Scenario: Exact path is present among duplicate basenames
- **WHEN** a candidate exactly matches the missing relative path and other candidates share its basename
- **THEN** the exact-path candidate is selected without replacing it with a basename candidate

#### Scenario: Basename fallback is ambiguous
- **WHEN** multiple candidates match only by basename
- **THEN** the workflow presents the candidates in deterministic traversal order and does not replace the missing reference until the user confirms one

### Requirement: Relink progress explains the bound and next action
The progress status SHALL announce discovered media counts and provide a keyboard-operable cancellation control; reaching the bound SHALL state the required next action.

#### Scenario: User cancels with the keyboard
- **WHEN** the progress status is visible and the user focuses and activates Cancel scan from the keyboard
- **THEN** the scan cancels and the accessible status reports the cancelled outcome

#### Scenario: User reaches the scan bound
- **WHEN** the scan reaches 250 supported media files
- **THEN** the status includes: “This folder contains more media than Blend can scan in one relink pass. No saved entries were removed. Choose a smaller folder or narrow the search.”
