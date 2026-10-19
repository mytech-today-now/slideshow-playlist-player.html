# Tasks

## 1. Supabase session persistence

- [x] 1.1 Add safe current/legacy session-key inspection and use the shared credential boundary for Supabase sign-in and refresh writes; verify present, clear, unavailable, denied-lock, and storage-failure outcomes with focused regression tests.
- [x] 1.2 Preserve valid Supabase sessions in memory when persistence is declined or unavailable; verify tab-only state and no sentinel output in the focused auth regression tests.

## 2. Analytics credential boundary

- [x] 2.1 Include Supabase session state in the analytics decision, re-evaluate after auth and cross-tab storage changes, and keep the UI status credential-free; verify the analytics contract and targeted privacy E2E assertions.
- [x] 2.2 Verify persisted and unreadable Supabase session keys block analytics requests, while a session remains usable in memory when the lock prevents persistence; assert sentinels do not appear in captured output.

## 3. Disclosure and revocation outcomes

- [x] 3.1 Update the Supabase save-session disclosure, exact tab-only fallback copy, and README privacy notes; verify both user-facing text paths and token-free rendered output.
- [x] 3.2 Distinguish confirmed, unknown, skipped, and incomplete local sign-out outcomes without logging tokens; verify mocked network and storage failures plus keyboard, wrapping, zoom, scroll, and overflow behavior at the report's relevant viewports.

## 4. Integration verification

- [x] 4.1 Run `npm run check` and `npm run test:regression`; record exit codes and assertion counts.
- [x] 4.2 Run `tests/e2e/analytics-consent.e2e.spec.mjs`, `tests/e2e/analytics-privacy.e2e.spec.mjs`, and `tests/e2e/supabase-auth.e2e.spec.mjs` in an available browser runner; classify any pre-assertion launch failure as Not run.
- [x] 4.3 Validate the OpenSpec change and verify the linked Beads issue remains open until acceptance.

## Verification record (2026-10-19)

- `npm run sanity` passed syntax checking and all 365 regression tests.
- The serial Chromium run covered the three specified E2E specs in the 17 changed-spec run. All analytics consent, analytics privacy, and Supabase auth cases passed. The overall run passed 118/122; four later lifecycle and playback cases failed in the full run, then passed 4/4 in an isolated rerun.
- Strict OpenSpec validation passed. Beads `blend-6qf` remains in progress and was not changed.

## Read-only architecture follow-up (2026-10-19)

- Reviewed the Supabase session storage and refresh flow, the Git credential storage path, the analytics credential boundary, the static PWA architecture, and this change's requirements. The documented boundary is accurate: Supabase sessions and remembered Git credentials are in same-origin LocalStorage only after explicit opt-in; Supabase and Git sessions otherwise stay in memory. Scripts running on the Blend origin can read opted-in LocalStorage values. The analytics lock prevents Blend's consented analytics loader from overlapping with known saved credential state; it does not isolate LocalStorage from arbitrary same-origin JavaScript. No script injection or token read was reproduced or attempted in this review.
- The current static app has no server component or build requirement. Stronger protection against same-origin script reads requires moving token custody or provider operations out of the page. Client-side encryption does not provide that boundary.
- Option comparison:

| Dimension | Current static app | Server-side token broker | Trusted native or extension host |
|---|---|---|---|
| Token trust boundary | Opted-in LocalStorage values and live in-memory tokens are readable to scripts on the Blend origin. The analytics lock coordinates Blend features but does not isolate the origin. | Keep provider access and refresh tokens on the server. A Secure, HttpOnly, SameSite session cookie hides its value from JavaScript, but active same-origin script can still issue cookie-authenticated requests. | Keep tokens in privileged extension or OS storage. The host must perform provider requests itself and must not return raw tokens to the page. Validate sender origin, message type, and allowed operation for every bridge request. |
| Refresh | The browser auth client refreshes using the session refresh token. | The broker refreshes and rotates provider credentials server-side, with server-side concurrency handling. | The host refreshes in privileged code and reports only sanitized session state to the page. |
| CSRF or message checks | Provider calls use explicit authorization headers, so cookie CSRF is not the current token exposure. Same-origin script access remains the relevant boundary. | Require SameSite cookies, a CSRF token, Origin checks, strict credentialed CORS, and no state-changing GET routes. | Page messages need a strict schema and sender allowlist. If the host uses cookies, apply the broker CSRF controls too. |
| Local playback and offline use | Local media and the static shell remain usable offline. Private remote media and token refresh need network access; issued signed URLs remain browser-visible bearer URLs. | Local media and the cached shell can remain usable offline. Remote private media and refresh need the broker online. Proxying media needs range-request support; returning a signed URL leaves that URL as a bearer capability in the page. | Local media remains available offline. Remote provider access needs the host and network. A media bridge or stream adds platform-specific playback work. |
| Sign-out and provider revocation | Clear the local session and report the remote logout result separately. Local cleanup does not revoke a provider session; access tokens and copied signed URLs may remain valid until token or cache expiry. | Clear the broker cookie/session and separately attempt provider logout to revoke the refresh session. Report failures distinctly; already issued access JWTs and signed URLs can remain valid until expiry or cache lifetime ends. | Clear host storage and separately attempt provider revocation. Report local and provider outcomes separately; previously issued JWTs and signed URLs can remain valid until expiry or cache lifetime ends. |
| Analytics exclusion | The current gate blocks Blend's analytics loader for known saved or unreadable credential state. It does not sandbox arbitrary same-origin code. | Preserve an explicit authenticated-session analytics gate or disable analytics while broker auth is active. A third-party script can make same-origin cookie-authenticated requests even though it cannot read the cookie. | Keep tokens behind the host API and deny analytics access to credential-bearing host operations. Retain an analytics gate for authenticated state; do not expose token values to analytics. |
| Migration | No server migration is needed. The current v2 session key remains opt-in; the session-only default reduces persistence but not live same-origin script access. | Do not silently transfer existing LocalStorage tokens through page JavaScript. Clear saved v2 copies and require sign-in to establish a broker session, unless the owner approves a reviewed migration protocol. | Do not auto-copy LocalStorage tokens into privileged storage. Require explicit reauthentication through the host and clear the old browser copy under a reviewed migration plan. |
| Deployment | Preserves the current static deployment and no-build PWA. | Requires a separately deployed HTTPS service, secret management, cookie/domain routing, monitoring, and provider API operations. | Requires signed platform-specific extension or native packages, host permission review, updates, and platform-specific validation. It does not protect the ordinary browser PWA. |

- Client-side encryption does not move trust outside the page and is not a viable protection for these tokens.
- Recommendation: retain the current documented boundary and session-only default until the owner decides whether the static deployment constraint may change. If strict token isolation is required, approve a broker design before implementation. No server, storage, analytics, or deployment change was made.
- Owner decisions required before implementation: whether the documented same-origin risk is acceptable; whether a backend and its deployment/operations are permitted; which private-media and refresh operations the broker must support; the offline expectations for private media; how existing saved sessions should be cleared or reauthenticated; and whether analytics remains blocked while an authenticated broker session exists.
- This review adds no implementation acceptance task. Existing Issue 05 remains at 9/9 tasks complete; no archive or Beads status change was made.

## Workflow follow-up

- Archive this OpenSpec change only after all acceptance checks pass.
