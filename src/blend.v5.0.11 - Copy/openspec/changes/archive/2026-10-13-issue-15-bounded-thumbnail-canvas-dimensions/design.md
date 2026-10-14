# Design

## Context

See `proposal.md` for the confirmed unbounded canvas-height calculation and the unconfirmed generalized decoder-memory hypothesis. The completed `issue-11-canvas-thumbnail-settlement` change already defines one-shot settlement, cleanup, queue-slot release, and the playable-media fallback; those guarantees remain in force. An owner-approved local profile has now exercised actual Add Files decoding for a 12 MP image and 4K video. Both previews succeeded, and no OOM or low-memory failure was reproduced. The profile and its measurement limits are recorded in `measurement-results.md`.

## Goals / Non-Goals

**Goals:**

- Keep both image and video output canvases within 320 by 320 pixels.
- Preserve source aspect ratio to integer-pixel rounding for valid dimensions.
- Keep failures on the existing optional-preview fallback path.
- Record a representative local browser profile and source dimensions without treating aggregate process memory as a per-item decoder budget.

**Non-Goals:**

- Establishing a portable, per-item browser decoder allocation limit from one local profile.
- Rejecting imported files by byte count or source dimensions without a reproduced resource failure.
- Changing the 250-item import limit, lazy scheduling, persistence, thumbnail cache, or playback source.

## Decisions

- Add one private dimension helper in `app.js`, shared by image and video thumbnail callbacks. For finite positive source dimensions, scale down uniformly so the longest output edge is at most 320 pixels, round to integer pixels, and clamp each edge to 1–320. Invalid dimensions settle to the existing preview fallback instead of creating an invalid or oversized canvas.
- Keep 320 pixels as the maximum edge because it is the current thumbnail canvas width. Applying that bound to both axes extends the existing output scale without inventing an imported-media rejection policy. A crop to a fixed 16:9 canvas was rejected because it would discard portrait content.
- Use synthetic source dimensions and canvas API stubs in browser tests. This records requested source and output dimensions without allocating a large canvas or decoding extreme media. Existing fault-injection tests continue to verify queue drain, retained library rows, fallback, and playback.
- At two active thumbnail jobs, two maximum RGBA destination surfaces have a theoretical combined pixel buffer of 819,200 bytes (about 0.78 MiB). This is an output-surface estimate only; browser decoder buffers, encoder copies, implementation overhead, and peak device memory are not measured by it.
- Use the approved local Playwright Chromium profile to import and decode generated 4032x3024 image and 3840x2160 video fixtures through the real Add Files queue. Record compressed fixture sizes, intrinsic dimensions, proportional canvas dimensions, per-source RGBA estimates, queue state, and sampled browser process working sets. These results are observations from this host, not a portable allocation cap.

## Risks / Trade-offs

- Source decoding can still allocate memory proportional to actual media dimensions; bounded destination canvases do not establish a full decoded-memory budget. The measured host had 64 GiB of RAM, Chromium reported 32 GiB through `navigator.deviceMemory`, and no memory limit was imposed. Low-memory devices remain unmeasured.
- Sources with invalid intrinsic dimensions receive no preview and use the existing icon fallback; the imported media item and its source handle remain available.

## Migration Plan

No persisted data, import format, IndexedDB schema, or PWA asset contract changes. Reverting the two canvas-size call sites and their focused assertions restores prior preview sizing; imported media and cached state do not need migration.

## Open Questions

- None for this scoped change. A future low-memory support policy would need a separately approved profile and a reliable decoder-memory measurement method.
