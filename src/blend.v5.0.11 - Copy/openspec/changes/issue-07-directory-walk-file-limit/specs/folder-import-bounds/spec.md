# Spec Delta

## Purpose

Folder imports remain responsive and recoverable when a selected tree contains more supported media than one import can safely retain and persist at once.

## ADDED Requirements

### Requirement: Folder scans enforce a per-scan supported-media ceiling

An Add Folder selection, through either the directory picker or directory-input fallback, MUST retain and import no more than 250 supported media files in one scan. It MUST continue counting accessible supported files beyond that ceiling as pending, while preserving the six-level depth cap and supported-file filtering.

#### Scenario: Folder contains at or below the ceiling
- **WHEN** a scan discovers no more than 250 supported media files
- **THEN** it imports every discovered supported file and keeps the existing complete, empty, cancellation, depth, and read-error outcomes

#### Scenario: Folder contains more than the ceiling
- **WHEN** a scan discovers more than 250 supported media files within readable branches and the depth limit
- **THEN** it imports at most 250, reports exact added, skipped, and pending counts whose sum equals the supported files found, and does not silently discard later supported files

### Requirement: A limited folder import can be safely continued

When a scan reaches the supported-media ceiling with pending files, Blend MUST state that already-added files are safe and offer a narrower-folder recovery action. Re-scanning overlapping files MUST preserve existing IDs and MUST NOT create duplicates.

#### Scenario: User selects a narrower folder after a limited import
- **WHEN** the user chooses a folder containing pending media after a limited scan
- **THEN** Blend imports those files, preserves prior records and selection, and does not duplicate already-imported media

#### Scenario: Scan is cancelled or a branch cannot be read
- **WHEN** a limited scan is cancelled or encounters a directory read error
- **THEN** Blend preserves its existing cancellation or read-error report, keeps imported records, and reports only counts known from accessible files
