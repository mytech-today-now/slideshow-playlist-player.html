# Design

## Context

Both Add Files paths converge on `addHandles`, while folder scans have an independent 250-media limit. The input fallback filters unsupported extensions before producing handles. See `proposal.md` and `specs/direct-file-import-limits/spec.md` for the behavior contract.

## Goals / Non-Goals

**Goals:**
- Share a unit-testable 250-file limit between folder scans and direct multi-file selection without changing the folder rule.
- Reject oversized direct selections before `addHandles` runs.
- Keep successful direct imports committed when one handle cannot be read, and make retry target only failed handles.
- Confirm a failed persistence attempt retains the imported in-memory rows and the existing save retry persists them without duplication.

**Non-Goals:**
- Splitting an oversized selection into multiple batches or adding a consent flow.
- Changing persistence formats, duplicate identity rules, single-file entry points, or folder scan semantics.
- Claiming that the reported latency, memory, or quota impact has been reproduced.

## Decisions

1. **Reject the whole selection above 250.** A shared count helper returns selected, accepted, remaining, and within-limit values. Above the cap it reports zero accepted and all selected files remaining. This avoids import mutation and is simpler to explain than consent-driven chunking; the trade-off is that the user must make a smaller selection.
2. **Gate all direct picker routes before import.** Native picker results, its untyped retry, and the input fallback use the same check. The count is computed before the import loop. Under-limit arrays retain their original order and continue through existing media and duplicate handling.
3. **Keep folder and direct caps aligned through one constant.** `MAX_FOLDER_MEDIA_FILES` will reference the shared 250-file constant; folder traversal still counts supported media and retains its current partial-result and smaller-folder recovery behavior.
4. **Make direct imports resilient to one unreadable handle.** An opt-in `addHandles` mode will verify each direct handle, record failures without interrupting the loop, save successful rows once, and return the failed handles to a direct-import status with a retry action. Other `addHandles` callers retain their current per-file behavior. Retrying only failed handles avoids reprocessing and duplicating successful rows.
5. **Reuse the existing save recovery for quota failures.** A failed snapshot already retains live state and exposes a save-status Retry action. Tests will inject a one-shot persistence failure after a direct batch and verify that retry saves the rows without adding them again; no new persistence path is needed.
6. **Exercise the synthetic picker routes in the configured browser engines.** Focused E2E tests will mock `showOpenFilePicker` for the native code path and use Playwright's file chooser for the input path. The existing browser-compatibility project filter will include this focused spec for Chromium, Firefox, and WebKit; this verifies app behavior with synthetic selections, not OS picker UI or branded/mobile browsers.
7. **Refresh the static asset and cache generation with the app/module update.** The service worker precaches versioned module URLs and serves scripts stale-while-revalidate. Advance the shared asset/cache token and its HTML, manifest, documentation, and app import references together so an installed app cannot pair the new `app.js` with a cached copy of `local-import-limits.js` that lacks the new export.

## Risks / Trade-offs

- [Users may routinely select more than 250 items] → Show the limit and exact counts and allow smaller selections or a smaller folder.
- [A handle may become unreadable after preflight] → Preserve the current `addHandles` behavior for every non-direct caller and offer retry only for failures observed during direct processing.
- [Synthetic handles do not prove native picker integration with the operating system] → Keep the test claim limited to the application code path and retain manual browser picker verification as a release check.

## Migration Plan

No migration is required. Roll back only the direct-selection gate and its failure retry wiring if the 250-file policy blocks normal use; do not remove rows already committed by successful imports.
