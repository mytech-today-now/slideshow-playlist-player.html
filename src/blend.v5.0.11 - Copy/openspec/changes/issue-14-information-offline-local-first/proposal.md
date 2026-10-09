# Proposal

## Why

When a user selects current online documentation without a fresh cache, the Information dialog can replace the installed guide with a loading state while the remote request waits up to ten seconds. The installed README is already available locally and should remain readable while that optional refresh is pending or fails.

## What Changes

- Keep the installed README visible while an online refresh is pending.
- Replace the complete installed guide only after a successful bounded remote response.
- On refresh failure, retain the installed guide and show the required unavailable message with a user-triggered retry.
- Add deterministic timing coverage for empty and expired caches, remote success and failure, fresh-cache behavior, and retry.

## Capabilities

### New Capabilities

- `information-documentation-refresh`: Keeps the installed guide available during an explicitly requested online documentation refresh.

### Modified Capabilities

None. The current source-selection, cache, safe-rendering, and navigation contracts are preserved.

## Impact

The change affects `readme-fetcher.js`, Information dialog loading and status handling in `app.js`, and the README fetcher regression and Information dialog Playwright tests. It adds no runtime dependency, persistence schema, or new remote URL.
