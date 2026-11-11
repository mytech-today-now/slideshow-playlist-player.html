# Design

## Context

See `proposal.md` for motivation. `app.js` currently uses `safeAbsoluteUrl` for both share page locations and image URLs; image metadata has separate compatibility rules, so share safety must not tighten image resolution. Imported share metadata is normalized in `app.js`, and the platform builder output is opened or copied later in the same browser-only orchestrator. Installed PWA clients cache versioned app assets from `pwa-config.js`.

## Goals / Non-Goals

**Goals:**

- Keep share page selection pure and regression-testable without importing browser-only `app.js`.
- Check both metadata overrides and final share sinks so unsafe values fall back to an HTTP(S) item deep link.
- Keep stored imported metadata untouched and announce when Share ignores an unsafe address.
- Ensure installed PWA clients fetch the security fix and its helper module.

**Non-Goals:**

- Restricting external HTTP(S) overrides to the app's origin. An explicit HTTPS override such as `https://evil.example` remains supported for compatibility and is covered by a named regression.
- Changing image metadata handling, share-file formats, IndexedDB, or service-worker cache strategies.

## Decisions

- Add a small pure module for HTTP(S) share URL resolution and unsupported scheme detection. Resolve relative addresses against the app entry URL, then accept only `http:` and `https:`. Keep `safeAbsoluteUrl` unchanged for image behavior.
- Have social metadata normalization omit unsafe URL fields and record an in-memory ignored-address flag. Build the item context with its generated deep link when the override is absent or rejected; do not rewrite the imported record.
- Revalidate the page location before copy and Web Share, and validate platform builder results at the navigation boundary. Permit `mailto:` only for the registered `email` platform. If a builder result is rejected, copy the safe page link.
- Use the existing toast surface with `role="status"` for the required fallback message so keyboard users receive visible feedback and assistive technology announces it.
- Keep explicit external HTTP(S) overrides. Restricting them to same-origin would prevent some portable experiences from sharing their canonical page URL; the remaining trust decision is documented in the risk section and the regression name.
- Advance the shared asset/cache generation and synchronize versioned asset references, including the new helper in the PWA precache. This is required so an installed offline client does not keep running the vulnerable app bundle. Preserve cache policies and the IndexedDB version.

## Risks / Trade-offs

- [A malicious imported HTTPS address can still point to a phishing site] → Preserve this explicit override contract for compatibility and make the choice visible in the regression name; the scheme allowlist only prevents active or opaque URL schemes.
- [A helper omitted from a deployed PWA shell could break app startup] → Add it to the required precache list and verify the versioned app/module references with the PWA configuration regression.
- [The generic import sanitizer also handles media paths] → Reject scheme-only values after HTTP(S), Supabase, and IPFS classification, retain Windows drive paths, and test the relevant safe cases.

## Migration Plan

No stored-data migration is needed. Existing imported metadata remains intact and unsafe fields are ignored at share time. Rollback consists of reverting the helper and app changes and advancing the asset/cache generation again so installed clients receive the reverted bundle; do not restore unsafe navigation behavior without a documented custom-scheme integration.
