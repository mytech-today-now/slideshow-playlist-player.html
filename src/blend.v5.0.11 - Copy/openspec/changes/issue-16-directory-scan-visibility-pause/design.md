# Design

## Context

See `proposal.md` for the motivation and `specs/directory-scan-lifecycle/spec.md` for observable requirements. `walkDirectoryForMedia` is an async depth-first walker with a cooperative yield every 24 entries. `scanDirectoryWithProgress` owns its live status toast. `scanAndImportDirectory` persists a completed or partial result and already commits the retained batch at the 250-file bound.

## Goals / Non-Goals

**Goals:** Make the visibility wait and cancellation behavior deterministic to test without importing the browser-only orchestrator in Node. Keep directory traversal single-pass and retain the current bounded yield points.

**Non-Goals:** Parallel enumeration, a worker, persistence/schema changes, retries of already enumerated entries, or guarantees about browser/OS suspension that prevents all page script from running.

## Decisions

- Put the visibility-aware yield in a small side-effect-free module. Inject the task-yield function, visibility reader, and visibility subscription; the browser adapter supplies `setTimeout(0)` and `document.visibilitychange`. This avoids browser globals in regression tests and avoids `requestAnimationFrame` for scan progress.
- At each existing 24-entry boundary, yield to the task queue. If hidden, update the current `role="status"` toast with the specified pause text, then wait for visibility or the scan's `AbortSignal`. Resume the same async iterator after visibility returns.
- Give each scan one `AbortController` and a keyboard-operable Cancel scan button. Aborting the visibility wait returns control to the walker, which follows its existing canceled-result path. The normal import path then saves its remaining retained handles; the already committed 250-file batch is not re-enumerated.
- Keep the existing error classification and status summaries. A permission error after resume remains a partial scan, and the app never replaces that outcome with a success toast.

## Risks / Trade-offs

- A directory iterator operation that has not returned yet cannot be paused or canceled at the cooperative boundary. The scan pauses at the next completed boundary and preserves the partial-result path for permission/read failures.
- A browser or mobile OS may suspend the whole page. JavaScript cannot make progress during full suspension; when execution resumes, visibility state and the same iterator determine whether to continue or wait.
- The new cancel control adds one focus target to the live toast. Verify status semantics and keyboard activation in the focused E2E coverage.

## Migration Plan

No migration is needed because this change does not alter persisted records. If the scheduler reduces responsiveness or prevents prompt recovery, revert the helper wiring and keep the explicit paused status and cancellation result behavior.

## Open Questions

None.
