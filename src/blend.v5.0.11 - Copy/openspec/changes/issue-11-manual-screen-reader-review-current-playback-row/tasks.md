# Tasks

## 1. Automated baseline

- [x] 1.1 Run the syntax check, regression suite, current-playback accessibility E2E spec, responsiveness matrix, and focused keyboard/touch E2E checks; verify the current marker, independent selection, unavailable description, pause/stop, experience switch, and responsive overflow behavior. Results: `npm run check` passed; `npm run test:regression` hit `spawn EPERM`, then the serial fallback passed 286/286; focused accessibility and responsiveness E2E passed 9/9; focused keyboard/touch E2E passed 2/2.

## 2. Human screen-reader review

- [ ] 2.1 With a supported desktop screen-reader/browser pairing, exercise Playlist and Slideshow play, advance, previous, list switch, pause, stop, unavailable rows, experience switch, and virtualized rows; record the exact spoken output and identify any duplicate announcements.

## 3. Evidence-based mitigation

- [ ] 3.1 If task 2.1 demonstrates that native `aria-current` is insufficient, implement the smallest semantic or polite-status fix and verify it does not repeat on ordinary list rerenders; otherwise record that no code fix was indicated.

## 4. Documentation

- [ ] 4.1 Update the README Accessibility section with only the browser, screen reader, and state transitions actually tested; confirm DOM tests are not described as a human screen-reader audit or WCAG conformance.
