# Tasks

## 1. Branded desktop smoke procedure and evidence

- [x] 1.1 Add the bounded synthetic-media workflow and per-browser result fields beside the README compatibility matrix; verify each unrun target remains partial and engine evidence stays separately labeled.
- [ ] 1.2 Run the workflow in each available branded desktop browser with a disposable profile and the same synthetic H.264 video; record exact browser and OS versions plus import/save, decode/playback, fullscreen, offline reload, and persistence outcomes. Keep unavailable or blocked targets not run and unverified.

## 2. Verification and tracking

- [x] 2.1 Run the focused browser-compatibility Playwright spec where the runner permits, then `npm run check` and `npm run test:regression`; record exact commands, outcomes, and any report artifact without translating engine results into branded passes.
- [x] 2.2 Validate this OpenSpec change and inspect the final diff and working tree; verify the pre-existing Issue 14 edit remains intact.

## Workflow follow-up

- Archive only after the requested branded browser workflows have named, versioned outcomes or the user accepts the remaining partial/unverified status.
