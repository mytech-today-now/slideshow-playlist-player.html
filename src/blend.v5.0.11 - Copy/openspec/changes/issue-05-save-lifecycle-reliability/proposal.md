# Proposal

## Why

The app can await and report completed IndexedDB snapshot writes for controlled experience transitions, while browser shutdown may interrupt a pagehide flush. The existing behavior is appropriately bounded, but regression coverage should make revision timing, transition ordering, and shutdown limits explicit.

## What Changes

- Specify truthful pending, saving, saved, and failed status around atomic snapshot completion.
- Add deterministic save-coordinator and reload-boundary coverage without treating pagehide as a durability guarantee.
- Document that browser shutdown flushes are best effort and keep the accessible retry/export recovery copy.

## Capabilities

### New Capabilities

- `save-lifecycle`: Dirty revision status, app-controlled transition ordering, and best-effort browser shutdown behavior.

### Modified Capabilities

None.

## Impact

The change is limited to the save coordinator regression tests, save lifecycle E2E coverage, and persistence guidance in `README.md`. Production persistence logic changes only if focused evidence reveals a contract gap. No database schema, snapshot format, runtime dependency, or six-store atomicity change is planned.
