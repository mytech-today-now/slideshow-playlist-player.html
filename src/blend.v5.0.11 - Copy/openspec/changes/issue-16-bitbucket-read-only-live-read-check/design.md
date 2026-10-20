# Design

## Context

See proposal.md and `specs/git-playlist-provider-reads/spec.md`. The storage module already fixes Bitbucket URLs, bounds response bodies, validates branch and playlist content, and stops Bitbucket publication before POST. The browser smoke already requires a disposable private repository and emits allowlisted request diagnostics, but its summary lacks branch, declared scope, timestamp, and explicit status. The read UI currently maps failures to provider-specific copy.

## Goals / Non-Goals

**Goals:** Keep the existing read contract intact, provide one accessible recovery message for failed remote reads, log only safe metadata for unexpected exceptions, and make a future operator-confirmed Bitbucket result auditable without exposing repository coordinates or credentials.

**Non-Goals:** Do not add Bitbucket writes, inspect or certify token privileges through the API, run a live provider request, alter local import behavior, or change persistence schemas.

## Decisions

- Keep request URLs, bounds, JSON validation, and credential placement in the existing storage/catalog modules. Expand their focused regression cases instead of introducing a provider abstraction.
- Handle read failures at the existing read UI boundary. Use the requested recovery copy for expected provider errors and unexpected exceptions; unexpected exceptions log only the operation, validated provider name, and a coarse error type. The existing live status element already has `role="status"` and polite announcements.
- Require a second, exact smoke confirmation for `Repository Read` scope in addition to the disposable-repository confirmation. Report it as operator-confirmed because the API does not expose a reliable scope attestation through this read flow.
- Emit an allowlisted Bitbucket result with provider, selected branch, declared scope, check timestamp, status, read verification, and stable error code. Map provider responses to success/failure, absent configuration to skipped, and timeout/network uncertainty to unknown. Keep coordinates, path, token, response, and raw exception details out of output.
- Use mocked browser routes for local state, error-copy, log-redaction, retry, and no-write integration coverage. Keep the real-browser live smoke as a separately gated release check.

## Risks / Trade-offs

- Operator-declared scope can be incorrect → label it operator-confirmed, require the explicit confirmation value, and document that it does not prove absence of extra privileges.
- A network or timeout failure may not establish whether the provider received a request → report unknown, keep the operation GET-only, and never infer success from missing response data.
- Browser process launch may be unavailable in a restricted runner → report the focused E2E result as Not run if it fails before assertions; regression and syntax results remain separate evidence.

## Migration Plan

No data migration is needed. Rollback by reverting the focused app, smoke, test, and documentation changes; no live provider mutation is part of this implementation. Run the live smoke later only after the owner confirms the disposable repository and Repository Read-only token scope.
