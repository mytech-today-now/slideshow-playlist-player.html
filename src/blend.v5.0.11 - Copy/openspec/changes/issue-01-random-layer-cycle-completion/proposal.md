# Proposal

## Why

Random selection currently always returns a playable index, and both layer advance functions allow wrapping. A Playlist or Slideshow configured as the experience end target therefore never completes, so the new Stop, Loop, and Go to Next Experience modes cannot run at that boundary.

## What Changes

- Define a random cycle as one pass through every currently playable list index without replacement.
- Let the pure next-index helper choose from unvisited indices and return `-1` when a non-wrapping cycle is exhausted; wrapping starts a fresh cycle.
- Track each layer's cycle in runtime memory, keep preloading within that cycle, route an exhausted end-target cycle through the existing completion handler, and automatically begin another cycle for a random companion layer.
- Explain cycle boundaries and reload behavior accessibly by the end-target and order controls, and announce an end-target cycle through the existing completion toast and transport state.
- Advance the PWA asset/cache generation so installed players fetch the updated app and playback module.
- Add regression and focused end-target E2E coverage for Playlist and Slideshow, Stop, Loop, Next Experience, and manual Next.

## Capabilities

### New Capabilities

- `random-playback-cycles`: Defines without-replacement random cycles and their interaction with experience end targets.

### Modified Capabilities

None. The existing experience-end-target behavior has no OpenSpec capability to modify in this checkout.

## Impact

- Code and PWA assets: `playback-mode.js`, `app.js`, `index.html`, `pwa-config.js`, and versioned manifest/app URLs.
- Tests: `tests/regression/playback-mode-ui-contract.test.mjs` and `tests/e2e/experience-end-target.e2e.spec.mjs`.
- Tracking: Beads issue `blend-3va` (stable report finding `issue-01` in `Pasted text.txt`).
- No persisted formats, database schema, or media resolution behavior change. Runtime cycle state resets on reload; the saved current item begins a new cycle. Only the cache generation changes; cache policy does not.
