# Proposal

## Why

Existing fixtures cover Bitbucket catalog and private playlist reads, but there is no current live disposable-repository result. The read UI also gives provider failures different low-level messages instead of one safe recovery instruction, making it harder to distinguish the read contract from provider-specific details.

## What Changes

- Keep public catalog reads unauthenticated and private playlist reads authorized with the repository token; preserve fixed HTTPS origins, response bounds, validation, and the existing prohibition on Bitbucket writes.
- Make remote read failures retain the local playlist and show the specified retry guidance. Log only safe structured metadata for unexpected exceptions.
- Gate the Bitbucket live smoke on exact disposable-repository confirmation and explicit operator confirmation of Repository Read scope. Record branch, declared scope, check time, and sanitized success/failure/skipped status without credentials or repository paths.
- Add regression and browser-fixture coverage for authorized reads, branch/file handling, denial, timeout, malformed and oversized responses, no writes, sanitized diagnostics, unchanged local state, and retry recovery.
- Document that only an owner-confirmed live run can establish current provider behavior; local fixtures remain mock evidence.

## Capabilities

### New Capabilities

- `git-playlist-provider-reads`: Public and authorized private remote reads are validated, bounded, read-only, and fail without changing the local playlist.

### Modified Capabilities

None.

## Impact

Affected areas are `app.js`, the Git playlist storage and catalog modules, their regression and browser tests, the opt-in provider smoke, and provider setup documentation. No runtime dependency or persisted-data change is expected. No live provider request is part of implementation; the live smoke remains gated on owner-confirmed disposable credentials and read-only scope.
