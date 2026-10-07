# Design

## Context

See proposal.md and `specs/private-storage-sharing/spec.md`. The checked-in app has a static unverified warning, a configured public bucket allowlist, and a compressed URL share payload that preserves portable storage references. No provider verification artifact exists in this checkout.

## Goals / Non-Goals

**Goals:**

- Stop compressed share links from containing references to private Supabase buckets while this build remains unverified.
- Use the existing public allowlist and warning copy, without changing playback or portable export behavior.
- Make the opt-in staging matrix emit all six principal/object outcomes without sensitive values.

**Non-Goals:**

- Verify, define, or deploy Supabase policy SQL.
- Add a browser-configurable flag that lets an app user self-certify provider authorization.
- Disable normal private playback, public-only URL sharing, or JSON exports.

## Decisions

- Inspect the already-built referenced-only export payload before compression. A pure helper classifies a Supabase reference as private when its normalized bucket is absent from the configured public allowlist. Checking the referenced payload leaves unused private library entries out of scope.
- Block before compression or opening the share dialog and show the existing verification warning through the app's accessible toast. Do not log the payload, bucket, or path.
- Advance the asset and cache version strings and update the shell/module URLs so the service worker installs the gated app instead of serving the earlier sharing code.
- Keep the resolver and export sanitizer unchanged. The resolver tests continue to prove client behavior only, and private portable `storageReference` values remain available to backups and imports.
- The checked-in build has no owner attestation and therefore has no client-side unlock switch. After owner evidence passes, a separately reviewed release change can authorize sharing; an ordinary user setting cannot mark provider policy as verified.
- Extend the staging script to check private and public fixtures for anonymous, owner, and unrelated authenticated principals. Output only those aliases and HTTP status codes. Without the exact disposable confirmation, exit before reading credentials or sending requests.

## Risks / Trade-offs

- [Private references in an experience cannot be shared by compressed URL in this build even if an external project happens to be correctly configured] → The release owner can use the reviewed export and staging matrix, then authorize sharing through a subsequent reviewed release change.
- [A public bucket can be misconfigured at the provider] → The gate follows only the explicit browser allowlist; public visibility remains a provider responsibility and is included in the staging matrix.
- [Local mocks cannot prove deployed policy behavior] → Keep the release gate not passed until the owner attaches the redacted policy and rollback exports and reviews all six staging outcomes.

