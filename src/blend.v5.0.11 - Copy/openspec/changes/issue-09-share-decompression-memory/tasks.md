# Tasks

## 1. Bounded decompression

- [x] 1.1 Reduce the maximum output to 8 MiB while keeping the existing output-limit error code.
- [x] 1.2 Replace chunk retention plus full concatenation with bounded geometric buffer growth and release temporary output references on failure.
- [x] 1.3 Cover below-cap, exact-cap, and cap-plus-one behavior, cancellation, and output allocation growth in regression tests.

## 2. Atomic failure and recovery

- [x] 2.1 Preserve share URL parameters after every failed import and clear them only after a committed import.
- [x] 2.2 Use the specified accessible over-limit recovery message.
- [x] 2.3 Verify oversized rejection and injected persistence abort leave state unchanged and keep the URL retryable; verify successful retry clears it.

## 3. Compatibility, performance, and verification

- [x] 3.1 Preserve the gzip/Base64URL format, parameter names, error code, and ordinary round trips.
- [x] 3.2 Run focused regression, output-limit E2E, and share-import/playback E2E coverage; record exact outcomes.
- [x] 3.3 Advance the asset/cache generation consistently and run the PWA version contract checks.
- [ ] 3.4 On an Android 13 (API 33) x86_64 Google Play AVD configured with 2 GiB guest RAM and a 720 by 1600 display, measure peak additional anonymous RSS for valid 1 MiB and exact 8 MiB outputs and a 10 MiB over-limit output using Chrome for Android stable 155.0.8059.39 as the baseline. Use a five-second idle-page baseline and Perfetto memory counters where available; each case must stay at or below 64 MiB additional renderer RSS. Run three trials per case and record the worst peak, exact emulator image/configuration and installed browser build, duration, responsiveness, and URL/state recovery. Mark the evidence as emulated; it does not prove Motorola moto e13, Android Go, or physical-device behavior.

## Tracking

- Source report: `Pasted text.txt`, Issue 09, “The 50 MiB share decompression ceiling can still create multiple large memory copies”.
- Beads issue: `blend-lmg`.

## Verification record (2026-10-12)

- `npm run check` passed.
- `npm run test:regression` passed all 335 tests, including URL-share round trip, corruption, schema, exact boundary, cancellation, allocation growth, and URL diagnostics coverage.
- `npm run test:e2e -- tests/e2e/url-share-output-limit.e2e.spec.mjs` passed 1/1 in Chromium. Oversized and transaction-abort failures retained state and URL; retry succeeded and cleared the parameters after commit.
- `npm run test:e2e -- tests/e2e/experience-share-import-playback.e2e.spec.mjs` passed 2/2 in Chromium.
- `openspec validate issue-09-share-decompression-memory` passed.
- The E2E `performance.memory` reading was `10,000,000` bytes before and after the rejected share. This browser reading is informational and is not a peak allocation measurement. The owner delegated profile and budget selection; the Android 13 2 GiB AVD and 64 MiB incremental renderer RSS budget are now selected. Task 3.4 remains open pending three measured trials per payload size.

## Emulator bring-up (2026-10-13)

- Installed Android command-line tools, ADB 37.0.1, Emulator 37.2.12, Android 13 x86_64 Google Play system image, and Microsoft OpenJDK 21 under the task temp directory; created `blend-issue05-api33-lowmem` with 2 GiB guest RAM and a 720 by 1600 display.
- The AVD points to the `google_apis_playstore` system image, but generated `config.ini` reports `PlayStore.enabled=no`; verify or correct Play Store availability and confirm the installed Chrome build before starting the trials.
- A fresh full boot is currently responsive. ADB reports `emulator-5554 unauthorized`, so guest inspection and browser measurement cannot proceed until the on-screen USB debugging authorization is accepted.
- Windows System log Application Popup event 26 identifies `crashpad_handler.exe` as the process that raised `0x80000003` on 2026-10-13. No matching QEMU/emulator Application Error event or emulator crash dump was found. A later full boot using `-gpu software -no-audio` selected SwiftShader/Lavapipe and remains responsive; no repeat breakpoint event appeared during the check. This isolates the observed dialog to the crash-report handler process, but its cause remains undetermined.
- No Android memory trials have been run. Task 3.4 remains open.

## Recheck (2026-10-15)

- The task-local AVD points to the installed `android-33/google_apis_playstore/x86_64` image (package revision 9); its configuration records API 33, x86_64, 2048 MiB RAM, and 720 by 1600. `PlayStore.enabled` was corrected from `no` to `yes` before boot. ADB still reports `emulator-5554 unauthorized`, so guest-side Play Store presence and the installed Chrome build could not be verified.
- USB debugging authorization requires user action. Computer Use rules prohibit acting on system security permission requests, so the prompt was left unapproved. Android measurements are Not run (0/9); renderer RSS, Perfetto, duration, responsiveness, and device-side URL/state recovery remain unmeasured.
- `npm run check` passed; `npm run test:regression` passed 360/360; the focused `url-share-output-limit.e2e.spec.mjs` passed 1/1 in Chromium after a sandbox `spawn EPERM` and permitted rerun. The browser heap observation remained 10,000,000 bytes and is informational only.
- The 8 MiB cap is unchanged. Task 3.4 remains open.
