# Proposal

## Why

The provider policy export and disposable staging matrix are still missing. The existing share gate relied on a runtime-editable public-bucket allowlist, which is not bound to an exact project or policy revision and cannot serve as owner approval. This follow-up keeps compressed Supabase references blocked until a trusted exact scope and a current revision source are available.

## What Changes

- Require a trusted, source-controlled project and policy-revision scope before compressed Share URLs can contain Supabase Storage references.
- Keep the current release scope absent and fail closed when the scope, project, or policy revision is missing or mismatched; do not use the runtime allowlist as approval.
- Explain the exact-scope block and retain direct public HTTP URL sharing and local playback.
- Refresh the app and service-worker cache versions so installed clients do not keep the previous sharing behavior.
- Keep direct public HTTP URL sharing, normal resolver playback, JSON export sanitization, and portable storage references in JSON exports intact.
- Keep release status unverified until the owner-reviewed provider export and disposable staging matrix pass.
- Make the opt-in staging matrix report the anonymous, owner, and unrelated-user outcomes for both private and public fixtures.

## Capabilities

### New Capabilities

- `private-storage-sharing`: Gate compressed sharing of private Supabase references on provider authorization verification.

### Modified Capabilities

None.

## Impact

Affected code includes `app.js`, `index.html`, `pwa-config.js`, `url-share.js`, storage policy and URL-share regression/E2E tests, the private Storage verification record, and the README private-media section. No provider policy, runtime dependency, credential, storage schema, or persistence format changes.
