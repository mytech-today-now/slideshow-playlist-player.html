# Spec Delta

## Purpose

Ensures that clearing local browser storage signs out every confirmed open Blend tab on the same origin while keeping provider sessions and saved Blend data recoverable.

## ADDED Requirements

### Requirement: Local reset clears auth state across open Blend tabs

When Clear Browser Storage starts, the system SHALL clear the current tab's local Supabase session and notify every participating same-origin Blend tab to clear its in-memory and opted-in saved session, cancel refresh timers, and abort active refresh requests before acknowledging. Reset notifications SHALL contain only an event type and nonce, and SHALL NOT call remote logout.

#### Scenario: Memory-only sessions are cleared in both tabs

- **WHEN** two open Blend tabs hold memory-only synthetic Supabase sessions and the user starts Clear Browser Storage in one tab
- **THEN** both tabs become signed out, both refresh timers are cancelled, and neither tab issues an auth request after handling the reset notification

#### Scenario: Opted-in refresh cannot restore a cleared session

- **WHEN** an opted-in tab has an in-flight refresh response when it handles a local reset notification
- **THEN** the tab remains signed out and the late response does not update memory or recreate the saved session key

#### Scenario: Notification contains no credentials

- **WHEN** a tab sends or acknowledges a local reset
- **THEN** each notification contains only an event type and nonce, with no access token, refresh token, or media data

### Requirement: Reset waits for peer confirmation before deleting saved Blend data

The system SHALL wait for every known participating Blend tab to acknowledge the local reset or close during a bounded confirmation period before snapshotting or deleting saved Blend data. If any tab remains unconfirmed, the current tab SHALL remain signed out, preserve saved Blend data, and show: "This tab is signed out, but another Blend tab may still be active. Close all Blend tabs and retry the local reset."

#### Scenario: Every peer confirms the reset

- **WHEN** all participating tabs acknowledge the reset before the confirmation period expires
- **THEN** the existing snapshot and database deletion flow continues and reports its actual success or partial-failure outcome

#### Scenario: A peer does not confirm the reset

- **WHEN** a participating tab does not acknowledge within the bounded confirmation period
- **THEN** the reset does not snapshot or delete Blend data, keeps that data available for retry, and shows the specified warning without waiting indefinitely

#### Scenario: A peer closes during confirmation

- **WHEN** a participating tab closes before acknowledging
- **THEN** its departure satisfies the pending confirmation and the reset can continue for the remaining tabs
