# Proposal

## Why

The provider policy export and disposable staging matrix are still missing, but the app currently creates compressed Share URLs containing portable references to private Supabase objects. The existing warning explains the unverified state but does not stop that sharing path.

## What Changes

- Block compressed Share URL creation when the referenced experience contains an object from a bucket outside the configured public allowlist.
- Show the existing private-media verification warning when the share is blocked.
- Refresh the app and service-worker cache versions so installed clients do not keep the previous sharing behavior.
- Keep URL sharing for public-only experiences, normal resolver playback, JSON export sanitization, and portable storage references intact.
- Keep release status unverified until the owner-reviewed provider export and disposable staging matrix pass.
- Make the opt-in staging matrix report the anonymous, owner, and unrelated-user outcomes for both private and public fixtures.

## Capabilities

### New Capabilities

- `private-storage-sharing`: Gate compressed sharing of private Supabase references on provider authorization verification.

### Modified Capabilities

None.

## Impact

Affected code includes `app.js`, `index.html`, `pwa-config.js`, `url-share.js`, storage policy regression and staging tests, the private Storage verification record, and the README private-media section. No provider policy, runtime dependency, credential, storage schema, or persistence format changes.
