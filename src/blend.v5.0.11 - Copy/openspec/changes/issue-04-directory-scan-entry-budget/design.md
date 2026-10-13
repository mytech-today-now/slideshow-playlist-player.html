# Design

## Context

See `proposal.md` for the motivation and `specs/directory-scan-bounds/spec.md` for observable requirements. `walkDirectoryForMedia` already counts every yielded entry and yields to the task queue every 24 entries. Folder imports commit their first 250 supported media as one saved batch; missing-media scans use the same walker and have a separate supported-media stop condition.

## Goals / Non-Goals

**Goals:** Bound entries across the full recursive traversal, count the final visited entry accurately, and route cutoffs through the existing partial-result recovery paths without changing saved media or scan lifecycle behavior.

**Non-Goals:** Add an elapsed-time watchdog, persist a cursor for continuation, change the 250-media or six-level limits, or change the browser-provided directory-input fallback.

## Decisions

- Set `LOCAL_IMPORT_MAX_DIRECTORY_SCAN_ENTRIES` to 2,000. A synthetic unsupported-file iterator using the existing cooperative yield measured 597 ms for 1,000 entries, 1,237 ms for 2,000, 3,136 ms for 5,000, and 6,415 ms for 10,000 in this Node environment. The 2,000-entry budget is eight times the existing supported-media limit and requires at most 83 cooperative yield boundaries. These are local synthetic timings, not browser or device performance guarantees.
- Keep one visited-entry counter across recursive directory iterators. Count files and directories, supported and unsupported. Process the 2,000th entry, commit it if it completes the existing 250-media batch, then stop before fetching another entry or descending into a directory at the ceiling. Treat reaching the ceiling as partial because checking whether the tree ended exactly there would require visiting beyond the budget.
- Add an `entryLimitReached` summary flag distinct from the existing supported-media `limitReached` flag. Use the existing status toasts and retry controls: folder imports report counts for visited entries and offer “Choose smaller folder”; missing-media scans report that later entries were not inspected and preserve saved list references.
- Leave cooperative yielding, cancellation, visibility pause/resume, permission errors, depth reporting, and the existing batch-save boundary in place. The same directory iterator remains active across visibility pauses.

## Risks / Trade-offs

- **A valid folder can contain more than 2,000 entries before all supported media are reached** → Report the partial count, keep discovered media, and let the user scan a narrower folder.
- **A single browser iterator operation can take a long time even though total yielded entries are bounded** → Keep the existing Cancel scan control and avoid claiming an elapsed-time guarantee.
- **The local Node timing is not a real browser/device measurement** → Use the deterministic entry budget as the acceptance criterion and retain focused browser coverage for environments where Playwright can launch.

## Migration Plan

No data migration is needed. Rolling back the source change removes the traversal ceiling without changing persisted records; previously committed media remains available either way.
