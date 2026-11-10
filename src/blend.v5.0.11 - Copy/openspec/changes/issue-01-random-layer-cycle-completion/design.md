# Design

## Context

See `proposal.md` for the problem. `playback-mode.js` currently samples random alternatives without cycle state, while `app.js` maintains independent layer completion flags and routes satisfied end targets through `handleExperienceCompletion`. The working tree also contains pre-existing user changes that extract playable list indices and cover unavailable rows; those changes remain in scope and must be preserved.

The service worker treats JavaScript as cache-first immutable content, and `pwa-config.js` derives precache URLs and cache names from the shared asset/cache generation. A generation bump is needed for installed players to fetch the changed app and helper; the cache policy itself does not change.

## Goals / Non-Goals

**Goals:**

- Give Random order a deterministic completion boundary after every playable list index has been used once.
- Route only the effective end-target boundary through existing Stop, Loop, and Next Experience handling.
- Keep random companion playback cycling and keep manual Next exempt from automatic completion.
- Expose the cycle and reload fallback to keyboard and screen-reader users.

**Non-Goals:**

- Persist cycle bookkeeping or change the current saved item, list data, experience settings, or import/export formats.
- Change media URL resolution, IndexedDB, service-worker policy, or playback modes.
- Change sequential order or unrelated work already present in the checkout.

## Decisions

1. **Pass visited indices to the pure helper.** `selectNextLayerIndex` will accept an optional visited-index collection for Random order. With cycle state supplied, it chooses from playable, unvisited indices; exhaustion returns `-1` when `wrap` is false and samples from all playable indices when `wrap` is true. Calls without cycle state retain their current random-alternative behavior for compatibility.

2. **Keep one volatile cycle per layer.** `app.js` will hold a signature of the current playable list, the indices already played, and at most one reserved next index. The item that just ended is added before selection. A changed playable list starts a new cycle from the current item. Malformed bookkeeping fails closed for that layer, announces an accessible error, and marks the layer complete so playback cannot enter an infinite loop. Cycle state is cleared with completion/reset handling and is never persisted.

3. **Share the cycle choice with preloading.** The existing layer preloader will reserve at most one random unvisited entry and the advance function will consume that reservation. The preloader will not wrap or start a next-cycle media/signed-URL request when no current-cycle entries remain. If no preload reservation exists, advance selects directly from the remaining cycle.

4. **Use existing completion semantics.** At exhaustion, the advance function will evaluate whether marking this layer complete satisfies `isExperienceEndSatisfied`, including its companion fallback for an empty configured target. If satisfied, it clears that layer and calls `markLayerComplete` with a random-cycle reason. If not satisfied, it resets the companion's visited set and selects from a fresh cycle. Manual Next always starts a fresh cycle at exhaustion without completing the experience.

5. **Announce the boundary once.** `handleExperienceCompletion` will show the specified cycle-completion status toast for all three experience modes, then update the transport through its existing Loop, Next, or Stop branch. It will not also show the generic `Experience finished` toast for the same random boundary.

6. **Explain volatile state at the controls.** A visible description associated with Experience end target and both order selects will state the one-pass rule, the end action, and that after reload the saved current item begins a new cycle. The completion toast remains a polite status message.

7. **Bump only the asset/cache generation.** Update the shared generation and all versioned app, module, manifest, and icon URLs that must stay synchronized. Keep the resume module's app import and precache URL on the same shared generation so the installed module graph remains complete. Leave `service-worker.js` and `sw.js` policies unchanged; they already consume the shared config. Existing PWA regression coverage will verify the synchronized references.

## Risks / Trade-offs

- **Reload loses which items were already used in the cycle** → The controls state that cycle progress is in memory and that reload starts a new cycle from the saved current item.
- **A playable list changes mid-cycle** → Its signature changes, so the cycle restarts from the current item using the new playable set.
- **A preload could outlive a cycle boundary** → Only the reserved unvisited item is preloaded, and the reservation is discarded when the cycle state resets.
- **A malformed runtime cycle could otherwise loop** → Stop advancing that layer, mark it complete, and show an accessible error; the companion layer remains available.
- **PWA clients may retain old cache entries** → The new asset/cache generation makes the updated app and playback helper use new versioned URLs and cache names.

## Migration Plan

No data migration is needed because cycle state is memory-only. The cache-generation bump makes the updated source eligible for the installed PWA's existing update flow. Rollback restores the prior source and prior asset/cache generation; no database or user-data recovery is required.
