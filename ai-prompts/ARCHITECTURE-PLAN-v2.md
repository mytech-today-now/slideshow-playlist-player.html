# player.html v2 Architecture Plan

**Version Target**: 2.0.0 (April 2026)
**Core Philosophy**: Elegant simplicity + progressive power. Local-first. Butter-smooth. "It just works."

## High-Level Structure (Single File)
- `src/player.html`: Full self-contained (HTML5 + <style> all CSS + <script> all JS)
- Optional CDN (documented at top):
  - Consider Tailwind Play CDN for rapid premium styling (https://tailwindcss.com/docs/installation/play-cdn)
  - Consider SortableJS for battle-tested list reordering if vanilla DnD proves fiddly
  - Decision: Start pure vanilla + modern CSS (container queries, view transitions where useful, :has()). Add Sortable only if time/perf requires. Keep "drop-in" spirit strong.

## DOM / UI Layout (Mobile-First Responsive)
```
<body>
  <div id="app">
    <!-- Hero Viewport ~70-80vh on desktop -->
    <div id="viewport" class="playback-viewport">
      <!-- Layer stack -->
      <div id="playlist-layer" class="media-layer bottom"> <!-- dual <video> for crossfade --> </div>
      <div id="slideshow-layer" class="media-layer top"> <!-- img or video + kenburns wrapper --> </div>

      <!-- Overlays -->
      <div id="viewport-hud"> Now blending: Playlist • Slideshow • 47% </div>
      <button id="config-gear" aria-label="Open configuration">⚙️</button>

      <!-- Transport dock (always functional) -->
      <div id="transport">
        Prev | Play/Pause (large) | Next | Opacity range (live) | Fullscreen | Mute
      </div>

      <!-- Subtle progress / countdown for current items -->
    </div>

    <!-- Config Panel (slide-in, backdrop blur) - NEVER pauses playback -->
    <div id="config-backdrop"></div>
    <aside id="config-panel">
      <header> ... project name editable ... close </header>

      <div class="two-pane">
        <!-- LEFT: Media Library -->
        <section class="library-pane">
          <h2>Media Library (n)</h2>
          <div class="actions">
            <button id="add-files">Add Files</button>
            <button id="add-folder">Add Folder</button>
            <button id="add-all-playlist">Add All Visible → Playlist</button>
            ...
          </div>
          <input type="search" id="library-search" placeholder="Search...">
          <div class="type-filters">All | Video | Audio | Image (pills, active state)</div>
          <div id="library-grid" class="grid cards">...</div>  <!-- virtual-ish or content-visibility -->
          <div class="library-toolbar" hidden> Selected (3) • Add to... • Clear selection </div>
        </section>

        <!-- RIGHT: Active List Editor -->
        <section class="list-pane">
          <div role="tablist" class="segmented">
            <button data-list="playlist" aria-selected="true">Playlist (n)</button>
            <button data-list="slideshow">Slideshow (n)</button>
          </div>

          <div id="list-editor">
            <!-- Dynamic: dense reorderable rows -->
            <!-- Each: drag-grip, thumb, name+path(trunc), meta, (duration input if img), (include-audio if video in ss), delete -->
          </div>

          <div class="list-actions"> Clear | Shuffle | Sort ▾ | Reverse | Export this list... </div>
        </section>
      </div>

      <!-- Global Settings (collapsible or below panes on wide) -->
      <section class="global-settings">
        Project name, Default image dur, Effect intensity (Off/Subtle/Medium/Strong), Volumes (3 sliders + master), Resume on load, etc.
      </section>
    </aside>

    <!-- Toasts container (bottom-right or top, stack, undoable) -->
    <div id="toast-container"></div>

    <!-- Modals: Help (?), Welcome first-run, Confirm, Import progress -->
    <dialog id="help-modal"> ... rich keyboard table + tips ... </dialog>
  </div>

  <!-- All inline SVGs for icons (Fluent style, expanded set) -->
  <svg id="defs" style="display:none"> ... </svg>
</body>
```

## State Shape (in-memory + persisted)
```js
{
  projectName: "My Blend Session",
  library: Map<id, LibraryItem>,  // id = crypto.randomUUID() or stable hash
  playlist: Array<PlaylistItemRef>,
  slideshow: Array<SlideshowItemRef>,
  settings: {
    defaultImageDuration: 4.0,
    effectIntensity: 'subtle', // 'off' | 'subtle' | 'medium' | 'strong'
    playlistVolume: 1.0,
    slideshowVolume: 0.6,
    masterVolume: 1.0,
    playbackModePlaylist: 'sequential', // or 'random', 'shuffle', 'loop-list', 'loop-item'
    playbackModeSlideshow: 'sequential',
    opacity: 0.5,
    resumeOnLoad: true,
    autoVerifyOnStartup: true
  },
  ui: { currentListTab: 'playlist', selectedLibraryIds: Set, ... },
  runtime: { isPlaying: false, historyPlaylist: [], historySlideshow: [] }
}

LibraryItem = {
  id, handle: FileSystemFileHandle, name, size, type: 'video'|'audio'|'image',
  duration?: number, width?, height?, lastVerified: Date, stale: bool, folderPathHint?
}

PlaylistItemRef = { id, addedAt }
SlideshowItemRef = { id, displayDuration?, includeAudio? }
```

## IDB Schema (player-blend-v1)
- objectStore 'library' (keyPath: 'id') — stores {id, handle, meta, lastVerified, stale?}
- objectStore 'playlist' (key: 'default') — { items: [...] , mode, currentIndex? }
- objectStore 'slideshow' (key: 'default')
- objectStore 'settings' (key: 'global')
- objectStore 'thumbnails' (keyPath: 'key') — {key: `${name}:${size}:${lastMod}`, blob: thumbnailBlob, generatedAt }
- Optional: 'directoryHandles' for refresh sources

Handles are directly stored (structured clone).

On hydrate:
1. Load everything
2. For each library handle: queryPermission → if prompt/granted attempt getFile() to verify + update meta (duration via temp <video> loadmetadata if needed)
3. Mark stale ones visually
4. Restore last current indices + modes + opacity + isPlaying? (prefer paused on reload for safety)
5. Debounced autosave (1s) + flush on visibility hidden / beforeunload

## Dual-Layer Media Engine
**Playlist Layer (base)**:
- Always video/audio capable
- Dual <video class="playlist-a"> <video class="playlist-b"> for seamless crossfade + audio ducking
- Native seeking supported on current
- Volume driven by playlistVolume * master

**Slideshow Layer (overlay)**:
- Supports image + video
- For images: absolutely positioned <img> inside .kenburns-wrapper
- For videos: <video> (muted by default unless includeAudio)
- Opacity of whole layer controlled by live blend slider (0-100%)
- Audio only when includeAudio flag + slideshowVolume * master

**Coordinator (PlaybackController)**:
- play(), pause(), toggle()
- next(), previous() — advance both sequencers (respect their modes + history stacks)
- stop() — pause + reset both to start of their lists
- setBlendOpacity(0..1) — live, no restart
- loadItemForLayer(layer, itemRef) — creates/assigns media el, wires events (ended, error), starts effects if applicable

**Sequencer (per list)**:
- Maintains ordered items + mode state + in-memory history (for Previous in random/shuffle)
- advance() / back() pure, then controller loads
- For slideshow image: uses precise requestAnimationFrame timer or setTimeout with drift correction for displayDuration
- Shuffle: pre-generate permutation array once per activation/list change. On end + loop: re-shuffle or repeat cycle.

**Effects Engine**:
- Intensity multipliers table:
  - off: 0
  - subtle: 1.0 (default) — 4-6% zoom drift, 600-900ms crossfade, slow pan
  - medium/strong: higher %
- Ken Burns implemented via rAF loop updating CSS transform on current slideshow media wrapper.
  Per-item random direction (N/S/E/W/NE etc or subtle diagonal).
- Crossfades: coordinated opacity ramps on outgoing/incoming pairs. For videos also volume ramps.
- All effects skip or reduce when `prefers-reduced-motion: reduce`

**Visual Polish**:
- Current item always highlighted in lists (even config closed) + subtle badge on viewport "P: title | S: title"
- Remaining time pill for current slideshow image (countdown)
- Progress bar(s): clickable for video items (playlist primary seek target)
- 60fps everywhere possible

## Input & Permissions (File System Access)
- Add Files: showOpenFilePicker({multiple:true, types: mediaTypes})
- Add Folder: showDirectoryPicker() + recursive async iterator over entries(), filter supported, store directoryHandle separately for "Refresh"
- Drag from OS: e.dataTransfer.items[0].getAsFileSystemHandle() (Chromium). Fallback to File objects (limited, one-time use)
- On every handle use: defensive try { await file = handle.getFile() } catch → mark stale + toast

## Thumbnail Pipeline (IDB backed)
- Queue + concurrency (2-3)
- For video: seek to 10% or 1s, draw to canvas (or Offscreen), downscale, store as Blob in IDB 'thumbnails'
- For image: draw full or sampled
- For audio: waveform icon or static
- Cache key: name + size + (lastModified || 0)
- Lazy gen on card render / intersection observer
- Fallback: nice SVG icon per type if gen fails

## Import / Export
- 4 formats supported for Playlist / Slideshow / Full Experience
- Path serialization: absolute FS paths. Quote if space or special char. Delimiters tolerant on parse (space, comma, ; , newline)
- Rich objects: {path, displayDuration, includeAudio, ...meta snapshot}
- On import: parse → for each path, attempt to match against current library or prompt "Select parent folder for these items" (one picker often suffices if they share tree) → then walk and resolve by basename + size heuristics. Mark unresolved clearly.
- Drag .json/.txt onto config panel or dedicated Import button → progress toast

## Keyboard (preserved + extended philosophy)
Central document keydown handler, preventDefault smartly.
New mappings (extend existing):
- Space/K: Play/Pause (both)
- ←/J , →/L : Prev/Next both layers
- [ / ] : Opacity -/+ 10%
- C : Toggle config panel (never pauses)
- F : Fullscreen viewport only
- M : Mute master
- 1-9 : Seek in current playlist video
- Delete/Backspace (list focused): remove focused item(s) + undo toast
- / : Focus library search
- Esc : Close panels/modals/config
- ? or F1 or H : Beautiful help modal (rich table, grouped)
- Also drag handles keyboard accessible (Move Up/Down buttons visible on focus)

ARIA: roles, labels, live regions for "Now playing X", mode changes, toasts.

## Persistence & Lifecycle
- Hydrate before first paint where possible (show "Restoring session..." subtle)
- Every list mutation, setting change, library add → debounced (800ms) save
- Flush immediately on critical (import success, explicit export prep)
- Visibilitychange + beforeunload → await flush
- On reload: restore indices, modes, opacity, projectName, last verified state. Playback state defaults to paused (safer UX)

## Error Handling & Resilience
- Every FSA call, media .play(), timer wrapped in try/catch + user toast
- Missing file mid-playlist: auto advance with warning toast, mark stale
- Rapid spam Next/Prev: debounce or queue advances, never break players
- Same folder added twice: dedupe by handle or (name+size)
- Exotic names (emoji, long, prefixes, spaces): CSS handles truncation + title=full on hover; paths quoted on export

## First Run Experience
- Onboarding modal (localStorage flag 'seenWelcome-v2')
- One sentence: "Two independent layers — a Playlist for audio foundation + a Slideshow for visual overlays — blended live with the opacity slider."
- Big "Add your first media" CTA + "Load demo from videos/ folder" guidance (no embedded bytes)

## Performance Targets
- 60fps interactions / Ken Burns / fades on 4K media
- Library 500+ items: filter/search instant (pre-indexed or simple), grid uses content-visibility: auto
- Thumbnail gen never blocks main thread (Offscreen + worker? or just rAF batches; keep simple queue)
- Media elements created lazily, cleaned on replace

## Browser Support Notes (2026)
Primary: Chromium (Chrome/Edge 90+) desktop + Android — full FSA, IDB, handles, getAsFileSystemHandle
Good: Firefox (directory picker limited or behind flag in some versions; fallback to multi-file)
Partial: Safari (FSA support improving but directory pickers weaker; many features via file pickers only)

## Implementation Order (for this pass)
1. Core shell + CSS foundation + viewport + transport + gear + config skeleton (no logic)
2. IDB layer + hydrate/save skeleton + settings
3. Library pane + pickers + grid render + search/filter + multi-select
4. List editor + segmented + basic add/remove/reorder (HTML5 DnD first)
5. Dual media elements + PlaybackController + simple sequential mode
6. Ken Burns + crossfade + effect intensity
7. Full modes (random/shuffle + history) + prev/next sync
8. Volumes, blend slider live, per-item slideshow controls
9. Persistence roundtrip + stale detection + relink
10. Import/export (all 4 formats) + drag import
11. Keyboard + help modal + toasts + undo
12. PWA + welcome + polish + accessibility pass
13. PowerShell scripts + README + Validation

## Key Risks & Mitigations
- FSA permission prompts fatigue: batch where possible, lazy request on first play or explicit "Reconnect" action
- Long/emoji filenames in UI: rigorous testing with the exact Lakers file + prefixed ones
- Video+audio mixing glitches: careful volume management + loadmetadata before play
- IDB quota / structured clone limits: store minimal, thumbnails as compressed blobs
- Crossfade audio clicks: use short linearRamp or just let browser handle (acceptable)

Decisions made for elegance:
- No multi-project in v2 (future); single active experience persisted
- "Play from here" in context menu sets current for layer + starts if stopped
- Export filenames: `player-blend-YYYY-MM-DD-projectname-full.json`
- Pure CSS for most beauty; minimal JS for positioning/animations where needed
```

This plan will guide the implementation. Any deviations for practicality will be noted in final code comments and response.