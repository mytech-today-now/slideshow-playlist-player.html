# Design

## Context

See `proposal.md` and `specs/compatibility-entry/spec.md`. The compatibility page is standalone HTML. The app already consumes deep-link query parameters in `app.js` and auth fragments in `supabase-auth.js`.

## Goals / Non-Goals

**Goals:** Forward the original query and fragment on the first app load, keep the route same-origin, preserve replace-history behavior, and make unavailable forwarding clear and recoverable.

**Non-Goals:** Change either app parser, auth cleanup, deep-link keys, service-worker routing, or server behavior.

## Decisions

- Build the destination from the current location and the fixed relative target `./index.html`, then copy `search` and `hash`. The fixed relative target prevents user input from selecting an external destination; an explicit origin check guards the invariant. Do not concatenate or normalize a return URL.
- Keep `location.replace` as the only automatic navigation and remove the state-dropping meta refresh. This avoids a second navigation path that can discard URL state or add an unwanted history entry.
- Keep a static `<noscript>` recovery path. It explains that automatic forwarding is unavailable, offers a direct index link labeled as potentially losing details, and tells users to copy the full original URL from the address bar. A static HTML link cannot include the current fragment, so do not present an empty-href link as the original URL.
- If destination construction or navigation setup throws, reveal the required generic failure text, a direct index link labeled as not preserving state, and a copyable link to the original compatibility URL. Do not log the caught error or expose URL values in visible text.
- Test auth forwarding with synthetic fragment values. Observe the original hash at the existing callback's `history.replaceState` cleanup boundary; do not change auth handling.

## Risks / Trade-offs

- [JavaScript is disabled] Dynamic query and fragment forwarding cannot run. The static fallback states this limitation and lets users copy the original link or open the app directly.
- [Auth fragment reaches the destination URL] The existing callback requires it. Keep it in same-origin navigation only, do not render or log it, and retain the current callback cleanup behavior.

## Migration Plan

No data migration is needed. Deploy the updated static compatibility page with the app; rollback by restoring the previous HTML file.
