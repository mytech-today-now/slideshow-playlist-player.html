# Proposal

## Why

The recorded 10 MiB experience-import run timed out waiting for Playwright's file chooser before reaching the import assertion. The boundary spec currently runs list-picker cases immediately before experience-picker cases, so isolate the experience flow and reset keyboard focus to improve the regression signal without treating the harness timeout as a production import failure.

## What Changes

- Run the experience below-limit, exact-limit, and over-limit cases in their own Playwright test fixture, separate from list-picker interactions.
- Arm the file-chooser waiter before focus and keyboard activation, and clear stale focus before focusing the labeled import button.
- Keep assertions that the exact-limit file reaches the parser outcome and an oversized file leaves experience state unchanged.
- Leave the 10 MiB production contract and import implementation unchanged unless an import assertion reproduces a product failure.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change only improves regression-test setup and does not change a system behavior requirement. `.openspec.yaml` sets `skip_specs: true`.

## Impact

- `tests/e2e/local-import-bounds.e2e.spec.mjs`
- No runtime code, public contract, dependency, persistence, or data changes.

## Tracking

- Source report: `ai-prompts/pre-mortem-2026-10-13-14-11-28.html`, stable finding `issue-14`.
- Beads: `blend-djs` (in progress).
- Related evidence: `openspec/changes/issue-08-bounded-add-files-selection/tasks.md`, verification record lines 24-26.
