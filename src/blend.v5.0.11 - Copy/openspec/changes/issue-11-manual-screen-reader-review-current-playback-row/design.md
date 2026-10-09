# Design

## Context

See `proposal.md` for the verification gap. The existing row renderer labels the list and item position, sets `aria-current` only for the loaded runtime item, uses an independent pressed control for selection, and describes unavailable items with `aria-describedby`. Rows are virtualized. The in-app browser and local NVDA/Firefox executables are not currently available in this environment.

## Goals / Non-Goals

**Goals:**

- Review actual spoken output before changing announcement behavior.
- Keep automated DOM evidence and human assistive-technology evidence distinct.
- Preserve current selection, availability, virtual-position, keyboard, and focus behavior.

**Non-Goals:**

- Adding a live region based only on a theoretical concern.
- Claiming a screen-reader audit, WCAG conformance, or coverage for an untested browser/AT pairing.
- Changing stored data, dependencies, or other app versions.

## Decisions

- Keep native `aria-current` as the current implementation unless a human review records a concrete announcement failure. A polite status adjacent to list controls is the narrow fallback if the active row cannot be identified in a supported pairing.
- Test the existing Playwright accessibility spec and responsiveness checks over HTTP. These prove rendered DOM and interaction state only; they do not substitute for speech output.
- Record browser, screen reader, state transitions, and exact observed speech in README only after those checks have actually run. If no supported pairing is available, retain an explicit outstanding-review statement.

## Risks / Trade-offs

- [Risk] No local screen reader/browser pairing may be available, leaving the central acceptance criterion open. → Record the unavailable environment and leave the issue in progress; do not infer speech quality from DOM assertions.
- [Risk] A future announcement could repeat on virtual-list rerenders. → Add one only after a reproduced human-review failure and verify that it changes only on playback state transitions.

## Migration Plan

No migration. If review produces a concrete deficiency, implement the smallest evidenced semantic or polite-status change, then rerun the focused browser checks and record the exact manual review coverage. Otherwise retain the current behavior and document the actual review result.
