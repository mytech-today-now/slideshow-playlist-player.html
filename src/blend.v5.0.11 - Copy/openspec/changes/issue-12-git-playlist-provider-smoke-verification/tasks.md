# Tasks

- [x] Add sanitized live-request diagnostics and deterministic regression coverage for success, denied permission, rate limit, stale revision, timeout before response, accepted write with lost response, and secret-sentinel boundaries.
- [x] Add an opt-in browser smoke for GitHub read, reviewed write, readback, stale review conflict, safe cleanup, and Bitbucket read-only verification. Skip when required credentials or confirmations are absent.
- [x] Document disposable private repository setup, least-privilege token scopes, cleanup, exact live/non-live evidence boundaries, and the not-run fallback. Add a dedicated npm command without wiring live credentials into CI or default checks.
- [x] Run the Git storage/catalog regressions, syntax check, regression suite, and focused mocked E2E suite. Run the live smoke only if disposable configuration is present; report absent configuration as skipped.
