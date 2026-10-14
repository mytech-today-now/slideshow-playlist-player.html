# Issue 15 Local Memory Profile

## Scope

The user approved the available local browser profile. This run measured image and video decoding through Blend's real Add Files thumbnail queue. It did not impose a memory limit or test a low-memory device.

## Profile

- OS: Windows 10.0.26300
- CPU: Intel Core i7-9750H at 2.60 GHz
- Installed physical memory: 64 GiB
- Chromium-reported `navigator.deviceMemory`: 32 GiB; this is a browser estimate, not an imposed limit
- Browser: Playwright-managed Headless Chromium 153.0.8010.12
- `navigator.hardwareConcurrency`: 12

## Sources and output

The fixtures were generated test patterns. Their pixel dimensions exercise common high-resolution source sizes, but the compressed byte sizes and visual content do not represent camera originals or production footage.

| Source | Compressed bytes | Decoded dimensions | One RGBA surface estimate | Thumbnail canvas | Canvas RGBA estimate |
| --- | ---: | ---: | ---: | ---: | ---: |
| JPEG image | 538,226 | 4032x3024 (12.2 MP) | 48,771,072 B (46.5 MiB) | 320x240 | 307,200 B (0.293 MiB) |
| H.264 video | 391,770 | 3840x2160 (8.3 MP) | 33,177,600 B (31.6 MiB) | 320x180 | 230,400 B (0.220 MiB) |

The RGBA figures are pixel-count estimates, not observed decoder allocations. Video decoders may use YUV surfaces, and browsers may keep extra decode, canvas, and encoder buffers. Both items ran at the queue's maximum of two active jobs. The queue returned to `active=0, pending=0`, both library rows remained, and there were no page errors.

## Process working-set observation

A Windows PowerShell sampler queried `Get-Process` every 50 ms for about 18 seconds and summed `WorkingSet64` for processes whose names contained `chrome`. It captured 13 ready-phase samples and 10 import-phase samples:

- Ready phase: 296.6 MiB median; samples ranged from 287.0 to 359.4 MiB.
- Import phase: 486.9 MiB sampled peak; samples ranged from 360.3 to 486.9 MiB.
- Difference between ready median and sampled import peak: about 190.3 MiB.

This is a coarse aggregate across Chromium browser, renderer, GPU, and service processes. It can count shared pages more than once and includes application/runtime overhead. It is not a per-item decoder peak or a portable device budget, and a 50 ms sampler can miss shorter peaks. No OOM, preview failure, or low-memory condition was reproduced. These results do not justify a file-byte or source-dimension import rejection.

## Commands used

Temporary fixture generation used FFmpeg's `testsrc2` source:

```powershell
ffmpeg -hide_banner -loglevel error -f lavfi -i 'testsrc2=size=4032x3024:rate=1' -frames:v 1 -q:v 3 image-4032x3024.jpg
ffmpeg -hide_banner -loglevel error -f lavfi -i 'testsrc2=size=3840x2160:rate=2' -t 1 -an -c:v libx264 -preset ultrafast -crf 35 -pix_fmt yuv420p -movflags +faststart video-3840x2160.mp4
```

The one-off Playwright profile harness was removed after measurement; it exercised those files through the project fixture server and real Add Files UI. Its exact command was:

```powershell
$env:ISSUE15_PROFILE_DIR='<temporary fixture directory>'
npm run test:e2e -- tests/e2e/issue15-profile.local.e2e.spec.mjs --project=chromium
```

The browser run passed 1/1 (exit 0) on Chromium 153.0.8010.12. A concurrent PowerShell sampler used `Get-Process`, filtered process names containing `chrome`, summed `WorkingSet64` every 50 ms for about 18 seconds, and exited 0.

## Related verification

- `npm run test:e2e -- tests/e2e/thumbnail-failures.e2e.spec.mjs` — 12 passed across Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6.
- `npm run test:e2e -- tests/e2e/add-files-selection-limit.e2e.spec.mjs` — 25 passed, 2 expected Chromium-only quota skips in non-Chromium projects; the 250-item cap remained intact.
- `npm run check` — passed, exit 0.
- `npm run test:regression` — 360/360 passed, exit 0.
- `openspec validate issue-15-bounded-thumbnail-canvas-dimensions --strict` — passed, exit 0.
- `git diff --check` — passed, exit 0.
