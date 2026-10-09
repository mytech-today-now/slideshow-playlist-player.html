# Design

## Context

See [proposal.md](proposal.md) for motivation. The app already falls back to file inputs when File System Access picker APIs are absent, stores picker-imported file data in IndexedDB, exposes a polite PWA status region, and uses a shared live region for toast messages. Folder fallback currently assumes `webkitdirectory`; fullscreen errors are swallowed or can throw when the API is missing. Playwright has one implicit Chromium project and CI already uploads its HTML report.

## Goals / Non-Goals

**Goals:**

- Keep all current E2E specs on Chromium while restricting Firefox and WebKit to one focused compatibility spec.
- Make fallback/import outcomes and unavailable fullscreen/offline capabilities observable to keyboard and assistive-technology users.
- Record browser project and runtime engine version in each compatibility smoke test result.
- Exercise one synthetic expired private-media URL without an authenticated session and verify that user-facing status and diagnostics omit private paths and bearer URL data.
- Describe engine evidence separately from branded desktop browsers and mobile devices.

**Non-Goals:**

- Running the entire suite on every engine or emulating iOS/Android as proof of device behavior.
- Changing media schemas, IndexedDB schema, remote auth, service-worker caching policy, or playback.
- Adding runtime or browser automation dependencies.

## Decisions

### Keep the full suite on Chromium and add focused projects

Add named Chromium, Firefox, and WebKit projects. Chromium keeps the default full test selection. Firefox and WebKit use a `testMatch` limited to `browser-compatibility.e2e.spec.mjs`. CI explicitly installs those three Playwright browsers; the existing report artifact remains the source for CI results.

Alternative considered: duplicate the full suite across all three engines. That increases runtime and multiplies unrelated cross-engine failures before the targeted fallback branches have coverage.

### Attach runtime engine evidence to each smoke result

The focused spec attaches the Playwright project name and `browser.version()` as plain text to each test result. The test itself follows an explicit supported or unavailable API branch; it does not skip an engine because a feature is absent.

Alternative considered: document a static version number in README. The installed Playwright browser changes with the lockfile, while the CI artifact captures the actual runtime version.

### Reuse existing status regions for limitations

Use `#toast-container` for file/folder/fullscreen outcomes and `#pwa-status` for offline-shell support. Add a labelled name to the fullscreen control and dynamically created file input. If the browser lacks directory-input support, do not open a nonfunctional picker; announce Add Files as the individual-file route.

Alternative considered: introduce a new cross-browser notification subsystem. Existing live regions already provide the needed visible and accessible status without new UI infrastructure.

### Keep private-media authorization failures opaque across engines

The focused compatibility spec seeds a synthetic expired signed URL with a portable private storage reference and no session. It asserts generic auth-required feedback, preserved media state, and no private path or bearer URL in the toast, console, or persisted debug log.

Alternative considered: repeat the full private-media suite in Firefox and WebKit. A single deterministic failure case checks the shared diagnostic boundary without multiplying unrelated auth and playback flows across engines.

### Qualify the README by evidence source

Retain the broad browser list but state that Chromium is the full automated baseline, Playwright Firefox and WebKit are focused engine runs, Edge has Chromium-family expectations but no branded Edge run, and iOS Safari/Android Chrome lack device runs. Do not call Playwright WebKit a Safari test.

## Risks / Trade-offs

- [Playwright WebKit is not the Safari application] → Keep the Safari row partial and identify WebKit as engine-only evidence.
- [Browser API support may vary by operating system or user settings] → Test detected supported/unavailable branches and retain mobile and platform caveats.
- [A browser may support the directory input property but not accept a directory payload in automation] → Assert the detected unsupported explanation where capability is absent; CI failures remain visible rather than skipped.
- [A committed IndexedDB save does not grant persistent permission to the original folder] → Say that file bytes are saved and source-folder access is not retained.

## Migration Plan

No data migration is required. CI installs the configured browsers before running tests. Rollback can remove the extra Playwright projects, smoke spec, user-facing fallback messages, and README evidence notes without changing stored data.
