# Design

## Context

See proposal.md and `specs/private-storage-sharing/spec.md`. The checked-in app has a configured public bucket allowlist and compressed URL sharing that can preserve portable storage references. No provider verification artifact or independently checked policy-revision source exists in this checkout.

## Goals / Non-Goals

**Goals:**

- Stop compressed share links from containing Supabase references until a trusted source-controlled project and current policy-revision scope exists.
- Preserve direct public HTTP URL sharing, playback, and portable JSON export behavior.
- Make the opt-in staging matrix emit all six principal/object outcomes without sensitive values.

**Non-Goals:**

- Verify, define, or deploy Supabase policy SQL.
- Add a browser-configurable flag that lets an app user self-certify provider authorization.
- Disable normal private playback, public-only URL sharing, or JSON exports.

## Decisions

- Inspect the already-built referenced-only export payload before compression. A pure helper fails closed for malformed references or when the source-controlled scope does not exactly match the current project and policy revision. Checking the referenced payload leaves unused private library entries out of scope.
- The runtime public-bucket allowlist remains a resolver setting; it cannot approve compressed sharing. This build ships a null trusted scope and no current policy-revision source, so every portable Supabase reference is blocked.
- Block before compression or opening the share dialog and show an accessible exact-scope warning. Do not log the payload, bucket, or path.
- Advance the asset and cache version strings and update the shell/module URLs so the service worker installs the gated app instead of serving the earlier sharing code.
- Keep the resolver and export sanitizer unchanged. The resolver tests continue to prove client behavior only, and private portable `storageReference` values remain available to backups and imports.
- The checked-in build has no owner attestation and therefore has no client-side unlock switch. After owner evidence passes, a separately reviewed release change can authorize sharing; an ordinary user setting cannot mark provider policy as verified.
- Extend the staging script to check private and public fixtures for anonymous, owner, and unrelated authenticated principals. Output only those aliases and HTTP status codes. Without the exact disposable confirmation, exit before reading credentials or sending requests.

## Risks / Trade-offs

- [Private references in an experience cannot be shared by compressed URL in this build even if an external project happens to be correctly configured] → The release owner can use the reviewed export and staging matrix, then authorize sharing through a subsequent reviewed release change.
- [Direct public HTTP URLs can become private or change behavior] → The app treats them as user-supplied URLs and does not claim provider visibility; review the URL before sharing.
- [Portable Supabase references are also unavailable for compressed sharing in this build] → Keep the scope absent until an owner-approved, revision-bound authorization source can be checked; JSON export and playback remain available.
- [Local mocks cannot prove deployed policy behavior] → Keep the release gate not passed until the owner attaches the redacted policy and rollback exports and reviews all six staging outcomes.

## Trusted-scope follow-up (2026-10-28)

The runtime Supabase project URL and `SUPABASE_PUBLIC_BUCKETS` can be changed through LocalStorage, so neither value is owner evidence. `TRUSTED_STORAGE_SHARE_SCOPE` is `null` in this build. The app supplies no policy revision because no trusted source for the provider's current revision is available; missing revision data therefore fails closed. The scope matcher requires an exact project URL, exact non-empty policy revision, and a valid bucket list. The app does not accept scope or policy-revision fields from runtime configuration.

This fail-closed choice blocks public and private `supabase://` references from compressed URLs until such a scope is verified. Direct public HTTP URLs continue to work. Local playback and JSON export of portable references remain unchanged. Synthetic scope tests validate matching and invalidation only; they do not authorize a provider or release.

