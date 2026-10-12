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

This byte-buffer accounting does not establish peak browser memory or a low-memory device budget. Browser heap readings remain observational; a supported low-memory profile and its acceptance budget still require owner agreement and measurement.
