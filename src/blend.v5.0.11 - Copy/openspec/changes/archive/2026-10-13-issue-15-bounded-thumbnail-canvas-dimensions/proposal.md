# Proposal

## Why

Both thumbnail helpers cap canvas width at 320 pixels but let canvas height grow with the source aspect ratio. A tall supported image or video can therefore create an unexpectedly large preview canvas; no out-of-memory event or decoded-memory failure has been reproduced.

## What Changes

- Bound the output canvas dimensions for image and video thumbnails independently of source dimensions while preserving aspect ratio.
- Keep imported media, playback sources, lazy preview generation, and the existing per-item failure fallback intact.
- Do not reject media by source byte size or dimensions unless a resource failure is reproduced.

## Capabilities

### New Capabilities

- `thumbnail-canvas-bounds`: Defines a source-independent maximum size and proportional output for generated thumbnail canvases.

### Modified Capabilities

None.

## Impact

The change is limited to thumbnail sizing in `app.js` and focused browser coverage in `tests/e2e/thumbnail-failures.e2e.spec.mjs`. It adds no runtime dependency or persisted-data change. Beads tracking: `blend-yb7` (report issue-15). Owner-approved real-device memory evidence remains a separate open measurement.
