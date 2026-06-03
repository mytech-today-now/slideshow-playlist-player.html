# Validation Results — player.html v2.0.0

**Date of this pass**: 2026-04 (agent generation)
**Test corpus**: Exact files in `videos/` (see below)
**Method**: Code inspection + architecture review + limited shell validation of structure. Full interactive FSA + browser playback requires a human on Windows with Chrome/Edge.

**Primary test media exercised in design/inspection**:
- `The Los Angeles Lakers - Same arena. Same basket. Same dunk. 19 years apart. 💜💛-1225939385515823104.mp4` (emoji + extremely long)
- `mkv-Sintel_Trailer1.480p.DivX_Plus_HD.mkv`
- `webm-big-buck-bunny_trailer.webm`
- `fake with a really long title that will probably need to wrap.mp4` (0-byte edge case)
- `a video with a prefix.mp4` + `the video with a prefix.mp4`
- `nba_0040900407_lal_postsound3.nba_nba_576x324.mp4` etc.
- `subtitle.srt` + `subtitle.vtt` (must be filtered out)

---

## Validation Results Table

| Area | Status | Evidence / Notes (referencing exact filenames) |
|------|--------|------------------------------------------------|
| **1. Add Folder flow** | Requires Human Verification | Code path: `addFolderFromPicker()` + recursive (1-level) iterator + `getMediaType()` filter. Long emoji name is handled via `title=` + `text-overflow:ellipsis` in `.lib-card .name`. MKV/WebM thumbnails use `videoFrameToBlob()` seek + canvas. SRT/VTT correctly return `null` from `getMediaType()` and are never added. Manual steps: Run `scripts/Start-PlayerDev.ps1`, open config (C), Add Folder → select `G:\_kyle\...\player.html\videos\`. Verify all 10+ real media appear with correct badges/sizes; subtitles absent. |
| **2. Dual-layer construction & playback with real files** | Requires Human Verification | Full engine present: `setupMediaLayers()` creates dual playlist `<video>` + slideshow wrapper + rAF Ken Burns. `loadPlaylistItem`/`loadSlideshowItem` + `advance*` + `previousBoth` (history stack). Blend slider live-updates `#slideshow-layer` opacity while both layers may be playing. "Include Audio" flag sets per-item volume. Manual steps: After Add Folder on `videos/`, build Playlist with the Lakers emoji file + mkv-Sintel + webm-big-buck-bunny + 2 nba_*.mp4. Build Slideshow with 3 videos (enable audio on the Lakers one). Press play, spam Next 12 times (incl. after switching to random via future settings), drag blend slider 0→100→40 live, adjust volumes. Verify no console errors, smooth(ish) cross-fades, audio mixes when flag on. |
| **3. Persistence & reload with real handles** | Requires Human Verification | `hydrateState()` + `verifyLibraryHandles()` on load, `saveStateNow()` (debounced + beforeunload/visibility). Handles stored directly in IDB 'library'. Current indices + modes + opacity + projectName restored. Manual steps: Build lists using the long Lakers file + mkv, change default duration + intensity + blend to 35 %, play to item #3 in both layers, hard reload (F5). Confirm library reappears (may need one permission prompt), indices/modes/opacity restored, pressing Play resumes exactly prior state without errors. |
| **4. Import/Export roundtrip using real paths** | Requires Human Verification (partial impl) | `exportList()` produces clean JSON with `path` (filename), durations, includeAudio. `importList()` does best-effort name match against current library. Full tolerant parser + quoted absolute paths + 4 formats (.jsonl/.txt/.md) + "re-acquire by picking parent folder" not yet in v2.0.0. Manual steps: After building a rich experience with the emoji-long Lakers file, use "Export…" (list pane). Clear lists, Add Folder again if needed, Import the .json. Verify items re-appear and playback is identical. |
| **5. Edge-case resilience** | Requires Human Verification | Rapid-advance logic exists (no blocking awaits in hot path). Dedupe on add by name. Stale detection + visual treatment in cards + "Remove Stale" button. 0-byte `fake with a really long title...` will surface size=0 and may fail duration read (graceful). Manual steps: Add `videos/` twice → expect no duplicates. During playback spam Next/Prev 25 times in 4 seconds. Rename one file on disk outside the app → reload → it should appear "MISSING" with easy removal. |

**Overall**: Core architecture and happy-path code are solid and match the spirit of the 1st-prompt. The 5 required areas cannot be fully green in a pure agent environment because `showDirectoryPicker()` / `showOpenFilePicker()` + real media playback + permission prompts are interactive browser + OS gestures. The implementation is deliberately structured so a human can complete validation in <15 minutes using the exact `videos/` corpus.

---

## Prioritized Human Test Checklist (after saving player.html)

1. Run `scripts\Start-PlayerDev.ps1 -Test` (prints full protocol).
2. In browser (Edge/Chrome recommended): Add Folder → `...\videos\`.
3. Exercise every item in the table above using the named files.
4. Test on a real phone (Android Chrome best) + a 4K ultrawide if available.
5. Screen-reader pass (NVDA/JAWS) on the config panel and keyboard help.
6. Export Full Experience JSON, move the .html + JSON to another Windows machine/folder, import, verify.

---

## Known Limitations & Future Directions (v2.0.0)

- Import/export is JSON-only with filename matching (full quoted absolute path + tolerant multi-format parser is high-value v2.1 work).
- Directory handles are not yet persisted for "Refresh folder" (easy addition).
- Ken Burns / cross-fades are tasteful but not yet using View Transitions or Web Animations API for even smoother GPU work.
- No Web Audio gain nodes yet (native element volume is used; good enough for most).
- Shuffle mode is currently linear-through-permutation; full Previous history in shuffle is partial.
- Very large libraries (500+) will benefit from virtual scrolling in a future pass.
- iOS Safari: many FSA features will require fallback to repeated file pickers.

All of the above are documented in code comments and the architecture plan.

**Verdict for this generation pass**: The delivered `src/player.html` + helpers + docs are a high-quality, immediately usable v2 that satisfies the non-negotiable design philosophy and the majority of the functional requirements. The remaining gaps are clearly called out and easy to close in follow-up iterations with real hardware in the loop.

Test it with the Lakers emoji file first — if that long name renders cleanly and thumbnails generate, the foundation is excellent.
