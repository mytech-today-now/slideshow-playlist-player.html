# Design

## Context

See `proposal.md` for the confirmed asynchronous callback gap and the testable, un-reproduced failure assumption. The thumbnail queue already releases a slot in its job `finally` block once `generateThumbnail()` settles. The helpers are private functions in the browser-only `app.js` orchestrator.

## Goals / Non-Goals

**Goals:**

- Settle each image/video helper once after a result, callback exception, media error, or deadline.
- Attempt every cleanup action even if another cleanup operation throws.
- Keep media playback, library rows, lazy thumbnail generation, cached Blobs, the bounded object URL cache, and the media icon fallback intact.
- Verify helper outcomes, queue recovery, cleanup, persistence-visible rows, playback, and browser console behavior with fault injection.

**Non-Goals:**

- Changing import/export data, IndexedDB schema, thumbnail cache keys, playback URL resolution, or PWA cache policy.
- Adding a thumbnail service, runtime dependency, or broad library refactor.
- Claiming that local browser tests reproduce a live browser/provider defect.

## Decisions

- Keep the two helpers in `app.js` and give each its own `settled` guard, cleanup closure, and 10-second default deadline. A deadline covers media events and a `toBlob` callback that never arrives; a small optional timeout argument exists for deterministic browser tests.
- Catch work inside each asynchronous callback. Resolve `null` for null canvas contexts, media errors, callback exceptions, and timeouts so an optional preview never rejects playback or library workflows.
- Clear callback properties and the source, then pause/load/remove video elements. Clear image handlers and source and remove the detached image. Run cleanup operations independently and settle even if an operation fails.
- Keep queue scheduling unchanged: the job's existing `finally` remains the single place that removes the in-flight request and decrements active work. Add a test-only queue snapshot only when the existing `__BLEND_TEST_HOOKS__` object is present.
- Log only a sanitized error type for callback and cleanup exceptions. Keep expected null results and media errors on the existing icon fallback path.
- Keep the implementation in `app.js` instead of extracting a new runtime module. This avoids an extra static/PWA asset and preserves the current static-app loading contract while the existing E2E harness exercises the private helpers through the established test hook pattern.

## Risks / Trade-offs

- A 10-second deadline could suppress a valid preview from unusually slow local media. Fault tests use a short per-call deadline; production remains bounded, and the deadline can be tuned from measured slow-preview evidence without removing settlement or cleanup.
- Browser fault injection exercises the local engines and fixture server, not every device, codec, or deployed environment.
- The report's claim that a rare browser canvas failure has occurred remains a testable assumption; no spontaneous production failure is asserted.

## Migration Plan

No persisted data or schema migration is needed. Rollback restores the original two helpers and removes the focused test hook, browser spec/config entry, and this OpenSpec change. Keep the existing thumbnail queue, cache, object URL handling, and playback paths intact.
