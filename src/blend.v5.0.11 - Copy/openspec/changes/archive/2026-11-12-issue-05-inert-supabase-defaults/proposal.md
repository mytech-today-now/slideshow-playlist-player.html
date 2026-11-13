# Proposal

## Why

An unconfigured copy of Blend currently inherits a concrete Supabase project URL and anon key, so ordinary browser use can send Auth or Storage traffic to a shared project. The Storage policy release gate is still not passed, and each static deployment should require its operator to select a project explicitly.

## What Changes

- Replace the shipped Supabase URL, anon key, and project-specific defaults with inert values while preserving the existing runtime override precedence.
- Prevent Auth and Storage requests until both a project URL and anon key are supplied through runtime configuration.
- Show an accessible status in Supabase settings with the required local-first fallback copy, and show the configured project URL when one is present.
- Keep local playback, direct public HTTP media, saved library data, and portable Supabase references available while disconnected.
- Remove the live-looking JWT from `.env.example`, document the runtime configuration path, and add regression and browser coverage.

## Capabilities

### New Capabilities

- `supabase-configuration`: Operator-supplied project configuration, request gating, and accessible configuration status for Supabase-dependent features.

### Modified Capabilities

None.

## Impact

The change affects `supabase-config.js`, `supabase-auth.js`, `storage-url-resolver.js`, `app.js`, the Supabase settings in `index.html`, `.env.example`, configuration documentation, and focused regression/browser tests. PWA asset and cache versions must advance so installed copies receive the inert defaults. It does not change IndexedDB, portable media formats, Storage policy authorization, or the private-reference sharing gate.
