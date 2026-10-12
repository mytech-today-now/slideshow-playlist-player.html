# Spec Delta

## Purpose

Bounds direct multi-file imports so large selections do not enter the library import pipeline without an explicit, understandable result. The same rule applies to the native picker and its input fallback.

## ADDED Requirements

### Requirement: Direct multi-file selections have a finite shared limit
The system SHALL allow at most 250 selected files through either Add Files picker path. A selection above the limit SHALL be rejected in full before any library record is added; the system SHALL NOT silently truncate or process the oversized selection.

#### Scenario: Native selection is at the limit
- **WHEN** the native Add Files picker returns 250 selected files
- **THEN** the system passes the complete selection through the existing import behavior

#### Scenario: Input fallback selection is at the limit
- **WHEN** the Add Files input fallback returns 250 selected files
- **THEN** the system passes the complete selection through the existing import behavior

#### Scenario: Native selection exceeds the limit
- **WHEN** the native picker returns more than 250 selected files
- **THEN** the system adds zero files and announces the selected count, accepted count of zero, remaining count equal to the selection, and the 250-file limit

#### Scenario: Input fallback selection exceeds the limit
- **WHEN** the input fallback returns more than 250 selected files
- **THEN** the system adds zero files and announces the selected count, accepted count of zero, remaining count equal to the selection, and the 250-file limit

### Requirement: Oversized selection feedback is accessible and actionable
The system SHALL present an accessible status that tells users to select up to the displayed limit or choose a smaller folder, confirms that no unlisted files were added, and reports selected, accepted, and remaining counts.

#### Scenario: User receives rejection guidance
- **WHEN** an Add Files selection exceeds the limit
- **THEN** the user can perceive the rejection and its counts through an accessible live status and visible text

### Requirement: Picker cancellation and other import scopes remain compatible
The direct-selection limit SHALL NOT change picker cancellation, existing media filtering and duplicate behavior, folder-import limits, single-file imports, or persisted data formats.

#### Scenario: User cancels either Add Files picker
- **WHEN** the native picker or input fallback is canceled
- **THEN** the library remains unchanged and no selection-limit message is shown

#### Scenario: User imports from a folder or a single-file workflow
- **WHEN** a folder scan or single-file workflow is used
- **THEN** that workflow continues to apply its existing behavior independently of the direct multi-file limit
