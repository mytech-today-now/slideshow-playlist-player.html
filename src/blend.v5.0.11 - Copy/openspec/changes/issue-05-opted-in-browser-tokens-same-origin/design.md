# Design

## Context

The existing analytics boundary inspects the remembered Git credential and uses the Web Locks API around analytics insertion and Git persistence. Supabase session persistence is implemented inside `supabase-auth.js`, including refresh writes, so guarding only the initial Config action would leave later writes outside the boundary. See the proposal and `specs/analytics-credential-boundary/spec.md` for the behavior contract.

## Goals / Non-Goals

**Goals:**

- Keep Git and Supabase credentials mutually exclusive with consented analytics across Blend tabs.
- Preserve private-media access in memory when session persistence is declined or cannot be safely completed.
- Make stored-session inspection, persistence results, and sign-out outcomes safe to render without exposing token values.

**Non-Goals:**

- Encrypt LocalStorage, add a backend, alter token scopes, or change provider APIs.
- Claim that same-origin scripts are isolated or that a failed sign-out request revoked a remote session.
- Change the report, provider configuration, or stored data schema.

## Decisions

1. **Use the existing shared Web Lock for every Supabase persistence write.** Pass a small persistence-boundary callback into the auth client and run opt-in and refresh writes inside it. Re-check credential storage while holding the lock. If the lock is unavailable, do not persist; keep the valid session in memory and report the tab-only result. This protects the existing remove-before-write refresh sequence from racing analytics insertion.

2. **Expose only a three-state saved-session inspection result.** The auth module checks the current and legacy session keys and returns `clear`, `present`, or `unavailable`. It never returns stored text or parsed fields. Analytics aggregates that state with the existing Git credential inspection and blocks for either `present` or `unavailable`.

3. **Treat persistence as optional after a valid session is accepted.** A storage write/removal failure or a denied boundary leaves the session usable in memory, marks persistence disabled, and uses the requested tab-only copy. A remaining or unreadable saved copy continues to block analytics and is described as unconfirmed cleanup rather than as absent.

4. **Re-evaluate the gate on auth and storage changes.** Same-tab auth events and cross-tab changes to either credential key trigger the existing analytics decision. Consent and provider connection state are not changed by the gate.

5. **Describe local cleanup and provider sign-out separately.** Keep the current user-triggered Supabase logout request. Show whether the provider response was confirmed, unknown, or skipped; describe the endpoint's default global scope and note that an already-issued access token can remain usable until expiry. A local-storage deletion is never presented as provider revocation.

## Risks / Trade-offs

- [Web Locks unavailable or busy] → Keep Supabase access in memory, show the tab-only message, and let analytics remain blocked when stored state cannot be inspected.
- [Storage removal also fails during fallback] → Keep the session in memory, report that an earlier saved copy could not be confirmed removed, and let the fail-closed inspector block analytics.
- [A Supabase access JWT was already issued before sign-out] → Explain that provider sign-out affects server-side refresh sessions while the access JWT may remain valid until expiry.
- [LocalStorage remains readable by arbitrary same-origin code] → State this boundary directly; do not claim the lock or UI disclosure creates a secure vault.

## Migration Plan

No schema migration is needed. Existing keys remain separate and the legacy Supabase key remains non-restorable. Rollback consists of reverting the focused code, documentation, and test changes; it requires no storage cleanup or provider mutation. A rollback restores the previous analytics behavior for saved Supabase sessions, so do not describe the rolled-back code as enforcing this boundary.
