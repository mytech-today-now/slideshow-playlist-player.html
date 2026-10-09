# Design

## Context

The current project root is the folder containing `AGENTS.md`, `README.md`, `CLAUDE.md`, `package.json`, and `index.html`. The neighboring `../blend.v5.0.11/` directory was verified as a separate folder with its own project documentation and package; the `../blend.v5.0.10/` version folder is also present. No local evidence establishes where this standalone review target should be copied for release.

## Goals / Non-Goals

**Goals:**

- Make local file and command references resolve from this project root.
- Keep the canonical upstream repository and release-folder links clearly labeled as upstream references.
- Preserve the app's version facts and no-build architecture guidance.

**Non-Goals:**

- Change runtime behavior, package scripts, version/cache values, or parent and sibling app files.
- Add a documentation test; the existing regression suite has no README/CLAUDE contract assertion pattern.

## Decisions

- Use paths such as `index.html`, `package.json`, and `tests/...` for files in this project. Refer to the verified neighbor as `../blend.v5.0.11/` only to identify it as separate, not as the target to edit.
- State that this folder is a standalone review target and that its release destination must be confirmed before copying changes. This follows the requested fallback because no release-destination record was found.
- Keep the existing GitHub link to `src/blend.v5.0.11` as the canonical upstream release-folder link; label it so it cannot be mistaken for this checkout's active root.
- Validate documentation paths and package scripts manually, then run `npm run check` and `npm run test:regression` from this project root. Do not add a test solely for documentation where no matching test pattern exists.

## Risks / Trade-offs

- A relative sibling reference can become stale if the checkout is moved. Keep the active target anchored by the containing `package.json` and entry point, and retain the upstream link for the canonical release copy.
- Existing unrelated README edits are already present. Change only the stale project-root references and review the diff to preserve those edits.

## Migration Plan

No runtime migration is needed. Edit the local documentation and revert only those documentation hunks if review rejects the change; leave parent and sibling folders untouched.
