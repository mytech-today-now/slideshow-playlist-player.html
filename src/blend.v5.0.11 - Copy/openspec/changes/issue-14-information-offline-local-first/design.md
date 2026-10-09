# Design

## Context

See proposal.md and `specs/information-documentation-refresh/spec.md`. `fetchReadme` already separates the installed README from the explicitly selected online guide, and online cache entries expire after one hour. The app currently replaces the content panel with a loading message before the online request and only fetches the local fallback after the 10-second network timeout.

## Goals / Non-Goals

**Goals:**

- Make local documentation available to the existing renderer before a cold or expired-cache online request can wait on the remote timeout.
- Keep the local document rendered during the online request and commit a successful online document in one render operation.
- Make timeout ordering and timer cleanup deterministic in regression tests.

**Non-Goals:**

- Change the one-hour online cache policy, service-worker routes, persisted application data, or the known README URLs.
- Add background refresh, parallel DOM updates, new dependencies, or automatic retries.

## Decisions

- **Fetch the installed guide before an uncached online request.** Fresh online cache entries still return immediately. For an empty, expired, or bypassed cache, `fetchReadme` obtains the same-folder README, reports it through an optional callback, and only then starts the bounded online fetch. The installed guide is never written to the online cache. A successful remote result is returned as one complete view model; a failed result returns the installed model marked unavailable.
- **Keep rendering in the existing dialog path.** The callback uses the existing request sequence guard and `renderInfoReadme` function. While online documentation is pending, the content region keeps the installed guide and the source status says that the installed copy is being shown. The remote result or failure is committed only if its request is still current. This avoids competing renderers and prevents an older request from replacing a newer source selection.
- **Inject time services at the fetch boundary.** `fetchReadme` and `fetchWithTimeout` accept a small clock object for `now`, `setTimeout`, and `clearTimeout`; defaults use browser-native time. Tests can hold the remote response pending, advance the deadline, and confirm that completed responses clear their timers without waiting ten seconds.
- **Use the specified failure state and existing retry control.** If online documentation fails after the installed guide is available, render the installed guide with the exact unavailable message and keep the existing keyboard-operable online retry action. If both local and remote sources fail, retain the existing local-guide error and retry controls.

## Risks / Trade-offs

- [Risk] The same-folder README may itself be unavailable → Continue with the bounded online request; if both sources fail, retain the existing explicit error and retry state.
- [Risk] A superseded online request may finish after the user changes source → Check the existing request sequence before every UI commit.
- [Trade-off] A cold online request performs the same-origin README request first → This prioritizes readable installed help; fresh online cache remains immediate and remote work retains its existing timeout.
