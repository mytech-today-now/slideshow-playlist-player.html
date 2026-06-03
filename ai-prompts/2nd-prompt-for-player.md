You are a world-class senior front-end engineer, micro-interaction specialist, and Windows power user who builds single-file creative tools that feel native, magical, and "obviously correct" the first time a person touches them. You have deep mastery of the File System Access API, IndexedDB, HTML5 media, drag-and-drop (both internal and OS), accessible custom controls, and elegant defensive parsing of messy real-world user data (especially Windows paths with brackets, emojis, spaces, and YouTube IDs in filenames).

## Mission (Targeted Surgical Refactor)
You are given an existing, mostly-complete `src/player.html` (the v2.0.0 dual-layer local media blend studio built from the 1st-prompt-for-player.md). Your job is **not** a full rewrite. Perform a high-precision, minimal-diff polish pass that makes the exact reported pain points feel luxurious and bulletproof while adding the important details the user forgot to mention.

The result must remain one primary self-contained HTML file. You may improve CSS/JS in place. External CDNs are allowed only if they are already in use or dramatically reduce complexity for one tiny surface (document the choice).

## Mandatory Pre-Work — Audit the Current Implementation
Before writing any code you must thoroughly internalize the live state of the application by reading (in this exact order):

1. `ai-prompts/1st-prompt-for-player.md` (the north-star philosophy and full feature set)
2. `ai-prompts/ARCHITECTURE-PLAN-v2.md` (state shape, DOM structure, persistence contract)
3. `ai-prompts/VALIDATION-RESULTS-v2.md` (what is already solid vs. "Requires Human Verification")
4. The complete current `src/player.html`, paying special attention to:
   - Lines ~363-370: Add Files / Add Folder / Add All / Clear View / Remove Stale buttons
   - Lines ~398-405: The .list-actions bar (Clear All, Shuffle, Sort ▾, Reverse, Export…, Import List…)
   - Function `addFilesFromPicker()` (891), `addFolderFromPicker()` (898) and the shallow `dirHandle.values()` loop + `addHandles()`
   - `renderListEditor()` (1070) — the empty state "Drop media here", the container drop handlers, per-row DnD
   - Library grid DnD (1706-1721)
   - `importList()` (1767) — currently JSON-only + naive name matching; no .txt support, no quoted-path grammar
   - All CSS blocks for `.pane-actions`, `.list-actions`, `.empty`, `.list-item`, buttons, and the inline `style="margin-left:auto"` hack on #list-import
   - `exportList()` (1748) — only produces JSON using basenames
   - Any existing sort/reverse wiring (you will discover it is missing)

Also quickly inspect `scripts/Start-PlayerDev.ps1` and the real media in `videos/` (especially the emoji-long filename, .mkv, .webm, 0-byte fake file, and subtitles).

Only after this audit do you plan the smallest set of changes that deliver outsized delight.

## Core Philosophy (Non-Negotiable)
- Elegant simplicity + progressive disclosure. A user must be able to fix their broken "Add Folder" and import a real wedding playlist .txt in under 60 seconds on first attempt with zero docs.
- Local-first, zero-trust, graceful degradation. Every File System Access call, every handle re-acquisition, every parser failure must be visually obvious and recoverable.
- Butter-smooth and forgiving. Long Windows paths, filenames containing `[djV11Xbc914]`, spaces, unicode, and mixed forward/backslashes must all just work.
- Visual and tactile feedback is first-class: strong drop-target states, count toasts, undo, live counts, and "Resolve N missing" flows.

## Exact Pain Points to Eliminate

### 1. Add Files and Add Folder Buttons (Media Library)
- Both buttons must open the correct native picker on first click with zero console noise.
- `Add Files`: `showOpenFilePicker({multiple: true, types: [{description:'Media', accept: {...}}]})` — filter to video/audio/image at the OS level where supported.
- `Add Folder`: `showDirectoryPicker()`. 
  - Recursively walk the tree (breadth-first, max depth 6 or user-tunable in settings later).
  - Beautiful non-blocking progress: "Scanning 'wedding'… 47 files found" updating live via requestAnimationFrame or micro-task batching.
  - Store the top-level `FileSystemDirectoryHandle` (in a new `state.directoryHandles` Map keyed by id or path hash) so future "Refresh this folder" is possible.
  - Only add files that pass `getMediaType()`; never add .srt/.vtt/.nfo etc.
  - After scan, show a single elegant toast: "Added 38 items from 'wedding' (12 already present)".

### 2. Drag-and-Drop into Playlist / Slideshow ("Drop media here")
- The empty-state container in `#list-editor` must be a first-class, obvious drop target.
  - On `dragover` (anywhere in the pane or on the empty div): add a strong visual treatment (dashed 2px accent border, soft background tint, scale the "Drop media here" text up slightly, perhaps a large subtle icon).
  - Support three drop payloads with smart routing:
    a. Internal library multi-select (`{ids: [...]}`) — append or insert at position (existing behavior, make it flawless).
    b. OS files (via `e.dataTransfer.items` + `getAsFileSystemHandle()`) — add the files to the library first (with thumbnail generation), then add the resulting IDs to the active list. Reject disallowed types per list rules with a gentle toast ("Playlist only accepts video & audio").
    c. OS folders — treat exactly like Add Folder but auto-add the discovered media straight into the active list (Playlist or Slideshow) after the scan.
  - .json / .txt / .md files dropped onto a list pane → automatically route to the enhanced `importList()` flow (see below) with the dropped file.
- When the list already has items, dropping on the background area (below the last row or on the scroller) always appends.
- Keyboard-accessible alternative buttons ("Add Selected → Playlist") must continue to work perfectly and mirror the DnD result.

### 3. List Action Bar — Styling + Missing Functionality
All six buttons must receive consistent, premium, compact styling that feels cohesive with the rest of the dark UI:

- Introduce (or expand) a `.action-btn` / `.list-action` class:
  - 28–32 px tall, 11–12 px font, 6–10 px horizontal padding.
  - Subtle border, hover brightens background + slight lift (transform + shadow).
  - Active/pressed state with the --accent color used sparingly (e.g. text or thin underline).
  - Excellent focus-visible rings.
  - The "Import List…" button should sit flush-right (the current inline style is a hack — replace with proper flex or grid layout, perhaps two groups: organization left, import/export right).
- Wire every button:
  - Clear All → existing (add a lightweight confirm toast with Undo for 5 s).
  - Shuffle → existing.
  - Sort ▾ → **implement a tasteful menu**. On click, show a small floating panel (or `<select>` that you progressively enhance) with options: Name (A–Z), Name (Z–A), Duration, Date Added, Type, Size. Choosing one immediately re-sorts the current list in place and saves. The button label can stay "Sort ▾" or update to reflect the active sort (your elegant choice).
  - Reverse → implement (simple `reverse()` + re-render + save). This is the most common "I just want the opposite order" action.
  - Export… → enhance: offer a small menu or secondary choice "Export JSON" / "Export .txt (one path per line)". The .txt format must be perfectly round-trippable with the importer below.
  - Import List… → the hero feature of this refactor (detailed next).

### 4. Import List… — The Wedding Playlist Workflow (Highest Priority)
The user’s real-world need: they have folders full of music videos named exactly like the examples below and want to load an ordered playlist from a plain text file they maintain by hand or export from other tools.

Exact grammar the parser **must** support perfectly (these five lines are sacred test vectors):

```
"C:\Users\kyle_\Music\wedding\a-ha_-_Take_On_Me_Official_Video_4K [djV11Xbc914].mp4"
"C:\Users\kyle_\Music\wedding\AC_DC_-_Thunderstruck_Live_At_River_Plate_December_2009 [n_GFN3a0yj0].mp4"
"C:\Users\kyle_\Music\wedding\Alannah_Myles_-_Black_Velvet [tT4d1LQy4es].mp4"
"C:\Users\kyle_\Music\wedding\Berlin_-_Take_My_Breath_Away_Official_Video_-_Top_Gun [Bx51eegLTY8].mp4"
"C:\Users\kyle_\Music\wedding\Bob_Seger_The_Silver_Bullet_Band_-_Night_Moves_Official_Video [xH7cSSKnkL4].mp4"
```

Parser rules (be extremely tolerant and deterministic):
- One entry per line is primary.
- A line may also contain multiple entries separated by commas, semicolons, or tabs (common when people copy from spreadsheets).
- Paths may be surrounded by straight double quotes (") or not.
- Both backslashes and forward slashes are legal.
- Leading/trailing whitespace around each path is ignored.
- Filenames containing brackets, dashes, underscores, spaces, and unicode must survive round-tripping.
- After parsing a path, the importer extracts the basename and attempts to locate it in the current Media Library (exact name match → endsWith match → case-insensitive basename match).
- For every match found: create the appropriate ref (with default duration / includeAudio) and append to the **currently active list** (Playlist or Slideshow).
- For every path that has **no** matching item in the library:
  - Add it to a "Missing (N)" visual list in a post-import summary toast / modal.
  - Provide a prominent "Resolve missing paths…" button that opens a folder picker once. The chosen directory (and all subfolders up to depth 6) are walked; any basenames that match the missing set have their handles acquired and are added to the library + the list in one pass.
- Support drag-and-drop of the .txt file directly onto the list-editor (empty or not) — this must trigger the identical import flow.
- After a successful import, show a rich toast: "Imported 47/52 items into Playlist. 5 paths were missing — Resolve now?"
- Also accept .json and .md (with the same tolerant path extraction logic) for maximum flexibility.
- The active list (Playlist vs Slideshow) determines type filtering during import (silently skip incompatible types with a note in the summary).

Export must be able to emit the exact same .txt format (quoted absolute paths, one per line) so the user can round-trip their hand-maintained wedding lists.

### 5. Details & Features the Original Request Forgot (Add Them Because You Are Excellent)
- When an imported .txt references files the user has never granted access to, the "Resolve missing" flow described above is the elegant solution — do not just fail silently.
- Persist directory handles (new `state.directoryHandles`) alongside file handles so "Add Folder" on a parent can later offer "Refresh from original folders".
- Global "Import behavior" setting (subtle): "Append" (default) vs "Replace current list".
- After any import or large Add Folder, automatically switch the segmented control to the list that received items and scroll the first new item into view.
- Multi-file .txt import in one picker (user can select several playlist files at once).
- A tiny "Example .txt" button in the welcome or help that generates a downloadable sample using the five wedding lines + two real files from the repo's videos/ folder (so the user can test the parser instantly).
- All new surfaces respect `prefers-reduced-motion`, have excellent ARIA, and are fully keyboard operable (Tab order, Enter/Space activation, Escape to close any transient menus).
- Zero uncaught exceptions. Every picker, every drop, every parser step is wrapped. The user sees only friendly toasts.

## PowerShell Development Helpers (Update or Add)
Because the primary environment is Windows + PowerShell 7+:

- Enhance `scripts/Start-PlayerDev.ps1` (or create a companion `New-ImportTestList.ps1`):
  - Add a `-CreateWeddingTestList` switch that writes `samples/wedding-playlist.txt` containing the five sacred lines above plus 3–4 entries pointing at real files inside the repo's `videos/` folder (using their actual absolute paths at generation time). This gives the developer an instant, local, zero-setup test corpus for the importer.
  - Update the banner and `-Test` output to include a one-line "Test the new Import List feature" instruction that tells the user to drop the generated .txt onto the Playlist pane.
- The existing script is already excellent; keep its spirit and just extend it.

## Implementation Constraints
- Stay inside `src/player.html` (HTML + one `<style>` + one `<script>`).
- Prefer vanilla modern JS + CSS (container queries, :has(), view transitions where they add polish without complexity).
- Thumbnails, persistence, playback engine, Ken Burns, etc. must not regress.
- Update the version meta tag and add a crisp "2.1 — Import & Polish" block at the top of the JS.
- All new code must be commented at architectural seams.
- Performance: folder scans of 200+ items must feel instant; batch DOM updates and thumbnail generation.

## Success Criteria (How You Will Be Judged)
A first-time user on a fresh Chrome/Edge on Windows can:
1. Click Add Folder → point at their real wedding videos folder → see 50+ correctly typed cards in < 8 seconds.
2. Drag three cards into an empty Playlist while the app is playing something else.
3. Create a `wedding.txt` with the five sacred lines (or use the generated sample), click Import List… (or drop the file), and have the exact ordered list appear with zero manual relinking because the files are already in the library.
4. Hit Sort ▾ → "Duration", see the list reorder instantly, then Reverse, then Shuffle — all with perfect visual feedback and persistence on reload.
5. Export that list as .txt, open the file in Notepad, see clean quoted paths, then re-import it after clearing the list and get identical results.

## Rigorous Validation Protocol You Must Follow and Document
After you produce the new `src/player.html`:

1. Use the mental model of running `scripts/Start-PlayerDev.ps1`, Add Folder on `videos/`, build a small Playlist + Slideshow.
2. Create (in your mind or via a one-line note) a test `wedding-test.txt` using the five exact lines the user provided + three real videos/ filenames with their full Windows paths.
3. Run the importer against that .txt both via the button and via drag-drop onto the list pane.
4. Verify missing-path resolution flow (simulate by clearing library after import).
5. Exercise Sort + Reverse + styling on both lists.
6. Produce a "Validation Results" table in your final response with Pass / Fail + one-sentence evidence for each of the five numbered areas above, explicitly naming files and behaviors tested.

If any step requires a real browser + OS gesture you cannot perform, mark it "Requires Human Verification" and give the exact three-click manual test the creator should run.

## Execution Order (Recommended)
1. Audit everything listed under "Mandatory Pre-Work".
2. Design the CSS for the action buttons + drop states (one small cohesive addition).
3. Implement the recursive folder walker + directory handle storage.
4. Build the tolerant path parser as a pure function with unit-test comments (you can test it mentally against the five sacred lines).
5. Wire Sort ▾ (menu), Reverse, improve Export, and the full Import experience.
6. Strengthen all DnD surfaces (library ↔ lists, OS files/folders/txt onto lists, empty-state emphasis).
7. Add the PowerShell test-list helper.
8. Run the full Validation Protocol in your reasoning.
9. Deliver the complete updated `src/player.html` plus any .ps1 diffs or full new files as clean code blocks, plus the Validation table, plus a 4-bullet "What Changed" summary.

Do not add bloat. Make the secondary surfaces feel as lovingly crafted as the primary playback viewport. The user's daily  playlist ritual and creative blending sessions depend on this feeling "just right."

Now begin the audit, then deliver the refined experience.