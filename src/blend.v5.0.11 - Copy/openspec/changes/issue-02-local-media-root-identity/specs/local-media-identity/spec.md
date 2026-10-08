# Spec Delta

## Purpose

Keeps local media from separately selected folder roots independently identifiable across import, persistence, playlist use, and relinking.

## ADDED Requirements

### Requirement: Local identity includes the selected root
The system SHALL identify local media using an opaque identity for the selected root and the exact-case relative path beneath it. Root display names, descendant paths without root identity, file size, and lowercased paths alone MUST NOT establish sameness.

#### Scenario: Same-named roots contain same-path files
- **WHEN** two separately selected roots have the same visible name and relative media path but contain different same-sized files
- **THEN** the system keeps both media items with distinct IDs, root identities, and file contents after saving and reloading

#### Scenario: The same root and relative path are imported again
- **WHEN** a selected directory handle is proven to be the same root and its media path matches an existing item exactly, including case
- **THEN** the system reuses the existing library item

#### Scenario: Paths differ only by case
- **WHEN** local relative paths differ only by letter case
- **THEN** the system keeps the paths distinct unless platform-aware evidence proves they identify the same file

### Requirement: Unproven local sameness keeps both items
When the system cannot prove that a local item comes from the same root and exact relative path as an existing item, it MUST keep a separate item and explain the possible duplicate.

#### Scenario: Root identity cannot be established
- **WHEN** a local candidate has a matching display path but its root identity is missing or cannot be matched safely
- **THEN** the system keeps both records and announces: "This file may duplicate an existing item. Both copies were kept so you can choose safely."

### Requirement: Root identity stays private and portable
The system SHALL preserve relative path hints for display and legacy relinking, accept legacy records without a root identity, and MUST NOT persist or export an absolute user filesystem path to distinguish roots.

#### Scenario: Legacy path-only media is imported
- **WHEN** a legacy media record contains a relative path hint but no root identity
- **THEN** the record remains importable and relinkable without inventing an absolute path or destructively migrating it

#### Scenario: Local media is exported
- **WHEN** the library or experience is exported
- **THEN** the export contains no absolute user filesystem path as a root identity

### Requirement: Same-source URL imports remain deduplicated
The system SHALL continue to deduplicate remote media only when the normalized source URLs match.

#### Scenario: The same normalized URL is imported twice
- **WHEN** the same remote source URL is imported more than once with equivalent normalization
- **THEN** the system reuses the existing library item
