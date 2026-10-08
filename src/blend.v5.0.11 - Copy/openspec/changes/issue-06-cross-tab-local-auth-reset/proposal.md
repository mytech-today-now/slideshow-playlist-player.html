# Proposal

## Why

Clear Browser Storage currently clears the Supabase auth client in the tab where reset starts. Another open Blend tab can retain its in-memory session and refresh timer, so the local reset can leave private media access active elsewhere in the same browser.

## What Changes

- Make local reset clear the in-memory session and opted-in saved session in every confirmed open Blend tab on the same origin.
- Send only a local reset event and nonce between tabs; receivers acknowledge after cancelling refresh and clearing local auth state.
- Wait for peer acknowledgments for a bounded period and keep saved Blend data recoverable when a peer cannot be confirmed.
- Preserve regular sign-out's existing remote behavior, the memory-only default, persistence opt-in, and reset rollback.
- Advance the asset and cache markers so installed clients load the reset coordination code.

## Capabilities

### New Capabilities

- `cross-tab-local-session`: Same-origin Blend tabs clear local Supabase auth together during browser reset without remote logout.

### Modified Capabilities

None. This checkout has no existing main specs.

## Impact

The change affects `supabase-auth.js`, the Clear Browser Storage flow in `app.js`, asset and cache markers in `index.html` and `pwa-config.js`, auth and reset regression tests, and the two relevant Playwright E2E specs. It adds no dependency, database migration, or provider request.
