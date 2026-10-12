# Design

## Context

The app already debounces ordinary edits, tracks dirty and saved revisions, persists the six-store snapshot atomically, and awaits saves before experience switching and mail navigation. `pagehide` starts a last-chance flush without waiting for it. See `proposal.md` and `specs/save-lifecycle/spec.md` for the motivation and behavior contract.

## Goals / Non-Goals

**Goals:**

- Make revision and overlap behavior deterministic in unit tests.
- Exercise fresh-page storage near the existing debounce boundary without asserting that browser shutdown commits asynchronously.
- Keep the retry/export recovery copy and explain the shutdown limit in user documentation.

**Non-Goals:**

- Guarantee a final IndexedDB commit during process termination.
- Replace or widen the six-store transaction, change the persisted format, or introduce a runtime dependency.
- Shorten the debounce or increase ordinary write frequency unless focused evidence shows that is necessary.

## Decisions

1. **Reuse the revision coordinator and atomic snapshot transaction.** Their successful-save boundary is IndexedDB transaction completion, and changing that mechanism would expand the issue into persistence architecture and write-amplification work.
2. **Test ordinary scheduling with injected fake timers and deferred writes.** This makes coalescing, overlapping flush calls, edits during an in-flight commit, and dirty-state transitions reproducible without relying on scheduler timing.
3. **Treat reload timing as an observation boundary.** At 100 ms and 800 ms, a clean page may see either the previous complete snapshot or the new complete snapshot if pagehide finishes; after the debounce it must see the committed edit. Never require the browser to wait for a pagehide transaction.
4. **Document the limit beside auto-save guidance.** State that browser shutdown may interrupt a pending save and keep the existing retry/export recovery copy for reported failures.

## Risks / Trade-offs

- **Browser scheduling can move an 800 ms reload across the 850 ms timer.** The E2E assertion will accept either complete revision before the debounce boundary and assert the latest revision is visible after the save status confirms completion.
- **A page-level close cannot simulate every forced process termination.** Keep OS/browser termination durability identified as browser-dependent.

## Migration Plan

No data or deployment migration is required. If a timing change increases write amplification, restore the existing debounce while retaining awaited app-controlled transitions and truthful unsaved status.
