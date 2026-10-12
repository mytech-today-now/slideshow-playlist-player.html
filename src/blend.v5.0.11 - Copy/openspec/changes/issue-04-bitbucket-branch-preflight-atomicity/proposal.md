# Proposal

## Why

Bitbucket Cloud's documented source upload accepts a branch and parent revision but does not document an atomic compare-and-set condition. A concurrent commit can therefore race the current preflight, and publish failures currently discard the exact reviewed document and revision needed for recovery.

## What Changes

- Stop direct writes to a Bitbucket branch unless the provider documents a conditional write that protects the reviewed head.
- Keep the exact reviewed JSON and observed revision available after conflicts and ambiguous write outcomes; offer an explicit user action to download that copy.
- After a possibly submitted write, require a successful remote read and comparison before another publish attempt.
- Preserve GitHub's documented stale-SHA protection and update provider guidance to describe only verified behavior.

## Capabilities

### New Capabilities

- `remote-playlist-publishing`: Review, conflict, write, and recovery behavior for direct Git provider playlist publishing.

### Modified Capabilities

None.

## Impact

Affected files include `git-playlist-storage.js`, the Git playlist controls in `app.js` and `index.html`, README and provider design documentation, and the storage regression and E2E tests. No dependencies, persisted formats, or database schema change.
