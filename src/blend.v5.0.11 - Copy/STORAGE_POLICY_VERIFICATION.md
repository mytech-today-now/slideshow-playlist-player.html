# Private Storage policy verification

## Current release-gate status

This checkout contains the browser resolver and runtime Supabase configuration, but no Storage policy SQL, migration, or deployable provider policy artifact. No live or disposable staging project was available during this change. This is an unverified provider boundary, not evidence of a policy defect.

The app resolver sends the signed-in user's access token to Supabase when it requests a private signed URL. It sends the configured public anon key as `apikey`; no service-role credential is part of browser runtime config. Public resolution is limited to `SUPABASE_PUBLIC_BUCKETS`. The settings panel therefore shows: “Private media access could not be verified. Contact the project owner before sharing.”

**Release gate: not passed.** Do not mark private Storage authorization verified until the policy owner supplies a redacted policy export and the matrix below passes in a disposable staging project. The owner must confirm the ownership predicate used by the project (for example user ownership or organization membership); this app does not choose or infer it.

## Policy and fixture record

Before running the matrix, record these non-secret values in the release review:

| Item | Required record |
|---|---|
| Project | Disposable staging project reference and reviewer |
| Private bucket | Bucket name; provider visibility set to private |
| Private fixture | Synthetic object path under `codex-policy-check/` |
| Owner A | Confirmed authenticated test principal and applicable ownership rule |
| User B | Distinct authenticated principal that does not own the fixture |
| Public bucket | Separately named bucket; provider visibility intentionally public |
| Public fixture | Synthetic object path under `codex-policy-check/` |
| Policies | Redacted `storage.objects` policy export, including command/role/ownership predicates |
| Rollback | Reviewed pre-change policy export and named project owner who can restore it |

Expected matrix:

| Principal and request | Private synthetic object | Allowlisted public synthetic object |
|---|---:|---:|
| Anonymous | Denied; no private URL from app resolver | Allowed |
| Owner A | Allowed directly and through app resolver's signed URL | Allowed |
| Unrelated authenticated user B | Denied directly and through any URL returned by the app resolver | Allowed |

The private bucket must not be added to the browser public-bucket allowlist. A successful owner result does not establish that anonymous or unrelated users are denied; record all three principal outcomes.

## Mocked contract coverage

`node --test --test-isolation=none tests/regression/storage-policy-contract.test.mjs` checks that anonymous private resolution fails closed, the caller's user token is used for signing, public resolution follows the configured allowlist, provider error payloads are not surfaced, logs contain no private path or signed URL, and browser config does not expose a service-role key. These tests validate app behavior only; they do not exercise provider policies.

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

Without the exact confirmation value the command sends no network requests and reports `SKIP`. With confirmation, it reports only principal aliases and HTTP status codes; it does not print tokens, object paths, provider payloads, or signed URLs. A passing run proves only the tested staging project, objects, and point in time. Repeat after every policy deployment and attach the redacted export plus output to release review.

## Rollback and change control

No provider policy was changed here, and this checkout has no current policy export to restore. Before a staging policy edit, the project owner must review and retain a redacted export of the current policies as the rollback artifact. If the matrix fails or public compatibility changes, restore that exact reviewed export in staging, rerun the full matrix, and keep the release gate failed until the results match the table. Promote a policy only after the owner reviews the exact change and the staging matrix passes. Do not derive or deploy SQL from this document; the ownership rule and existing provider schema are not available in this checkout.

For this app-only change, rollback is to restore the prior versions of `index.html`, `storage-url-resolver.js`, `README.md`, `package.json`, the added tests, and this document from the saved checkout snapshot. No provider rollback is needed because no provider change was made.
