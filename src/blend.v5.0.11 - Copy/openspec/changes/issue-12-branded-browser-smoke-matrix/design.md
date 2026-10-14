# Design

## Context

See [proposal.md](proposal.md) for motivation. `README.md` already distinguishes the full Playwright Chromium suite and selected Firefox/WebKit engine smoke from branded browser applications. `browser-compatibility.e2e.spec.mjs` attaches the Playwright project and engine version to each result. PWA shell assets are listed in `pwa-config.js`; the worker serves a cached navigation fallback when the network is unavailable.

The current machine is Windows. Chrome 155.0.8059.40 and Edge 155.0.4283.45 are installed. Safari is not installed. The Windows app-control approval timed out before a branded workflow could be run, so those installed versions are environment inventory only and their workflow results must be recorded as not run.

## Goals / Non-Goals

**Goals:**

- Define one repeatable smoke with synthetic local media and a disposable browser profile.
- Keep per-brand result fields distinct from Playwright project/engine evidence.
- State a useful next step when a browser is absent or a step cannot run.

**Non-Goals:**

- Add branded browser projects to Playwright or broaden Firefox/WebKit test selection.
- Change app code, manifests, service-worker behavior, or support guarantees without a reproduced product difference.
- Claim Safari, iOS, Android, or other operating-system coverage from this Windows run.

## Decisions

### Put the procedure beside the existing support matrix

Add a concise manual desktop smoke section and a dated result record to the README. This keeps the procedure next to the browser claims users inspect. A separate harness or runtime feature would add maintenance without improving this manual evidence boundary.

### Use one bounded local workflow per branded desktop browser

Use a fresh disposable profile and the same two-second synthetic H.264 test video in each branded desktop browser. Import the media, place it in a list, play it, enter and exit fullscreen, wait for the service worker to control the page, set the browser's network panel offline, and reload. Record whether the shell and saved local state recover. Restore network state and discard the disposable profile after each run. If a fixture cannot be generated, mark codec playback not run; do not substitute personal media.

Record browser brand, exact product version, OS version, run date, network state, each step outcome, and an unrun reason where applicable. Do not include private media, local paths, signed URLs, credentials, or unrelated-origin data in evidence.

Alternative considered: Add a Playwright `channel` project for branded Chromium applications. That would turn a deliberately manual smoke into automation, still would not provide Safari coverage, and would expand the suite without a reproduced defect.

### Keep missing results partial

An unavailable browser or blocked run is `Not run`, with its reason. It remains partial/unverified and does not contribute a branded pass. WebKit results continue to identify only the Playwright WebKit engine. Add a focused code change and regression coverage only after a concrete difference is reproduced in a branded browser.

## Risks / Trade-offs

- [A single synthetic media item cannot cover every codec or operating-system integration] → Keep the smoke small and describe its exact fixture and result; do not generalize the outcome beyond the tested browser/version.
- [Offline behavior can be confused with an unready service worker] → Wait for the app's worker status/control before toggling offline, then record the reload result explicitly.
- [The current Windows run has no Safari application or completed Chrome/Edge UI run] → Keep all three branded rows partial until a named manual workflow is completed; do not treat installed-version metadata as a test result.

## Migration Plan

No runtime or data migration is needed. Rollback removes the README procedure and dated record plus this OpenSpec change; no user data or app state is affected.
