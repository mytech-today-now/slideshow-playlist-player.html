# Design

## Context

See `proposal.md` for the motivation and `specs/information-documentation/spec.md` for observable behavior. The running version is already available as `VERSION` in `app.js`; the same-folder README declares it in its Current Version Information section. `readme-fetcher.js` currently returns only Markdown and caches the mutable root response under an unversioned key. The service worker explicitly bypasses README requests and does not precache the local README.

## Goals / Non-Goals

**Goals:** Keep source and version metadata together from fetch through display, allow online access only on explicit selection, and make the installed README available from the existing PWA documentation cache.

**Non-Goals:** Change Markdown syntax or sanitization, update other Blend version folders, add a remote dependency, or introduce application-data migration.

## Decisions

- **Use a small README view model.** The fetcher will extract the explicit runtime-version marker and return source, detected version, version-match state, timestamp, cache state, and fallback state with the Markdown. The app will pass its existing `VERSION` value. An unrecognized version remains visible as unknown rather than being inferred from an unrelated changelog entry.
- **Keep local and online loading separate.** The default request loads `./README.md` only. Selecting current online documentation loads the existing mutable root URL. A new cache key prevents old unversioned cache records from being treated as versioned entries. Online cache records store the detected document version and fetch time and expire after one hour. The retry control bypasses the cache.
- **Fall back to the installed guide on an online error.** The fetcher will try the same-folder README after an online failure and mark the returned view model as a fallback. The dialog will select the local source, display the required unavailable message, and offer a retry that explicitly requests online documentation again.
- **Use the existing documentation cache for offline help.** Add `./README.md` to optional documentation precaching and allow same-origin README requests through the existing docs route, removing its unconditional service-worker bypass. Optional precaching preserves app installation if a hosting copy omits the guide; the checked-in app contains it.
- **Use a native source selector and source-specific scroll state.** A labeled `<select>` provides built-in keyboard operation. The dialog keeps the current Information tab unchanged and stores local and online README scroll positions separately from the existing per-tab position.
- **Keep the renderer as the security boundary.** Both sources continue through `renderMarkdown`; status and source labels use text content, and no README HTML is inserted directly.

## Risks / Trade-offs

- [Risk] A README may omit or mistype its runtime-version marker → show the version as unknown or mismatched and retain the local guide without silently substituting another source.
- [Risk] The mutable online URL can change during the one-hour cache window → display its declared version and cached timestamp, keep it optional, and retain explicit retry.
- [Risk] Optional service-worker precaching can fail on a host that does not publish `README.md` → keep installation non-blocking and show the existing installed-guide retry state if the local document is unavailable.
- [Risk] The current checkout's repository-root `README.md` is HTML rather than Markdown → treat that as online source content only, show that no app version is declared, and continue to render it through the escaping Markdown renderer.

## Migration Plan

Use a new online README cache key and ignore the legacy unversioned entry. No user-data migration is needed. The service worker's existing asset-version change during release will install the updated optional docs cache; rollback restores the prior code and cache policy without changing app data.
