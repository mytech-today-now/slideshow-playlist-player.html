# Supabase Storage Migration Notes

## Architectural Changes
- Runtime media resolution now targets Supabase Storage URLs only.
- Browser auth/session lifecycle is handled through Supabase Auth token endpoints with local session persistence.
- Storage URL resolution supports:
  - public bucket URLs (`/storage/v1/object/public/...`)
  - signed private URLs (`/storage/v1/object/sign/...`)
  - legacy `ipfs://...` references mapped through a configurable legacy prefix in Supabase Storage.
- Playback path now resolves media references through a dedicated storage resolver with retry/backoff and per-item failure isolation.

## One-Time Setup
1. Configure environment placeholders in `.env.example` equivalents for each deployment target.
2. Ensure Supabase Auth has your player origin and `<SUPABASE_AUTH_REDIRECT_URL>` in allowed redirect URLs.
3. Confirm bucket policy model:
   - public buckets: read policy open only where intended
   - private buckets: RLS read policy scoped to authenticated users.
4. If legacy media references include `ipfs://CID/...`, upload mapped objects to Supabase using the same migration path convention:
   - `legacy/ipfs/<CID>/<optional_path>`
5. Validate client-side anonymous key has no elevated admin privileges.

## Data Migration Steps
1. Export current experience/library JSON from the app.
2. Convert legacy references to one of:
   - `supabase://<bucket>/<path>`
   - absolute HTTPS object URL
   - keep `ipfs://` for compatibility and rely on mapped legacy path in Supabase.
3. Re-import into the migrated build.
4. Run resolver validation tests and playback smoke tests across playlist + slideshow layers.

## Rollback Notes
- Keep previous build artifacts and old service worker cache key available until the Supabase build is confirmed in production.
- Rollback is safe by deploying the previous static bundle and clearing app cache/service worker.
- Session data stored under the new Supabase auth key is isolated; rollback does not require destructive DB cleanup.
