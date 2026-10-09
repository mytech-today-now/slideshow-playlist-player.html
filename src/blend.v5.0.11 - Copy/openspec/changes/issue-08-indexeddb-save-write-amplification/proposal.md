# Proposal

## Why

Ordinary experience saves currently read and merge every snapshot store, then queue puts for every merged row. This may create substantial write amplification as libraries grow, but the user impact has not been measured; establish a repeatable baseline before changing the persistence algorithm.

## What Changes

- Add synthetic Node and browser benchmarks for 1,000 and 10,000 library items, plus a 20,000-item stress case because the app documents support for 10,000+ items but does not define a hard maximum.
- Report fixture record and payload counts, `getAll` reads, merge entries, queued writes, p50/p95 save duration, and available heap measurements. Keep performance output free of file paths and URLs.
- If measurements confirm avoidable write amplification, queue only changed records and explicit deletions from the existing merge decision. Preserve the six-store transaction, revision handling, conflict detection, remote-deletion protection, rollback, migration, and save recovery behavior.

## Capabilities

### New Capabilities

- `experience-persistence`: Atomic multi-store snapshots merge disjoint edits, reject conflicting edits, and avoid rewriting unchanged rows.

### Modified Capabilities

None.

## Impact

The implementation is in `experience-persistence.js`. Regression and browser coverage will use `tests/regression/experience-persistence.test.mjs` and new benchmark/E2E files. No schema, runtime dependency, public format, or UI change is planned. The repository has no defined product-level save-latency target, so benchmark measurements will be reported without claiming a target pass.
