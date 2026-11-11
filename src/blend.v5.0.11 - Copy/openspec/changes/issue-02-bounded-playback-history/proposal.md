# Proposal

## Why

Random Playlist and Slideshow advances append every prior item index to runtime history, and each successful advance saves that growing history in the experience snapshot. Long sessions therefore increase IndexedDB write size even though Previous only needs recent entries. The current full-experience JSON exporter already omits runtime history; this change will preserve and verify that contract.

Source finding: `ai-prompts/pre-mortem-2026-11-09-19-36-34.html#issue-02`.

## What Changes

- Keep at most 256 recent Previous-history entries per playback layer, dropping the oldest entries when a random advance exceeds the cap.
- Compact snapshot creation and legacy snapshot normalization to the same cap; discard malformed and out-of-range indices without changing playlist or slideshow items.
- Keep full-experience JSON free of per-advance runtime history.
- Keep Previous navigation on the retained playable history and show an accessible status when older history is trimmed.
- Advance the shared asset/cache generation so installed players receive the updated immutable JavaScript, HTML, CSS, and manifest assets.
- Keep the IndexedDB schema, experience/share formats, save recovery behavior, and sequential history clearing unchanged.

## Capabilities

### New Capabilities

- `playback-history`: Defines bounded, recent-item history for Previous navigation and compatible snapshot compaction.

### Modified Capabilities

None. The current main spec catalog has no playback-history or experience-history capability.

## Impact

- `app.js`: runtime history insertion, snapshot creation, snapshot normalization, and trim notice state.
- `playback-mode.js`: pure bounded-history helpers used by runtime and regression coverage.
- `index.html`: accessible status text associated with Previous controls.
- `styles.css`: visible trim-status placement in the playback viewport.
- `pwa-config.js`, `index.html`, `app.js`, `alias-store.js`, and manifests: synchronized asset/cache generation references.
- `tests/regression/playback-mode-ui-contract.test.mjs`: cap, compaction, Previous, legacy-list-preservation, and UI-contract coverage.
- `tests/regression/pwa-config.test.mjs`: verify the new generation and existing cache-policy contract.

No database migration, runtime dependency, service-worker policy change, or export schema change is required.
