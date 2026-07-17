# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Blend is a local-first, browser-based dual-layer media studio. It runs a **Playlist layer** (video/audio) and a **Slideshow layer** (image/video) simultaneously and blends them live. It is a zero-framework, no-build static web app: ES modules + browser-native APIs (IndexedDB, File System Access, Media, Fullscreen, Service Worker), served as static files. There is no bundler step for normal playback.

## Repository layout — versioned implementation folders

The repo ships one self-contained copy of the app per release under `src/`, e.g. `src/blend.v5.0.4/`, `src/blend.v5.0.11/`, plus older `src/slideshow-playlist-player.v4.x/`. Each folder is a complete standalone app with its own `package.json`, tests, and assets — they are **siblings, not a shared codebase**. Work happens inside the latest folder; the current working directory (`src/blend.v5.0.11`) is the active one.

Both the root `README.md` (source of truth) and `.github/workflows/sanity-tests.yml` (CI) may trail the active folder. Beware of other stale cross-references: root `VERSION` and `scripts/Start-PlayerDev.ps1` can reference legacy paths.

When changing the app, edit files in the active version folder and verify which folder any tooling/CI actually targets before assuming a change is covered.

## Commands

All commands run from **inside a version folder** (e.g. `cd src/blend.v5.0.11`), which holds its own `package.json`.

```bash
npm install              # dev deps only: @playwright/test, esbuild (app itself has no runtime deps)
npm run check            # node --check syntax-lint of every active JS module
npm run test:regression  # node --test on tests/regression/*.test.mjs
npm run test:e2e         # Playwright (auto-starts tests/e2e/fixture-server.mjs)
npm run sanity           # check + regression (this is `npm test`)
```

Run a single regression test file: `node --test tests/regression/storage-url-resolver.test.mjs`
Run a single e2e spec: `npx playwright test tests/e2e/sharing.e2e.spec.mjs`

Serve for manual testing (must be over HTTP, not `file://`, for modules + service worker):
```bash
npx serve -l 5173 --cors        # then open http://localhost:5173/index.html
```

## Test architecture

Two layers with different boundaries:
- **Regression** (`tests/regression/`, `node:test`): import the *small, side-effect-free modules directly* (`storage-url-resolver.js`, `supabase-auth.js`, `transition-manager.js`, `supabase-config.js`). They do **not** import `app.js` — it is a ~290KB browser-only orchestrator that touches `document`/`window` at load. To unit-test playback logic, replicate the narrow behavior against the resolver/manager modules (see `playlist-resilience.test.mjs`).
- **E2E** (`tests/e2e/`, Playwright): `fixture-server.mjs` serves the version folder over HTTP and mocks Supabase/IPFS storage endpoints. `support/blend-app-page.mjs` is the page object. `fullyParallel: false` — specs share the fixture server and run serially.

## Code architecture

`index.html` is the shell; `app.js` is the single orchestrator (state + UI wiring + import/export + playback + persistence). It pulls in focused modules:

- `storage-url-resolver.js` — normalizes media references (`http(s)`, `supabase://bucket/path`, bare `bucket/path`, legacy `ipfs://CID/...`) into public or signed-private object URLs, with retry/backoff and per-item failure isolation. This is the runtime media-resolution path.
- `supabase-config.js` — layered runtime config. Precedence: `overrides` → LocalStorage `blend-runtime-config-v1` → `globalThis.BLEND_RUNTIME_CONFIG`/`__BLEND_RUNTIME_CONFIG__` → frozen `PLACEHOLDER_DEFAULTS`. `.env.example` documents the placeholder set; the anon key it ships is a public Supabase anon JWT.
- `supabase-auth.js` — token/session lifecycle; session persisted in LocalStorage. Required only for signed private media.
- `transition-manager.js` — slideshow transition engine (17 effects, weighted selection, FPS-driven quality tiers, `prefers-reduced-motion` awareness).
- `drag-sort.js` — the pointer-events sortable that powers **all** playlist/slideshow row reordering (mouse, pen, touch). List rows are intentionally `draggable=false`; native HTML5 drag is not used for reorder (it only remains for dragging library cards *into* a list). The sortable reports an insertion *gap* in original-list coordinates and only captures the pointer once a drag actually begins (capturing on pointerdown would retarget the follow-up click and break click-to-select/play).
- `list-reorder.js` — pure, DOM-free reorder math (`computeMoveOrder`, `applyOrder`, `buildIndexRemap`). Shared by `app.js` and unit-tested in `tests/regression/list-reorder.test.mjs`. Selected items move as one ordered block to the insertion gap; everything at/after the gap shifts down. `app.js` tracks the multi-selection by ref id (`state.ui.listSelection`) so it survives reorders; Ctrl/Cmd-click toggles, Shift-click ranges, and Alt+↑/↓ moves the selection by keyboard.
- `logger.js` — structured logging with optional LocalStorage persistence.
- `pwa-config.js` — shared app/cache/database versions, precache assets, and cache policy metadata. It uses a global-object pattern so ES modules, tests, and the classic service worker can all consume it without a build step.
- `pwa-client.js` — service worker registration, install/update UI, worker messages, cache status, and alias snapshot sync.
- `alias-router.js` — pure alias validation and route resolution. It also uses a global-object pattern so the classic worker can load it with `importScripts()`.
- `alias-store.js` / `alias-sync.js` — IndexedDB alias persistence, manifest validation/downgrade guards, and worker snapshot synchronization.

`app.js` wiring entry points: `wireTransport()`, `wireConfig()`, `wireKeyboard()` (called from bootstrap after `openDB()`). State is a single in-memory `state` object (library map, dir handles, playlist/slideshow arrays, settings, experience catalog, runtime position/history). `window.Blend` exposes debug/integration helpers (switch experience, import/export, share).

### Persistence
- IndexedDB `player-blend-v1` (version 5): stores `library`, `playlist`, `slideshow`, `settings`, `experiences`, `thumbnails`, `dirHandles`, `aliases`, and `aliasMeta`. Bump `DB_VERSION` in `pwa-config.js` when changing the schema, and make `app.js` openDB migrations create the new stores.
- LocalStorage: `blend-active-experience-id`, `blend-runtime-config-v1`, `blend-supabase-auth-session-v1`, consent/banner flags.
- Version constants live in `pwa-config.js`: `APP_VERSION`, `ASSET_VERSION`, `CACHE_VERSION`, `DB_VERSION`, cache names, precache assets, and route policies. `app.js`, `index.html`, manifests, and service worker behavior should stay aligned with that source and the invariant tests.

### Service worker
`service-worker.js` is a classic worker that imports `pwa-config.js` and `alias-router.js`. It splits caches into shell/static/docs/API/alias namespaces, uses route policies, supports navigation preload, handles update/cache/alias messages, and serves `offline.html` as a last fallback. Media and HTTP `Range` requests intentionally bypass Cache Storage and go to network/local handles. `sw.js` is a compatibility shim for older registrations.

### IPFS modules are legacy
`ipfs-*.js` (and the ~2.8MB `ipfs-helia-provider.bundle.js`) are carried forward but are **not in the active v5 runtime path** — `ipfs://` references are handled by mapping rules in `storage-url-resolver.js`, not by these modules. Don't wire new features through them.

## Import/export schemas (keep stable for round-trips)
- List: `player.blend.list.v1` (JSON) plus `.txt`/`.md`/`.jsonl`
- Library: `player.blend.library.v1`
- Experience: `player.blend.experience.v2` (settings + library + both lists)

Path handling sanitizes control chars and rejects `..` traversal; folder scan depth is capped at `MAX_FOLDER_DEPTH = 6`.

## Conventions when extending
- No build step and no runtime dependencies — keep the app loadable as plain static ES modules. Add new logic as a small importable module so it can be regression-tested without `app.js`.
- Add a regression test for any change to persistence, import/export, or media resolution; add a targeted e2e spec for changed UI workflows.
- On a release, copy the active folder to the next `src/blend.vX.Y.Z/`, then bump the version/cache/schema constants together.
