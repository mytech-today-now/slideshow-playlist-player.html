# Design

## Context

See proposal.md for the evidence gap. The existing `directory-scan-lifecycle` spec already defines the user-visible pause, resume, permission-loss, cancellation, and saved-batch behavior. The remaining work is to exercise the importer orchestration and paused status with targeted browser tests.

## Goals / Non-Goals

**Goals:**

- Verify permission loss after a saved 250-media batch returns a partial outcome without re-enumerating or duplicating saved items.
- Verify the live paused status and its cancel action at the requested desktop, tablet, and mobile viewport sizes.
- Keep the active status before the sticky configuration header, inside the dialog and focus trap, so a short panel does not clip the status or its cancel action.
- Attempt native tab switching without overriding `document.visibilityState`; keep an unavailable hidden state classified as unverified.

**Non-Goals:**

- Do not alter scan scheduling, batching, limits, persistence, or user-facing result wording unless a native mismatch is reproduced.
- Do not treat viewport emulation as physical-device evidence.
- Do not change the source report, external providers, or unrelated dirty work.

## Decisions

- Add the lifecycle cases to the existing visibility E2E spec. The permission-loss case belongs at this integration layer because it must observe the 250-item persistence batch and the app's partial-result UI; the side-effect-free yield module cannot model those effects.
- Use a controlled directory iterator that hides at a 24-entry yield boundary and throws a named `NotAllowedError` only after visibility resumes. Assert the same iterator ran once, the saved 250 rows remain unique, and the scan ends partial.
- Place active scan progress before the sticky configuration controls while the dialog is open. This keeps the status inside the dialog's focus trap and at its visible top edge on short screens.
- Exercise the paused status at 320×480, 360×800, 375×667, 390×844, 430×932, 768×1024, 1024×768, and 1280×720. Check text wrapping, document and status bounds, button target geometry and hit testing, keyboard focus visibility, and touch cancellation. Use unsupported synthetic entries for this layout-only case so it does not depend on a browser's synthetic file-handle persistence.
- Skip the 250-file persistence integration case in WebKit after the runner fails to commit the synthetic handle batch; keep its saved-batch result unverified there.
- Keep native visibility checks separate. A runner that never exposes native `hidden` produces an explicit skipped/unverified result; no synthetic visibility injection may satisfy that native assertion.

## Risks / Trade-offs

- Browser-engine viewport and touch emulation cannot establish physical-device behavior → report device checks separately as Not run.
- The browser runner may not expose a native hidden document → record the engine/version and skip reason as unverified; leave the tracker open for native/device evidence.
- The extra fixtures exercise existing limits and may reveal an actual integration defect → make only the smallest fix backed by that failure; otherwise leave runtime code unchanged.

## Migration Plan

No data or runtime migration is required. Rollback consists of reverting the scan status placement and styling, added scan E2E cases, and this OpenSpec change; preserve any unrelated edits already present in `app.js` and issue-14 files.
