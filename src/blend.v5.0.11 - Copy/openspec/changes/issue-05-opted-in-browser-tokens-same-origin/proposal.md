# Proposal

## Why

An opted-in Supabase session is stored in LocalStorage on the Blend origin, but the analytics credential boundary currently inspects only the Git credential key. This leaves the saved Supabase session outside the existing mutual-exclusion rule even though same-origin scripts can read it.

## What Changes

- Include current and legacy saved Supabase session keys in fail-closed analytics credential inspection.
- Require the existing shared browser lock before saving an opted-in Supabase session; retain tab-only access when persistence is declined, unavailable, or blocked by the lock.
- Re-evaluate analytics after same-tab and cross-tab Supabase session changes without exposing token values or changing analytics consent.
- Explain same-origin LocalStorage readability and the limits of local cleanup versus provider-side session revocation.
- Assert synthetic access and refresh tokens do not appear in logs, rendered status, requests, or analytics parameters.

## Capabilities

### New Capabilities

### Modified Capabilities

- `analytics-credential-boundary`: Extend the existing credential and analytics exclusion contract to remembered Supabase sessions and their persistence lifecycle.

## Impact

Affected code is limited to `app.js`, `supabase-auth.js`, the Supabase auth dialog in `index.html`, and the existing analytics/auth regression and E2E tests. README security and privacy notes will be updated. No provider contract, storage schema, runtime dependency, or report artifact changes are required.
