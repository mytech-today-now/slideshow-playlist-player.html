# Public Git Playlist Catalog Design

## Implemented scope

Blend can read a user-configured public playlist catalog from either GitHub or Bitbucket Cloud. The provider is an explicit choice. There is no default owner, repository, branch, or catalog directory. The Configuration panel fetches a catalog index and offers each playlist for an explicit import into the local Playlist. Import follows the existing append or replace setting, and replace asks before changing the current local list.

The implementation is read-only. It does not authenticate, write commits, connect a private repository, publish, rename, unpublish, delete, or reconcile remote edits. A private repository is not used as a fallback for the public catalog.

## Repository layout

The configured catalog directory contains this index:

```json
{
  "schema": "player.blend.catalog.v1",
  "playlists": [
    { "id": "ambient", "title": "Ambient" }
  ]
}
```

Each index item resolves to `<catalog-directory>/playlists/<id>.json`. IDs use ASCII letters and digits with optional underscore or hyphen, up to 64 characters. Index titles are plain text. The index has a 256 KB limit and may list at most 100 playlists.

Playlist files use `player.blend.list.v1`, `type: "playlist"`, and the existing list `items` array. The remote reader accepts only an allowlisted subset of list fields. Each item needs a unique ID, a name, an `audio` or `video` type, and the same public HTTPS URL in `path` and `sourceUrl` when both are present. URLs with credentials, queries, fragments, IP-literal hostnames, common local host suffixes, signed/private path markers, or unsupported media extensions are rejected. The accepted JSON is reconstructed from safe fields before the existing local importer sees it. Experience settings, library snapshots, local paths, storage references, metadata, and arbitrary item fields are not imported.

Each playlist file is limited to 1 MB and 10,000 items. Requests have a 15 second deadline. There are no automatic retries. Errors are reduced to stable status messages and raw provider response bodies are not surfaced or logged.

The LocalStorage key `blend-public-git-catalog-v1` contains only the provider, owner or workspace, repository, branch, and catalog directory. It does not contain authorization data or a remote playlist cache. No IndexedDB migration is needed.

## Provider request behavior

- GitHub reads use the fixed `https://api.github.com` Contents API and the configured branch. Unauthenticated requests fetch only public repository data. The official REST API supports cross-origin requests. See [GitHub CORS guidance](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests), [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), and [repository contents](https://docs.github.com/en/rest/repos/contents).
- Bitbucket Cloud reads use the fixed `https://api.bitbucket.org/2.0` source API and the configured branch. Its REST API documents CORS support and raw file reads. See [Bitbucket CORS and hypermedia](https://developer.atlassian.com/cloud/bitbucket/rest/) and the [source API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/).
- Requests omit browser credentials, use `cache: "no-store"`, and reject redirects. The API hosts are constants, never user input. Bitbucket's file-read endpoint returns raw file content, while GitHub's Contents API returns base64 file content for the reader to decode.
- Provider write controls remain external to Blend. GitHub rulesets can target branches and govern interactions with them; Bitbucket branch permissions can restrict writes and merges by branch or pattern. A GitHub Contents API update requires the current file blob SHA and documents `409 Conflict`; Bitbucket's source upload API creates commits and accepts branch and parent parameters, but the reviewed endpoint documentation does not define a complete stale-write recovery contract for this client. The reader has no revision tracking or write logic. See [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets), [GitHub Contents API](https://docs.github.com/en/rest/repos/contents), [Bitbucket branch permissions](https://support.atlassian.com/bitbucket-cloud/docs/use-branch-permissions/), and [Bitbucket source commits](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/).
- GitHub documents a 60-request-per-hour primary limit for unauthenticated reads, associated with the originating IP. Requests rate limited by the implemented reader are surfaced as a stable error and are not retried. No numeric Bitbucket Cloud request limit was established from the official documentation reviewed for this change; a returned `429` is handled as a provider access or rate-limit error without retry.
- These documentation facts do not prove a live catalog repository, its permissions, or a deployment's network policy. No live provider account or repository validation is part of automated tests.

## Threat model and data handling

The public index and playlist JSON are untrusted input. A repository owner or contributor can change them. A catalog can list misleading text, malformed data, an attempt to import private media references, or an unexpectedly large response.

The reader limits response bytes and item counts, validates identifiers and repository paths, accepts one versioned catalog schema and one playlist schema, rejects unsupported fields, and rebuilds the import object from an explicit allowlist. Catalog titles are rendered with `textContent`. API errors and request failures are converted to stable error codes. Requests use only fixed HTTPS provider origins. Credentials are neither sent nor stored.

Imported HTTPS media references still leave the browser when the user chooses to import or play the playlist. The URL checks reject common private and signed-reference forms, but they cannot prove that an arbitrary public HTTPS host will remain public or free of tracking. Users should review media sources and the public repository before importing. Git history can retain catalog content even after the current index stops listing an item.

The service worker only controls this app's own origin. Git API calls go directly to the fixed cross-origin provider hosts and use `no-store`; they are not put into Blend's Cache Storage. Media Range behavior and existing offline playback paths are unchanged.

### Actors and compromise impact

- Repository readers include anyone who can access the public repository and its history. A public catalog is public data, not a private sharing surface.
- Authorized writers are people or app identities that the provider permits to write to the selected repository and branch. Choosing a repository does not prove that the current user can write to it. Provider permissions and branch rules decide that.
- Catalog owners and contributors are also untrusted input authors from the browser's point of view. Their JSON must remain validated as strictly as other remote data.
- The current app has no Git access token or client secret. If a future design puts a user access token in browser memory, same-origin script execution, an XSS defect, browser extensions, or a compromised browser session could read it and act with its granted permissions until expiry or revocation. Memory-only storage limits persistence but does not prevent active-session theft.
- A trusted broker could keep provider client secrets and refresh tokens server-side, but it would add a service that can act for users. Its compromise could expose every token and repository that the broker is authorized to use. The broker would need per-user sessions, repository binding, narrow provider permissions, CSRF protections, server-side secret storage, and an audited operation allowlist.

## Write authorization boundary

Public reads do not grant write permission. The public catalog and any future user-owned repository must remain separate settings and operations. A private repository must never become an implicit fallback for the public catalog.

### Provider findings

| Topic | GitHub | Bitbucket Cloud |
|---|---|---|
| Browser authorization | GitHub Apps support a web application authorization flow and fine-grained app permissions. Exchanging the callback code for a user token requires the app client secret. PKCE is supported but does not remove that requirement. The GitHub docs describe device flow as intended for headless or no-browser clients. It avoids the client secret, but GitHub's OAuth guidance warns against enabling it for ordinary web apps because it can be used for phishing. | The current developer reference says the authorization-code grant is supported and implicit grant is no longer supported. Code exchange and refresh use the OAuth consumer key and secret. The consumer and callback must be registered. The scope is configured on the consumer, not selected more narrowly for each authorization request. |
| Permission and repository binding | An OAuth App's `public_repo` scope permits read and write access across public repositories; `repo` includes public and private repository access plus additional organization resources. Neither scope binds access to one repository. A GitHub App can request `Contents: write`; the user token is limited to permissions and repositories available to both the app and user. The documented `repository_id` parameter can further limit a user token to one repository, but it is ignored if the app or user cannot access that repository. | The source upload endpoint requires `repository:write`. For OAuth 2.0, this scope implicitly includes `repository` read access, so it is sufficient for reading and writing. OAuth consumer scopes are configured at the client level, and the reviewed docs do not provide repository-specific consent binding for OAuth tokens. Repository access tokens can be limited to one repository, but they are created by a repository administrator and act as that repository token identity, not as an individually consenting writer. They are not an approved substitute for per-user OAuth. |
| Token lifetime and refresh | GitHub App user tokens expire after 8 hours by default. Refresh tokens expire after 6 months and rotate when used. Refreshing requires the client secret unless the token came from device flow. Users can revoke app authorization; API-based grant deletion also requires the client secret. | OAuth access tokens expire after 1 hour. Refresh tokens rotate when used and an unused refresh token expires after 3 months. The refresh request requires the OAuth consumer secret. Users can revoke connected-app grants in Atlassian account settings; deleting the consumer also removes all tokens linked to it. |
| CORS | GitHub documents CORS for REST API AJAX requests from any origin, including Authorization and Content-Type headers and GET, POST, PATCH, PUT, and DELETE methods. This documents the REST API only. It does not establish that browser token exchange is supported. | Bitbucket documents CORS support for REST API requests across domains. The reviewed documentation does not establish browser CORS support for OAuth token exchange or refresh. |
| Write and conflict behavior | The Contents API requires the current file blob `sha` when replacing or deleting a file, and documents `409 Conflict`. Fine-grained access requires repository `Contents: write`. Branch rules and repository permissions remain provider-controlled. | Source upload creates a commit and supports `branch` and `parents` parameters, but its documented responses list `201`, `403`, and `404`. The reviewed reference does not define a compare-and-set contract or a stale-parent conflict response for this client. Atlassian's support guidance says OAuth credentials cannot push to branches with branch restrictions. No branch protection may be bypassed. |
| Rate limits | GitHub documents 5,000 REST requests per hour for authenticated user tokens, with secondary limits including content-generation limits. It returns `403` or `429` when rate limited. | The current Atlassian API access documentation describes per-endpoint rate-limit headers and `429` responses, but no fixed Bitbucket Cloud quota for this integration was established from the reviewed pages. |

The current Bitbucket developer reference says implicit grant is no longer supported and OAuth access tokens expire after 1 hour. Atlassian's separate support article still describes implicit grant and a 2-hour access-token lifetime. This memo follows the current developer reference for available grants and expiry. The support article is used only for its statement that deleting an OAuth consumer removes its linked tokens. Confirm this behavior with an authorized Bitbucket test account before implementation.

### Decision

No approved browser-only design currently meets the requested constraints for the existing GitHub and Bitbucket choices. GitHub's strongest repository-scoped option is a GitHub App, but its browser web flow needs a client secret. Device flow avoids that secret but is documented for headless clients and carries a phishing concern for web apps. Bitbucket's browser implicit flow has been retired; its authorization-code exchange and refresh need a client secret, while OAuth scopes are configured broadly at consumer level rather than bound to one repository. REST CORS documentation does not prove CORS support for either provider's token exchange endpoint. No authorized test account was used to validate OAuth, CORS, consent, or live repository permissions.

Do not implement writes, private-repository connections, provider registration, or a backend broker under the current authorization. Keep the catalog read-only. The smallest product decision needed to proceed is: **keep Git writes deferred, or authorize a trusted server-side broker and provider app registrations?** If a broker is approved, also identify whether its first release supports GitHub, Bitbucket Cloud, or both. The broker design must preserve user identity, bind every authorization to the intended provider and repository, verify repository permissions, enforce an explicit playlist-only payload allowlist, keep secrets and tokens server-side, and define revision conflict and uncertain-write behavior before UI work begins.

### Write design implications

- A future writer must use a separate authenticated repository configuration. A location entered by the user is not proof of access; the provider authorization must be checked for the exact owner or workspace, repository, and branch before enabling a write.
- Do not reuse `exportList()` as a publishing serializer. That export supports compatibility and may contain fields that are not approved for publication. Build a deterministic versioned playlist-only payload from an explicit allowlist.
- The existing local playlist is persisted independently in IndexedDB. A failed, denied, timed-out, or uncertain remote operation must leave the local state and playback untouched. A write timeout must not trigger an automatic retry because the first commit may have succeeded.
- The existing import path sanitizes remote playlist data before local import. It does not provide outbound schema validation, remote revision tracking, conditional writes, or conflict UI.
- Current catalog coordinates are stored under `blend-public-git-catalog-v1`; they contain no credentials. The local reset removes these coordinates. A future broker session or token must not be added to this key, IndexedDB, LocalStorage, Cache Storage, exports, or service-worker state.
- Cross-origin Git API requests are not intercepted by this app's service worker, which only handles same-origin GET requests. Keep authenticated provider responses network-only and uncached if a future broker or direct API flow is approved.

Official documentation reviewed on 2026-10-11:

- GitHub: [OAuth app best practices](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app), [authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [GitHub App user authorization and repository binding](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), [refreshing GitHub App user tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens), [OAuth authorization revocation](https://docs.github.com/en/rest/apps/oauth-applications), [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps), [REST CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests), [contents API](https://docs.github.com/en/rest/repos/contents), and [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
- Bitbucket Cloud: [REST authentication, scopes, and token lifecycle](https://developer.atlassian.com/cloud/bitbucket/rest/intro/), [CORS documentation](https://developer.atlassian.com/cloud/bitbucket/rest/intro/), [source upload API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/), [branch permissions](https://support.atlassian.com/bitbucket-cloud/docs/use-branch-permissions/), [OAuth branch restriction behavior](https://support.atlassian.com/bitbucket-cloud/docs/push-back-to-your-repository/), [OAuth consumer deletion effects](https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/), [Atlassian Connected Apps](https://support.atlassian.com/atlassian-account/docs/update-your-profile-and-visibility-settings/), and [Atlassian API rate limits](https://developer.atlassian.com/cloud/admin/api-access/rest/).
