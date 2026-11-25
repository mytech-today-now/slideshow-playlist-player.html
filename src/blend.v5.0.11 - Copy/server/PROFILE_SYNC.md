# Blend profile synchronization

This optional API is separate from the static cPanel app. It stores profile state, credentials as hashes, recovery-key hashes, share-token hashes, WebDAV locks, idempotency records, audit metadata, and a retryable GitHub outbox in PostgreSQL. The only public artifact is `experiences/{guid}/experience.json` in `BlendPlayer/BlendPlayer`. Its complete Git history is public.

## Render setup

The Blueprint is in `render.yaml` in this version directory. In Render, connect the parent `slideshow-playlist-player.html` Git repository and set the Blueprint file path to `src/blend.v5.0.11 - Copy/render.yaml`. The service root directory in the Blueprint is the same version folder. It creates a dedicated Node web service and a separate Postgres database with external IP access disabled. The web service uses the lowest paid always-on compute plan and the database uses the lowest paid durable plan. Render's Free Postgres is not suitable for this datastore because it expires.

Before deploying, set these Blueprint values in Render's protected environment controls:

- `BLEND_PROFILE_SYNC_ALLOWED_ORIGINS`: exact comma-separated HTTPS origins of the static app.
- `BLEND_PROFILE_SYNC_FRONTEND_ORIGIN`: one exact app origin that matches the allowlist.
- `BLEND_PROFILE_SYNC_FRONTEND_URL`: the public HTTPS `index.html` URL used to make share links.
- `BLEND_PROFILE_SYNC_GITHUB_TOKEN`: a fine-grained token restricted to the `BlendPlayer/BlendPlayer` repository with Contents read and write access. Repository metadata read is also required by GitHub.
- `BLEND_PROFILE_SYNC_ADMIN_KEY_SHA256`: the SHA-256 hash from the one-time admin key generator.

Render generates `BLEND_PROFILE_SYNC_TOKEN_PEPPER`; `DATABASE_URL` references the private database connection string. The initial `SameSite=Strict` cookie setting works when the app and API share the `mytech.today` site. Use `SameSite=None` only if the actual cPanel origin is cross-site and the target browsers allow its Secure cookie. Cross-site cookie blocking can prevent synchronization even when CORS is configured correctly.

The Blueprint requests `api.mytech.today`. Render adds TLS after the custom domain is attached and its DNS points at the service. DNS and HTTPS require external verification. No DNS record is written by this application.

To create an admin key, run `node scripts/generate-profile-sync-admin-key.mjs` in a private terminal. The script prints the high-entropy key and its SHA-256 value once. Save the key in a password manager, put only the hash in Render, then clear the terminal output. The admin page never stores or redisplays the key. Do not run this command in CI, shared logs, or a captured terminal session.

For GitHub, create a fine-grained token for only `BlendPlayer/BlendPlayer`, set Contents to Read and write, and allow the minimum metadata permission GitHub requires. Do not use a user password, browser credential, broad classic token, or token copied into repository files. Token rotation is performed in Render's protected secret controls.

## Local server

The Node API requires Node.js 20 or later, `DATABASE_URL`, a token pepper with at least 32 UTF-8 bytes, and an exact HTTPS frontend origin. It runs the idempotent SQL migration on the first API request after startup. GitHub sync remains queued when `BLEND_PROFILE_SYNC_GITHUB_TOKEN` is absent and retries after the token is configured.

```sh
npm ci
npm run build
npm run start:server
```

## Migration and rollback

The versioned SQL migration uses `CREATE TABLE IF NOT EXISTS` and is safe to retry after a partial startup failure. Apply it through the API readiness path; do not edit the live database by hand. A code rollback should leave these tables in place because dropping them would erase profiles, credentials, pending GitHub work, and audit records. Add a later forward migration for schema changes, and verify the database backup and retention plan before decommissioning the service.

The profile UI uses `https://api.mytech.today/api/profile-sync` by default. A local browser test may set `window.BLEND_PROFILE_SYNC_API_URL` to a loopback API URL before `app.js` loads. Keep test state isolated and never point tests at the public repository or production database.

## Security and behavior

- Profile GUIDs are validated UUIDs and are never credentials.
- Device cookies are high-entropy, host-only, Secure, HttpOnly, scoped to `/api/profile-sync`, and use a 30-day maximum age. PostgreSQL stores HMAC hashes, not plaintext device credentials.
- Recovery and share credentials are random, one-use values. The database stores HMAC hashes. A recovery rotation is staged for 15 minutes, requires an acknowledged file download in the client, then atomically replaces the key set and revokes every prior device.
- Sharing atomically consumes a token, enrolls a device, and returns the complete JSON Experience. The token and GUID live in the URL fragment only; the page removes the fragment before application scripts proceed. Referrers are disabled.
- Mutations require an exact allowed Origin, a custom CSRF header, and same-site Fetch Metadata. CORS never uses a wildcard. Profile API responses are `no-store` and the service worker sends API calls to network only.
- Writes require an enrolled device, a five-minute WebDAV lock, the current backend revision, the expected GitHub SHA, and a unique idempotency key. Locks coordinate authorized writers but do not authorize them.
- Accepted PostgreSQL changes are durable before GitHub processing. One outbox row per profile always represents its newest desired revision. Provider retries cannot apply an older accepted snapshot after a newer one.
- If GitHub changes outside this API, the service blocks the outbox and the client asks the user to resubmit or load the current public file. Cancel fetches the file again, accepts its current SHA on the server, then atomically imports it into the active local Experience. Local import failure keeps the browser's existing draft.
- The admin API exposes health, safe metadata, eligible retry, and a single-use two-step artifact delete by validated GUID. Deletion clears the server Experience and recovery records, revokes devices and share links, then removes the current GitHub file with a new commit. Public Git history remains. It has no arbitrary path, repository administration, force-push, or history rewrite operation.
- Errors, audit metadata, and health responses omit secret values, request headers, request bodies, Experience contents, recovery keys, and share tokens.

## API summary

| Route | Authorization | Purpose |
| --- | --- | --- |
| `POST /profiles/{guid}/initialize` | Exact Origin and CSRF checks | Create profile, first recovery keys, and device cookie |
| `POST /profiles/{guid}/enroll` | One recovery key or one share token | Consume credential and issue a new device cookie |
| `GET /profiles/{guid}` | Device cookie | Read current serialized Experience and sync status |
| `LOCK` and `UNLOCK /profiles/{guid}/experience` | Device cookie | Coordinate a profile write |
| `PUT /profiles/{guid}/experience` | Device cookie, lock, revision, SHA, idempotency key | Accept a new backend revision |
| `POST /profiles/{guid}/accept-remote` | Device cookie, current remote SHA | Accept the GitHub version after a conflict |
| `POST /profiles/{guid}/recovery/rotate` and `/commit` | Device cookie | Stage and commit ten replacement keys |
| `POST /profiles/{guid}/share` | Device cookie | Create a ten-minute, one-use link |
| `POST /profiles/{guid}/disconnect` | Current device cookie | Revoke this browser's device record and clear its cookie |
| `/admin/health` | Admin bearer key | Check database and GitHub health |
| `/admin/profiles/{guid}` | Admin bearer key | Read safe profile and outbox metadata |
| `/admin/profiles/{guid}/retry` | Admin bearer key, CSRF check | Retry an eligible outbox operation |
| `/admin/profiles/{guid}/delete/prepare` and `/delete` | Admin bearer key and single-use challenge | Clear server Experience and recovery records, tombstone profile, and delete the current artifact with a new commit |

## Verification boundary

Automated tests use synthetic credentials and provider doubles. They do not verify a live GitHub token, repository permission, Render resource, custom DNS record, TLS certificate, cPanel origin, or production database. Those checks must be made after the protected environment values and DNS are configured.
