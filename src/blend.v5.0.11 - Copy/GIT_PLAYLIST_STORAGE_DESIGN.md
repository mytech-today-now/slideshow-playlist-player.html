# Git Playlist Storage Design

## Scope

Blend has two separate Git features:

- The public catalog is an unauthenticated, read-only source. It fetches an index and playlist files, validates them, and offers an explicit import into the local Playlist.
- The user repository connection is an optional direct browser BYOT source and publishing destination. It uses a token supplied by the Blend owner, separate repository settings, explicit read and publish actions, and a reviewed playlist-only payload.

Neither feature runs provider requests during normal startup, playback, or local list editing. The public catalog never falls back to the authenticated user repository. No shared token, OAuth client secret, backend, broker, runtime dependency, or build step is used.

## Public catalog contract

The configured public catalog directory contains this index:

```json
{
  "schema": "player.blend.catalog.v1",
  "playlists": [
    { "id": "ambient", "title": "Ambient" }
  ]
}
```

Each item resolves to `<catalog-directory>/playlists/<id>.json`. IDs use ASCII letters and digits with optional underscore or hyphen, up to 64 characters. The index is limited to 256 KB and 100 playlists.

Playlist files use `player.blend.list.v1`, `type: "playlist"`, and the list `items` array. The reader accepts only an allowlisted subset. Each item needs a unique ID, name, `audio` or `video` type, and a supported public HTTPS URL. URLs with credentials, queries, fragments, IP-literal hosts, common local host suffixes, signed/private path markers, or unsupported media extensions are rejected. The reader reconstructs a safe local import object. Experience settings, library snapshots, local paths, storage references, arbitrary metadata, and unknown fields are not imported.

The LocalStorage key `blend-public-git-catalog-v1` contains only provider, owner or workspace, repository, branch, and catalog directory. It contains no credentials or remote playlist cache.

## Authenticated repository workflow

The Configuration panel stores provider, owner or workspace, repository, branch, and a repository-relative `.json` path under `blend-git-playlist-repository-v1`. The separate key `blend-git-playlist-credential-v1` stores a provider-tagged token and is written only after the user checks **Remember on this device** and repository/read access verification succeeds. A remembered token is used only for the provider recorded with it. Without that choice the token is retained only in the client module's memory for the current app session. The token input is cleared when Connect is activated.

Disconnect clears the in-memory token and active connection. Forget credential also removes the remembered browser copy. Neither operation revokes the provider token. Clear Browser Storage removes repository settings and the remembered token. The UI links to the provider's token settings or revocation instructions.

The LocalStorage disclosure says that scripts running on Blend's origin can read a remembered token. LocalStorage is not represented as a secure vault. Tokens are sent only in the provider authorization header. They do not enter the public catalog settings, playlist documents, exports, analytics, logs, URLs, provider error messages, or service-worker caches.

### Access verification

Connect makes read-only requests:

- GitHub: `GET /repos/{owner}/{repo}` for repository metadata/visibility and `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` for the selected branch. A valid ref response confirms the configured repository and branch are readable.
- Bitbucket Cloud: `GET /2.0/repositories/{workspace}/{repo_slug}` for repository metadata/visibility and `GET /2.0/repositories/{workspace}/{repo_slug}/refs/branches?q=name="{branch}"&pagelen=1` for the selected branch and head commit. A matching branch confirms read access.

Connect does not attempt a write. Read permission is marked confirmed after these requests. GitHub write permission remains unverified until the user confirms a real publish and the provider accepts or denies that operation. Bitbucket write permission is not used while Blend's branch write is disabled. Repository metadata visibility is read from GitHub's `private` field or Bitbucket's `is_private` field. Missing or malformed visibility data remains `unknown`.

The selected path is validated as a bounded `.json` repository path and each segment is URL encoded. Owner/workspace, repository, and branch are validated independently. Request URLs use only `https://api.github.com` or `https://api.bitbucket.org`; a user-supplied repository URL is never treated as an API host. Requests use `mode: "cors"`, `credentials: "omit"`, `cache: "no-store"`, rejected redirects, a 20-second deadline, bounded response streams, and no automatic retry.

GitHub requests omit `X-GitHub-Api-Version` because the published CORS preflight allowlist does not include that header. The versioning docs say requests without it use `2022-11-28`, which is currently supported through March 10, 2028. Recheck the documented default and CORS headers before changing this request behavior.

### Provider operations and permissions

| Operation | GitHub | Bitbucket Cloud |
|---|---|---|
| Read playlist | Contents API `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}`. File JSON is base64 decoded as UTF-8. | Source API `GET /2.0/repositories/{workspace}/{repo_slug}/src/{commit}/{path}`. File bytes are decoded as UTF-8. |
| Create or update | Contents API `PUT /repos/{owner}/{repo}/contents/{path}` with UTF-8 content base64 encoded. Existing files include the current blob `sha`; new files omit it. | Disabled. Blend does not send a branch write because the documented Source API does not promise atomic compare-and-set protection for `branch` and `parents`. |
| Minimum token | Fine-grained personal access token restricted to the intended repository. Use Contents read for reading and Contents write for publishing. | Repository access token scoped to this repository with Repository Read (`repository`). Blend does not currently use Bitbucket write permission. |
| Conflict behavior | The Contents API requires the existing blob SHA when updating and documents `409 Conflict`. A stale SHA is surfaced; Blend does not overwrite or retry. | Blend re-reads the selected branch head and target file. A changed snapshot is surfaced as a conflict. If unchanged, Blend still stops before POST because the documented API does not establish a conditional write. The outgoing review and observed head remain available. |

Bitbucket repository access tokens are tied to the repository rather than a user's account. Blend currently uses the token for repository and playlist reads only. Branch restrictions and repository permissions remain provider-controlled.

### Read, review, and publish

Read is a separate action. Blend fetches only the configured file, limits it to 1 MB, validates the versioned playlist schema and every accepted item, removes unapproved fields, and displays the sanitized result. A second explicit import action passes that validated document to the existing local list importer. A read failure or denied access does not mutate the local Playlist or playback state. Denied, timed-out, malformed, and oversized reads show: “The remote playlist could not be read. Check the repository and read permission, then retry.” Unexpected exceptions log only safe operation, provider, and coarse error-type metadata.

Publishing has a separate review step. A dedicated serializer constructs `player.blend.list.v1` from an explicit allowlist: playlist name, safe item name/type/order, supported public HTTPS media URL, and relevant presentation toggles. Item IDs are regenerated in document order. It does not serialize arbitrary app state, project names, library records, local file paths, storage references, signed URLs, credentials, experience settings, or metadata. The candidate is run through the same strict playlist parser used for public imports. Local paths, unsafe/private/signed URLs, credentials, and unsupported media cause the operation to fail closed.

The review displays the exact JSON text, repository, branch, path, and visibility warning. Private visibility is not a guarantee against repository readers. Public or unknown visibility is shown as a warning. For GitHub the user must check a deliberate confirmation and activate **Publish reviewed playlist**. For Bitbucket this action stays disabled while no documented atomic branch condition exists.

Before a GitHub write, Blend fetches the current target state and compares file existence and SHA to the reviewed state. It includes the reviewed blob SHA in the update, so a provider stale-SHA response is surfaced without retry. For Bitbucket, Blend compares the current branch head and target file to the review, then refuses to send a POST even when they still match because the documented upload does not provide an atomic revision condition.

If a GitHub write may have reached the provider but its response is lost, malformed, or inconclusive, Blend reports an unresolved outcome, keeps the exact review and observed revision visible, and disables another publish until the user reads and compares the current remote playlist. Reading does not prove which request created a matching version. Blend never retries automatically. A user may explicitly download the retained allowlisted JSON; no conflict copy is stored or downloaded automatically.

The exact review and strict playlist allowlist reduce accidental disclosure, but an HTTPS media URL can still track readers or later become private. Users must review URLs and understand that Git history can retain published content after a file is changed or removed.

## Cache and local-state boundaries

Authenticated Git requests are direct cross-origin requests. The app's service worker only handles same-origin app requests and does not intercept these API calls. Provider fetches use `cache: "no-store"`; the authenticated response bodies and credential are not stored in Cache Storage. There is no IndexedDB schema change.

Remote read, denial, malformed content, conflict, failed write, and uncertain write outcomes do not replace or remove the local playlist or alter playback. A successful publish also leaves local state unchanged.

## Opt-in live-provider verification

`tests/e2e/git-playlist-provider-smoke.e2e.spec.mjs` is an explicit browser-only smoke, invoked with `npm run test:git-provider-smoke`. It uses the real browser `fetch` path so CORS and preflight behavior are observed. The test skips without all required per-provider environment variables and an exact repository-specific confirmation; default CI receives no smoke credentials and makes no provider requests. `playwright.config.mjs` removes smoke variables from the local fixture server's environment.

Each provider requires a separate private repository whose slug starts with `blend-smoke-`, with a valid fixture at the fixed `blend-smoke/playlist.json` path. GitHub additionally requires confirmation equal to `I_CONFIRM_DISPOSABLE_PRIVATE_REPOSITORY:<owner>/<repository>` before the write flow runs. The smoke checks private visibility before mutation, publishes only synthetic public media URLs, exercises a stale reviewed snapshot, and restores the original validated playlist. Restoration creates Git history; it does not erase commits or delete the repository. Bitbucket verification requires the same repository confirmation plus `BLEND_BITBUCKET_SMOKE_SCOPE_CONFIRM=I_CONFIRM_BITBUCKET_REPOSITORY_READ_ONLY_SCOPE`. This is an operator statement after inspecting the token settings; it does not certify that the token lacks additional permissions. Bitbucket verification is read-only and makes no write request.

Request diagnostics are an allowlist of provider, operation, method, observed HTTP status, and stable outcome. The Bitbucket summary records branch, operator-confirmed scope, UTC check time, read status, and a stable error code; it omits credentials, repository coordinates, repository paths, and response bodies. The test helper rejects non-fixed provider origins and credentials outside the Authorization header. It does not inspect or serialize response headers, URL, response body, repository coordinates, or raw fetch errors. A successful response is `success`, an explicit provider or fixture rejection is `failed`, absent confirmation is `skipped`, and a timeout/network boundary is `unknown`. Regression coverage uses synthetic sentinels and deterministic mocks for success, denial, rate limit, stale revision, and ambiguous write outcomes. These results establish code behavior under the tested fixtures. A live disposable result establishes only what the selected provider account and disposable repository returned at that time; it does not establish production permissions or deployed-app behavior.

If an outcome is uncertain, no repeat publish is made before a successful remote read. Cleanup restores only when the current remote playlist matches the original validated fixture or a known synthetic smoke candidate. If reads fail or state differs, stop and inspect the confirmed disposable repository before retrying. The user-facing not-run state is: “Provider verification was not run. Local playlist edits remain saved; inspect the disposable repository before retrying a publish.”

## Verified provider documentation

Reviewed on 2026-10-12:

- GitHub [Contents endpoints](https://docs.github.com/en/rest/repos/contents): fine-grained token permissions, base64 file content, required `sha` for updates, branch parameter, and documented conflicts.
- GitHub [REST API CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests) and [API version support](https://docs.github.com/en/rest/about-the-rest-api/api-versions): cross-origin REST access and preflight support for `Authorization`, `Content-Type`, GET, and PUT; requests without an API version header default to `2022-11-28`.
- GitHub [Get a Git reference](https://docs.github.com/en/rest/git/refs#get-a-reference): selected branch verification.
- Bitbucket [Source API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/): raw reads, multipart upload path encoding, documented `branch` and `parents` fields, required repository permissions, and `201 Created` response. The endpoint documentation does not specify an atomic compare-and-set condition, so Blend does not issue these writes.
- Bitbucket [Refs API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-refs): branch listing and filtered branch lookup.
- Bitbucket [CORS and hypermedia](https://developer.atlassian.com/cloud/bitbucket/rest/intro/): CORS support, `Authorization` and `Content-Type` request headers, and GET/POST methods.
- Bitbucket [Repository access token setup](https://support.atlassian.com/bitbucket-cloud/docs/create-a-repository-access-token/), [permissions](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-token-permissions/), [API use](https://support.atlassian.com/bitbucket-cloud/docs/using-access-tokens/), and [revocation](https://support.atlassian.com/bitbucket-cloud/docs/revoke-a-repository-access-token/).

These documentation findings establish that direct browser REST requests are supported and that the selected requests use documented operations and authorization methods. Mocked tests do not validate a real token, a provider account, a repository's live permission settings, deployment policy, or provider uptime.
