# Design

## Context

See `proposal.md` for motivation and `specs/indexeddb-forward-compatibility/spec.md` for the behavior contract. Compatible databases are opened after validating required stores and key paths. Snapshot persistence reads the six snapshot stores and performs conflict checks and changed-row writes in one read-write transaction.

## Goals / Non-Goals

**Goals:**
- Retain unknown top-level properties from the same existing library row when an older app version writes its known serialized values.
- Keep the preservation source read in the same transaction as the write.
- Keep read, merge, and transaction failures on the existing reject-and-recover path.

**Non-Goals:**
- Change database version, migrations, object-store key paths, or known-field serialization.
- Make the whole database read-only or add a schema migration framework.
- Preserve nested unknown properties inside fields that this version itself replaces, such as a known metadata object.

## Decisions

- For a local library row, build the merge candidate from the current transaction row, falling back to the previously read base row if the current row is absent, then overlay the old app's serialized row. This lets current app values win while retaining additional top-level properties. Run this before conflict comparison so the value selected for the committed snapshot and the value written by `put` both carry the preserved fields.
- Limit this behavior to `library`, the store with a fixed app-side record projection identified by the report. Other stores keep their existing merge behavior.
- Keep the existing transaction as the safety boundary. All reads finish before merged writes are queued; an error aborts the transaction, leaving all six stores and the revision unchanged. Existing save failure UI supplies Retry and Export Backup.
- Prefer the transactional merge over rejecting all writes to a compatible newer database. A successful merge keeps the app editable; changing `DB_VERSION` would require coordinated migrations without addressing the unknown-field write itself.

## Risks / Trade-offs

- Unknown nested properties under a known field that the current app replaces are outside this top-level merge. The regression fixture covers a distinct future top-level field containing a nested object.
- If a transaction read or write fails, edits remain in memory and the existing save failure notice provides retry and export; the original transaction remains uncommitted.
- Future store-level key-path changes remain incompatible and are rejected by the existing validation path.

## Migration Plan

No migration is required. Rollback consists of reverting the library merge branch and keeping current transaction failure handling. `DB_VERSION` and migration callbacks remain unchanged.
