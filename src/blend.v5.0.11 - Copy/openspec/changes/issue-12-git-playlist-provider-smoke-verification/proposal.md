# Proposal

## Why

The GitHub and Bitbucket BYOT flows have deterministic mock coverage, but no recorded live-provider verification. A disposable, opt-in browser smoke can expose real CORS, permissions, rate limits, and response behavior without making normal tests depend on network access or provider accounts.

## What Changes

- Add a separate live smoke command for configured disposable private repositories, with missing credentials reported as skipped.
- Capture only sanitized provider, operation, method, HTTP status, and stable outcome codes; never record headers, URLs, repository coordinates, response bodies, or credentials.
- Verify GitHub read, reviewed publish, readback, stale review conflict, and restoration of the original fixture. Verify Bitbucket read only because Blend intentionally does not issue Bitbucket branch writes.
- Document least-privilege setup, exact disposable-repository confirmation, recovery, and the distinction between mock, live-disposable, and production evidence.
- Add regression coverage for timeouts before headers and after an accepted submission, plus secret-sentinel handling.

## Capabilities

This change adds test and diagnostic tooling only. It does not change runtime app behavior or an existing spec-level requirement, so this change opts out of capability specs with `skip_specs: true`.

## Impact

Affected files include the Git playlist regression and E2E tests, a new opt-in Playwright smoke spec, a small sanitized diagnostic helper, `package.json`, README BYOT guidance, and `GIT_PLAYLIST_STORAGE_DESIGN.md`. No runtime dependency, networked default test, persisted-format change, provider API change, or production repository operation is introduced.
