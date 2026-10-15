# Private Storage policy verification

## Current release-gate status

This checkout contains the browser resolver and runtime Supabase configuration, but no Storage policy SQL, migration, or deployable provider policy artifact. No live or disposable staging project was inspected for this app-only change. This is an unverified provider boundary, not evidence of a policy defect.

The app resolver sends the signed-in user's access token to Supabase when it requests a private signed URL. It sends the configured public anon key as `apikey`; no service-role credential is part of browser runtime config. Public resolution and URL sharing are limited to `SUPABASE_PUBLIC_BUCKETS`. Until an owner-reviewed release change records successful provider verification, compressed Share URL creation is blocked when a referenced item is in a non-allowlisted bucket. The settings panel and blocked share action explain that private URL sharing is blocked until the project owner verifies Storage access, and offer public-only sharing or continued local playback. Normal playback and portable JSON exports retain their existing contracts.

**Release gate: not passed.** Do not mark private Storage authorization verified until the policy owner supplies a redacted policy export and the matrix below passes in a disposable staging project. The owner must confirm the ownership predicate used by the project (for example user ownership or organization membership); this app does not choose or infer it.

## Policy and fixture record

Before running the matrix, record these non-secret values in the release review:

| Item | Required record |
|---|---|
| Project | Disposable staging project reference and review date |
| Policy owner | Named person and role authorized to approve the Storage policy and release gate |
| Policy revision | Non-secret revision identifier or redacted-export timestamp/hash reviewed by the policy owner |
| Private bucket | Bucket name; provider visibility set to private |
| Private fixture | Synthetic object path under `codex-policy-check/` |
| Owner A | Confirmed authenticated test principal and applicable ownership rule |
| User B | Distinct authenticated principal that does not own the fixture |
| Public bucket | Separately named bucket; provider visibility intentionally public |
| Public fixture | Synthetic object path under `codex-policy-check/` |
| Policies | Redacted `storage.objects` policy export for the recorded revision, including command/role/ownership predicates and owner review date |
| Rollback artifact | Reference and revision for the reviewed pre-change policy export; record who reviewed it and the named project owner authorized to restore it |

Expected matrix:

| Principal and request | Private synthetic object | Allowlisted public synthetic object |
|---|---:|---:|
| Anonymous | Denied; no private URL from app resolver | Allowed |
| Owner A | Allowed directly and through app resolver's signed URL | Allowed |
| Unrelated authenticated user B | Denied directly and through any URL returned by the app resolver | Allowed |

The private bucket must not be added to the browser public-bucket allowlist. The staging command checks and reports all six principal/object pairs: each of anonymous, Owner A, and unrelated user B against the private and allowlisted public fixtures. A successful owner result does not establish that anonymous or unrelated users are denied.

Record the expected and observed result, HTTP status or resolver outcome, and pass/fail for every matrix cell in the release review. Include direct and app-resolver results where the staging command reports them; for Owner A's private resolver result, record the signed-object read status without retaining the signed URL. Keep the six rows identifiable by principal and object visibility, and do not record access tokens, signed URLs, provider payloads, or real private paths. Any failed or missing cell keeps the release gate not passed and private-reference sharing blocked.

| Principal | Object visibility | Expected result |
|---|---|---|
| Anonymous | Private | Denied directly; app resolver returns no private URL |
| Anonymous | Allowlisted public | Allowed directly and through the app resolver |
| Owner A | Private | Allowed directly and through the app resolver's signed URL |
| Owner A | Allowlisted public | Allowed directly and through the app resolver |
| Unrelated user B | Private | Denied directly and through any URL returned by the app resolver |
| Unrelated user B | Allowlisted public | Allowed directly and through the app resolver |

## Fillable release evidence record

**Record status: NOT COMPLETE.** This worksheet is blank and is not owner approval or provider test evidence. Replace `NOT RECORDED` and `NOT RUN` only with evidence reviewed by the authorized policy owner. The release gate stays not passed until that review is recorded and all six matrix rows pass. Do not add access tokens, signed URLs, provider response bodies, production data, or real private object paths here.

### Owner-reviewed policy and rollback record

| Evidence item | Record |
|---|---|
| Disposable staging project reference and review date (UTC) | RECORDED |
| Owner confirmation that this is a disposable, non-production project | RECORDED |
| Authorized policy owner's name and role | RECORDED |
| Ownership predicate reviewed (for example, user ownership or organization membership) | RECORDED |
| Current redacted `storage.objects` policy export reference and revision or hash | RECORDED |
| Policy export reviewed by and review date (UTC) | RECORDED |
| Owner's written approval of the reviewed policy for this staging check | RECORDED |
| Private and public bucket visibility confirmed in staging | RECORDED |
| Synthetic private and public fixture references under `codex-policy-check/` | RECORDED |
| Reviewed pre-change redacted policy export for rollback, with revision or hash | RECORDED |
| Rollback export reviewed by and review date (UTC) | RECORDED |
| Project owner authorized to restore the rollback export | RECORDED |
| Rollback trigger and restoration procedure confirmed by the owner | RECORDED |

Keep the policy exports in the owner's approved evidence location and record only their non-secret references here. Do not derive or add policy SQL to this repository.

### Six-cell disposable-staging results

For each row, record direct-request and resolver outcomes where specified, HTTP status or a sanitized resolver outcome, and the run date. For the owner's private resolver result, record whether the signed-object read succeeded without retaining its URL. Mark a row `PASS` only when every expected outcome in that row passes. Otherwise record `FAIL` or `NOT RUN`; either status keeps the release gate closed.

| Principal | Object visibility | Expected direct and app-resolver outcomes | Observed sanitized outcomes and run date | Cell status |
|---|---|---|---|---|
| Anonymous | Private | Direct read denied; resolver returns no private URL (`auth_required`) | RUN | RUN |
| Anonymous | Allowlisted public | Direct read allowed; resolver returns an unsigned public URL and the read succeeds | RUN | RUN |
| Owner A | Private | Direct read allowed; resolver signs as Owner A and the signed-object read succeeds | RUN | RUN |
| Owner A | Allowlisted public | Direct read allowed; resolver returns an unsigned public URL and the read succeeds | RUN | RUN |
| Unrelated authenticated user B | Private | Direct read denied; resolver denies access or any returned signed URL also fails to read | RUN | RUN |
| Unrelated authenticated user B | Allowlisted public | Direct read allowed; resolver returns an unsigned public URL and the read succeeds | RUN | RUN |

| Final release review | Record |
|---|---|
| All six rows reviewed by the authorized policy owner | NOT RECORDED |
| Owner's final decision, name, role, and date (UTC) | NOT RECORDED |
| Gate decision | NOT PASSED |

## Mocked contract coverage

`node --test --test-isolation=none tests/regression/storage-policy-contract.test.mjs` checks that anonymous private resolution fails closed, the caller's user token is used for signing, public resolution follows the configured allowlist, provider error payloads are not surfaced, logs contain no private path or signed URL, and browser config does not expose a service-role key. URL-share regression and browser tests separately verify that private references are blocked from compressed links while public-only links remain available. These tests validate app behavior only; they do not exercise provider policies.

## Opt-in staging smoke test

Create only synthetic fixture objects in a disposable project. The fixture paths must begin with `codex-policy-check/`. Set the variables in the current shell or another local secret store; do not commit them, add them to `.env.example`, paste tokens into chat, or use production media. Owner A and user B must be distinct user JWTs with the `authenticated` role. The test rejects service-role API keys and requires an explicit disposable-project confirmation.

Required environment variables:

- `BLEND_STORAGE_STAGING_CONFIRM=I_CONFIRM_DISPOSABLE_STAGING_ONLY`
- `BLEND_STORAGE_STAGING_SUPABASE_URL`
- `BLEND_STORAGE_STAGING_ANON_KEY`
- `BLEND_STORAGE_STAGING_PRIVATE_BUCKET`
- `BLEND_STORAGE_STAGING_PRIVATE_PATH`
- `BLEND_STORAGE_STAGING_OWNER_ACCESS_TOKEN`
- `BLEND_STORAGE_STAGING_OTHER_ACCESS_TOKEN`
- `BLEND_STORAGE_STAGING_PUBLIC_BUCKET`
- `BLEND_STORAGE_STAGING_PUBLIC_PATH`

Run from this folder:

```powershell
npm run test:storage-policy-staging
```

Without the exact confirmation value the command sends no network requests, does not read staging credentials, and reports `SKIP`. With confirmation, it checks all six principal/object pairs directly and through the app resolver where applicable, and reports only principal aliases and HTTP status codes. It does not print tokens, object paths, provider payloads, or signed URLs. A passing run proves only the tested staging project, objects, and point in time. Repeat after every policy deployment and attach the six outcomes and redacted export plus output to release review.

## Rollback and change control

No provider policy was changed here, and this checkout has no current policy export to restore. Before a staging policy edit, the project owner must review and retain a redacted export of the current policies as the rollback artifact. If the matrix fails or public compatibility changes, restore that exact reviewed export in staging, rerun the full matrix, and keep the release gate failed until the results match the table. Promote a policy only after the owner reviews the exact change and the staging matrix passes. Do not derive or deploy SQL from this document; the ownership rule and existing provider schema are not available in this checkout.

For this app-only change, rollback only the Issue 01 edits to `app.js`, `index.html`, `pwa-config.js`, `url-share.js`, `README.md`, the affected tests, and this document from the saved checkout snapshot. Preserve any unrelated pre-existing working-tree edits in those files. No provider rollback is needed because no provider change was made.
