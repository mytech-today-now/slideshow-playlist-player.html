# Proposal

## Why

This version can open a structurally compatible IndexedDB database whose version is newer than its own. When it saves a library row, its fixed field projection can replace future-version fields on that row. The report's future extra field is a testable assumption; no current user data loss is established.

## What Changes

- Preserve unknown top-level fields on existing library records when this version writes its known fields inside the current atomic snapshot transaction.
- Keep a compatible newer database readable and editable when the preservation merge succeeds; abort the transaction and retain retry/export recovery if the read or merge fails.
- Add synthetic newer-schema regression and E2E coverage, including incompatible-key-path recovery and transaction rollback.
- Keep `DB_VERSION`, migrations, known-field serialization, and the six-store transaction contract unchanged.

## Capabilities

### New Capabilities
- `indexeddb-forward-compatibility`: safely retain data in records from compatible newer IndexedDB schemas when an older app version saves.

### Modified Capabilities

## Impact

The persistence merge in `experience-persistence.js` and its regression tests change. The newer-schema Playwright fixture and assertions change. `app.js` keeps its current serializer and error recovery path; `pwa-config.js` keeps the current database version and migration coordination. No runtime dependency or stored schema change is introduced.
