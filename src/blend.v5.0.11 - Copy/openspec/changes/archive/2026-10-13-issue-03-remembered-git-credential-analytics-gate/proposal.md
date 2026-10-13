# Proposal

## Why

Blend can explicitly remember a GitHub or Bitbucket token in same-origin LocalStorage, while consented analytics loads Google Tag Manager into the Blend document. An allowlisted event payload does not isolate that script from the token. This is a conditional supply-chain exposure; there is no evidence that the current analytics vendor has read credentials.

## What Changes

- Prevent analytics script execution while a remembered Git repository credential exists or LocalStorage state cannot be inspected.
- Coordinate analytics execution and credential persistence across Blend tabs so the two modes cannot be entered concurrently.
- Keep a Git connection session-only if analytics already owns the shared boundary, and explain how to switch modes without changing consent or losing the current connection.
- Re-evaluate consent when a credential is remembered or forgotten, including changes from another tab. Preserve DNT/GPC, event allowlists, provider tagging, and explicit forget/disconnect behavior.
- Document the reversible mode boundary and its browser support fallback.

## Capabilities

### New Capabilities

- `analytics-credential-boundary`: Prevent unisolated third-party analytics execution and remembered repository write credentials from being active together.

### Modified Capabilities

None.

## Impact

Affected code includes the analytics decision and loader in `app.js`, `analytics-consent.js`, the remembered credential API in `git-playlist-storage.js`, analytics and Git controls in `index.html`, and the security/privacy notes in `README.md`. Regression and Playwright coverage will exercise saved-state inspection, cross-tab boundary acquisition, privacy signals, event allowlists, and credential recovery. No runtime dependency or persisted-format migration is needed.
