# Proposal

## Why

Clear Browser Storage currently materializes every non-thumbnail IndexedDB record in memory before changing the local session or deleting the database. That scaling behavior is confirmed by the source and README; the claim that larger user libraries make reset unacceptably slow or unavailable is a testable assumption. The user accepted the measured synthetic baseline, so this change records the evidence and strengthens failure coverage without changing reset behavior.

## What Changes

- Measure snapshot time and peak Chromium heap for small, typical, and large synthetic authored-record profiles.
- Assert that database deletion starts only after the recovery snapshot transaction completes.
- Inject a read-transaction abort in each protected store and verify that saved data and the local session remain intact with the existing incomplete status.
- Preserve the existing reset implementation and leave profiles larger than the accepted test profile explicitly unmeasured.

## Capabilities

### New Capabilities

None. This change adds tests and evidence only; it does not change product behavior.

### Modified Capabilities

None. The change sets `skip_specs: true` because no system requirement changes.

## Impact

The work affects `tests/e2e/clear-browser-storage.e2e.spec.mjs` and this OpenSpec record. It adds no runtime dependency, database migration, persisted format, or production code change. The Beads record is `blend-d58`; source artifact: user attachment `Pasted text.txt`, Issue 17.
