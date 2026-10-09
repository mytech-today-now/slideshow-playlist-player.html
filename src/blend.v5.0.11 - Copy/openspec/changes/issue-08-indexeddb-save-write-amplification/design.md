# Design

## Context

See `proposal.md` for the motivation and `specs/experience-persistence/spec.md` for the save guarantees. The persistence module reads each of six stores inside one readwrite transaction, merges by primary key, and currently puts every merged row. Callers provide base and local snapshots, and the module reads the current snapshot under the transaction.

## Goals / Non-Goals

**Goals:**

- Measure synthetic snapshots in Node and real IndexedDB transactions in Chromium before changing the merge behavior.
- Preserve the current transaction scope, revision increment, conflict list, and merged result while avoiding puts for rows the merge retained unchanged.
- Keep benchmark diagnostics limited to counts, payload bytes, durations, and memory values.

**Non-Goals:**

- Avoiding whole-store reads or changing the concurrency model. The current snapshots do not carry a trustworthy per-key change set, so skipping reads would weaken conflict detection without a separate design.
- Changing database schema, record formats, save UI, retry/export recovery, or other app versions.
- Defining a product latency budget that the repository does not currently specify.

## Decisions

1. **Measure the existing algorithm with realistic row shapes.** Use 1,000 and 10,000 library records and a 20,000-record stress fixture. Scale directory roots by the documented 250-file import batch; use one row each for settings and both list stores, with realistic arrays inside list rows, and a synthetic experience catalog. Include record totals, serialized fixture bytes, reads, merge entries visited, queued writes, p50/p95 latency, and available heap measurements. The larger stress fixture is not a claim that 20,000 is a product limit.

2. **Derive queued writes from the merge decision.** A merged record selected from the current snapshot needs no write. A local addition or a local edit against an unchanged current row needs a put; a merged deletion of an existing current row needs a delete. If both tabs made the same edit, retain the current row without rewriting it. Keep explicit experience deletions and the revision put in the existing transaction. Recomputing equality after the merge was rejected because it would add another full comparison pass. When a merge compares a record reference with itself, validate its serialization once and avoid normalizing and serializing the same value twice.

3. **Keep the six-store transaction and full conflict scan.** All reads, merge decisions, changed-row writes, explicit deletes, and one revision update remain in the same readwrite transaction. Per-key transactions and cached revisions were rejected because they would change the conflict/atomicity model and require schema or synchronization work.

4. **Treat benchmark timing as evidence, not a product SLO.** Emit machine-readable metrics with synthetic fixture counts only. Since no product save-latency target is defined, report timing and write reductions without labeling an arbitrary threshold as a product pass.

## Risks / Trade-offs

- [The code may miss a write for a merged local edit] → Derive operations at the same branch that chooses each merged value, then test additions, edits, deletions, same-result concurrent edits, and conflicts.
- [Benchmark timing varies by browser and hardware] → Report fixture size and measurement environment; use operation counts as deterministic regression assertions.
- [Full-store reads and comparisons remain proportional to snapshot size] → Preserve them for conflict safety and state this remaining cost explicitly; consider a separately specified revision/change-set design only if later measurements justify it.

## Migration Plan

No schema or data migration is needed. If verification fails, revert the changed-row queueing logic while retaining the synthetic benchmark coverage; persisted formats and transaction boundaries are unchanged.
