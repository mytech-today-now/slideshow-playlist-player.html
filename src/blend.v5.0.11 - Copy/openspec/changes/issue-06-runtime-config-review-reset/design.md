# Design

## Context

See [proposal.md](proposal.md) and [the Supabase configuration delta](specs/supabase-configuration/spec.md). The app currently resolves configuration once at startup, constructs Auth and Storage clients from that snapshot, and has no UI for editing project credentials. The reset flow has a recovery gate before IndexedDB deletion and currently preserves `blend-runtime-config-v1`.

## Goals / Non-Goals

**Goals:** Keep browser-stored settings inert until reviewed in the current tab, preserve host-controlled deployment config, provide an operator path to configure a project, and make connection-setting reset results truthful.

**Non-Goals:** Change Supabase provider policy, Auth session persistence format, IndexedDB schema or recovery behavior, PWA caches, media files, or portable media references.

## Decisions

1. **Treat LocalStorage as a pending source.** Parse its config defensively and validate URL fields, but do not apply any of it until a session-scoped review record matches the stored config in the current tab. Give `BLEND_RUNTIME_CONFIG` and `__BLEND_RUNTIME_CONFIG__` precedence over reviewed browser values so a venue deployment cannot be silently retargeted by an older browser entry. Explicit in-code overrides remain highest precedence. An unreviewed entry keeps Auth and Storage unconfigured unless controlled host config is present.

2. **Review through the Configuration panel.** Add labelled project URL, anon key, and Auth redirect fields plus an unchecked confirmation checkbox and a status region. The form shows pending saved values while the active configuration status continues to identify the project actually in use. Saving validates the project URL as HTTP(S), validates the redirect against `location.origin`, requires the checkbox, writes the values, records review for this tab, and reloads so the existing startup-created Auth and Storage clients receive the reviewed settings.

3. **Keep a confirmed tab-only fallback when LocalStorage writes fail.** A valid confirmed configuration first attempts the documented LocalStorage key. If that write fails but `sessionStorage` works, keep the reviewed settings in a tab-scoped session entry, reload the current tab, and announce that the settings are active only for this tab and were not saved. If neither storage path works, leave the entered values in the form and announce that the active connection was not changed or saved.

4. **Reject invalid stored values with accessible diagnostics.** Only plain JSON objects are accepted. Invalid JSON and non-HTTP(S) project URLs are ignored. Auth redirects are accepted only on the current HTTP(S) origin; no extra redirect origins are documented. Return sanitized warnings for the Configuration status without logging URL credentials or anon-key material. If storage cannot be read, prefer valid host-injected config; otherwise use inert defaults and the specified fallback copy.

5. **Remove connection data as part of reset.** Before destructive reset work, confirm LocalStorage is readable. After the existing recovery and database gates, remove the runtime config key, tab-scoped runtime config, and review marker. Put failures in the existing cleanup-failure outcome so success copy is never shown when connection-setting removal is uncertain. The reset confirmation and completion copy name the runtime settings and continue to state that files on disk are untouched.

6. **Test the boundaries at module and browser layers.** Regression tests exercise precedence, malformed reads, URL validation, review-required saves, same-origin redirects, and storage-write fallback. Playwright verifies that a planted unreviewed project cannot receive Auth requests, that the Configuration review flow activates only a same-origin redirect, and that default reset removes the stored config while retaining on-disk media behavior.

## Risks / Trade-offs

- [LocalStorage and sessionStorage are not cryptographically authenticated against active same-origin script execution] → Treat the review as an operator guard for persisted cross-user state, keep active URL allowlisting and fail-closed reset behavior, and do not claim protection against an active XSS or malicious extension.
- [Operators must review saved settings in each new tab] → Keep the project URL and redirect visible in Configuration and scope the review only to the current tab.
- [A confirmed settings save reloads the page] → Reuse the existing startup construction path for Auth and Storage clients instead of adding mutable client reconfiguration.
- [Session storage can also be unavailable] → Keep form values in place, report that settings are neither active nor saved, and leave Supabase requests gated by the existing active configuration.

## Migration Plan

Existing `blend-runtime-config-v1` entries become pending and require review once per tab. Clear Browser Storage removes them by default. Host-injected deployments retain their existing no-rebuild path and take precedence over saved browser values. Rollback restores the prior static app artifact; no data migration or schema change is required.
