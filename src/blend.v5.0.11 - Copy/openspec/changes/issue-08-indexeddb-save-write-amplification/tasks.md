# Tasks

## 1. Establish the Baseline

- [x] 1.1 Add a deterministic Node benchmark using synthetic library, directory-handle, experience, list, and settings rows at 1,000, 10,000, and 20,000 library items; report record/payload sizes, reads, merge entries, writes, p50/p95 duration, and heap measurements without logging item identifiers.
- [x] 1.2 Add a browser benchmark against real IndexedDB for a settings edit, list-entry edit, and library-item edit at each fixture size; assert serialized snapshots and record counts after every save, and report long tasks and available heap measurements.
- [x] 1.3 Run both baselines and record the measured write amplification and timing before changing persistence behavior.

## 2. Write Only Changed Rows

- [x] 2.1 Derive puts and deletes from merge decisions, queue only changed data rows plus the single revision update, and avoid duplicate normalization for shared record references; verify focused regression coverage for no-op rows, local edits/deletions, disjoint additions, identical concurrent edits, protected remote deletion, and conflicting edits.
- [x] 2.2 Keep the injected queued-write failure atomic across all six stores and verify save-state remains dirty/retryable after failure.
- [x] 2.3 Re-run the Node and browser benchmarks and compare operation counts, p50/p95 duration, heap measurements, serialized snapshots, and long tasks against the baseline.

## 3. Integration Verification

- [x] 3.1 Run `npm run check`, `npm run test:regression`, and focused concurrency and save-recovery E2E tests; record exact outcomes and any runner limitations.
- [x] 3.2 Validate the OpenSpec change and verify the linked Beads issue and final statuses.
