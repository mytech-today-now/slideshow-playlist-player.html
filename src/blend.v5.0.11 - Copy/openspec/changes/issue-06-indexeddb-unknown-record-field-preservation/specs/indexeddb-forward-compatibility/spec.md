# Spec Delta

## Purpose

Allows this version to safely read and edit records from later compatible database schemas while retaining fields that it does not understand.

## ADDED Requirements

### Requirement: Compatible newer library records retain unknown fields on save

When the app saves a library record from a compatible newer database, it SHALL preserve top-level fields that the current app does not write while applying the current app's known field values.

#### Scenario: Save an edited record with a future field

- **WHEN** a higher-version database has the required key paths and a library record contains an extra nested field
- **AND** this version edits and saves that library record
- **THEN** the stored known fields reflect the edit and the extra field remains exactly unchanged

### Requirement: Failed compatible-schema saves do not partially commit

If a read, merge, or write in a compatible-schema snapshot transaction fails, the app SHALL leave the prior database snapshot intact and expose its recoverable save retry and export actions.

#### Scenario: Abort after merging a future field

- **WHEN** a snapshot transaction is aborted after a library record with an unknown field has been merged
- **THEN** the original library row and every other snapshot row remain unchanged
- **AND** the app does not report the save as successful

### Requirement: Incompatible required key paths remain rejected

The app SHALL reject a database whose required object-store key paths do not match this version before allowing application writes, without replacing or deleting the existing database.

#### Scenario: Higher-version database changes a required key path

- **WHEN** a higher-version database has an incompatible required key path
- **THEN** startup shows database recovery guidance and the original database version and records remain unchanged
