# Design

## Context

Analytics consent currently inserts Google Tag Manager in the Blend document. Git credentials are persisted only after explicit opt-in, under a same-origin LocalStorage key. A point-in-time key check is insufficient: another tab can change the key between check and use, or a credential can be requested after a script has already executed. The new capability contract is in `specs/analytics-credential-boundary/spec.md`.

## Goals / Non-Goals

**Goals:**

- Serialize analytics script execution and credential persistence across same-origin Blend tabs.
- Fail closed if saved-credential state or the shared browser boundary cannot be checked.
- Keep session-only Git connections, consent, privacy signals, provider scoping, and existing explicit disconnect/forget behavior.
- Explain when a user must reload to switch from analytics to remembered credentials.

**Non-Goals:**

- Build a credential vault, change the LocalStorage format, or revoke provider tokens.
- Move analytics to an origin that this static checkout does not own.
- Claim that allowlisted events sandbox a script after it executes.

## Decisions

- Use one named Web Lock for both modes. Analytics requests it without waiting, checks credential storage again while holding it, and keeps it through page lifetime after inserting the third-party script. Credential persistence requests the same lock around the operation that can save the token. This closes the check/write race between app tabs. A failed script load keeps the lock because an error does not prove that no script code ran.
- Inspect credential storage as a three-state result: empty, present, or unavailable. Any non-empty stored value blocks analytics, including malformed data; a read failure is not treated as an empty store. The inspector returns no token value.
- If a credential operation cannot acquire the lock, complete the provider connection in memory and do not write LocalStorage. Preserve an existing remembered value when the user is only reconnecting with that saved value. Do not change consent as a side effect.
- On browsers where the lock API is unavailable or fails, do not load analytics or persist a newly requested credential. Keep provider access session-only and expose an accessible reason. This optional safety trade-off is preferable to claiming cross-tab isolation without coordination.
- Recheck after same-tab connect/forget operations and on relevant LocalStorage `storage` events. Forget retains its current explicit session-clearing semantics; the analytics gate itself does not disconnect Git.
- Associate the live analytics boundary status with both consent and Remember controls. Keep the remembered-credential message free of token, provider, or repository details.

The simpler alternative, checking LocalStorage only before script insertion, was rejected because it leaves both a cross-tab race and a same-page remember-after-load path. A separate analytics origin is not available in this self-contained static app.

## Risks / Trade-offs

- [Browsers without Web Locks cannot use optional analytics or remember a new token] → Keep local playback and session-only Git connection available, explain the reason, and test the supported path in Chromium.
- [A tab that has inserted analytics holds the lock until it closes, even after consent is turned off or loading fails] → Explain that switching to remembered credentials requires turning consent off, closing other Blend tabs, and reloading before reconnecting.
- [A non-Blend same-origin page that ignores this lock could still run code] → This change specifically prevents Blend's consented analytics loader from overlapping with Blend's remembered Git credential flow; it does not create an origin sandbox.

## Migration Plan

No persisted-format migration is required. Rollback removes the shared-lock coordination and credential-state gate together, then reruns the same boundary regressions; no credential is deleted and no consent value is rewritten.
