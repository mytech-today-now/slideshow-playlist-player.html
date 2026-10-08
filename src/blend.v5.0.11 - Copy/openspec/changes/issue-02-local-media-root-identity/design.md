# Design

## Context

The app already persists a generated `directoryId` with local media and persists directory records in the `dirHandles` store. Today directory records are reused by display name, and local identity comparison only sees normalized path hints. See `proposal.md` and `specs/local-media-identity/spec.md` for the behavior contract.

## Goals / Non-Goals

**Goals:**

- Reuse existing `directoryId` as the opaque selected-root identity.
- Prove a selected directory is an existing root only by handle reference or `isSameEntry`.
- Keep uncertain local items and their playlist references without merging.
- Keep filesystem paths out of new persisted and exported identity data.

**Non-Goals:**

- Add a database migration, a new persistence field, or an export schema change.
- Hash file contents or infer identity from size, timestamps, names, or OS paths.
- Change unrelated relinking fallback behavior beyond preserving path case.

## Decisions

1. **Use directory IDs as root identity.** A directory record's already-persisted opaque ID is attached to each imported library item. This avoids a schema bump and leaves visible `pathHint` values unchanged. Absolute paths and content fingerprints were rejected because they expose private state or add cost without proving that two directory handles refer to the same root.
2. **Reuse roots only with explicit handle proof.** `rememberDirectoryHandle` checks object identity first, then calls `isSameEntry` when available. A failed or unavailable comparison creates a new ID. Name matching is rejected because two roots may share a display name.
3. **Require root plus exact-case path for local deduplication.** Local items merge only when both directory IDs match and their safe relative paths match with case preserved. `normalizeRelinkPath` continues slash/traversal normalization but does not lowercase. Remote items continue to use normalized source URL identity.
4. **Keep ambiguous candidates and explain the choice.** Same relative paths without matching proven root identities remain separate. The explanation is a wrapping, keyboard-focusable status toast with a long enough timeout to be reached without stealing focus.

## Risks / Trade-offs

- [Some browsers or synthetic handles cannot prove root sameness] → Keep another directory ID and allow duplicate items; do not merge by name.
- [Case-sensitive path matching can reduce auto-dedup or relink matches on case-insensitive filesystems] → Prefer preserving data over a false merge; use the existing explicit relink chooser when exact path matching is unavailable.
- [Legacy records lack directory IDs] → Keep accepting them and do not treat a path-only match as proof of duplicate identity.

## Migration Plan

No migration is needed. Existing records remain readable; future folder imports create or reuse opaque directory IDs and persist them through the current directory record and library fields. Reverting the code leaves those optional existing fields harmless.
