# Issue 08 benchmark report

Captured before changing `experience-persistence.js` with synthetic metadata only. The Node harness uses an operation-counting IndexedDB double; the Playwright harness uses real IndexedDB in its default headless browser against the same module. Neither is a production incident or a device-wide performance guarantee.

## Fixture and method

| Library items | Total snapshot rows | Serialized payload bytes | Directory rows | Experience rows |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,017 | 275,364 | 4 | 10 |
| 10,000 | 10,143 | 2,749,678 | 40 | 100 |
| 20,000 stress case | 20,283 | 5,499,218 | 80 | 200 |

Each fixture has one settings row and one row per list store; each list contains one quarter of the library. Synthetic directory rows scale at the documented 250-file import batch. Experience catalog rows scale at one per 100 library items. The app documents 10,000+ items but no hard maximum; 20,000 is a stress case, not a supported limit.

Each of three scenarios (one setting edit, one playlist-entry edit, and one library metadata edit) ran three times per fixture. p50 is the middle sample; with three samples, nearest-rank p95 is the maximum sample. Every baseline save issued six `getAll` calls and visited every merged row.

## Node operation-count and CPU baseline

| Library items | Scenario | p50 ms | p95 ms | getAll reads | Merge rows visited | Writes/save |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | Setting | 25.63 | 51.09 | 6 | 1,017 | 1,018 |
| 1,000 | List entry | 27.27 | 38.28 | 6 | 1,017 | 1,018 |
| 1,000 | Library item | 25.16 | 25.26 | 6 | 1,017 | 1,018 |
| 10,000 | Setting | 295.40 | 302.37 | 6 | 10,143 | 10,144 |
| 10,000 | List entry | 287.55 | 293.39 | 6 | 10,143 | 10,144 |
| 10,000 | Library item | 306.72 | 414.93 | 6 | 10,143 | 10,144 |
| 20,000 | Setting | 735.70 | 804.10 | 6 | 20,283 | 20,284 |
| 20,000 | List entry | 632.27 | 760.38 | 6 | 20,283 | 20,284 |
| 20,000 | Library item | 595.17 | 678.20 | 6 | 20,283 | 20,284 |

The Node process heap observations are GC-sensitive point-in-time readings, not a peak-memory measurement. Across the baseline samples, the reported pre-save heap ranged from 6.6 MB to 154 MB and the largest post-save value was 230 MB. Full per-sample values are in `issue-08-node-baseline.json`.

## Browser IndexedDB baseline

| Library items | Scenario | p50 ms | p95 ms | Writes/save | Long-task duration across 3 saves |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1,000 | Setting | 160.0 | 164.7 | 1,018 | 229 ms |
| 1,000 | List entry | 118.9 | 129.6 | 1,018 | 182 ms |
| 1,000 | Library item | 118.6 | 137.6 | 1,018 | 191 ms |
| 10,000 | Setting | 1,300.8 | 1,389.1 | 10,144 | 1,954 ms |
| 10,000 | List entry | 1,123.3 | 1,225.7 | 10,144 | 1,695 ms |
| 10,000 | Library item | 1,187.7 | 1,401.9 | 10,144 | 1,806 ms |
| 20,000 | Setting | 2,416.6 | 2,638.3 | 20,284 | 3,688 ms |
| 20,000 | List entry | 2,425.9 | 2,695.6 | 20,284 | 3,832 ms |
| 20,000 | Library item | 2,530.9 | 2,537.6 | 20,284 | 3,693 ms |

The browser exposed `performance.memory.usedJSHeapSize`, but it returned exactly 10,000,000 bytes before and after each sample, so the value was too coarse to distinguish fixture sizes. Long-task observation was available. Browser timing includes real IndexedDB reads and writes but remains specific to this headless test environment.

## Finding

The baseline confirms substantial write amplification: a one-row edit at 10,000 library items queues 10,144 writes, including every library, directory, and experience row; at 20,000 it queues 20,284. In the 10,000-item browser fixture, measured p50 save duration was 1.12–1.30 seconds, with long tasks during each save. This synthetic evidence supports reducing unchanged-row writes while preserving the existing full-store reads and merge checks.

No product-level save-latency target exists in repository guidance, so target pass/fail is undefined. This measurement does not establish that a production user has experienced a slow save.

## Changed-row results

The optimized algorithm still reads all six stores and visits all merged rows, but queues only changed data rows and the revision row. Browser results below use the same three samples per scenario as the baseline.

| Library items | Scenario | Baseline p50/p95 ms | Changed-row p50/p95 ms | Writes/save before → after | Long-task duration before → after across 3 saves |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1,000 | Setting | 160.0 / 164.7 | 44.4 / 64.8 | 1,018 → 3 | 229 → 0 ms |
| 1,000 | List entry | 118.9 / 129.6 | 39.8 / 43.1 | 1,018 → 3 | 182 → 0 ms |
| 1,000 | Library item | 118.6 / 137.6 | 30.9 / 33.1 | 1,018 → 2 | 191 → 0 ms |
| 10,000 | Setting | 1,300.8 / 1,389.1 | 238.5 / 316.9 | 10,144 → 3 | 1,954 → 414 ms |
| 10,000 | List entry | 1,123.3 / 1,225.7 | 243.9 / 451.5 | 10,144 → 3 | 1,695 → 495 ms |
| 10,000 | Library item | 1,187.7 / 1,401.9 | 284.9 / 290.2 | 10,144 → 2 | 1,806 → 458 ms |
| 20,000 stress | Setting | 2,416.6 / 2,638.3 | 597.9 / 725.6 | 20,284 → 3 | 3,688 → 1,153 ms |
| 20,000 stress | List entry | 2,425.9 / 2,695.6 | 496.9 / 643.1 | 20,284 → 3 | 3,832 → 984 ms |
| 20,000 stress | Library item | 2,530.9 / 2,537.6 | 524.7 / 699.8 | 20,284 → 2 | 3,693 → 974 ms |

At 10,000 items, writes fell by 99.97–99.98% and browser p50 was 4.2–5.5 times lower. At 20,000 stress items, writes fell by over 99.98% and browser p50 was 4.0–4.9 times lower. The six reads and merge-entry counts did not change. Saves still took about 239–285 ms p50 at 10,000 items and 497–598 ms at 20,000; browser long tasks remain at those larger sizes. The optimization therefore removes measured write amplification but does not eliminate scale-dependent comparison work.

The browser heap API returned the same 10,000,000-byte value before and after every sample, both before and after optimization. Node heap observations also varied with garbage collection: baseline pre-save values ranged from 6.6 MB to 154 MB with a maximum post-save value of 230 MB; optimized pre-save values ranged from 6.6 MB to 211 MB with a maximum post-save value of 295 MB. These samples do not establish a memory improvement or peak-memory bound.

Full per-sample optimized Node values are in `issue-08-node-optimized.json`. No latency target is defined, so target pass/fail remains undefined. The remaining O(n) reads/comparisons and long tasks should be measured on representative user hardware before any separate change-set or revision design is considered.

## Command outcomes

- `node tests/benchmarks/experience-persistence.mjs`: passed on Node v24.14.1, Windows x64.
- `$env:PLAYWRIGHT_PORT='5174'; npm run test:e2e -- tests/e2e/experience-persistence-performance.e2e.spec.mjs`: passed, 1 test, 45.9 seconds. The first sandboxed attempt stopped before assertions with `Error: spawn EPERM`; the successful run used process-launch permission.
- After optimization, the same Node benchmark passed with operation counts in `issue-08-node-optimized.json`; p50/p95 remain variable because merge comparisons are unchanged.
- After optimization, the same focused Playwright command passed in 18.0 seconds and verified serialized snapshot equality, record counts, one revision increment, six reads, changed writes, and long tasks at all three fixture sizes.
- `npm run check`: passed.
- `npm run test:regression`: stopped before assertions because the Node test runner hit `Error: spawn EPERM`; serial fallback `node --test --test-isolation=none tests/regression/*.test.mjs` passed all 286 tests.
- Focused regression fallback `node --test --test-isolation=none tests/regression/experience-persistence.test.mjs tests/regression/save-state.test.mjs`: passed all 14 tests.
- `$env:PLAYWRIGHT_PORT='5174'; npm run test:e2e -- tests/e2e/experience-concurrency.e2e.spec.mjs tests/e2e/save-lifecycle.e2e.spec.mjs`: passed all 7 tests in 16.5 seconds, including conflict, debounce/flush, retry, and failed-save recovery flows.
