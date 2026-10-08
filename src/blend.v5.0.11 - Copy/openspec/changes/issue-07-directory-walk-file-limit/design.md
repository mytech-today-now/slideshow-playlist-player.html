# Design

## Context

`walkDirectoryForMedia` currently keeps a breadth-first directory queue and every supported file handle until traversal ends. `addHandles` saves through the existing atomic experience snapshot after processing the complete array. The directory-input fallback also maps the full selected file list into handles before saving.

The uncapped Playwright baseline used synthetic files in a six-level tree. Importing 1,000 files completed in 10,703 ms; the first IndexedDB write began at 10,654 ms. The 10,000-file import did not reach its completion assertion within the 210,000 ms browser wait. The first benchmark's progress observer used the wrong toast selector, so it produced no valid progress-count measurement.

## Goals / Non-Goals

**Goals:**

- Bound application-retained folder media handles and the directory traversal stack.
- Commit the first supported batch as soon as the ceiling is reached, then count later supported files without retaining their handles.
- Preserve accurate counts, directory-root identity, duplicate checks, and the existing atomic save boundary.
- Keep progress perceivable and announce updates at a restrained interval.

**Non-Goals:**

- Changing per-file Add Files limits, persisted schemas, list formats, or media type support.
- Persisting a scan cursor or adding a cross-session continuation protocol.
- Replacing the existing IndexedDB snapshot transaction.

## Decisions

- Use `MAX_FOLDER_MEDIA_FILES = 250` as the single code limit. The 1,000-item baseline took 10.7 seconds to reach its first write, and the uncapped 10,000-item import exceeded the 210-second harness wait. The capped 250-item import reached its first write at 1,377 ms and completed at 1,456 ms, so the measured candidate was retained.
- Walk directories depth-first with async recursion. Since `MAX_FOLDER_DEPTH` remains six, active directory iterators are bounded by depth instead of by the number of sibling folders queued. Count every supported media file found, but allocate a path hint and retain a handle only until the first 250 are collected.
- In folder-picker scans, remember the selected root before walking. When the 250th handle is found, pass that one bounded batch to the existing `addHandles` save path and await its atomic snapshot. Continue walking to count pending media, without retaining later handles. If fewer than 250 files are found, import the retained array after traversal as today. The directory-input fallback similarly counts its browser-provided `FileList` and creates handles only for its first 250 supported files.
- Treat supported items beyond the imported batch as pending. For a fully traversed scan, `added + skipped + pending` equals supported media found; `skipped` includes items already present. Read errors and depth skips remain separate because media beneath unreadable or unvisited branches cannot be counted.
- Keep the existing picker as the recovery mechanism. The limited-result status offers a smaller-folder action; selecting a narrower root imports its files through the same persistence and duplicate checks. No scan cursor is persisted.
- Give the live progress toast `role="status"` and update it no more than once per second, with a final count update. The traversal continues yielding to the browser event loop; the capped-count message follows after the walk.

Corrected capped-path measurements from the synthetic six-level browser harness:

| Supported files found | Imported | Pending | First write | Total elapsed | Peak retained handles | Progress updates |
|---:|---:|---:|---:|---:|---:|---:|
| 250 | 250 | 0 | 1,227 ms | 1,388 ms | 250 | 2 |
| 1,000 | 250 | 750 | 1,066 ms | 2,780 ms | 250 | 3 |
| 10,000 | 250 | 9,750 | 1,121 ms | 9,108 ms | 250 | 10 |

The 10,000-file run announced progress ten times over 9.1 seconds and reported all discovered supported files. The heap sampler observed the test fixture as well as the app, so heap values are not used as an app-memory estimate; retained handles were measured at the folder collector's insertion and bounded-batch release points.

## Verification record

- `npm run check`: passed.
- `npm run test:regression`: Node's test runner could not spawn workers in this environment (`spawn EPERM`) before assertions ran. The serial fallback ran all 27 regression files with `node --test --test-isolation=none`; 27 passed and 0 failed.
- `npm run test:e2e`: 131 passed and 22 failed out of 153 with six workers. Failures span storage, experience import, picker, sharing/auth, and service-worker cases; this run does not establish that they are caused by this folder-scan change.
- Focused one-worker E2E for directory scans, picker identity, and local import bounds: 18 passed and 1 failed. All 10 directory-scan cases and all 4 picker-identity cases passed. The remaining 10 MiB JSON-boundary case timed out waiting for the experience-import file chooser during keyboard activation; normal legacy JSON/JSONL imports passed. The byte-limit implementation was not changed, but this browser assertion remains unverified in this run.
- The directory-scan E2E includes the seven requested viewport sizes, keyboard focus, status announcements, folder-input fallback, count boundaries, persistence, cancellation, read errors, depth truncation, and duplicate-free narrower-folder recovery.
- `openspec validate issue-07-directory-walk-file-limit`: passed. No actual screen-reader audit was run.

## Risks / Trade-offs

- **[A broad tree still takes time to enumerate]** → Retain only bounded handles, keep the traversal stack bounded, yield during enumeration, and report exact pending counts; benchmark the 10,000-file scan after capping imports.
- **[A 250-item batch may still be slow on weaker devices]** → Measure the capped 250-item import in Chromium and lower the single constant if it remains too long.
- **[A flat folder may not have a smaller child folder]** → The recovery copy also permits choosing another folder; per-file selection remains available for a user to select a smaller group.
- **[A late scan cancellation occurs after the first batch was committed]** → Preserve the committed batch and use the existing cancellation status for the remaining discovered files.

## Migration Plan

No data migration is needed. Each bounded batch uses the existing snapshot save and directory-handle store. Rolling back the code removes the folder count ceiling without changing stored records.
