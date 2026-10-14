# Design

## Context

See `proposal.md` for the motivation. `tests/e2e/local-import-bounds.e2e.spec.mjs` currently exercises list and experience imports in a single test. Its keyboard helper focuses the import button before it registers the `filechooser` waiter. The page object already arms chooser waiters before clicking import controls; this change is confined to the boundary spec.

## Goals / Non-Goals

**Goals:**

- Make the experience boundary flow start with a fresh Playwright page and no earlier list-picker interaction.
- Ensure each keyboard activation has an armed chooser waiter and a deliberate focus transition.
- Preserve the existing assertions for parser outcomes, rejected size, import state, and parser/read counts.

**Non-Goals:**

- Change the production byte limit, parser, import transaction, or picker implementation.
- Claim that Playwright's synthetic file selection verifies an operating-system picker.
- Add runtime dependencies or introduce an app-side test hook.

## Decisions

1. **Separate list and experience boundary cases into different tests.** A Playwright `page` fixture gives the experience flow a fresh page and browser context state. Keeping the three experience sizes in one test preserves their intentional serial order and allows the over-limit case to compare against the preceding valid import.
2. **Register the chooser waiter before any focus or keyboard action.** Then blur the current active element, focus the button selected by its existing ID, assert focus, and press Enter. This follows the user's keyboard path while avoiding a stale focused control between selections.
3. **Wait for each import outcome before the next activation.** Existing toast and instrumentation assertions remain the completion signals; no arbitrary delay is introduced.
4. **Keep production code untouched.** A chooser timeout remains a test-harness failure. Only a reached exact/over-limit import assertion can provide evidence for changing product behavior.

## Risks / Trade-offs

- [A supported browser may still fail to emit Playwright's filechooser event] → Report the E2E run as unavailable or failed at the harness boundary; do not report it as a product import rejection or as a pass.
- [Synthetic selection does not exercise the OS picker UI] → Keep operating-system picker behavior as a separate, unverified manual check.

## Migration Plan

No application migration or user-data change is involved. If the revised test setup proves unreliable, revert only the helper and test split while retaining the existing byte-boundary and state-preservation assertions. No production rollback is needed.
