# Spec Delta

## Purpose

Defines finite, without-replacement cycles for Random Playlist and Slideshow order and how those cycles interact with experience completion.

## ADDED Requirements

### Requirement: Random order visits each playable list entry once per cycle
Random order MUST choose only currently playable entries that have not yet been played in the current cycle. When no entries remain, the next-index decision MUST be terminal if wrapping is disabled and MUST choose from a fresh cycle if wrapping is enabled. Empty and unplayable lists MUST keep their existing completion behavior.

#### Scenario: Two-item cycle exhausts without wrapping
- **WHEN** both playable entries in a two-item random list have been used in the cycle and the caller disables wrapping
- **THEN** the next-index decision returns the terminal result `-1`

#### Scenario: One-item cycle exhausts without wrapping
- **WHEN** the sole playable entry has been used in a random cycle and the caller disables wrapping
- **THEN** the next-index decision returns the terminal result `-1`

#### Scenario: Exhausted cycle wraps to a fresh random choice
- **WHEN** every playable entry has been used and the caller enables wrapping
- **THEN** the next-index decision selects an entry from a fresh cycle

### Requirement: Random preloading stays within the current cycle
Random order MUST reserve and preload only an unvisited playable entry from the current cycle. When no unvisited entry remains, the system MUST NOT preload media or request a signed URL for the next cycle before the current cycle completes.

#### Scenario: The current random item is the final cycle item
- **WHEN** all other playable entries have already been visited and the current item is playing
- **THEN** no media or signed-URL request starts for a new cycle before the completion boundary

### Requirement: Exhausted random end-target cycles complete the experience
When automatic playback exhausts a random cycle on the effective experience end target, the system MUST mark that layer complete and run the selected experience playback mode exactly once for the cycle. A random non-target layer MUST begin a fresh cycle without completing the experience.

#### Scenario: Playlist is the random end target in Stop mode
- **WHEN** every playable Playlist entry has played once in its random cycle and the experience playback mode is Stop
- **THEN** playback stops, the current Slideshow item remains visible, and completion is announced once

#### Scenario: Slideshow is the random end target in Stop mode
- **WHEN** every playable Slideshow entry has played once in its random cycle and the experience playback mode is Stop
- **THEN** playback stops, the current Playlist item remains visible, and completion is announced once

#### Scenario: Loop starts a fresh random cycle
- **WHEN** a random end-target cycle is exhausted and the experience playback mode is Loop
- **THEN** the experience restarts and the next cycle can visit every playable entry again

#### Scenario: Next Experience waits for random cycle completion
- **WHEN** a random end-target cycle has unplayed entries and the experience playback mode is Go to Next Experience
- **THEN** the current experience continues; the next experience starts only after the cycle is exhausted

#### Scenario: Random companion layer starts another cycle
- **WHEN** a random non-target layer exhausts its cycle while the end-target layer is still active
- **THEN** the companion layer starts a fresh random cycle and does not complete the experience

### Requirement: Manual Next does not complete an experience at a random cycle boundary
Manual Next MUST preserve its completion exemption. If manual navigation exhausts the current random cycle, playback MUST continue from a fresh random cycle without marking the experience complete.

#### Scenario: Manual Next crosses the random cycle boundary
- **WHEN** the operator presses Next after every entry in the current random cycle has been visited
- **THEN** playback continues and the experience is not completed

### Requirement: Random cycle behavior and reload fallback are accessible
The controls for Experience end target and both layer orders MUST expose visible text explaining the one-pass cycle, the configured end action, and that a reload begins a new cycle from the saved current item. When a random end-target cycle completes, the existing status toast MUST announce: “Random order finished its current cycle. Playback will stop, loop, or move to the next experience according to Experience playback mode.”

#### Scenario: Keyboard or screen-reader user focuses a related control
- **WHEN** the user focuses Experience end target, Playlist order, or Slideshow order
- **THEN** the cycle explanation is available to that control and remains readable without CSS

#### Scenario: Random end-target cycle completes
- **WHEN** a random end-target cycle reaches its completion boundary
- **THEN** the status toast announces the cycle completion and the transport reflects the selected playback mode

#### Scenario: Playback resumes after reload without saved cycle state
- **WHEN** a random layer resumes from a saved current item after reload
- **THEN** that item begins a new in-memory cycle and the visible cycle explanation states this fallback
