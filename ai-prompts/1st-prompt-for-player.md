```prompt
You are a world-class senior front-end engineer, UX architect, and media application specialist with deep expertise in single-file web apps, the File System Access API, IndexedDB persistence, HTML5 media playback, high-performance CSS animations, touch/keyboard interactions, and building elegant creative tools that feel native and magical.

Your mission: Completely refactor `src/player.html` (the current 2,780-line self-contained, zero-dependency video player) into a dramatically more powerful, beautiful, and intuitive **dual-layer local media playback studio**. The result must remain a single primary HTML file (player.html) containing all custom CSS and JavaScript, while allowing external libraries via CDN when they meaningfully improve quality or reduce complexity without compromising the "drop-in" spirit.

The new experience transforms player.html from a simple folder video player into a professional-grade yet approachable creative instrument for curating, blending, and performing with local images, videos, and audio on any modern device.

## Non-Negotiable Design Philosophy

- **Elegant simplicity first**: A brand-new user must be able to add media, build a basic playlist + slideshow, press play, and enjoy a beautiful blended result in under 30 seconds with zero documentation.
- **Power through progressive disclosure**: Advanced controls (per-item duration, audio flags, Ken Burns intensity, import/export) are discoverable but never in the way.
- **Local-first & private**: All data and media stay on the user's machine. No telemetry, no cloud, no external calls except optional CDN libraries for UI (clearly documented).
- **Butter-smooth & resilient**: 60 fps interactions and transitions, even on 4K media and 500+ item libraries. Graceful handling of missing files, revoked permissions, exotic filenames, and corrupt media.
- **Accessible & device-agnostic**: Full keyboard navigation, excellent touch targets (≥44 px), ARIA everywhere, responsive from 320 px portrait phones to 4K ultrawide desktops in both orientations.
- **"It just works" persistence**: After reload the app is in an immediately usable state. Verification of file handles happens automatically and silently where possible.

## Current Codebase Context (You Must Internalize This)

Read and deeply understand the existing `src/player.html` before writing a single line of the new version. Key strengths to preserve and evolve:
- Excellent responsive foundation and viewport handling
- Custom video controls and progress bar with thumbnail preview
- Thumbnail generation + caching patterns (localStorage today → IndexedDB tomorrow)
- Keyboard shortcut philosophy and discoverability (`?` help)
- PWA installability and manifest generation
- Dark, high-contrast aesthetic with purple accent (`--theme-color`)
- Zero hard dependencies and clean inline SVG iconography (Fluent UI system icons)
- Hash-based deep linking and shareable state patterns (adapt for local experiences)

You are free (and encouraged) to remove jQuery in favor of modern vanilla JS or lightweight patterns. Keep the file count at one primary deliverable.

## Core Functional Requirements

### 1. Layout & Primary Playback Experience

- The blended **playback viewport** must occupy ~80 % of the vertical real estate on desktop (use `clamp()`, container queries, and safe-area insets for mobile). It is the undisputed hero of the interface.
- A **Configuration gear icon** (⚙️) lives in the top-right corner of the playback viewport. It is permanently visible at 35–45 % opacity, brightens and scales on hover/focus, and never disappears. Clicking it opens the configuration experience **without ever pausing or resetting playback** of either layer.
- The configuration surface is a fast, beautiful, dismissible panel (slide-in from right on ≥1024 px, full-height sheet or stacked vertical on smaller viewports). Backdrop blur + subtle dimming is encouraged. Playback audio and visuals continue uninterrupted underneath.
- Main transport controls (Prev / Play-Pause / Next, opacity slider, fullscreen) are elegantly overlaid or docked to the playback viewport and remain functional while config is open.
- On narrow screens the 80 % rule becomes "the playback area is the primary focus and never feels cramped."

### 2. Configuration Panel — Two-Pane Master Editor

**Left pane (~40–48 %): Local Storage Library**
- Title "Media Library" + primary actions: **Add Files**, **Add Folder**, **Add All Visible → Playlist**, **Add All Visible → Slideshow**, **Clear View**.
- "Add Folder" uses `window.showDirectoryPicker()` (store the directory handle for later refresh). Recursively (or breadth-first) enumerate supported media. Store `FileSystemFileHandle` objects directly in IndexedDB.
- "Add Files" uses `showOpenFilePicker({multiple:true})`.
- Display as a responsive, searchable, filterable grid of rich cards (or compact rows on mobile):
  - Lazy-generated high-quality thumbnail (canvas for video at ~1 s or 10 % mark; full image for photos; waveform or icon for audio).
  - Filename (smart ellipsis), type badge (VIDEO / AUDIO / IMAGE), size, duration/dimensions.
- Multi-select with click, Shift+click range, Ctrl/Cmd+click toggle, and visible "selected (n)" toolbar.
- Real-time search input + type filter pills (All / Video / Audio / Image).
- Every card is a drag source. Dragging one or more selected items to the right pane adds them to the currently active list (Playlist or Slideshow).
- "Clear View" removes items from the visible library pool only (items already referenced by playlists remain functional until explicitly removed). Provide "Remove missing / stale" bulk action.
- Empty state is delightful and instructive.

**Right pane: Playlist or Slideshow Editor (user chooses via prominent segmented control at the top of the pane)**
- Segmented control: **Playlist (n)** | **Slideshow (n)**
- The right pane instantly reflects the chosen list.
- Each list item is a beautiful, dense, reorderable row/card containing:
  - Drag grip
  - Small thumbnail
  - Name + truncated path (click copies full path)
  - Size + native duration
  - For **slideshow images only**: editable "Duration" field (number input, default 4.0 s, debounced persistence, range 0.5–300 s)
  - For **slideshow videos only**: "Include Audio" toggle (default off; when on, this video's audio mixes with the playlist audio track)
  - Red × delete button (destructive but recoverable via toast undo for 4 s)
- Full drag-and-drop reordering **within** the list (smooth placeholder, auto-scroll, keyboard-accessible alternative via Move Up/Down buttons on focused items).
- Multi-item drag from library: selecting several library items and dragging any of them inserts the whole group at the drop point in correct order.
- List-level actions: Clear All (confirm), Shuffle, Sort by Name / Duration / Date Added, Reverse Order.
- Enforce type rules elegantly:
  - Playlist accepts only video and audio (images are rejected with a gentle toast explanation).
  - Slideshow accepts images and video (pure audio files are rejected or added as silent video placeholders).
- Virtual scrolling or efficient DOM recycling recommended for 200+ item lists.

### 3. Dual-Layer Playback Engine & Synchronization (The Heart of the App)

Two independent sequencers run in perfect coordination:

**Playlist layer (always bottom / base layer)**
- Contains only video and audio items.
- Plays with full native controls (seek within current item supported).
- Audio track is always active (subject to master volume).

**Slideshow layer (always top / overlay layer)**
- Contains images and videos.
- Images display for their configured duration using precise timers.
- Videos play to completion (or loop item if mode dictates).
- Opacity of the entire slideshow layer is controlled live by the **Opacity Blend slider** (0 % = pure playlist visible, 100 % = pure slideshow visible, 50 % = artistic blend). The slider exists both in the configuration panel **and** in the main playback controls.
- Audio rule: Slideshow video audio is additive **only** when the per-item "Include Audio" flag is enabled. Both audio streams are mixed naturally by the browser. Provide independent volume sliders in settings (Playlist vol, Slideshow vol, Master).

**Transport synchronization (mandatory)**
- Play / Pause: Affects both layers simultaneously. Resumes from their individual current positions.
- Next (>>): Both layers advance to their next item according to their own playback mode, then play if the master state is playing.
- Previous (<<): Both layers step backward using their session history stacks (critical for random and shuffle modes — see below).
- Stop: Pauses both and resets both to the first item of their respective lists (or current if "loop item").
- When the user presses Play for the first time after load or stop, both layers begin together at whatever items they are currently parked on.

**Playback modes (independent per list)**
- Sequential, Random, Shuffle, Loop (the exact UI labels and sub-options are your elegant decision — e.g. "Play Once → Loop List → Loop Item").
- **Random**: Each advance picks uniformly at random (avoid immediate repeats where reasonable). Maintain an in-memory history stack so Previous always works.
- **Shuffle**: Generate a single shuffled permutation at mode activation or list change. Play through it linearly. History stack still allows full Previous navigation within the current shuffle cycle. On reaching end + loop, reshuffle or repeat the same permutation (your tasteful choice, exposed in UI).
- History stacks are session-only (in-memory) but must survive rapid next/prev spamming without ever throwing or showing broken media.

**Ken Burns & cross-fade effects (tasteful, not gimmicky)**
- Slideshow images: During their display duration, apply a continuous, slow, subtle pan + zoom (Ken Burns classic). 3–12 % scale drift + gentle directional pan over the full duration. Direction can be random per item or user-influenced.
- Cross-fade between consecutive items (both layers): 600–1800 ms elegant dissolve (excellent cubic-bezier). Outgoing item fades out while incoming fades in; scale/pan continues smoothly across the fade for extra polish.
- Playlist video transitions: Cross-fade video + audio at item boundaries using dual `<video>` elements or equivalent technique.
- Global "Effect Intensity" setting in the config panel (Off / Subtle / Medium / Strong) that scales zoom amount, pan speed, cross-fade duration, and rotation micro-movements. Default: Subtle.
- All effects are GPU-accelerated, respect `prefers-reduced-motion`, and can be toggled globally.

**Visual feedback**
- Current item for both layers is always obvious (even with config closed).
- Subtle remaining-time countdown for images in slideshow.
- Elegant progress bar under or inside the viewport for the current item(s). Click-to-seek for video items.
- "Now Blending" mini HUD (optional but delightful) showing abbreviated names of both current items.

### 4. Import & Export (First-Class Citizens)

Support four formats for Playlist-only, Slideshow-only, **and** Full Experience (both lists + per-item settings + global playback settings + project name):

- `.json` (pretty or minified array of rich objects)
- `.jsonl` (one JSON object per line)
- `.txt` (human-readable, one entry per line preferred)
- `.md` (well-formatted list or table, still machine-parsable)

**Path rules (strictly followed on both export and import)**
- Absolute local paths only (the only thing that makes sense with File System Access).
- Any path containing spaces or special characters **must** be enclosed in double quotes.
- Acceptable delimiters inside a single line: one or more spaces, commas, semicolons, or actual newlines.
- Parsers must be extremely tolerant and forgiving while still being deterministic.

**Rich item objects (JSON/JSONL/MD) include**
- `path`
- `displayDuration` (images in slideshow)
- `includeAudio` (videos in slideshow)
- Optional: original duration, size, type, custom title, etc.

**Import UX**
- File picker or drag-and-drop of the .json/.txt/etc. file directly onto the config panel.
- Progress + summary toast: "Imported 14/17 items. 3 paths could not be resolved — they may have moved or permissions changed."
- After import, automatically attempt to re-acquire handles (user may be prompted by the browser for directory or file access). Stale items are clearly marked and easily bulk-removed.

**Export UX**
- One-click "Export Playlist…", "Export Slideshow…", "Export Full Experience…" with sensible default filename including date + project name.
- Exported files are immediately downloadable and round-trip perfectly on the same machine.

### 5. Persistence & Handle Lifecycle (Make or Break)

Use a single IndexedDB database (`player-blend-v1` or similar) with object stores for:
- `library` (array of handles + lightweight metadata)
- `playlist`
- `slideshow`
- `settings` (modes, volumes, durations, intensity, last opacity, projectName, etc.)

`FileSystemFileHandle` and `FileSystemDirectoryHandle` objects are stored directly — they are structured-cloneable.

**On every load (automatic, no user action)**
1. Open DB and hydrate full state.
2. For every stored handle: `queryPermission({mode:'read'})` → `requestPermission()` only when necessary and only with user gesture context if possible.
3. Attempt `handle.getFile()` to verify the file still exists and is readable.
4. Any handle that fails is marked stale with clear visual treatment and a one-click "Relink" that opens a targeted picker.
5. Bulk "Remove all stale items" action.
6. Last-used playlist index, slideshow index, and play modes are restored so the user is exactly where they left off (paused state on reload is acceptable and often preferable).

All mutations to lists, settings, or library are debounced and auto-saved (500–2000 ms). Also flush on `visibilitychange` → hidden and `beforeunload`.

### 6. Responsiveness, Devices & Accessibility

- 4K desktop, normal desktop, tablet, iPhone, Android phones — portrait and landscape — all first-class.
- On phones the config panel becomes a full-screen vertical stack with sticky segmented control; playback viewport still feels generous.
- Touch-optimized drag-and-drop (or excellent fallback buttons).
- Complete keyboard coverage (documented in a beautiful, instantly accessible Help modal triggered by `?` or a header button):
  - Space / K = Play-Pause
  - ← / J = Previous (both layers)
  - → / L = Next (both layers)
  - [ / ] = Opacity blend ±10 %
  - C = Toggle config
  - F = Fullscreen viewport
  - M = Mute / unmute
  - 1–9 = Seek within current video
  - Delete / Backspace (when list focused) = remove item
  - Etc.
- ARIA roles, live regions for toasts and mode changes, focus management for modals, visible focus indicators.
- Respects `prefers-reduced-motion`, `prefers-color-scheme` (though dark is strongly preferred default).

### 7. Features You Must Thoughtfully Add (The Ones That Were Implied or Obviously Required)

- Editable **Experience / Project Name** (persisted, appears in exports and window title).
- Global settings panel or section inside config: default image duration, cross-fade time, Ken Burns intensity, three volume sliders, "Resume playback on load" toggle, "Auto-verify library on startup".
- Toast / snackbar system (elegant, non-blocking, stackable, with undo where appropriate).
- "Add Selected (n)" and "Add All Visible" buttons that are always visible and obvious.
- Empty states for library, playlist, and slideshow that actively teach the next action.
- Context menu (right-click or long-press) on list items: Remove, Play This Item Now, Edit Duration, Copy Path, Relink.
- Subtle remaining-time and cross-fade progress indicators during playback.
- Ability to drop a supported media file or folder directly from the OS onto the library pane or the playback viewport (triggers the appropriate picker or direct handle creation where the browser allows).
- "Play from here" action on any list item (sets that item as current for its layer and starts playback).
- Safe destructive action confirmations that still feel lightweight.
- Clear visual distinction between "library source pool" and "curated ordered lists".
- On first run ever: a warm, one-time welcome card or modal that explains the dual-layer concept in one sentence and offers a "Load sample experience" (you may embed a tiny set of public-domain or placeholder references, or simply guide the user).

### 8. Technical & Implementation Constraints

- Final deliverable is primarily one file: `src/player.html` (HTML + all CSS in one `<style>` + all JS in one `<script>`).
- External libraries via CDN are permitted when they dramatically improve the result (Tailwind Play CDN for styling speed, SortableJS or equivalent for list reordering, Lucide or Heroicons for additional icons, etc.). Document every external URL at the top of the file and provide a commented "pure self-contained" alternative path if feasible.
- No build step required for normal use. The HTML must be openable directly from the filesystem or a static server.
- All custom SVG icons should continue the existing inline Fluent UI / system style unless a better consistent set is found.
- Performance: thumbnail generation is throttled and cached in IndexedDB (not just localStorage). Media elements are created on demand and cleaned up. Object URLs are revoked.
- Error handling: every File System Access call, every media play, every timer is wrapped. The user never sees an uncaught exception or broken UI.
- Version: update the meta `version` to 2.0.0 (or a 2026 date-based scheme) and add a short "What's New" comment block at the top of the JS.

### 9. PowerShell Development & Workflow Helpers (Windows-Native)

Because the target development and primary usage environment is Windows, create 1–3 high-quality, well-commented `.ps1` scripts (place in `scripts/` or repo root):

1. `Start-PlayerDev.ps1`
   - Starts a minimal static HTTP server (prefers `npx serve`, falls back to Python, then a pure-PowerShell listener).
   - Opens the user's preferred browser (Chrome or Edge recommended) to `http://localhost:PORT/src/player.html`.
   - Prints a beautiful banner with the exact URL, keyboard shortcuts reminder, "Ctrl+C to stop server", **and a one-line "Quick Test Command"** that tells the user exactly how to point "Add Folder" at the repo's `videos/` directory for immediate validation against real media (long filenames, MKV, WebM, etc.).
   - Supports parameters: `-Port`, `-Browser`, `-Incognito`, `-NoOpen`, `-Test` (when `-Test` is supplied it additionally prints the full prioritized test checklist from the Testing Protocol).

2. `New-SampleExperience.ps1` (optional but excellent)
   - Creates a `samples/` folder with a small curated set of media (or symlinks if the user has the existing `videos/` folder) plus a starter `.json` Full Experience file that demonstrates playlist + slideshow blending.

3. `Package-SelfContained.ps1` (advanced, nice-to-have)
   - If any CDN resources were used during development, this script produces a single, fully inlined `player-self-contained.html` by fetching and embedding styles/scripts as data URIs or literal text.

All scripts must be executable on PowerShell 7+, handle errors gracefully, and contain helpful comment-based help (`Get-Help`).

### 10. Documentation Deliverables

- Update `README.md` with:
  - New headline and hero description
  - "Quick Start" (30-second path to first blended playback)
  - Complete feature list
  - Keyboard shortcuts table
  - Browser support matrix (emphasize Chrome/Edge desktop + Android for full File System Access; graceful degradation elsewhere)
  - "Persistence & Permissions" section explaining the reload experience
  - "Export / Import" examples
- Add a short entry to a `CHANGELOG.md` (create if absent) or a top-of-file comment block.
- The prompt file you are reading may be copied into `ai-prompts/1st-prompt-for-player.md` for future reference (your choice).

## Success Criteria (How the Finished Work Will Be Judged)

- A person who has never seen the app before can create a compelling blended experience in < 60 seconds on first use.
- Reloading the page after a full session (with 30+ items across lists) restores everything in a ready-to-play state, including correct current items and modes.
- Dragging 8 images from library into slideshow while playback continues feels instant and delightful.
- Previous button works perfectly even after 20 random advances.
- Opacity slider, Ken Burns, and cross-fades look and feel premium.
- No console errors or warnings in normal use across Chrome, Edge, and Firefox.
- The app is genuinely enjoyable on an iPhone 12 in portrait and a 4K ultrawide monitor.
- Code is readable, well-organized, and commented at architectural boundaries.
- The result feels like it was designed by someone who truly loves both media art and user interface craft.

## Testing Protocol for the Final Result File (`src/player.html`)

**This is non-negotiable.** The implementation is not finished until the produced `src/player.html` has been explicitly validated against the real media files that exist in this repository (`videos/` directory). You must use these concrete assets during your final verification pass:

**Primary test media (actual files present):**
- `The Los Angeles Lakers - Same arena. Same basket. Same dunk. 19 years apart. 💜💛-1225939385515823104.mp4` (emoji + extremely long name — tests layout, truncation, history, drag/drop)
- `mkv-Sintel_Trailer1.480p.DivX_Plus_HD.mkv` (non-mp4 container)
- `webm-big-buck-bunny_trailer.webm` (WebM)
- `fake with a really long title that will probably need to wrap.mp4`
- `a video with a prefix.mp4`, `the video with a prefix.mp4`
- `nba_*.mp4` files (multiple similar files for multi-select / range behavior)
- `subtitle.srt` + `subtitle.vtt` (must be ignored gracefully by library importers or handled if subtitle support is retained)

**Testing Requirements (you must address every item in your reasoning and final output):**

1. **Add Folder flow**: Using the generated `Start-PlayerDev.ps1` (or manual localhost server), open the app, click "Add Folder", point it at the repo's `videos/` folder. Verify:
   - All video files are discovered and show correct type badges, human sizes, and durations.
   - The two long/emoji filenames render without breaking cards, search, or lists (smart ellipsis or wrapping).
   - Thumbnails generate successfully for MKV and WebM (or graceful fallback).
   - SRT/VTT files do not appear as playable media or pollute the library (or are filtered).

2. **Dual-layer construction & playback with real files**:
   - Build a Playlist with ≥5 items including the emoji-long video + the .mkv + the .webm.
   - Build a Slideshow using 3+ video files from the same set (test "Include Audio" toggles on 1-2 of them).
   - Start blended playback. Exercise Play/Pause, Next/Prev (≥10 advances including random mode), Opacity slider live while playing, volume controls.
   - Verify cross-fades, Ken Burns (on any stills if you embed test images, or note video-only slideshow behavior), no audio glitches when mixing playlist + slideshow-with-audio items.
   - Previous button works after random/shuffle advances (history stack).

3. **Persistence & reload with real handles**:
   - After building lists + changing settings + playing to item #3, reload the page (or simulate restart).
   - Confirm library re-hydrates, permissions are re-requested only as needed, current playlist/slideshow indices + modes are restored, and pressing Play resumes the exact prior state without errors.

4. **Import/Export roundtrip using real paths**:
   - Export "Full Experience" (with the long-named files).
   - Clear everything.
   - Import the file. Verify all paths (including quoted long/emoji paths) re-acquire and the blended experience is identical.

5. **Edge-case resilience**:
   - Rapid Next/Prev spam (20+ clicks in <5s) — no broken players, no JS errors.
   - Add the same folder twice — deduping or clear "already present" UX.
   - Revoke permission mid-session for one file (if testable) or simulate stale handle.

**Output Mandate**: Your final response **must** contain a "Validation Results" section (use a markdown table or detailed log) with Pass/Fail + one-sentence evidence for each of the 5 areas above, explicitly referencing the actual filenames used from `videos/`. If any area cannot be fully validated in one generation pass, document the exact manual steps a human must perform after saving your `player.html` and mark it "Requires Human Verification".

This ensures the final result file is not just implemented but proven against the exact media the creator will use daily.

## Execution Instructions

1. Begin by thoroughly exploring the current `src/player.html`, `README.md`, the `videos/` sample media, and the overall repository structure. Pay special attention to exotic filenames, container types (mkv/webm), and subtitle files — these are your primary test corpus.
2. Plan the new architecture (state shape, component boundaries, media element strategy, IDB schema) before writing code.
3. Implement the complete refactored `src/player.html`.
4. Create the PowerShell script(s), ensuring `Start-PlayerDev.ps1` makes it trivial to serve the repo and immediately begin testing with real media via "Add Folder".
5. Update documentation (README + any inline guides). Embed or link to the concrete testing scenarios that use the files in `videos/`.
6. **Execute the full Testing Protocol** (see the dedicated section above) against the actual files in `videos/`. In your reasoning, walk through Add Folder, playlist/slideshow construction, blended playback, persistence reload, import/export, and edge cases using the real filenames. Fix any issues your validation uncovers before finalizing the code.
7. At the very end of your response, provide:
   - A crisp "What Changed" summary (kept vs. rebuilt vs. entirely new subsystems).
   - A "Validation Results" block (table or structured log) — **not** just a generic checklist — showing Pass/Fail + evidence for each required test area, explicitly naming the video files exercised (e.g. the emoji-long title, the .mkv, the .webm).
   - A prioritized "Test Checklist" for any remaining human-driven scenarios (responsiveness on real devices, accessibility with screen reader, etc.).
   - "Known Limitations & Future Directions" (browser FSA support, potential multi-project support, WebGPU effects, etc.).

If any requirement is even slightly ambiguous, choose the most elegant, empowering, and "it just works" interpretation and document the decision in code comments.

The final `src/player.html` you deliver must be one that its creator can drop into the existing `videos/` folder (or point "Add Folder" at it) and immediately have a reliable, delightful dual-layer experience with zero friction. Test it like your reputation depends on it — because it does.

Now begin. The world-class result you produce will be used daily by its creator and will set a new bar for what a single HTML file can achieve.
```

## Instructions for the Prompt User (you)

Copy the entire content inside the code block above (starting with "You are a world-class...") and paste it verbatim into any high-capability LLM (Claude 4, GPT-4o, Grok 4, Cursor Composer, etc.) **together with**:
- The full current `src/player.html`
- A directory listing or description of the files inside `videos/` (especially the long/emoji filename, .mkv, .webm, and subtitle files)

The resulting implementation will be exceptionally robust, delightful, and complete **because the model is now explicitly required to test the final `player.html` against your real media before declaring victory**.

After the LLM returns the new `src/player.html` (plus the `.ps1` scripts and doc updates + Validation Results):
1. Save `src/player.html` (overwrite or as a new candidate file).
2. Run the freshly generated `Start-PlayerDev.ps1` (or `npx serve` / Python) from the repo root.
3. In the browser, use "Add Folder" → select the `videos/` directory.
4. Execute the exact scenarios listed in the LLM's "Validation Results" section.
5. Only promote the file to production use once the Validation Results are all green (or all "Requires Human Verification" items have been manually confirmed on your hardware).

The PowerShell helpers and documentation updates are explicitly requested as part of the same generation pass.
```