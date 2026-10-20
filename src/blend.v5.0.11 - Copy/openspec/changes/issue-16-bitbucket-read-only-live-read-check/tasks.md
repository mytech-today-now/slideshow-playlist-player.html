# Tasks

## 1. Read behavior and local regression coverage

- [ ] 1.1 Give remote playlist read failures the specified accessible recovery copy and log only safe metadata for unexpected exceptions; verify the status and unchanged-local-state assertions in the focused browser test.
- [x] 1.2 Extend storage/catalog regression coverage for Bitbucket public and authorized private reads, selected branch/file handling, bounded bodies, denied/malformed outcomes, and sanitized errors; focused provider regression set passed 39/39.
- [ ] 1.3 Add a mocked Bitbucket browser integration test for 401, 404, timeout, malformed JSON, and oversized body responses; verify local playlist/playback state is unchanged, logs omit token/body/path, writes stay absent, and a retry succeeds.

## 2. Auditable live-read gate and documentation

- [x] 2.1 Require explicit Repository Read-only scope confirmation and record branch, declared scope, check time, and sanitized success/failure/skipped/unknown status; unit tests cover the confirmation gate and all status classes, and code review confirms GET-only diagnostics.
- [x] 2.2 Update provider setup and evidence-boundary documentation to explain the new scope confirmation, output fields, recovery behavior, and operator-declared scope limitation; verify the documented variable names match the smoke configuration.

## 3. Verification and external evidence

- [x] 3.1 Run `npm run check` and `npm run test:regression`; syntax check passed; the regression command reached assertions and failed two existing README contract expectations in `playwright-workflow-contract.test.mjs`.
- [x] 3.2 Run the focused mocked provider browser spec; it returned `Error: spawn EPERM` before assertions, so browser behavior is Not run in this environment.
- [ ] 3.3 After owner confirmation of disposable repository credentials and Repository Read-only scope, run `npm run test:git-provider-smoke` and record the sanitized provider, branch, scope, date, and status. Leave pending until that confirmation and live result exist.
