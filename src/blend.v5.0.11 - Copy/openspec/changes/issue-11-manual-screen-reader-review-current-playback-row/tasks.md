# Tasks

## 1. Automated baseline

- [x] 1.1 Run the syntax check, regression suite, current-playback accessibility E2E spec, responsiveness matrix, and focused keyboard/touch E2E checks; verify the current marker, independent selection, unavailable description, pause/stop, experience switch, and responsive overflow behavior. Results: `npm run check` passed; `npm run test:regression` hit `spawn EPERM`, then the serial fallback passed 286/286; focused accessibility and responsiveness E2E passed 9/9; focused keyboard/touch E2E passed 2/2.

## 2. Human screen-reader review

- [ ] 2.1 With a supported desktop screen-reader/browser pairing, exercise Playlist and Slideshow play, advance, previous, list switch, pause, stop, unavailable rows, experience switch, and virtualized rows; record the exact spoken output and identify any duplicate announcements.

## 3. Evidence-based mitigation

- [ ] 3.1 If task 2.1 demonstrates that native `aria-current` is insufficient, implement the smallest semantic or polite-status fix and verify it does not repeat on ordinary list rerenders; otherwise record that no code fix was indicated.

## 4. Documentation

- [x] 4.1 Update the README Accessibility section with only the browser, screen reader, and state transitions actually tested; confirm DOM tests are not described as a human screen-reader audit or WCAG conformance. The README records the Playwright Chromium DOM coverage and explicitly says it does not capture speech output; human review remains outstanding.

## Verification refresh (2026-10-12)

- `npm run check` passed; `npm run test:regression` passed 349/349.
- `npm run test:e2e -- tests/e2e/player-controls.e2e.spec.mjs` passed 12/12 in Chromium. `npm run test:e2e -- tests/e2e/responsiveness.e2e.spec.mjs` passed 7/7 in Chromium.
- `npm run test:e2e -- tests/e2e/list-playback-accessibility.e2e.spec.mjs` passed 1/2. The current-row navigation test failed at line 92 while waiting for the slideshow index to advance; an isolated rerun reproduced the same timeout. The page snapshot showed `Loading next slide…`. The experience-switch test passed. This is not spoken-output evidence and did not confirm a screen-reader defect.
- Environment checked: Microsoft Windows NT 10.0.26300.0 and Microsoft Edge 155.0.4283.45; NVDA was not found on PATH or in standard install locations checked. `C:\WINDOWS\System32\Narrator.exe` exists but was not running, and the Browser plugin reported no available browser sessions. No human speech-output review or actual 200% browser-zoom review was performed. Automated responsive checks are not a substitute for either manual review.
- The supplied README line references have drifted in this checkout: the current-row manual-review note is at `README.md:538`, and the separate manual disclosure check is at `README.md:739`.
- Tasks 2.1, 3.1, and 4.1 remain open. No app or README behavior change was made because no speech output was observed.

## Issue 10 verification refresh (2026-10-13)

- `npm run test:e2e -- tests/e2e/list-playback-accessibility.e2e.spec.mjs` exited 1 before test startup with `Error: spawn EPERM`; no browser assertions ran.
- `npm run check` passed. `npm run test:regression` passed 360/360.
- The manual speech audit was not run. Environment: Windows 10.0.26300.0; Microsoft Edge 155.0.4283.45 is installed; NVDA is unavailable on PATH; Narrator exists but was not running. This session has no browser-control or audio-capture tool, so exact spoken output could not be observed or recorded.
- Keep tasks 2.1, 3.1, and 4.1 open. No source or README behavior change is indicated without speech evidence.

## Issue 06 / source report Issue 10 verification refresh (2026-10-16)

- Environment for a possible manual run: Microsoft Windows 10 Home 26H2, build 26300 (`Microsoft Windows 10.0.26300`); Microsoft Edge 155.0.4283.45 is installed. NVDA was not found on PATH or in the standard locations checked. `C:\WINDOWS\System32\Narrator.exe` exists but was not running; its version was not collected. No active screen-reader/browser speech session was available, so this pairing was not used for a human review.
- Human matrix (screen reader: Not run; browser pairing: Not run; OS: Windows 10 Home 26H2, build 26300). In every row, the active-row content and exact spoken output were not observed, and duplicate detection was not run:

  | Action | Result | Spoken output / repeat check |
  |---|---|---|
  | Playlist play | Not run | Not observed / not run |
  | Slideshow play | Not run | Not observed / not run |
  | Playlist and Slideshow advance | Not run | Not observed / not run |
  | Playlist and Slideshow previous | Not run | Not observed / not run |
  | Switch Playlist and Slideshow lists | Not run | Not observed / not run |
  | Pause and resume | Not run | Not observed / not run |
  | Stop | Not run | Not observed / not run |
  | Unavailable item | Not run | Not observed / not run |
  | Experience switch | Not run | Not observed / not run |
  | Virtualized rows | Not run | Not observed / not run |
  | List update or ordinary row rerender | Not run | Not observed / not run |
  | Repeat actions to detect duplicate announcements | Not run | Not observed / not run |

- Automated checks completed: `npm run test:e2e -- tests/e2e/browser-compatibility.e2e.spec.mjs` passed 30/30 across Chromium, Firefox, and WebKit; `npm run test:e2e -- tests/e2e/list-playback-accessibility.e2e.spec.mjs` passed 2/2 in Chromium; `npm run check` passed; `npm run test:regression` passed 360/360. These checks assert DOM and engine behavior only and are not speech-output evidence.
- README Accessibility now names the current-row DOM test and its covered transitions, then distinguishes those assertions from the outstanding human speech review. No playback semantics were changed because no spoken-output defect was observed.
- Tasks 2.1 and 3.1 remain open. Task 4.1 is complete. Existing tracking remains OpenSpec `issue-11-manual-screen-reader-review-current-playback-row` and Beads `blend-v1h` (`in_progress`); no duplicate was created.
