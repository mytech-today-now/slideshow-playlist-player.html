# Tasks

Report finding: ai-prompts/pre-mortem-2026-10-20-13-13-58.html#issue-08 (stable article ID issue-08): Bitbucket read failure recovery lacks browser integration coverage.

## 1. Read behavior and local regression coverage

- [x] 1.1 Give remote playlist read failures the specified accessible recovery copy and log only safe metadata for unexpected exceptions; focused Chromium browser coverage passed for the polite recovery status, unchanged playlist/playback snapshot, and allowlisted unexpected-error log metadata.
- [x] 1.2 Extend storage/catalog regression coverage for Bitbucket public and authorized private reads, selected branch/file handling, bounded bodies, denied/malformed outcomes, and sanitized errors; focused provider regression set passed 39/39.
- [x] 1.3 Add a mocked Bitbucket browser integration test for 401, 404, timeout, malformed JSON, and oversized body responses; focused Chromium test passed with unchanged local state, no token/body/path in logs or visible status, GET-only requests, keyboard retry, and a validated preview before import.

## 2. Auditable live-read gate and documentation

- [x] 2.1 Require explicit Repository Read-only scope confirmation and record branch, declared scope, check time, and sanitized success/failure/skipped/unknown status; unit tests cover the confirmation gate and all status classes, and code review confirms GET-only diagnostics.
- [x] 2.2 Update provider setup and evidence-boundary documentation to explain the new scope confirmation, output fields, recovery behavior, and operator-declared scope limitation; verify the documented variable names match the smoke configuration.

## 3. Verification and external evidence

- [x] 3.1 Run `npm run check` and `npm run test:regression`; syntax check passed and all 373 regression tests passed.
- [x] 3.2 Run the focused mocked provider browser spec; the default sandbox returned `Error: spawn EPERM` before discovery, then the process-enabled Chromium rerun executed and passed 1/1 focused test.
- [ ] 3.3 After owner confirmation of disposable repository credentials and Repository Read-only scope, run `npm run test:git-provider-smoke` and record the sanitized provider, branch, scope, date, and status. Leave pending until that confirmation and live result exist.
