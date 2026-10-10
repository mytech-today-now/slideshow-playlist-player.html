# Changelog

User-visible changes for Blend Player v5. Dates and features are recorded only where the repository has supporting documentation. Version-folder snapshots without their own release notes are identified in [VERSIONS.md](VERSIONS.md) rather than filled with inferred changes.

## Unreleased

These changes are present in the current review checkout. The app version remains 5.0.11.

### Added

- Added deterministic save-performance fixtures and Node/browser benchmarks for large experiences, plus regression and browser coverage for changed-row writes and save recovery.
- Added focused Firefox and WebKit compatibility coverage and CI reporting that records engine versions without implying branded-browser or mobile-device certification.

### Changed

- Startup can open a higher IndexedDB version when all stores and key paths required by this release match; incompatible schemas fail closed without changing saved data.
- PWA manifests and required icon precache entries use the versioned app-root paths; the worker no longer requests legacy `/assets/icon.svg` files.
- Experience saves now queue writes for changed records and explicit deletions while preserving the existing multi-store transaction, merge, conflict, and recovery behavior.
- Browser reset recovery snapshots omit regenerable thumbnail blobs, prepare before local sign-out or database deletion, and report incomplete reset outcomes accurately.
- The Information dialog uses the installed README by default. Online documentation is an explicit source, carries version and cache-age information, and refreshes while the installed guide stays visible.
- Clarified local-copy instructions, browser compatibility claims, reset behavior, and offline documentation behavior.

## 5.0.11 — 2026-10-06

- Added `pwa-config.js` as the shared source for the application, cache, and database versions, precache assets, and route cache policies.
- Moved service-worker registration, install and update prompts, cache status messages, and alias snapshot synchronization into `pwa-client.js`.
- Replaced the single-cache worker with separate shell, static, documentation, API, and alias caches, plus navigation preload, offline fallback, cache cleanup, and worker message commands.
- Added IndexedDB-backed alias metadata and routing with `alias-router.js`, `alias-store.js`, `alias-sync.js`, and `alias-manifest.json`.
- Added bounded IndexedDB startup recovery with guidance for blocked opens, retry after open failures, and safe handling of late connections.
- Improved library and list selection with range, toggle, keyboard navigation, undoable batch removal, and mouse marquee selection.
- Simplified shared-link status badges while retaining detailed measurements in the Share URL dialog.
- Added media-duration probing and compact, backward-compatible `blend-share` links that preserve export settings, list metadata, media order, and editor state.
- Exposed the current playback row in each layer with `aria-current` and covered navigation, virtualization, unavailable details, and experience switching.

## 5.0.7–5.0.10 — separate notes unavailable

Versioned folders exist for these releases, and the 5.0.7–5.0.10 package files identify their respective app versions. Their checked-in READMEs repeat the 5.0.6 notes and do not provide distinct dates or release summaries, so no release-specific changes are inferred here.

## 5.0.6 — 2026-06-25

- Added exact-position pause and resume for playlist media, slideshow timing, and Ken Burns progress, plus Stop-to-restart behavior.
- Added the pure `playback-clock.js` module for timers and transport-state behavior.
- Updated the configuration dialog with a centered layout, vertical scrolling, focus trapping, and a sticky header.
- Added the Information dialog with independently scrolling tabs, saved tab and scroll positions, external-link handling, and the safe Markdown renderer.
- Added responsive layouts across desktop, tablet, and mobile viewports, plus the Stop keyboard shortcut and play-state accessibility metadata.

## 5.0.0–5.0.5 — historical snapshots

Version folders for 5.0.0 through 5.0.5 are present in the repository. No dated release notes or package-level version records were found for these snapshots, so their individual changes and release dates are undocumented.
