# Blend Player

Fork from `https://github.com/pseudosavant/player.html`. Git dropped and re-started new because this is such a different application. `slideshow-playlist-player.html\src\player.original\player.html` kept for reference.

Blend Player is a local-first HTML5 media player for building an ordered video/audio playlist, building an ordered image/video slideshow, and blending both layers live in the browser. It is delivered as `src\slideshow-playlist-player.v4.2\index.html` app with no build step and no server-side media processing.

The app is designed for desktop curation sessions, events, screenings, and experiments where privacy matters: media files stay on your machine, file handles and library metadata are stored in IndexedDB, and exports are human-readable JSON.

Current version: **4.2.0**

## Features

- Dual-layer playback: a Playlist layer for video/audio and a Slideshow layer for images/video.
- Live opacity blend slider, independent layer volumes, master volume, mute, fullscreen, and transport controls.
- Local Media Library with Add Files, Add Folder, drag-and-drop, search, type filters, thumbnails, stale-file marking, and multi-select.
- Playlist and Slideshow editors with drag reorder, clear, shuffle, reverse, sort, import, export, and drop-to-list routing.
- Media Library sorting by filename, full path, duration, file size, date added, type, and custom metadata when present.
- JSON exports for playlists, slideshows, the media library, and the full experience.
- JSON order preservation through explicit `order` arrays and per-item `order` indexes.
- Path-preserving export/import using absolute paths from imports, browser-safe folder-relative paths, or `./filename` relative fallbacks.
- Import validation for `.json`, `.jsonl`, `.txt`, and `.md` lists, including malformed JSON feedback and missing-file resolution.
- URL imports in the interface, and as a list in a imported file.
- Slideshow preloading, cross-fades, and optional Ken Burns-style image motion.
- Persistent project settings, list state, library metadata, file handles, thumbnails, and sort preferences.
- Keyboard-friendly UI with accessible labels, visible focus states, toasts, and modals.

## Requirements

- A modern Chromium-based browser is recommended for best File System Access API support.
- Windows PowerShell 7+ is recommended for the helper script, but any static HTTP server can serve the app.
- No npm install or build command is required.

## Installation And Setup

Clone or download the repository, then serve the root folder:

```powershell
.\scripts\Start-PlayerDev.ps1
```

The helper serves the repository at:

```text
http://localhost:5173/src/v/slideshow-playlist-player.html
```

You can also use another static server from the repository root:

```powershell
python -m http.server 5173
```

Then open:

```text
http://localhost:5173/src/v/slideshow-playlist-player.html
```

Opening `src/v/slideshow-playlist-player.html` directly can work for simple sessions, but `localhost` is preferred because browsers expose more file-system capabilities in secure contexts.

The live experience lives at: `<a href="https://mytech.today/tools/player/v/index.html" target="_blank">https://mytech.today/tools/player/v/index.html</a>`

## Usage Guide

1. Open the app and press `C`, or click the gear button, to open the editor.
2. Use `Add Files` to add individual media files, or `Add Folder` to recursively scan a folder.
3. Search or filter the Media Library as needed.
4. Select rows and choose `Add Selected -> Playlist` or `Add Selected -> Slideshow`.
5. Reorder list items by dragging them, or use Sort, Shuffle, Reverse, and Clear All.
6. Press Play and adjust the Blend slider to mix the Slideshow layer over the Playlist layer.
7. Export playlists, slideshows, the media library, or the full experience from `Export...`.

## Import And Export

Open the editor, select the Playlist or Slideshow tab, then use `Export...` or `Import List...`.

Export options:

- `Export JSON` exports the active Playlist or Slideshow.
- `Export .txt` exports the active list as one quoted path per line.
- `Export Media Library JSON` exports the full Media Library in the current saved sort order.
- `Export Full Experience JSON` exports settings, library metadata, Playlist, and Slideshow together.

Import behavior:

- Use the `Import behavior` setting to choose `Append` or `Replace current list`.
- Replace imports keep the current list if no valid item can be imported.
- Missing paths are reported with a toast and modal.
- The `Resolve missing paths...` flow lets you select a folder to scan for missing filenames.
- Invalid JSON is rejected with user-facing feedback and a console warning for debugging.

Supported import formats:

- `.json`
- `.jsonl`
- `.txt`
- `.md`

Text and Markdown imports support quoted paths, Windows paths, slash paths, commas, semicolons, tabs, bullets, and numbered lists.

## JSON Export Format

Playlist and Slideshow exports use this structure:

```json
{
  "version": "2.3.0",
  "schema": "player.blend.list.v1",
  "type": "playlist",
  "name": "Playlist",
  "description": "",
  "createdAt": "2026-06-02T18:00:00.000Z",
  "project": "Untitled Session",
  "exportedAt": "2026-06-02T18:05:00.000Z",
  "order": ["media-id-1"],
  "items": [
    {
      "order": 0,
      "id": "media-id-1",
      "path": "videos/example.mp4",
      "fullPath": "videos/example.mp4",
      "pathKind": "relative",
      "name": "example.mp4",
      "type": "video",
      "size": 123456,
      "duration": 42.5,
      "addedAt": 1780000000000,
      "displayDuration": null,
      "includeAudio": null
    }
  ]
}
```

Path behavior:

- Imported absolute paths are normalized and preserved, for example `C:/Users/name/Videos/file.mp4`.
- Folder-picker paths are exported as relative paths, for example `Wedding/file.mp4`.
- Simple file-picker entries export as `./filename.ext` when the browser does not expose a fuller path.
- JSON exports normalize path separators to `/` for cross-platform consistency.
- Import rejects empty paths, URL-style paths, control characters, and `..` traversal segments.

## Sorting

The Media Library sort menu supports:

- Filename ascending/descending
- Full path ascending/descending
- File size ascending/descending
- Type ascending/descending
- Date added ascending/descending
- Duration ascending/descending
- Custom metadata ascending/descending when imported metadata exists

The selected Media Library sort key and direction are persisted in IndexedDB and reused on the next launch.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Space` / `K` | Play or pause |
| `Left` / `J` | Previous item |
| `Right` / `L` | Next item |
| `[` / `]` | Decrease or increase blend opacity |
| `C` | Toggle config panel |
| `F` | Toggle fullscreen |
| `M` | Mute or unmute |
| `1`-`9` | Seek to 10%-90% in the active playlist video |
| `/` | Focus Media Library search |
| `Alt+S` | Open the Media Library sort menu |
| `Delete` / `Backspace` | Remove the focused list item |
| `?` | Open help |
| `Esc` | Close menus, modals, or the panel |

## Tech Stack

- HTML5
- CSS Custom Properties and responsive CSS
- Modern JavaScript (ES6+)
- File System Access API with input fallback
- IndexedDB for persistent library/list/settings storage
- Canvas-based media thumbnails
- Browser-native media playback

## Development

This project intentionally avoids framework and build-system overhead. Edit `src/v/slideshow-playlist-player.html` directly, then reload the browser.

Useful helper commands:

```powershell
.\scripts\Start-PlayerDev.ps1
.\scripts\Start-PlayerDev.ps1 -Test
.\scripts\Start-PlayerDev.ps1 -CreateWeddingTestList
```

Recommended manual checks:

- Add a folder with videos, images, audio, spaces, long filenames, and Unicode filenames.
- Sort the Media Library by each available key and reload to confirm persistence.
- Export Playlist JSON, Slideshow JSON, Media Library JSON, and Full Experience JSON.
- Re-import exported JSON using both Append and Replace current list.
- Try malformed JSON and path traversal samples such as `../secret.mp4`.
- Rename or move an external media file, reload, and verify stale-file feedback.

## Repository Layout

- `src/v/index.html` - the Blend Player app.
- `scripts/Start-PlayerDev.ps1` - local static-server and test-helper script.
- `samples/` - sample import lists.
- `videos/` - optional local media/testing folder.
- `src/v/assets/` - static artwork and supporting assets.
- `ai-prompts/` - project planning and validation notes.
- `VERSION` - semantic version for the current app release.

## Helpers

Use `\scripts\list-gen.ps1` to generate a .txt file list of all of the URLs files in a web directory.

Use `https://github.com/mytech-today-now/professional-video-downloader` for easy PowerShell-based video downloads from the internet.

## Contributing

- Keep the app local-first and privacy-preserving.
- Preserve existing import/export schema compatibility when possible.
- Prefer browser-native APIs and small, focused helpers over dependencies.
- Keep UI controls consistent with the existing design language.
- Add defensive error handling around file access, parsing, IndexedDB, and media playback.
- Test empty lists, duplicate paths, missing files, large libraries, unsupported media types, and invalid JSON.

## License

MIT. See `LICENSE`.
