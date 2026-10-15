# Design

## Context

See `proposal.md` for motivation. `npm run test:e2e` uses the existing Playwright configuration, starts `tests/e2e/fixture-server.mjs`, writes an HTML report, and the CI workflow runs `tests/e2e/verify-playwright-report.mjs` before artifact upload. The report already distinguishes a process-launch failure from test assertions.

## Goals / Non-Goals

**Goals:**

- Capture current focused and full-suite evidence in a runner that permits Playwright workers and browsers.
- Keep each run's test results and HTML report in a distinct ignored output folder.
- Preserve failed assertions and record the safety verifier's result without uploading a rejected report.

**Non-Goals:**

- Change application behavior, test assertions, Playwright projects, CI policy, or dependencies to make this runner work.
- Infer release readiness from a run with assertion failures or from an unverified report.

## Decisions

- Use the exact repository scripts and Playwright configuration so the evidence describes the configured workflow.
- Use the existing HTML report verifier for each report. The traced report may contain a binary trace attachment that the verifier intentionally rejects; keep that report local and report the rejection.
- If the full suite cannot launch, preserve the exact error and classify it as not run with no assertion count.

## Risks / Trade-offs

- A passing launch demonstrates this runner can execute tests; it does not make unrelated assertion failures pass. Record each category separately.
- A report rejected by the safety verifier is not eligible for CI upload; retain it only in its isolated local output folder.
