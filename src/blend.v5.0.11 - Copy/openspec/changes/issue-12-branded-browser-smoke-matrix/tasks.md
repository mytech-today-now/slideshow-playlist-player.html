# Tasks

## 1. Branded desktop smoke procedure and evidence

- [x] 1.1 Add the bounded synthetic-media workflow and per-browser result fields beside the README compatibility matrix; verify each unrun target remains partial and engine evidence stays separately labeled.
- [ ] 1.2 Run the workflow in each available branded desktop browser with a disposable profile and the same synthetic H.264 video; record exact browser and OS versions plus import/save, decode/playback, fullscreen, offline reload, and persistence outcomes. Keep unavailable or blocked targets not run and unverified.

## 2. Verification and tracking

- [x] 2.1 Run the focused browser-compatibility Playwright spec where the runner permits, then `npm run check` and `npm run test:regression`; record exact commands, outcomes, and any report artifact without translating engine results into branded passes.
- [x] 2.2 Validate this OpenSpec change and inspect the final diff and working tree; verify the pre-existing Issue 14 edit remains intact.

## 2026-10-16 execution note

- The H.264 fixture was generated and verified, but no branded workflow ran. Chrome `155.0.8059.82` and Edge `155.0.4283.45` are installed; CUA could not provide either browser, and Playwright channel launches failed with `spawn EPERM` before navigation. Safari is not installed. The host version recorded in README is `10.0.26300.9711` (26H2, Core; registry ProductName `Windows 10 Home`). All branded workflow steps remain **Not run**, and task 1.2 remains unchecked.
- The focused Playwright engine baseline rechecks using both `npm run test:e2e` and direct `npx playwright test` stopped before test execution with `spawn EPERM`; the failed-run HTML artifact is `playwright-report/issue-12-branded-smoke-20261016-f1dd4a9cb0444a8e8757c9bd6ba39fe2/index.html`. A separate same-day engine run recorded in the Issue 14 verification note passed 30/30 compatibility cases and 5/5 Chromium PWA offline cases; this remains engine-only support. `npm run check` passed. `npm run test:regression` passed 360/360.

## Workflow follow-up

- Archive only after the requested branded browser workflows have named, versioned outcomes or the user accepts the remaining partial/unverified status.
