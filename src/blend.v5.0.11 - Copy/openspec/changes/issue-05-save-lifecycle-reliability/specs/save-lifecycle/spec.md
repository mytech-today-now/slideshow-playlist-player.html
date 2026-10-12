# Spec Delta

## Purpose

This capability defines how Blend reports pending and committed save revisions, orders app-controlled transitions around persistence, and handles browser shutdown without overstating IndexedDB durability.

## ADDED Requirements

### Requirement: Save status follows committed snapshot revisions

The app MUST keep edits dirty until their atomic IndexedDB snapshot transaction completes, and a completed older revision MUST NOT clear a newer edit.

#### Scenario: A newer edit arrives during a delayed commit
- **WHEN** revision N is being committed and revision N+1 becomes dirty before that transaction completes
- **THEN** the app continues to report unsaved work after revision N commits and reports all changes saved only after revision N+1 commits

#### Scenario: A snapshot transaction fails
- **WHEN** quota, blocking, abort, or another persistence failure prevents the transaction from completing
- **THEN** the app reports an accessible failure and retains the current edit for retry or backup export

### Requirement: App-controlled transitions wait for the current dirty revision

The app MUST await the current dirty revision before leaving or replacing the active experience through an app-controlled transition, and MUST keep the current experience and recovery actions available if persistence fails.

#### Scenario: Switching experiences with a pending edit
- **WHEN** the user switches experiences while an edit is dirty or being saved
- **THEN** the current experience remains active until its latest dirty revision commits

#### Scenario: A controlled transition encounters a save failure
- **WHEN** the current revision fails to commit before an app-controlled transition
- **THEN** the transition stops and the user can retry or export the retained edit

### Requirement: Browser shutdown persistence is best effort

The app MAY request a final pagehide flush, but MUST NOT treat browser shutdown as proof of durability or report that flush as saved before its transaction completes.

#### Scenario: Pagehide starts while an edit is dirty
- **WHEN** pagehide occurs before a dirty snapshot transaction completes
- **THEN** the app may attempt the flush, and the resulting fresh page may observe the previous complete snapshot or the new complete snapshot without partial transaction state

#### Scenario: The pagehide flush fails
- **WHEN** the final flush rejects or aborts
- **THEN** the pagehide handler does not throw or create an unhandled rejection, and the app does not announce that the failed revision was saved

### Requirement: Save and recovery status is accessible

The app MUST expose readable pending, saving, saved, and failed states through an accessible status, and a failed state MUST retain keyboard-operable retry and backup export actions.

#### Scenario: A user reviews save state and recovery actions
- **WHEN** the user reaches the save status or a persistence failure notice with a keyboard or assistive technology
- **THEN** the current state is announced and any available retry or export action can receive focus and be activated
