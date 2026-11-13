# Design

## Context

See proposal.md and specs/supabase-configuration/spec.md. `supabase-config.js` already merges explicit overrides over LocalStorage, global runtime configuration, and defaults. Auth transport is centralized in `requestJson`; Storage resolution has separate public URL and signed URL paths. The existing settings panel already exposes an `aria-live` Supabase session status. The project is a static, local-first PWA with no build step.

## Goals / Non-Goals

**Goals:**

- Make every shipped Supabase project-dependent value inert by default.
- Reject Auth and Storage operations locally when either required config value is absent.
- Explain disconnected and configured states in the existing Supabase settings area.
- Keep operator overrides, local/direct playback, portable references, and current policy gates intact.

**Non-Goals:**

- Change provider Storage policies, private-reference share authorization, session format, or anon-key semantics.
- Add a configuration editor, server, dependency, build step, or persisted-data migration.

## Decisions

- Set the default project URL, anon key, Storage endpoint, CDN base, and Auth redirect to empty strings. Keep the merge order unchanged. Empty defaults cannot be mistaken for a project and avoid constructing a request target for an unconfigured copy.
- Gate requests at both client boundaries. Auth checks configuration in its shared request function so password sign-in, refresh, and sign-out cannot bypass the check. Storage rejects Supabase references before generating public project URLs or requesting private signatures; direct HTTP(S) references remain independent.
- Add a credential-free live status adjacent to the Supabase controls. Display only the configured project origin, never the anon key. Disable the token connection control until both required settings are present; keep local sign-out available.
- Keep `.env.example` as comments with empty placeholders because this static app does not load `.env` at runtime. Update the architecture guide so it no longer claims that a JWT ships in the example.
- Advance the static asset/cache version and the app module query version together. An installed PWA can otherwise keep serving the previous browser defaults after a static update.
- Keep portable Supabase references and existing media records untouched. A disconnected resolve returns an error; the saved reference can be retried after the operator configures a project.

## Risks / Trade-offs

- [A deployment that relied on the source default becomes disconnected] → Configure its project through `BLEND_RUNTIME_CONFIG` or the preserved `blend-runtime-config-v1` operator setting.
- [A browser with an older installed cache may continue using the old code until its worker updates] → Advance the app asset and cache version as part of this change.
- [A configured public anon key remains visible to browser users] → This is expected for a browser client; configure only the intended project and keep provider authorization policies owner-reviewed.

## Migration Plan

Before publishing, an operator that requires Supabase must inject `SUPABASE_URL` and `SUPABASE_ANON_KEY` through the supported runtime configuration path. Rollback, if required, restores the prior app artifact and PWA asset version; it does not put a JWT back into source. The Storage policy release gate remains independent and not passed until its owner evidence is recorded.
