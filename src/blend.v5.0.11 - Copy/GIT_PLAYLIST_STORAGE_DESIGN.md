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

Connect does not attempt a write. Read permission is marked confirmed after these requests. Write permission remains explicitly unverified until the user confirms a real publish and the provider accepts or denies that operation. Repository metadata visibility is read from GitHub's `private` field or Bitbucket's `is_private` field. Missing or malformed visibility data remains `unknown`.

The selected path is validated as a bounded `.json` repository path and each segment is URL encoded. Owner/workspace, repository, and branch are validated independently. Request URLs use only `https://api.github.com` or `https://api.bitbucket.org`; a user-supplied repository URL is never treated as an API host. Requests use `mode: "cors"`, `credentials: "omit"`, `cache: "no-store"`, rejected redirects, a 20-second deadline, bounded response streams, and no automatic retry.

GitHub requests omit `X-GitHub-Api-Version` because the published CORS preflight allowlist does not include that header. The versioning docs say requests without it use `2022-11-28`, which is currently supported through March 10, 2028. Recheck the documented default and CORS headers before changing this request behavior.

### Provider operations and permissions

| Operation | GitHub | Bitbucket Cloud |
|---|---|---|
| Read playlist | Contents API `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}`. File JSON is base64 decoded as UTF-8. | Source API `GET /2.0/repositories/{workspace}/{repo_slug}/src/{commit}/{path}`. File bytes are decoded as UTF-8. |
| Create or update | Contents API `PUT /repos/{owner}/{repo}/contents/{path}` with UTF-8 content base64 encoded. Existing files include the current blob `sha`; new files omit it. | Source API `POST /2.0/repositories/{workspace}/{repo_slug}/src` using multipart form data, a slash-prefixed repository path field with filename, commit message, selected `branch`, and reviewed `parents` commit. |
| Minimum token | Fine-grained personal access token restricted to the intended repository. Use Contents read for reading and Contents write for publishing. | Repository access token scoped to this repository. Read uses Repository Read (`repository`); publishing uses Repository Write (`repository:write`). Select both for this app's read and publish workflow. |
| Conflict behavior | The Contents API requires the existing blob SHA when updating and documents `409 Conflict`. A stale SHA is surfaced; Blend does not overwrite or retry. | Blend re-reads the selected branch head before the write and supplies that head as `parents`. The reviewed API documents branch and parent parameters and a `201 Created` success response, but it does not document an atomic compare-and-set guarantee. Another writer can race between preflight and the commit. The UI states this limitation. |

Bitbucket repository access tokens are tied to the repository rather than a user's account, and provider-created content may appear under the token identity. Branch restrictions and repository permissions remain provider-controlled. A provider `201 Created` response confirms the Bitbucket commit; the app does not require an undocumented response-body schema to report success.

### Read, review, and publish

Read is a separate action. Blend fetches only the configured file, limits it to 1 MB, validates the versioned playlist schema and every accepted item, removes unapproved fields, and displays the sanitized result. A second explicit import action passes that validated document to the existing local list importer. A read failure or denied access does not mutate the local Playlist or playback state.

Publishing has a separate review step. A dedicated serializer constructs `player.blend.list.v1` from an explicit allowlist: playlist name, safe item name/type/order, supported public HTTPS media URL, and relevant presentation toggles. Item IDs are regenerated in document order. It does not serialize arbitrary app state, project names, library records, local file paths, storage references, signed URLs, credentials, experience settings, or metadata. The candidate is run through the same strict playlist parser used for public imports. Local paths, unsafe/private/signed URLs, credentials, and unsupported media cause the operation to fail closed.

The review displays the exact JSON text, repository, branch, path, and visibility warning. Private visibility is not a guarantee against repository readers. Public or unknown visibility is shown as a warning. The user must check a deliberate confirmation and activate **Publish reviewed playlist**.

Before writing, Blend fetches the current target state again. For GitHub it compares the target file existence and SHA to the reviewed state. For Bitbucket it compares the branch head and target-file state, then includes the reviewed head as the commit parent. A newly appeared file, changed file, or moved Bitbucket branch produces a visible conflict and requires a new read/review. The app never automatically retries a write. A timeout, network failure after a write begins, provider 5xx, or incomplete success response is reported as an uncertain result and tells the user to inspect the remote file before attempting another publish.

The exact review and strict playlist allowlist reduce accidental disclosure, but an HTTPS media URL can still track readers or later become private. Users must review URLs and understand that Git history can retain published content after a file is changed or removed.

## Cache and local-state boundaries

Authenticated Git requests are direct cross-origin requests. The app's service worker only handles same-origin app requests and does not intercept these API calls. Provider fetches use `cache: "no-store"`; the authenticated response bodies and credential are not stored in Cache Storage. There is no IndexedDB schema change.

Remote read, denial, malformed content, conflict, failed write, and uncertain write outcomes do not replace or remove the local playlist or alter playback. A successful publish also leaves local state unchanged.

## Verified provider documentation

Reviewed on 2026-10-11:

- GitHub [Contents endpoints](https://docs.github.com/en/rest/repos/contents): fine-grained token permissions, base64 file content, required `sha` for updates, branch parameter, and documented conflicts.
- GitHub [REST API CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests) and [API version support](https://docs.github.com/en/rest/about-the-rest-api/api-versions): cross-origin REST access and preflight support for `Authorization`, `Content-Type`, GET, and PUT; requests without an API version header default to `2022-11-28`.
- GitHub [Get a Git reference](https://docs.github.com/en/rest/git/refs#get-a-reference): selected branch verification.
- Bitbucket [Source API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/): raw reads, multipart upload path encoding, `branch`, `parents`, required repository permissions, and `201 Created` response.
- Bitbucket [Refs API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-refs): branch listing and filtered branch lookup.
- Bitbucket [CORS and hypermedia](https://developer.atlassian.com/cloud/bitbucket/rest/intro/): CORS support, `Authorization` and `Content-Type` request headers, and GET/POST methods.
- Bitbucket [Repository access token setup](https://support.atlassian.com/bitbucket-cloud/docs/create-a-repository-access-token/), [permissions](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-token-permissions/), [API use](https://support.atlassian.com/bitbucket-cloud/docs/using-access-tokens/), and [revocation](https://support.atlassian.com/bitbucket-cloud/docs/revoke-a-repository-access-token/).

These documentation findings establish that direct browser REST requests are supported and that the selected requests use documented operations and authorization methods. Mocked tests do not validate a real token, a provider account, a repository's live permission settings, deployment policy, or provider uptime.
