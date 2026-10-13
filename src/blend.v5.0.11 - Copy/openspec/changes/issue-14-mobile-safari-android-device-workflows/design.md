# Design

## Context

See [proposal.md](proposal.md) for motivation and [the spec delta](specs/mobile-device-acceptance/spec.md) for observable requirements. The existing app already exposes file-input and fullscreen status through its toast live region. The browser-compatibility Playwright project runs desktop Chromium, Firefox, and WebKit builds at desktop defaults; no mobile device session is available here.

## Goals / Non-Goals

**Goals:**

- Make unavailable and denied API paths actionable without mutating library state.
- Keep evidence from desktop engine runs separate from named physical-device results.
- Preserve current persisted formats, PWA cache behavior, and playback flow.

**Non-Goals:**

- Treat viewport or browser emulation as iOS or Android device evidence.
- Change picker capability detection, install prompts, orientation locking, media schemas, or cache rules.
- Add a device-farm service or runtime dependency.

## Decisions

### Reuse the existing accessible toast status

Update the current folder and fullscreen messages in `app.js`, which already announces them through the shared toast region. Keep `AbortError` as a silent user cancellation. For permission or security errors, provide the Add Files route and state that the current library is unchanged. This avoids a new notification surface; adding a new mobile-only dialog would duplicate existing behavior and require broader UI testing.

### Exercise capability branches with focused desktop-engine tests

Extend `browser-compatibility.e2e.spec.mjs` to reject folder selection with a synthetic permission error after loading one synthetic media item. Assert the accessible message, enabled Add Files control, and unchanged library snapshot. Update the existing unsupported-folder and fullscreen assertions to the specified copy. These tests prove the fallback branches only; the test report remains engine-only. A mocked API failure is not a substitute for device testing.

### Record physical runs as per-platform evidence

Keep the README's browser matrix and add a concise mobile acceptance record that lists the iOS Safari and Android Chrome workflows as unverified until a run records the device model, OS, browser version, network state, and outcome. Do not add emulated runs as evidence. A later physical run can update one platform and workflow at a time without changing claims for the other platform.

### Leave service-worker and persisted state contracts intact

No changes are planned for `pwa-config.js`, `pwa-client.js`, `service-worker.js`, `sw.js`, IndexedDB, or cache policies. The requested PWA device scenario remains open for physical acceptance; existing desktop offline-shell E2E stays a separate baseline.

## Risks / Trade-offs

- [No named iOS or Android device can be exercised in this run] → Leave physical acceptance tasks incomplete and retain partial/unverified README claims.
- [Synthetic API errors may not reproduce platform-specific permission behavior] → Use the test only to verify non-destructive fallback handling; capture actual permission and lifecycle behavior on devices later.
- [Browser or OS updates may change folder, fullscreen, install, quota, or lifecycle behavior] → Include exact device, OS, browser, network, and workflow details in each future evidence row.

## Migration Plan

No data migration or deployment configuration is required. If a copy change regresses desktop fallback behavior, revert only the affected message or error branch and keep the mobile claims unverified. The test additions and README evidence can remain independent of that rollback.
