# Proposal

## Why

Issue 7 in `ai-prompts/pre-mortem-2026-11-09-19-36-34.html#issue-07` records that compressed sharing is already blocked while `storage-url-resolver.js` can still send a caller access token to request a private Storage URL. The owner-reviewed project and policy revision are absent and all six principal/object matrix cells remain NOT RUN, so this build needs to block private signing as well.

## What Changes

- Add an empty source-controlled Storage policy scope and current policy revision for this build; runtime configuration cannot supply either value.
- Reject private URL signing before using an access token or making a Storage request unless the exact project, policy revision, and bucket match the trusted scope.
- Give operators accessible guidance that preserves local files, direct public media URLs, JSON export, and saved `supabase://` references.
- Keep the Share gate closed, retain the release record's NOT RECORDED / NOT RUN evidence, and update asset/cache versions so installed clients receive the gate.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `supabase-configuration`: Require private Storage signing to match a source-controlled project, policy revision, and bucket scope; preserve portable references and unrelated local/public playback.

## Impact

The change affects `storage-url-resolver.js`, `url-share.js`, `app.js`, the versioned PWA asset list, the Supabase configuration documentation, and focused regression/browser coverage. It adds one small source-controlled scope module, but no runtime dependency, build step, storage schema, provider policy artifact, credential, or service-role key. The existing `TRUSTED_STORAGE_SHARE_SCOPE` remains null.
