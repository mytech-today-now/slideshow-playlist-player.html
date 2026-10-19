# Proposal

## Why

The current lifecycle implementation has synthetic pause, resume, cancellation, and permission-loss coverage, but no current native tab run has exposed a hidden document. This change strengthens the regression evidence for saved batches and the paused status layout, then records native browser results without treating synthetic visibility as native proof.

## What Changes

- Add focused integration coverage for permission loss after a committed 250-media batch and verify partial results remain unique.
- Verify the paused scan status at the requested eight viewport sizes, including wrapping, overflow, keyboard focus, touch hit reachability, and clipping.
- Keep the active scan status and cancel action at the top of the open configuration panel so short viewports and the panel's focus trap can reach it.
- Run the syntax, regression, and focused visibility E2E checks; report native cases that skip as unverified and physical-device checks separately.
- Keep the scan scheduler unchanged unless a native lifecycle mismatch is reproduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The existing `directory-scan-lifecycle` specification already covers accessible pause status, same-iterator resume, saved batches, permission loss, cancellation, and the existing import limits. This change adds verification only; `skip_specs: true` records that no behavior contract changes.

## Impact

Changes are limited to scan status placement and touch/focus styling, directory-scan E2E coverage, and the OpenSpec/Beads tracking record. No scheduler, runtime dependency, persistence format, provider request, or report asset changes are planned.
