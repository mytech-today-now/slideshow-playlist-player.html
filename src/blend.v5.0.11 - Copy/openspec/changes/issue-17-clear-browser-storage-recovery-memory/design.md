# Design

## Context

See [proposal.md](proposal.md). `snapshotIndexedDBConnection` reads `getAllKeys()` and `getAll()` for the eight stores other than `thumbnails`, then retains the recovered values in an in-memory `Map`. The test fixture seeds synthetic library records after app startup so the app state does not already hold a duplicate of the profile.

## Goals / Non-Goals

**Goals:** Measure reset snapshot time and peak heap for the accepted synthetic profiles. Protect the existing pre-delete recovery guarantee when any protected store read aborts.

**Non-Goals:** Change the production snapshot algorithm, impose a general cap for larger libraries, add a recovery database, or claim performance for real user libraries or non-Chromium engines.

## Decisions

1. **Measure authored records separately from derived thumbnails.** Seed library records at 10 × 1 KiB, 512 × 8 KiB, and 4,096 × 16 KiB. Keep the existing thumbnail-cache matrix as separate Issue 09 coverage so its 64 MiB Blob fixture cannot be mistaken for authored snapshot payload.

2. **Capture reset time and memory from the browser.** Measure snapshot time from the first protected-store read through readonly transaction completion. Force a Chromium heap collection before each reset and sample CDP `Runtime.getHeapUsage` every 10 ms through the reset action. Also capture deletion-call ordering. The page `performance.memory` API reported a constant 10,000,000 bytes in this runner, so it is not used as the heap result.

3. **Treat the measurements as an accepted profile, not a universal cap.** Three Chromium runs measured:

   | Profile | Records / payload | Snapshot time | Peak heap above pre-reset baseline |
   | --- | ---: | ---: | ---: |
   | Small, run 1 | 10 / 10 KiB | 65.4 ms | 2,483,024 B |
   | Small, run 2 | 10 / 10 KiB | 57.4 ms | 2,389,976 B |
   | Typical, run 1 | 512 / 4 MiB | 111.6 ms | 8,473,720 B |
   | Typical, run 2 | 512 / 4 MiB | 100.2 ms | 7,826,696 B |
   | Large, run 1 | 4,096 / 64 MiB | 587.4 ms | 70,320,676 B |
   | Large, run 2 | 4,096 / 64 MiB | 543.5 ms | 71,332,596 B |
   | Small, run 3 | 10 / 10 KiB | 70.8 ms | 2,480,092 B |
   | Typical, run 3 | 512 / 4 MiB | 93.2 ms | 7,923,892 B |
   | Large, run 3 | 4,096 / 64 MiB | 514.5 ms | 71,337,376 B |

   The user accepted the current snapshot at this measured profile. These values are evidence for the synthetic Chromium fixture, not a cap for larger libraries. No assertion is made for profiles above 4,096 × 16 KiB.

4. **Abort recovery reads at each protected store.** The E2E fixture aborts the readonly transaction when each store's value request succeeds. For each injected failure, assert the exact incomplete-reset copy, zero database-delete calls, preserved IndexedDB authored state, and preserved local auth session; then restore the fixture and retry successfully. Existing tests continue to exercise post-snapshot session, deletion, timeout, and cleanup failures.

5. **Verify rollback with synthetic authored profiles.** On 2026-10-19, the focused Chromium E2E prepared empty, small, typical, and large user-authored library profiles, forced a delete timeout, then verified that all records present before reset remained readable in each of the eight non-thumbnail stores. Every large-profile row also checked the unknown `syntheticUserMetadata` field against its expected value. Snapshot duration is measured from the first protected-store read through readonly transaction completion; CDP heap sampling runs every 10 ms from before reset through the incomplete-reset status.

   | Profile | Records / payload | Snapshot time | Sampled peak heap growth |
   | --- | ---: | ---: | ---: |
   | Empty, run 1 | 0 / 0 B | 153.1 ms | 2,534,628 B |
   | Empty, run 2 | 0 / 0 B | 79.4 ms | 2,842,288 B |
   | Small, run 1 | 10 / 10 KiB | 153.3 ms | 2,530,008 B |
   | Small, run 2 | 10 / 10 KiB | 66.8 ms | 2,801,316 B |
   | Typical, run 1 | 512 / 4 MiB | 255.2 ms | 9,511,644 B |
   | Typical, run 2 | 512 / 4 MiB | 201.0 ms | 9,623,444 B |
   | Large, run 1 | 4,096 / 64 MiB | 796.5 ms | 84,442,084 B |
   | Large, run 2 | 4,096 / 64 MiB | 737.7 ms | 85,199,476 B |

   Both runs used the failed-delete path and are not directly comparable to the earlier successful-reset samples. CDP sampling stopped at the incomplete-reset status; the subsequent record-preservation polling is outside the heap sample. These are observed Chromium profiles, not a universal cap or a claim about larger real libraries. The large-profile rollback scenario is retained as an acceptance boundary until its observed heap and duration are accepted for the supported dataset.

## Risks / Trade-offs

- [The memory sample is approximate and can miss short peaks between polls] → Sample every 10 ms and report the measurement as observed heap, not an exact allocation ceiling.
- [A real library may be larger or contain records with different serialized sizes] → Keep the profile data and scope visible in the report; do not generalize the result beyond the tested sizes.
- [A snapshot that exceeds the accepted profile can still fail before deletion] → Preserve the current fail-before-delete recovery-copy message and source data; larger profiles remain unmeasured.

## Migration Plan

No migration is needed. No production code, database schema, or persisted format changes. If future evidence shows the accepted profile is insufficient, create a behavior-changing design and spec before introducing bounded crash-safe recovery.
