# Proposal

## Why

The current Playlist and Slideshow rows expose `aria-current`, and automated tests cover the DOM state, but the app has no recorded human screen-reader review. That leaves a verification gap in the main playback workflow; it is not evidence of a confirmed accessibility defect.

## What Changes

- Review the current playback row with a supported desktop screen reader and browser when available, covering navigation, pause, stop, list switching, unavailable items, experience switching, and virtualization.
- Record only speech and transitions that were actually observed. Preserve selection independence, unavailable-item descriptions, virtualized positions, keyboard behavior, and focus.
- Add an announcement only if the human review shows that native `aria-current` does not identify the current item or layer adequately.
- Update the README with the exact browser, screen reader, and states completed; do not claim a WCAG audit from DOM tests.

## Capabilities

### New Capabilities

None. This change is verification and documentation work; no new user-facing behavior is specified before human evidence exists.

### Modified Capabilities

None.

## Impact

Primary review targets are `app.js`, `README.md`, `styles.css`, and `tests/e2e/list-playback-accessibility.e2e.spec.mjs`. A code change is in scope only if observed screen-reader output demonstrates a specific deficiency. No persistence, schema, or dependency changes are expected.
