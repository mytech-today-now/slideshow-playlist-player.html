# Spec Delta

## Purpose

Bounds folder scanning work so unsupported files and wide directory trees cannot keep one scan active indefinitely, while preserving discovered media and giving users a clear recovery path.

## ADDED Requirements

### Requirement: Folder scans have a total entry ceiling
A folder scan SHALL visit no more than 2,000 file and directory entries, including unsupported files, and SHALL report the number of entries visited when the ceiling stops traversal.

#### Scenario: A wide tree exceeds the entry ceiling
- **WHEN** a selected folder contains more than 2,000 entries
- **THEN** the scan visits at most 2,000 entries and reports a partial result with the visited count and supported media counts
- **AND** the app does not announce that the scan is complete

### Requirement: Entry-limited scans preserve results and offer recovery
When the entry ceiling stops a folder scan, the app SHALL keep supported media already discovered within the existing 250-media limit and SHALL offer an action to choose a smaller folder.

#### Scenario: A committed media batch reaches the entry ceiling
- **WHEN** the scan has committed supported media and then reaches the entry ceiling
- **THEN** those committed media remain available and the partial status reports the supported media found, added, already present, and pending within the visited entries
- **AND** the status offers a smaller-folder action for scanning another section
