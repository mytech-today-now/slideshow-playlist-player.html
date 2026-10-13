# Proposal

## Why

The directory walker currently awaits `requestAnimationFrame` after each 24 entries. That source behavior is confirmed; whether a particular browser throttles or suspends those frames in a hidden tab is a testable assumption that varies by browser. A long scan can therefore appear stalled without telling the user how to continue or cancel it.

## What Changes

- Replace the scan's animation-frame yield with an injectable visibility-aware task helper that announces a pause while the document is hidden and resumes the same directory iterator when visible.
- Add a keyboard-accessible cancel action to the scan status. Cancellation or permission loss returns a partial result and keeps committed batches and discovered files.
- Add focused regression and browser coverage for visibility changes, cancellation, permission loss, progress, and duplicate prevention.
- Preserve the 250-file limit, batch persistence, depth rules, live progress, and import formats.

## Capabilities

### New Capabilities

- `directory-scan-lifecycle`: Defines visible pause, resume, cancellation, partial-result, and saved-batch behavior for long directory scans.

### Modified Capabilities

None.

## Impact

The change affects `app.js`, a small side-effect-free visibility-yield module, the package syntax-check list, and directory-scan regression/E2E coverage. It adds no runtime dependency and changes no persisted format. Source finding: `ai-prompts/pre-mortem-2026-10-12-00-11-24.html`, Issue 16; Beads record: `blend-4kn`.
