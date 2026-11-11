# Spec Delta

## Purpose

This capability keeps Playlist and Slideshow Previous navigation useful during long random sessions while limiting the history data stored in experience snapshots and exports.

## ADDED Requirements

### Requirement: Previous history is bounded per playback layer

The app MUST retain no more than 256 recent history indices for each playback layer. When a new index exceeds the limit, the oldest index MUST be discarded while the new index remains available to Previous.

#### Scenario: Random playback exceeds the history limit
- **WHEN** a layer records more than 256 random advances
- **THEN** its history contains exactly the most recent 256 indices

#### Scenario: Previous skips history that is no longer playable
- **WHEN** Previous walks retained history containing stale or unavailable list entries
- **THEN** it selects the newest retained index that is currently playable and preserves the existing sequential fallback when no retained entry is playable

### Requirement: Experience snapshots compact playback history

Experience snapshots MUST include at most the latest 256 valid integer history indices per layer. Loading an oversized or malformed legacy history MUST discard invalid and out-of-range indices and compact the rest without changing list items, settings, library files, or directory handles.

#### Scenario: A long session is saved
- **WHEN** a Playlist or Slideshow has advanced randomly more than 256 times
- **THEN** its saved experience snapshot contains no more than 256 history indices for that layer

#### Scenario: An oversized legacy snapshot is normalized
- **WHEN** a legacy snapshot contains more than 256 entries, non-integer indices, or indices outside its list bounds
- **THEN** normalization keeps at most the latest 256 valid in-range indices and preserves the original playlist and slideshow items

### Requirement: Full-experience exports omit playback history

Full-experience JSON exports MUST omit the per-advance runtime history arrays so their size does not grow with playback duration.

#### Scenario: A long-running experience is exported
- **WHEN** the current experience has advanced randomly more than 256 times
- **THEN** the exported JSON contains neither `runtime.historyPlaylist` nor `runtime.historySlideshow`

### Requirement: History trimming is announced accessibly

When older history entries are discarded to keep a layer within the limit, the app MUST show the message `Earlier playback history was trimmed to keep this experience saveable. Previous still moves through the most recent items.` in a visible status near the Previous controls that is available to keyboard and screen-reader users.

#### Scenario: The history limit is reached
- **WHEN** an advance drops an older history entry
- **THEN** the visible, polite live status announces the required message and remains associated with Previous navigation
