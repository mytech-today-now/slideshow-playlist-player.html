# Proposal

## Why

The local `AGENTS.md` makes this self-contained checkout the work target, but `README.md` and `CLAUDE.md` direct contributors to the sibling `blend.v5.0.11` directory. That conflict can send documentation, code, and test changes to the wrong copy.

## What Changes

- Identify the project root containing this README, `CLAUDE.md`, and `package.json` as the active target for this checkout.
- Make README entry paths, project structure, serve instructions, and package commands relative to this project root.
- Describe the existing `../blend.v5.0.11/` sibling as a separate version folder, preserve valid upstream links and release facts, and state that the release destination for this standalone review target must be confirmed before copying changes.
- Align `CLAUDE.md` project layout, commands, and release guidance with the same scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is documentation-only work and does not change product behavior.

## Impact

Only local project documentation changes: `README.md` and `CLAUDE.md`. No runtime code, dependencies, formats, or parent/sibling app files are in scope.
