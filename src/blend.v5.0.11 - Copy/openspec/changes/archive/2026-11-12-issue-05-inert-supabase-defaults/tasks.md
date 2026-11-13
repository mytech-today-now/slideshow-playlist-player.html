# Tasks

## 1. Inert runtime defaults

- [x] 1.1 Replace shipped Supabase project defaults with empty values, keep override precedence unchanged, convert `.env.example` to commented placeholders, and correct the runtime configuration documentation; verify with `node --test --test-isolation=none tests/regression/supabase-config.test.mjs` (2/2 passed after plain `node --test` hit `spawn EPERM`).

## 2. Fail-closed Auth and Storage

- [x] 2.1 Reject Auth and Supabase Storage operations when either the project URL or anon key is missing, while keeping direct HTTP(S) resolution available; add fetch-spy and override regressions and verify with `node --test --test-isolation=none tests/regression/supabase-auth.test.mjs tests/regression/storage-url-resolver.test.mjs` (58/58 passed).

## 3. Accessible disconnected state and PWA delivery

- [x] 3.1 Add the accessible Supabase configuration status, show only the configured project URL, disable token connection while unconfigured, update the focused browser coverage, and advance synchronized app/PWA asset versions; verified with focused Chromium Playwright flows (`unconfigured copy|fresh profile`, 2/2 passed) and `tests/regression/pwa-config.test.mjs` (7/7 passed).

## 4. Integration verification

- [x] 4.1 Run `npm run check`, the focused config/Auth/Storage regressions, `openspec validate issue-05-inert-supabase-defaults --strict`, and inspect the final diff for the removed project URL/JWT and preserved playback/state behavior; verified `npm run check`, the four focused regression files (67/67 passed), strict OpenSpec validation, `git diff --check`, and source scans for project URLs and literal JWTs in browser defaults/Auth/Storage/app/example files.

## Workflow follow-up

- Archive this change only after the implementation and acceptance checks pass.
