# Proposal

## Why

Historical full-suite failures and focused passes cannot establish the current browser baseline. The supplied October 17 review stopped before Playwright assertions with `spawn EPERM`, so a current full-suite run or an exact, versioned `Not run` record is needed to keep runner failures distinct from browser results.

## What Changes

- Capture a full configured Playwright attempt with a unique output directory, revision and worktree status, Playwright and engine versions, exact per-project counts when tests execute, and report-verifier outcome.
- If the runner fails before discovery or assertions, record `Not run` with the startup error and leave the supported-runner baseline unresolved.
- If current assertions fail, rerun the affected spec serially with trace and isolated outputs; change only a reproduced product or test-harness cause.
- Restore focus to the retry action after a failed remote playlist read when that action had focus and the user has not moved focus elsewhere; allow the timeout fixture enough time for the configured request timeout.
- Preserve historical reports and unrelated dirty changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Provider reads are an active delta-only capability in the separate Issue 16 change, so this evidence-focused change avoids creating a duplicate capability delta. The focus correction is covered by the existing E2E assertion.

## Impact

This change first recorded verification evidence for `ai-prompts/pre-mortem-2026-10-17-21-05-36.html#issue-17` and includes a minimal correction to the confirmed provider-read retry-focus failure in `app.js`, covered by the existing E2E spec. Its current-tree revalidation is linked to `ai-prompts/pre-mortem-2026-10-20-13-13-58.html#issue-07` (prior source issue 17). It does not change persisted data, CI configuration, or provider state. The Beads record is `blend-6dw`.
