# Proposal

## Why

The compatibility page currently redirects to `index.html` without its query or fragment, so shared playback state and authentication callbacks are lost before the app's existing parsers can handle them. Preserving the URL state keeps compatibility links useful without changing the destination app's deep-link or authentication flows.

## What Changes

- Redirect to a fixed, same-origin `index.html` URL while carrying the original query and fragment unchanged and retaining `location.replace` history behavior.
- Update the compatibility page title and make its JavaScript-disabled and redirect-failure fallback clear about state preservation. No-script users will be told to copy the full URL from the address bar; script failures can provide an exact copyable link.
- Add browser regression coverage for deep links, synthetic auth fragments, unsafe-looking query values, direct entry, no-script guidance, and responsive fallback behavior.

## Capabilities

### New Capabilities

- `compatibility-entry`: defines state-preserving navigation and honest fallback behavior for the legacy compatibility page.

### Modified Capabilities

None.

## Impact

The change affects `slideshow-playlist-player.html` and its Playwright E2E coverage. The existing `app.js` deep-link parser and `supabase-auth.js` callback parser remain the consumers of the forwarded URL state. No runtime dependency or server change is required.
