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

- Current report finding: `ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-04`, stable article ID `issue-04`, “An 8 MiB shared experience lacks low-memory peak measurements”.
- Original implementation source: `Pasted text.txt`, Issue 09, “The 50 MiB share decompression ceiling can still create multiple large memory copies”.
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

## Issue 07 verification (2026-10-19)

- `npm run check` passed; `npm run test:regression` passed 365/365.
- Traced Chromium `url-share-output-limit.e2e.spec.mjs` passed 2/2, including a real IndexedDB abort after a queued write, state/URL preservation and retry, and the eight-viewport recovery, keyboard-focus, and touch checks. Traced Chromium `experience-share-import-playback.e2e.spec.mjs` passed 2/2.
- The browser `performance.memory` value (10,000,000 bytes before and after rejection) is informational only and is not Android renderer RSS.
- Redirecting Android user and emulator paths to task temp removed the protected default-profile lock error. ADB now sees `emulator-5554` as `unauthorized`; user authorization is required before guest Chrome/version inspection or trials. Android measurements are Not run (0/9), and responsiveness, duration, and device-side URL/state recovery remain unmeasured.
- The 8 MiB cap remains unchanged. Task 3.4 remains open pending all nine RSS trials and acceptance.

## Android measurement follow-up (2026-10-19)

Current device access check: `adb` and `emulator` were unavailable as commands, `ANDROID_HOME` and `ANDROID_SDK_ROOT` were unset, and the conventional Android SDK tool locations checked did not contain either executable. The current device/emulator state, guest image, and installed Chrome build could not be inspected. No Android or browser memory measurement was substituted for the required renderer RSS measurement.

All nine requested trials are explicitly Not run:

| Output size | Trial | Result | Blocker |
|---|---:|---|---|
| Valid 1 MiB | 1 | Not run | ADB and emulator CLI unavailable; configured AVD and guest Chrome cannot be inspected. |
| Valid 1 MiB | 2 | Not run | ADB and emulator CLI unavailable; configured AVD and guest Chrome cannot be inspected. |
| Valid 1 MiB | 3 | Not run | ADB and emulator CLI unavailable; configured AVD and guest Chrome cannot be inspected. |
| Exact 8 MiB | 1 | Not run | ADB and emulator CLI unavailable; configured AVD and guest Chrome cannot be inspected. |
| Exact 8 MiB | 2 | Not run | ADB and emulator CLI unavailable; configured AVD and guest Chrome cannot be inspected. |
| Exact 8 MiB | 3 | Not run | ADB and emulator CLI unavailable; configured AVD and guest Chrome cannot be inspected. |
| Over-limit 10 MiB | 1 | Not run | ADB and emulator CLI unavailable; configured AVD and guest Chrome cannot be inspected. |
| Over-limit 10 MiB | 2 | Not run | ADB and emulator CLI unavailable; configured AVD and guest Chrome cannot be inspected. |
| Over-limit 10 MiB | 3 | Not run | ADB and emulator CLI unavailable; configured AVD and guest Chrome cannot be inspected. |

No trial duration, idle baseline, peak anonymous renderer RSS, responsiveness, or device-side URL/state recovery result was collected. The requested Chrome for Android 155.0.8059.39 build and exact active AVD image/configuration remain unverified in this session. Task 3.4 remains open at 9/10, the 8 MiB cap is unchanged, and Beads `blend-lmg` remains in progress.

## Issue 04 report finding follow-up (2026-10-26)

- Current report finding: `ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-04`, stable article ID `issue-04`, “An 8 MiB shared experience lacks low-memory peak measurements”.
- `npm run sanity` passed: syntax checks and all 383 Node regression tests.
- `npm run test:e2e -- tests/e2e/url-share-output-limit.e2e.spec.mjs tests/e2e/experience-share-import-playback.e2e.spec.mjs` passed 4/4 in Chromium in the process-enabled runner. The default runner attempt stopped before discovery with `spawn EPERM` and ran zero assertions.
- The E2E browser heap observation was `10,000,000` bytes before and after rejection; it is informational and is not peak renderer RSS. The runs used local synthetic fixtures, with no user data, credentials, or live provider.
- Android 13 API 33 AVD measurement is Not run (0/9). `adb` and `emulator` are unavailable and `ANDROID_HOME`/`ANDROID_SDK_ROOT` are unset. The active AVD, installed Chrome build, RSS, duration, responsiveness, and device-side URL/state recovery were not measured.
- The 8 MiB cap remains unchanged. OpenSpec task 3.4 remains open at 9/10; Beads `blend-lmg` remains `in_progress`.

## Android measurement retry (2026-10-26)

- Report finding: `ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-04`, stable article ID `issue-04`, “An 8 MiB shared experience lacks low-memory peak measurements”. The matching OpenSpec change remains `issue-09-share-decompression-memory`; the existing Beads issue remains `blend-lmg` (`in_progress`).
- Located the task-local Android tools and AVD under the temporary Android SDK directory. The AVD configuration identifies `blend-issue05-api33-lowmem`, Android 13 / API 33, x86_64 Google Play image, 2,048 MiB guest RAM, and 720 by 1,600 display. Emulator 37.2.12 and ADB 37.0.1 are present. These are configuration-file values; the active guest image and installed browser could not be inspected.
- `adb devices -l` reports `emulator-5554 unauthorized`. The emulator log says to check the device for its USB debugging authorization dialog. The available computer-use surface listed no app or browser window, so no authorization was accepted. Chrome for Android 155.0.8059.39 remains unverified. No ADB authorization keys were changed and no package was installed or upgraded.
- Prepared synthetic v2 experience payloads only. Their decompressed JSON sizes are 1,048,576, 8,388,608, and 10,485,760 bytes; gzip sizes are 39,685, 374,467, and 376,943 bytes; Base64URL field lengths are 52,914, 499,290, and 502,591 characters, respectively. The local fixture server at `127.0.0.1:4297` returned HTTP 200 for the app entry point. Preparation and host-side availability are not Android trials.
- All nine required Android trials remain Not run (0/9). No five-second device baseline, renderer anonymous RSS, trial duration, responsiveness observation, or device-side URL/state recovery result was collected. The prior supported-runner Chromium checks and `performance.memory` observation remain as recorded above; they do not substitute for Android RSS.
- Keep the 8 MiB cap unchanged and task 3.4 open at 9/10. Resume after the emulator's USB debugging prompt is approved by the device owner: verify boot, API/image, display and Chrome build first, then record three trials for each size against the 64 MiB incremental renderer RSS budget. Preserve the existing experience and URL on over-limit failure.

## One-time authorization continuation (2026-10-26)

- This work remains linked to `ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-04`, stable article ID `issue-04`. The device owner selected one-time USB debugging approval with “Always allow” unchecked.
- The earlier emulator process had exited before approval could be confirmed. Relaunched the same AVD visibly with software graphics and audio disabled, without wiping its data. The computer-use inventory still exposes no app or browser window to target. ADB then moved from no device entry to `offline` and finally back to `unauthorized`; the USB debugging prompt has not been accepted.
- The AVD remains running. No ADB key or security setting was changed. Chrome version and active guest build remain unverified, and Android trials remain Not run (0/9), with no RSS, duration, responsiveness, or URL/state results.
- Task 3.4 remains open at 9/10 and the 8 MiB cap remains unchanged. The device owner must accept the visible one-time prompt because the emulator window is not available to the computer-use surface; continue with build verification and all nine trials only after ADB reports `device`.
