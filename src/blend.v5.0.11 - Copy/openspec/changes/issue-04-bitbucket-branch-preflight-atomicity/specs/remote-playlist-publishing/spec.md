# Spec Delta

## Purpose

Defines safe, reviewable publishing and recovery for playlists sent to user-owned Git repositories, including provider conflicts and submissions with uncertain outcomes.

## ADDED Requirements

### Requirement: Bitbucket branch updates require a documented conditional write
Blend MUST NOT submit a write to a Bitbucket branch unless the documented Bitbucket API enforces the reviewed branch revision as a condition of that write.

#### Scenario: The documented endpoint has no conditional write
- **WHEN** the user confirms a Bitbucket playlist review and the supported source endpoint documents branch and parent fields but no atomic revision condition
- **THEN** Blend sends no write request and explains that publishing is paused to protect remote changes
- **AND** the exact reviewed JSON and observed branch revision remain available in the review

#### Scenario: A branch changes after preflight
- **WHEN** the branch head moves after Blend reads the head and before a write could be submitted
- **THEN** Blend does not report a successful publish or send an unconditional write
- **AND** the reviewed JSON and original observed revision remain available

### Requirement: Failed reviews remain recoverable
After a conflict, rejected write, or uncertain outcome, Blend MUST retain the exact reviewed allowlisted JSON and its observed revision until the user replaces or cancels the review, and MUST offer saving a copy only after an explicit user action.

#### Scenario: Conflict preserves reviewed content
- **WHEN** a publish attempt detects a changed branch or file
- **THEN** Blend leaves the local playlist unchanged, keeps the review and observed revision visible, and announces: "The remote playlist changed while you were publishing. Your local copy is unchanged. Review the newest remote version and choose which version to publish."

#### Scenario: User saves an outgoing copy
- **WHEN** the user activates the save-copy control on a retained review
- **THEN** Blend downloads exactly the reviewed JSON without credentials or other app state
- **AND** Blend does not save or download a conflict copy automatically

### Requirement: Uncertain submissions require remote reconciliation
Blend MUST NOT automatically retry a write whose submission may have reached the provider, and MUST require a successful remote read and comparison before enabling another publish attempt from that review.

#### Scenario: Submission response is lost
- **WHEN** the provider may have accepted a write but the response is lost, malformed, or inconclusive
- **THEN** Blend reports the outcome as unresolved, retains the reviewed JSON and revision, and disables another publish attempt
- **AND** no automatic write retry occurs

#### Scenario: Remote state is read after an uncertain submission
- **WHEN** the user reads the remote playlist after an uncertain outcome
- **THEN** Blend compares the newest branch revision and playlist JSON with the retained review before allowing another publish attempt
- **AND** Blend leaves the local playlist unchanged

### Requirement: GitHub stale SHA protection remains intact
Blend MUST continue to include the reviewed file SHA in GitHub updates and MUST surface stale-SHA conflicts without retrying or discarding the review.

#### Scenario: GitHub file changes after review
- **WHEN** the GitHub Contents API rejects a reviewed update because its file SHA is stale
- **THEN** Blend reports a conflict, preserves the local playlist and reviewed JSON, and sends no retry
