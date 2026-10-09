# Spec Delta

## Purpose

Experience snapshots persist library data, directory handles, the experience catalog, both lists, and settings as one conflict-aware unit. This capability defines their atomic merge behavior and avoids rewriting snapshot rows that did not change.

## ADDED Requirements

### Requirement: Snapshot saves write only changed rows

The system MUST queue a data-row put only when the merged row differs from the current persisted row, and MUST retain explicit row deletions. A successful snapshot save MUST advance the shared revision exactly once.

#### Scenario: Setting edit leaves unrelated rows untouched
- **WHEN** a snapshot changes one settings row while its library, directory handles, catalog, and lists remain unchanged
- **THEN** the save writes only changed data rows and the revision row, and all persisted records match the merged snapshot

### Requirement: Disjoint snapshot changes merge atomically

The system MUST commit all experience snapshot stores in one readwrite transaction and preserve disjoint changes made since the caller's base snapshot.

#### Scenario: Concurrent library additions are disjoint
- **WHEN** two tabs add different library records from the same base and save in sequence
- **THEN** both records remain persisted and each successful transaction advances the revision once

### Requirement: Conflicting snapshot changes fail without partial writes

The system MUST reject conflicting edits and abort every queued write when a snapshot transaction fails.

#### Scenario: Two tabs edit the same list differently
- **WHEN** one tab commits a list edit and a stale tab attempts a different edit to that same list row
- **THEN** the stale save fails, the committed list remains unchanged, and the stale tab retains its in-memory edit for recovery

#### Scenario: A queued write fails
- **WHEN** a queued snapshot write fails
- **THEN** every snapshot store remains at its pre-transaction state and the caller receives a save failure
