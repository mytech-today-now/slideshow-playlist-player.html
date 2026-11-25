# Tasks

## 1. Runtime configuration trust boundary

- [x] 1.1 Make stored configuration parsing fail closed, validate HTTP(S) project and same-origin redirect URLs, stage unreviewed LocalStorage values, preserve host-injected precedence, and add regression coverage for invalid JSON, invalid URLs, same-origin redirects, and host configuration; verify with `node --test --test-isolation=none tests/regression/supabase-config.test.mjs`.
- [x] 1.2 Add confirmed saving and a tab-scoped fallback for LocalStorage write failure, and verify the save result, review requirement, and unsaved status through focused regression cases.

## 2. Configuration review flow

- [x] 2.1 Add labelled connection fields, active/pending project status, accessible confirmation and failure text, and request gating for unreviewed stored settings; verify through the focused Configuration Playwright spec.
- [x] 2.2 Update runtime configuration documentation for review, host injection, same-origin redirects, and failed writes; verify all documented keys and reset claims match the code with `rg -n 'blend-runtime-config-v1|blend-runtime-config-tab-v1|blend-runtime-config-review-v1|preserved by Clear Browser Storage|Runtime configuration was preserved' README.md CLAUDE.md`.

## 3. Browser reset behavior

- [x] 3.1 Remove persistent and tab-scoped runtime settings during default reset, update confirmation/completion/failure messages, and extend the reset Playwright coverage; verify the planted key is gone after reset and media files remain untouched.

## 4. Integration verification

- [x] 4.1 Run `npm run check`, the focused runtime configuration regression file, and the relevant configuration/reset Playwright cases; inspect `git diff --check` and `git status --short` before reporting.
- [ ] 4.2 Run `openspec validate issue-06-runtime-config-review-reset` with the OpenSpec CLI.

## Verification evidence

- `node --test --test-isolation=none tests/regression/supabase-config.test.mjs`: 10/10 passed.
- `npm run check`: passed.
- `npm run sanity`: syntax checks and all 441 regression tests passed.
- `npm run test:e2e -- --reporter=list`: 339 passed, 0 failed, and 12 skipped across Chromium, Firefox, and WebKit. Configuration review and browser reset cases passed.
- `openspec validate issue-06-runtime-config-review-reset`: NOT RUN because the OpenSpec CLI is not installed in this checkout. Task 4.2 remains open.
