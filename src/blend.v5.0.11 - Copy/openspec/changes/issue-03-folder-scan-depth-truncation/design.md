# Design

## Context

The recursive directory walker is shared by Add Folder and missing-media relinking. It currently records read errors in `skippedBranches`, but has no summary field for child directories ignored at `MAX_FOLDER_DEPTH`. Keep the depth at six and preserve the current discovered-handle and retry contracts.

## Goals / Non-Goals

**Goals:**
- Keep depth skips distinct from read failures in the summary and logs.
- Prevent depth-truncated work from reaching either consumer as a complete or empty scan.
- Provide a single status toast with a keyboard-operable folder-selection action and mobile-safe wrapping.
- Prove boundary behavior, deeper-root recovery, persistence, and existing outcomes with synthetic directory handles.

**Non-Goals:**
- Changing the depth cap, persisting scan summaries, or changing IndexedDB schemas.
- Enumerating skipped folders, collecting their names or paths, or adding dependencies.

## Decisions

- Add a saturating `skippedDepthBranches` count to the walker summary. Increment it for each child directory encountered at the cap, leave `skippedBranches` for read errors, and mark an otherwise complete scan partial whenever either count is nonzero. Saturation at `Number.MAX_SAFE_INTEGER` keeps the counter bounded without affecting realistic folder trees.
- Log depth truncation once with only the operation and count. Keep read-error logs limited to the existing allowlisted error name and operation; do not log paths or entry names.
- Build the folder-import status toast from the separate counts. Keep the existing retry action for read failures and add a “Choose deeper folder” action for depth skips that reuses `addFolderFromPicker`; a selected descendant becomes a normal new scan root and is persisted through the existing directory-handle path.
- Apply the same partial-status distinction to missing-media scans, which share the walker, so they cannot report completion after truncation.
- Give the directory-scan toast a bounded responsive width, wrap its message and actions, and retain a visible keyboard focus outline.

## Risks / Trade-offs

- The scanner cannot know whether an unvisited folder contains supported media without opening it. Count every directory entry skipped at the cap and describe it as a skipped folder, not as confirmed missing media.
- A user may select a deeper folder that still contains subfolders beyond the limit. The same partial notice and recovery action will remain available for each scan.
- A bounded counter can saturate only for an unrealistically large enumeration; all practical counts remain exact.

## Migration Plan

No data migration is needed. Existing directory handles and media records remain unchanged. Reverting the code restores the prior silent-depth-skip behavior without requiring persisted-state cleanup.
