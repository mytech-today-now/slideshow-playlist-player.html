# Design

## Context

See `proposal.md` and `specs/supabase-configuration/spec.md`. The existing app uses the configured project URL and caller access token to request private signed URLs. The Share gate already has no owner-reviewed scope, and the current policy revision is not independently available in this build.

## Goals / Non-Goals

**Goals:**

- Make one source-controlled policy scope the only authorization input for compressed sharing and private signing.
- Block private signing in this build before caller-token access, cache reuse, or a Storage request.
- Show the requested accessible fallback and retain portable references for later reviewed builds.

**Non-Goals:**

- Run the provider matrix, infer or deploy policy SQL, or claim anything about live project authorization.
- Let runtime configuration or `SUPABASE_PUBLIC_BUCKETS` approve a policy scope.
- Change Auth, JSON/share formats, persistence schema, or service-role handling.

## Decisions

- Put `TRUSTED_STORAGE_POLICY_SCOPE` and `CURRENT_STORAGE_POLICY_REVISION` in a small static module. Both are empty for this checkout. The module also owns the exact project/revision/bucket matcher and the playback fallback message. `url-share.js` keeps exporting `TRUSTED_STORAGE_SHARE_SCOPE` as the same null value, so existing callers and the fail-closed sharing contract remain intact.
- Inject only these module constants into `createStorageUrlResolver`; do not read scope fields from `RUNTIME_CONFIG`. Validate the requested bucket and exact configured project/revision before cache lookup, then repeat the check at `signPrivateUrl` before reading the access token. A runtime public-bucket entry is not a substitute for the trusted scope.
- In playback, refuse to reuse a Supabase signed URL from a saved item while its scope is unverified. Keep the portable `supabase://` reference, list membership, and other state so a later reviewed build can resolve it again. Direct public HTTP URLs and local files continue through their existing paths.
- Surface the gate through the existing toast system with `role="alert"`, assertive live announcement, and the exact operator fallback copy. Share keeps its pre-compression block and is updated to avoid saying private playback remains available.
- Bump the asset/cache version and add the scope module to the PWA precache. Existing installed clients must fetch the new authorization behavior.
- Use synthetic policy scope data only in unit tests to exercise exact matching and the signing request path. These tests establish local code behavior, not provider policy outcomes.

## Risks / Trade-offs

- [Private Storage playback is disabled for every project in this checkout, including projects that may actually be correctly configured] → Keep the gate closed until the owner supplies and reviews project/policy evidence and a separate code change records the exact scope.
- [A signed URL already copied outside Blend can remain usable until provider expiry] → This client change prevents reuse or new signing in the app; it cannot revoke a provider-issued bearer URL.
- [The active Issue 01 share-change artifact predates this playback decision] → Keep its Share implementation and owner evidence gate intact; use this Issue 07 change as the separate contract for private signing.

## Migration Plan

1. Ship the new cache version with the null policy scope and private-signing block.
2. Keep the existing release record's owner/rollback fields NOT RECORDED, six matrix rows NOT RUN, and release status NOT PASSED.
3. To enable private signing in a later reviewed release, first obtain owner-approved current and rollback exports and all six disposable-staging outcomes, then add a source-controlled scope and independently reviewed current revision. Do not use runtime settings to unlock it.

Rollback by reverting the code and asset-version change only if a reviewed release owner accepts the prior private-signing behavior. Keep the Share scope null unless the corresponding owner evidence is present.
