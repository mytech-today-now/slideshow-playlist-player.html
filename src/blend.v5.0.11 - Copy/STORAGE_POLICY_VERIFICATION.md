# Private Storage policy verification

## Current release-gate status

This checkout contains the browser resolver and runtime Supabase configuration, but no Storage policy SQL, migration, or deployable provider policy artifact. No live or disposable staging project was inspected for this app-only change. This is an unverified provider boundary, not evidence of a policy defect.

The app resolver sends the signed-in user's access token to Supabase when it requests a private signed URL. It sends the configured public anon key as `apikey`; no service-role credential is part of browser runtime config. Public resolution and URL sharing are limited to `SUPABASE_PUBLIC_BUCKETS`. Until an owner-reviewed release change records successful provider verification, compressed Share URL creation is blocked when a referenced item is in a non-allowlisted bucket. The settings panel and blocked share action explain that private URL sharing is blocked until the project owner verifies Storage access, and offer public-only sharing or continued local playback. Normal playback and portable JSON exports retain their existing contracts.

**Release gate: not passed.** Do not mark private Storage authorization verified until the policy owner supplies a redacted policy export and the matrix below passes in a disposable staging project. The owner must confirm the ownership predicate used by the project (for example user ownership or organization membership); this app does not choose or infer it.

## Finding assessment

Linked finding: [report `issue-01`](ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-01), **Private Storage authorization remains an unpassed release gate**. Private-reference URL sharing remains blocked by the app. No provider policy defect or exposure was observed; the actual provider policy and authorization behavior remain unknown. The possibility that a deployed policy could permit unintended access or deny the owner is a testable assumption, not an observed incident or a claim that the policy is safe.

## Claim provenance inventory

Reviewed 2026-10-23 against this checkout. Active code describes repository-owned client behavior. Placeholder configuration describes defaults and possible runtime overrides. Neither category proves provider-owned bucket state or authorization. Expected matrix outcomes are acceptance criteria, not observed results.

| Statement | Classification | Source | What the evidence establishes |
|---|---|---|---|
| Compressed Share URL creation stops before compression when a referenced Supabase bucket is outside the configured public allowlist. | Active code | `url-share.js` (`hasNonPublicSupabaseStorageReference`), `app.js` (`shareExperienceViaUrl`), and the URL-share regression and private-media E2E tests. | This is the app gate. It does not establish bucket visibility or provider authorization. A non-allowlisted reference is unverified by this gate, not confirmed private. |
| The settings note and blocked-share message explain the gate, allow public-only sharing or continued local playback, and leave portable Supabase references available to JSON export. | Active code | `index.html`, `app.js`, `url-share.js` (`sanitizeMediaRecordForExport`), and `tests/e2e/private-media-export.e2e.spec.mjs`. | This traces the implemented fallback and export contract. Browser behavior was not rerun for this documentation review. |
| Private URL signing requires a caller access token and sends that token as the bearer identity with the configured anon key. | Active code | `storage-url-resolver.js` (`signPrivateUrl`) and synthetic cases in `tests/regression/storage-policy-contract.test.mjs`. | This establishes request construction and local error handling only. It does not establish whether the provider authorizes the caller. |
| `SUPABASE_PUBLIC_BUCKETS` defaults to `public`; runtime settings can override configuration defaults. | Placeholder config and active config resolution | `supabase-config.js` (`PLACEHOLDER_DEFAULTS`, `getBlendRuntimeConfig`) and `.env.example`. | These are defaults and configuration mechanics, not the deployed bucket list or evidence that any bucket is public. `.env.example` contains placeholders. |
| Browser runtime config does not expose a service-role field. | Active code and synthetic regression | `supabase-config.js` and the injected-value assertion in `tests/regression/storage-policy-contract.test.mjs`. | This verifies the local config object with synthetic input. It is not provider-policy evidence. |
| The staging runner's six-cell checks, synthetic-path validation, and exact-confirmation skip guard. | Active code and synthetic skip-path regression | `tests/integration/storage-policy-staging.mjs` and absent/inexact-confirmation cases in `tests/regression/storage-policy-contract.test.mjs`. | The source and local skip cases establish runner mechanics only. The regression cases make no provider request, and the six-cell matrix was not run. |
| Generic statements about private/public bucket access, the example `owner_id` rule, and anonymous Auth users using the `authenticated` role. | External vendor documentation, generic only | [Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control), [Storage Buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), and [Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous). | These describe documented platform behavior and examples, not this project's bucket settings, policy, ownership model, or authorization results. |
| The draft's named buckets, Owner A/B fixture ownership, `owner_id`/`sub` predicate, read-only scope, no-other-policy assumption, and test meaning of anonymous. | Unverified draft assumptions | `STORAGE_POLICY_ASSUMPTIONS_DRAFT.md`. | These are hypothetical test-model assumptions only. The commented SQL is not a policy export, rollback copy, owner approval, or deployment record. |
| Actual bucket IDs and visibility, the complete applicable Storage policy set, the ownership predicate, and owner approval. | Owner-approved redacted export: NOT PROVIDED | The owner and policy fields below remain `NOT RECORDED`; no owner export was supplied in this checkout. | These provider-owned facts remain unknown. The exact required inputs are listed in the owner-reviewed policy and rollback record below. |
| Anonymous, Owner A, and unrelated User B outcomes for private and public fixtures. | Disposable-stage result: NOT RUN | All six rows in the six-cell results table below remain `NOT RUN`, with no observed outcome or run date. | No provider result or passing cell is claimed. Local mocks and skip-path tests do not fill these rows. |
| Pre-change policy state, reviewed rollback export, and owner-authorized restoration outcome. | Owner-approved redacted export: NOT PROVIDED | Rollback fields below remain `NOT RECORDED`; no rollback export was supplied in this checkout. | There is no provider rollback artifact to restore or claim as reviewed. |
| Expected authorization outcomes and rollback requirements. | Expected requirements, not evidence | The expected matrix and rollback/change-control sections below. | These specify future acceptance and recovery steps. They do not describe observed provider behavior or a rollback artifact. |

The repository scan `git ls-files '*.sql' '**/*.sql'` and `rg --files -g '*.sql' -g '!node_modules/**'` returned no SQL files in this checkout. This local scan does not rule out owner evidence held elsewhere. No owner-reviewed policy export, rollback export, or disposable-stage result was supplied for this review. Keep the gate **not passed** and private-reference URL sharing blocked until the missing owner inputs and all six staging outcomes are recorded.

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

| Evidence item | Record status | Information required to complete the record |
|---|---|---|
| Disposable staging project reference and review date (UTC) | NOT RECORDED | Non-secret project reference and date the project was confirmed disposable. |
| Owner confirmation that this is a disposable, non-production project | NOT RECORDED | Written confirmation from the authorized project owner. |
| Authorized policy owner's name and role | NOT RECORDED | Owner's name, role, and authority to approve the Storage policy and release gate. |
| Ownership predicate reviewed (for example, user ownership or organization membership) | NOT RECORDED | The exact ownership rule used by this project, confirmed by its policy owner. Do not infer it here. |
| Current redacted `storage.objects` policy export reference and revision or hash | NOT RECORDED | Non-secret reference to the redacted export and its revision, timestamp, or hash. Keep the export in the owner's approved evidence location. |
| Policy export reviewed by and review date (UTC) | NOT RECORDED | Reviewer's name and role, plus review date in UTC. |
| Owner's written approval of the reviewed policy for this staging check | NOT RECORDED | Reference to the owner's approval and its date. |
| Private and public bucket visibility confirmed in staging | NOT RECORDED | Owner-reviewed confirmation of each fixture bucket's configured visibility. |
| Synthetic private and public fixture references under `codex-policy-check/` | NOT RECORDED | Synthetic fixture references for both buckets under the required prefix. |
| Reviewed pre-change redacted policy export for rollback, with revision or hash | NOT RECORDED | Non-secret reference to the exact pre-change rollback export and its revision, timestamp, or hash. |
| Rollback export reviewed by and review date (UTC) | NOT RECORDED | Reviewer's name and role, plus review date in UTC. |
| Project owner authorized to restore the rollback export | NOT RECORDED | Name and role of the owner authorized to restore the retained export. |
| Rollback trigger and restoration procedure confirmed by the owner | NOT RECORDED | Owner-confirmed rollback trigger and the procedure for restoring the exact retained export. |

Keep the policy exports in the owner's approved evidence location and record only their non-secret references here. Do not derive or add policy SQL to this repository.

### Six-cell disposable-staging results

For each row, record direct-request and resolver outcomes where specified, HTTP status or a sanitized resolver outcome, and the run date. For the owner's private resolver result, record whether the signed-object read succeeded without retaining its URL. Mark a row `PASS` only when every expected outcome in that row passes. Otherwise record `FAIL` or `NOT RUN`; either status keeps the release gate closed.

| Principal | Object visibility | Expected direct and app-resolver outcomes | Observed sanitized outcomes and run date | Cell status |
|---|---|---|---|---|
| Anonymous | Private | Direct read denied; resolver returns no private URL (`auth_required`) | NOT RUN; no outcome or run date recorded | NOT RUN |
| Anonymous | Allowlisted public | Direct read allowed; resolver returns an unsigned public URL and the read succeeds | NOT RUN; no outcome or run date recorded | NOT RUN |
| Owner A | Private | Direct read allowed; resolver signs as Owner A and the signed-object read succeeds | NOT RUN; no outcome or run date recorded | NOT RUN |
| Owner A | Allowlisted public | Direct read allowed; resolver returns an unsigned public URL and the read succeeds | NOT RUN; no outcome or run date recorded | NOT RUN |
| Unrelated authenticated user B | Private | Direct read denied; resolver denies access or any returned signed URL also fails to read | NOT RUN; no outcome or run date recorded | NOT RUN |
| Unrelated authenticated user B | Allowlisted public | Direct read allowed; resolver returns an unsigned public URL and the read succeeds | NOT RUN; no outcome or run date recorded | NOT RUN |

| Final release review | Record |
|---|---|
| All six rows reviewed by the authorized policy owner | NOT RECORDED |
| Owner's final decision, name, role, and date (UTC) | NOT RECORDED |
| Gate decision | NOT PASSED |

## Mocked contract coverage

`node --test --test-isolation=none tests/regression/storage-policy-contract.test.mjs` checks that anonymous private resolution fails closed, the caller's user token is used for signing, public resolution follows the configured allowlist, provider error payloads are not surfaced, logs contain no private path or signed URL, and browser config does not expose a service-role key. URL-share regression and browser tests separately verify that private references are blocked from compressed links while public-only links remain available. These tests validate app behavior only; they do not exercise provider policies.

Historical local validation record for 2026-10-15, not rerun for this documentation review: the focused Storage policy contract passed 7/7, `npm run check` passed, and `npm run test:regression` passed 360/360. No staging command or provider request was run for that review because owner approval, policy evidence, and disposable-project confirmation were not supplied. These historical local checks do not change the provider release-gate status.

Local validation record for 2026-10-25, linked to [report finding `issue-01`](ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-01), **Private Storage authorization remains an unpassed release gate**: `node --test --test-isolation=none --test-name-pattern="staging command skips" tests/regression/storage-policy-contract.test.mjs` passed 2/2 for absent and inexact confirmation. The credential-reading proxy observed only the confirmation setting, the fetch spy observed no requests, and output contained no credential values. `npm run sanity` passed, including syntax checks and 383/383 regressions. `npm run test:storage-policy-staging` was not run because no owner-approved disposable project, redacted current and rollback exports, or synthetic fixtures were supplied. Provider behavior remains **NOT RUN**; all six cells remain **NOT RUN**, owner and rollback evidence remain **NOT RECORDED**, and the release gate remains **NOT PASSED**. Private-reference URL sharing remains blocked.

### 2026-10-25 scope and local-check recheck

The linked finding, this evidence record, `blend-5qc`, and the OpenSpec change were rechecked. Owner approval and policy evidence are still not recorded in this checkout: the disposable project identity and confirmation, authorized policy owner's identity and authority, ownership predicate, bucket visibility and fixtures, separate current and rollback export references and revisions, reviewer details, staging approval, rollback owner and procedure, six observed outcomes, and final owner decision remain **NOT RECORDED** or **NOT RUN**. The assumption draft and completed OpenSpec planning artifacts are not provider evidence.

The static app's project and public-bucket allowlist can be changed through runtime configuration, including LocalStorage. The share gate checks a referenced bucket against that configurable public allowlist; this does not bind an owner approval to an exact project and policy revision. No private-reference sharing scope was enabled. A future enablement requires a trusted, non-user-editable scope binding and a defined way to invalidate it when the provider policy revision changes. Until that design and every owner prerequisite pass, keep the existing gate closed.

- `node --test --test-isolation=none --test-name-pattern="staging command skips" tests/regression/storage-policy-contract.test.mjs`: passed 2/2. The synthetic environment proxy observed only the confirmation setting; no credentials were read and the fetch spy observed no requests.
- `node --test --test-isolation=none tests/regression/storage-policy-contract.test.mjs tests/regression/url-share.test.mjs`: passed 53/53.
- `npm run sanity`: passed syntax checks and 383/383 regressions.
- Initial sandboxed `npm run test:e2e -- tests/e2e/private-media-export.e2e.spec.mjs tests/e2e/sharing.e2e.spec.mjs` returned `spawn EPERM` before test discovery. Retrying with the sandbox process restriction lifted launched the local fixture server and browsers.
- Focused Chromium E2E rerun for `private-media-export.e2e.spec.mjs` and `sharing.e2e.spec.mjs`: **7 passed**. This covered private-reference share blocking, portable JSON export, disclosure and viewport behavior, keyboard access, and Supabase auth UI flows.
- Full `npm run test:e2e` run with isolated output under `output/playwright/e2e-full-20261025/`: **307 passed, 3 failed, 12 skipped** across 322 Chromium, Firefox, and WebKit cases, using six workers. The failures were the Chromium expired signed-URL renewal case, the Chromium temporary refresh-outage focus assertion, and the WebKit thumbnail canvas call-count assertion. The provider smoke cases reported skipped and made no provider requests. The HTML report is `output/playwright/e2e-full-20261025/report/index.html`.
- Reran the three failed cases with one worker across Chromium and WebKit using `--grep "expired Supabase signed URLs renew|temporary refresh outage keeps the saved session|a canvas failure releases queue capacity"`: **4 passed**. The full-run failures did not reproduce in this focused rerun; the reason for the difference is not established. Rerun output is under `output/playwright/e2e-failure-rerun-20261025/`.
- `npm run test:storage-policy-staging`: not run because owner prerequisites are absent. No staging credentials were read and no provider request was made.

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
