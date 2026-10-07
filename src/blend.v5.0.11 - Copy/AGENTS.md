# Blend Player v5.0.11 — Agent Instructions

## Scope and project shape

- Treat this directory as a self-contained, versioned app. Keep changes here; do not edit the parent repository or sibling app versions unless the task asks for it.
- `index.html` is the app entry point. `slideshow-playlist-player.html` is a compatibility redirect.
- This is a local-first static app built with browser-native APIs and ES modules. Normal playback has no build step or runtime package dependencies.
- Read the local `README.md` and `CLAUDE.md` for feature and architecture context. Check this directory's `package.json` before relying on a command; copied docs may refer to paths outside this checkout.

## Augment Extensions

- When a task may use shared extension guidance, inspect `.augment/extensions.json` if present and run `augx list --linked`.
- Use `augx show <module-name>` for a linked module's instructions and `augx search <keyword>` to find relevant modules.
- This checkout currently has no `.augment/extensions.json`, and `augx list --linked` reports no linked modules. Do not assume unrelated modules apply.

## Commands

Run commands from this directory. Available package scripts are:

- `npm run check` — syntax-checks the app's JavaScript modules.
- `npm run test:regression` — runs the Node.js regression tests.
- `npm run test:e2e` — runs Playwright tests; the config starts the local fixture server.
- `npm run sanity` or `npm test` — runs syntax checks and regression tests.

Use the narrowest relevant check first, then broader checks when the change warrants them. For manual browser checks, serve the folder over HTTP; ES modules and service workers do not work correctly from `file://`.

## Architecture and change boundaries

- `app.js` is the browser-only application orchestrator and accesses `window` and `document` at load time. Regression tests should target the focused, side-effect-free modules rather than importing `app.js` in Node.
- Put reusable logic in small ES modules where practical. Add or update regression coverage for changed logic and Playwright coverage for changed browser workflows.
- Keep import/export formats, persisted data, media URL resolution, and playback behavior compatible unless the task explicitly changes those contracts.
- If changing IndexedDB stores or schema, coordinate the `DB_VERSION` in `pwa-config.js` with the database migration in `app.js` and its tests.
- If changing PWA caching or offline behavior, check `pwa-config.js`, `service-worker.js`, `sw.js`, manifests, and relevant tests together. Media and HTTP range requests have special cache behavior; preserve it unless the task requires a change.
- Keep the app usable as static files without adding runtime dependencies or introducing a build requirement without a clear need.
- Treat `.env.example` as placeholders only. Never add real credentials to source, tests, logs, or documentation.

## Working rules

- Inspect the relevant files and `git status` before editing. Preserve unrelated changes and keep the patch focused.
- Follow existing module and test patterns; verify commands from the local package instead of importing scripts or workflows from another repository.
- Do not assume Beads, OpenSpec, release synchronization, or workspace-level tooling is configured here; check for local configuration before using those workflows.
- Report the checks actually run and any relevant gaps. Do not describe a local test or syntax check as proof of live-service, deployment, or full browser behavior.
