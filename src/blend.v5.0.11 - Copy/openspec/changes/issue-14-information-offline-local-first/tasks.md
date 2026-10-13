# Tasks

## 1. Local-first README fetching

- [x] 1.1 Update `fetchReadme` to render installed documentation before an uncached online request, preserve remote-only cache writes and fresh-cache short-circuiting, inject clock services, and cover timeout ordering, timer cleanup, success, failure, expiration, and retry in `tests/regression/readme-fetcher.test.mjs`.

## 2. Information dialog behavior

- [x] 2.1 Keep rendered help visible during online refresh, show the installed-guide status and required failure copy, preserve request ordering and navigation state, and add Playwright coverage for delayed success, failure, keyboard retry, and the existing viewport matrix in `tests/e2e/information-dialog.e2e.spec.mjs`.

## 3. Integration verification

- [ ] 3.1 Run `npm run check`, `npm run test:regression`, `npm run test:e2e`, and `openspec validate issue-14-information-offline-local-first`; verify `blend-1pr` with `bd show` and record exact results and any remaining browser gaps.
  - 2026-10-13: `npm run check` passed; `npm run test:regression` passed (353/353); `openspec validate issue-14-information-offline-local-first` passed; `bd show blend-1pr` verified the record remains in progress.
  - The focused `npm run test:e2e -- tests/e2e/information-dialog.e2e.spec.mjs` run passed in the elevated permitted runner: 14 Chromium tests, Playwright last-run status `passed`, no failed tests. The initial sandbox attempt stopped before tests with `spawn EPERM`.
  - The complete `npm run test:e2e` suite and manual screen-reader review remain outstanding. Keep this task unchecked until those requested checks are completed.
