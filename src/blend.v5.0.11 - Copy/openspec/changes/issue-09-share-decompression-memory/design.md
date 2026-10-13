# Design

## Confirmed behavior and testable assumption

Confirmed in this checkout: `url-share.js` allows 50 MiB of decompressed output, keeps emitted chunks in an array, allocates a second contiguous `Uint8Array`, decodes the bytes to a JavaScript string, and parses JSON. The current URL import path validates before staging and commits the import atomically, but its failure handler also removes the source share parameters.

Testable assumption from the source report: a near-limit accepted share can exceed available memory on a low-memory mobile browser. No out-of-memory failure or target-device memory budget is available in this checkout.

## Decision

Set the output ceiling to 8 MiB as a conservative policy, not as a measured device-specific safe threshold. This is below the existing 10 MiB local experience-import file limit, so a JSON backup within that import limit remains a recovery route. Larger shares need to be regenerated with fewer records or replaced by a smaller link/backup.

Use a 64 KiB starting output buffer that doubles as needed and never grows beyond the configured cap. Check each stream chunk against remaining capacity before copying it. On over-limit, read, or allocation failure, clear the output reference and cancel the readable and writable sides. Return a view over the accumulated buffer rather than retaining chunks and allocating a second full-size result. Drop the decompressed-byte reference after text decoding and before parsing.

Keep the existing gzip/Base64URL format, query names, compressed-input bound, schema handling, stable output-limit code, and atomic import. On any import failure, preserve the source URL. Remove it only after `importExperienceFromFile` returns a persisted record. Use the requested explicit fallback copy for output-limit errors.

## Allocation accounting and limits

For an 8 MiB output delivered in small chunks, the collector's reachable output backing storage is at most 8 MiB after each growth. During a growth from 4 MiB to 8 MiB, the old and new arrays can coexist transiently (12 MiB of output storage), before accounting for compressed input, decompressor internals, the decoded string, parsed object graph, and app import staging. The unit test verifies the geometric capacity sequence and that the crossing chunk causes no additional output allocation.

This byte-buffer accounting does not establish peak browser memory or a low-memory device budget. Browser heap readings remain observational.

## Selected low-memory measurement profile

The user delegated selection of a reasonable profile and budget for Android emulation on 2026-10-13:

- Device profile: Android 13 (API 33) x86_64 Google Play AVD, configured with 2 GiB guest RAM and a 720 by 1600 display. This approximates the memory and display constraints of a low-cost Android phone; it is not a Motorola moto e13 or Android Go image.
- Browser: Chrome for Android stable 155.0.8059.39 as the baseline build; record the exact installed build during measurement.
- Budget: no more than 64 MiB of additional anonymous RSS across the renderer process or processes hosting Blend, above a five-second idle-page baseline. This is an import-overhead budget, not a total Chrome or device memory limit.
- Method: sample Android process anonymous RSS during each import and capture Perfetto system memory counters where available, including `kmem/rss_stat` and process statistics. Record the emulator image and configuration with the result.
- Runs: perform three trials each for valid 1 MiB and exact 8 MiB output payloads, plus a 10 MiB over-limit payload. Record the worst peak delta, Android image/AVD/browser build, import duration, responsiveness, and URL/state recovery for each size.

An emulator result can close the requested emulated-profile measurement, but it does not establish performance on Motorola firmware, Android Go, or physical low-memory hardware. Keep the 8 MiB ceiling unless measurement shows a concrete issue that justifies changing it.
