# Tasks

## 1. Capability fallback behavior

- [x] 1.1 Clarify unavailable and denied folder selection status, preserve the current library, and verify with focused E2E assertions for absent and rejected picker APIs.
- [x] 1.2 Clarify unavailable and rejected fullscreen status and verify the visible control fallback in the compatibility E2E spec.

## 2. Evidence and documentation

- [x] 2.1 Qualify mobile capability claims and record iOS Safari and Android Chrome workflows as unverified until named device runs are available; verify the README separates device coverage from engine results.
- [ ] 2.2 Run named physical-device acceptance on iOS Safari and Android Chrome with synthetic media; record device, OS, browser, network, offline reload, library recovery, picker/fullscreen, rotation, quota/permission, and accessibility outcomes without clearing unrelated origin data.

## 3. Integration verification

- [x] 3.1 Run the requested syntax, regression, browser-compatibility E2E, PWA offline E2E, and OpenSpec validation commands; verify Beads record `blend-amv`. Results: syntax check passed; regression 349/349; compatibility 30/30; PWA offline 5/5; strict OpenSpec validation valid; `blend-amv` remains in progress.
