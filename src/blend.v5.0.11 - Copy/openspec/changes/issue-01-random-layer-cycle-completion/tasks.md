# Tasks

## 1. Pure random-cycle selection

- [x] 1.1 Extend the pure next-index helper with optional visited indices and a terminal result for an exhausted non-wrapping cycle; add two-item, one-item, wrap, empty-list, and existing sequential regression cases in `tests/regression/playback-mode-ui-contract.test.mjs`.

## 2. Experience completion and accessible behavior

- [x] 2.1 Track volatile Playlist and Slideshow cycles in `app.js`; reserve and preload only the next unvisited item, route only an exhausted effective end-target cycle through `markLayerComplete`, restart non-target and manual-Next cycles, and fail closed on malformed cycle state. Verify with focused regression assertions and E2E coverage for both targets, Stop, Loop, Next Experience, manual Next, companion visibility, a single completion announcement, and no cycle-end media/signed-URL requests.
- [x] 2.2 Explain the one-pass cycle and reload fallback beside Experience end target and both order controls, associate the text with those selects, and announce the exact cycle-boundary status through the existing toast. Verify keyboard-accessible control descriptions and the status text in regression/E2E assertions.

## 3. Cached app update and acceptance checks

- [x] 3.1 Advance the shared PWA asset/cache generation and synchronize versioned app/module, resume-module, manifest, and icon URLs; verify with `tests/regression/pwa-config.test.mjs` and inspect that `service-worker.js` and `sw.js` cache policies remain unchanged.
- [x] 3.2 Run `npm run check`, the focused playback and PWA regression files, and `npx playwright test --config=playwright.config.mjs tests/e2e/experience-end-target.e2e.spec.mjs`; record actual outcomes and any environment limitation.

Verification: `npm run check` passed; focused playback and PWA regressions passed (16/16); focused end-target Playwright suite passed (15/15). The initial sandboxed Playwright attempt stopped at `spawn EPERM`; the same command passed with elevated process access. `openspec validate issue-01-random-layer-cycle-completion` passed.

## Workflow follow-up

- Close Beads issue `blend-3va` only after implementation and acceptance checks are complete. Leave the OpenSpec change available for review and archive it only through a separate archive action.
