# Spec Delta

## Purpose

Defines how public and authorized private Git playlist reads are bounded, validated, shown to users, and kept separate from local playlist state.

## ADDED Requirements

### Requirement: Bitbucket repository reads remain read-only
The app MUST use fixed HTTPS Bitbucket Cloud endpoints for repository, branch, and playlist reads. Public catalog reads omit credentials, and private playlist credentials are sent only in the Authorization header. Bitbucket requests MUST NOT write repository content.

#### Scenario: Public catalog file read
- **WHEN** a user fetches a public Bitbucket catalog
- **THEN** the app sends an unauthenticated GET to the fixed Bitbucket API origin and validates the bounded response

#### Scenario: Authorized private playlist read
- **WHEN** a user connects with a repository access token and reads a selected branch and file
- **THEN** the app sends GET requests with the token only in Authorization and sends no write request

### Requirement: Remote playlist reads do not change local state
The app MUST bound and validate the selected remote playlist before displaying it. A remote read MUST NOT alter the local playlist or playback state; import remains a separate user action.

#### Scenario: Valid remote playlist
- **WHEN** the selected branch and file return a supported playlist within the response limits
- **THEN** the app displays the validated playlist and leaves the local playlist unchanged until the user chooses import

#### Scenario: Denied, unavailable, malformed, or oversized read
- **WHEN** a remote playlist read is denied, times out, returns malformed content, or exceeds a response limit
- **THEN** the app retains local playlist and playback state, hides any invalid remote result, and says: “The remote playlist could not be read. Check the repository and read permission, then retry.”

#### Scenario: Unexpected read exception
- **WHEN** a remote read fails with an unexpected exception
- **THEN** the app preserves local state, logs only safe operation/provider/error-type metadata, and exposes the same retry guidance

### Requirement: Live read evidence is gated and sanitized
The opt-in Bitbucket smoke MUST require exact confirmation of a disposable repository and operator confirmation of Repository Read scope. Its result MUST distinguish success, failure, skipped, and unknown outcomes and include the selected branch, declared scope, and check time without credentials, repository coordinates, response bodies, or repository paths.

#### Scenario: Confirmed live read succeeds
- **WHEN** the owner confirms a disposable private repository and its Repository Read-only scope, and the smoke validates the fixture
- **THEN** the result records Bitbucket, branch, operator-confirmed scope, check time, and successful read status, with GET-only diagnostics

#### Scenario: Smoke is not configured or the read outcome is unavailable
- **WHEN** required confirmation is absent or a timeout/network boundary prevents determining the provider result
- **THEN** the result is reported as skipped or unknown respectively, with no write request and no sensitive provider data

#### Scenario: Provider explicitly rejects or returns an invalid fixture
- **WHEN** the provider returns a denied/not-found response or the fixture is malformed or oversized
- **THEN** the result is reported as failed with a stable sanitized code and no response body or credential
