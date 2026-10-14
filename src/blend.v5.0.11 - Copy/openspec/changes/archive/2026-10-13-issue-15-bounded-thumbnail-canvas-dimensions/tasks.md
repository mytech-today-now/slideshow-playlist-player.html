# Tasks

## 1. Bound thumbnail canvas dimensions

- [x] 1.1 Extend `thumbnail-failures.e2e.spec.mjs` to record current source and output dimensions for ordinary and extreme synthetic image/video sizes with a canvas stub, so baseline sizing is measured without allocating extreme canvases. Verified with `npm run test:e2e -- tests/e2e/thumbnail-failures.e2e.spec.mjs --project=chromium --grep "records the current thumbnail canvas dimensions"` (1 passed; Chromium 153.0.8010.12).
- [x] 1.2 Add one shared 320-pixel maximum-edge sizing helper, use it for image and video thumbnail canvases, assert proportional bounds and invalid-dimension fallback, and retain the existing failure-settlement coverage. Verified with `npm run test:e2e -- tests/e2e/thumbnail-failures.e2e.spec.mjs` (12 passed across Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6).

## 2. Verify preservation and report evidence

- [x] 2.1 Run `npm run test:e2e -- tests/e2e/add-files-selection-limit.e2e.spec.mjs`; exact-cap import remained at 250 items across Chromium, Firefox, and WebKit. The full spec passed 25 tests and skipped 2 Chromium-only quota cases in non-Chromium projects.
- [x] 2.2 `npm run check` passed (exit 0), `npm run test:regression` passed 360/360 (exit 0), and strict OpenSpec validation passed (exit 0). The cross-engine synthetic tests recorded Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6; source dimensions included 4032x3024, 3840x2160, and 160x16000; maximum output edge was 320px. A 320x320 RGBA output surface is 409,600 bytes; at two active jobs the theoretical pair is 819,200 bytes. These synthetic assertions do not allocate or decode extreme media.
- [x] 2.3 On the user-approved local Windows profile, import a generated 4032x3024 JPEG and 3840x2160 H.264 video through the real Add Files queue. `npm run test:e2e -- tests/e2e/issue15-profile.local.e2e.spec.mjs --project=chromium` passed (1/1, Chromium 153.0.8010.12). Both source rows remained, the two-slot queue drained, canvases were 320x240 and 320x180, and no page errors occurred. The sampled aggregate Chrome-process working set and its limitations are recorded in `measurement-results.md`; no OOM or low-memory failure was reproduced.

## Workflow follow-up

- The delta requirement was synced to `openspec/specs/thumbnail-canvas-bounds/spec.md`; `openspec validate --specs` passed.
- This change was archived at `openspec/changes/archive/2026-10-13-issue-15-bounded-thumbnail-canvas-dimensions/` after all five OpenSpec tasks and strict validation passed.
- `bd show blend-yb7` confirmed the issue closed after the profile evidence was recorded.
- The available local profile is a high-memory desktop profile, not a constrained-memory target. It does not establish a portable decoder allocation budget or justify source-byte/dimension rejection without a reproduced resource failure.
