# Proposal

## Why

The browser-stored Supabase runtime configuration can silently redirect future Auth and Storage traffic, and Clear Browser Storage currently preserves that configuration. On shared venue devices, an operator must be able to see and review the connection before Blend uses it, and a full reset must remove it.

## What Changes

- Treat browser-stored connection settings as pending until an operator reviews them in the current tab.
- Keep controlled host-injected `BLEND_RUNTIME_CONFIG` active and give it precedence over saved browser settings.
- Show the active project URL and pending saved destination in Configuration, with a labelled confirmation control before saving or activating browser-stored connection settings.
- Accept only HTTP(S) project URLs and restrict Auth redirect URLs to the current app origin; report ignored or unreadable settings accessibly.
- Clear saved and tab-scoped runtime connection settings during Clear Browser Storage and update the confirmation and completion copy accordingly.
- Keep on-disk media untouched and report LocalStorage cleanup failures without claiming connection settings were cleared.
- Add focused regression and browser coverage and update runtime configuration and reset documentation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `supabase-configuration`: Change runtime precedence so unreviewed browser settings cannot initiate Supabase requests, constrain URL handling, expose review state, and define reset behavior.

## Impact

The change affects `supabase-config.js`, `app.js`, Supabase settings in `index.html`, runtime configuration and reset documentation, `tests/regression/supabase-config.test.mjs`, and focused Supabase/reset Playwright coverage. It does not change Auth session formats, IndexedDB, media files, portable references, or PWA cache names.
