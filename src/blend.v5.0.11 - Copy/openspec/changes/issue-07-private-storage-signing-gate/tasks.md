# Tasks

## 1. Source-controlled policy scope and resolver gate

- [x] 1.1 Add the empty source-controlled scope/revision module and exact project, revision, and bucket matcher; reuse it from the Share helper and require it in private signing before token, cache, or network access. Verify with focused resolver and URL-share regressions, including null scope with a populated runtime public-bucket list and a synthetic exact-scope case. Evidence: `node --test tests/regression/storage-url-resolver.test.mjs tests/regression/url-share.test.mjs` passed 64/64.
- [x] 1.2 Preserve direct public URL resolution and saved portable references while signing is blocked. Verify the resolver returns the stable gate error without calling fetch or reading the caller token, and JSON/export regressions continue to retain `supabase://` references without bearer data. Evidence: resolver assertions observed zero token reads and zero fetches; `node --test tests/regression/media-export-sanitizer.test.mjs` passed 4/4.

## 2. Playback feedback and release record

- [x] 2.1 Show the specified fallback copy as an accessible playback alert, prevent use of an unverified cached Supabase signed URL, and keep the stored reference/list entry intact. Evidence: the policy-contract regression passed; the Chromium `private-media-export.e2e.spec.mjs` passed 3/3 at 320, 768, and 1366 pixels, confirming one exact `role=alert`, zero Storage requests, and a retained available `supabase://` reference. Playlist and slideshow failures now preserve the item and show one de-duplicated alert.
- [x] 2.2 Update the README, changelog, and `STORAGE_POLICY_VERIFICATION.md`; bump PWA asset/cache versions and precache the scope module. Evidence: `pwa-config.test.mjs` passed 7/7; the verification record still lists owner and rollback inputs as NOT RECORDED, all six provider cells as NOT RUN, and the gate as NOT PASSED.

## 3. Integration verification

- [x] 3.1 Run `npm run check`, the narrow storage resolver / URL-share / policy-contract / export regressions, `openspec validate issue-07-private-storage-signing-gate --strict`, and the relevant Playwright spec if worker processes are available. Evidence: `npm run check` passed; the focused Node regressions passed 81/81; `pwa-config.test.mjs` passed 7/7; strict OpenSpec validation passed; and the local Chromium fixture spec passed 3/3. Playwright provided automated UI evidence only; manual browser, screen-reader, and provider checks were not run, and the provider gate remains NOT PASSED.
