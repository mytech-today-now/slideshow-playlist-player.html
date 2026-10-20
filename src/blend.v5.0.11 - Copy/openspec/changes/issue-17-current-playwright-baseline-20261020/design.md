# Design

## Evidence collection

Run `npm run check` and `npm run test:regression`, then run the configured `npm run test:e2e` suite with fresh Playwright test and HTML report directories under the system temporary directory. Record the Git commit and dirty-worktree state so the run is tied to the reviewed checkout. Record the package Playwright version and configured browser engine versions; when Playwright executes, use its project summaries as the authoritative runtime results.

## Failure classification

- A process-launch error before test discovery or assertions is `Not run`; report zero executed tests only when the runner confirms that fact.
- For executed tests, record passed, failed, and skipped counts for Chromium, Firefox, and WebKit separately.
- Reproduce each assertion failure serially with trace and a distinct output directory before changing source or expectations. Preserve the original full-run report and trace artifacts.
- Run `tests/e2e/verify-playwright-report.mjs` against any generated HTML report before any upload. A trace archive rejected by the verifier stays local.
- A reproduced Bitbucket read-failure case showed focus was lost when its busy state disabled the focused read button. Restore focus after re-enabling only when the read action had focus at start and the user has not moved focus elsewhere.
- The same dirty E2E case delays one mocked response for 21 seconds, beyond the product's 20-second request timeout. Give only that timeout-mode assertion 25 seconds while retaining all fallback, focus, state, sanitization, and overflow assertions.

## Scope and recovery

Do not modify app code in response to runner startup failure. Preserve historical artifacts, unrelated dirty E2E changes, serial regressions, project engine tags, and report verification. Keep all current reports and trace outputs in unique temporary directories. A `Not run` record leaves the current browser baseline unresolved for a process-enabled runner. No provider requests, credential use, browser storage changes, or live service actions are part of this work.
