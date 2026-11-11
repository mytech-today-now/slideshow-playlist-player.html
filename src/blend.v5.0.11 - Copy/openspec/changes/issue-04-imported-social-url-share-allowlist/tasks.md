# Tasks

## 1. URL Safety Helpers

- [x] 1.1 Add pure share URL and unsupported-scheme helpers with focused Node regression coverage for unsafe schemes, valid HTTPS, generated-link fallback, and Windows drive paths.

## 2. Imported Metadata and Share Boundaries

- [x] 2.1 Reject unsupported scheme-only values during import path normalization; normalize unsafe social/share/og URL overrides to the generated item deep link, preserve stored metadata, and add focused browser coverage for the accessible warning and imported-row behavior.
- [x] 2.2 Revalidate copy, Web Share, platform builder, and navigation destinations; preserve encoded HTTPS share queries and email `mailto:` behavior, and add assertions that unsafe schemes never reach clipboard, Web Share, or navigation.

## 3. Installed PWA Asset Generation

- [x] 3.1 Advance the shared asset/cache generation, add the safety helper to the PWA precache, synchronize active asset references, and verify the PWA configuration regression.

## 4. Acceptance Verification

- [x] 4.1 Run `npm run check`, the focused Node regression file, the relevant sharing Playwright spec when worker processes are available, and `openspec validate issue-04-imported-social-url-share-allowlist --strict`; record exact outcomes and any manual/browser limitations.

### Verification record

- `npm run check`: PASS.
- `node --test --test-isolation=none tests/regression/share-destination-safety.test.mjs tests/regression/pwa-config.test.mjs`: PASS, 12 tests.
- `npm run test:regression`: PASS, 399 tests.
- `node --check tests/e2e/sharing.e2e.spec.mjs`: PASS.
- `openspec validate issue-04-imported-social-url-share-allowlist --strict`: PASS.
- `npx playwright test --config=playwright.config.mjs --project=chromium tests/e2e/sharing.e2e.spec.mjs`: PASS, 7 Chromium tests. The default sandbox attempt failed with `spawn EPERM`; the permitted rerun passed.
- Manual import and Share check: NOT VERIFIED. No manual browser check was completed.
- `git diff --check`: PASS with no whitespace errors. Git emitted line-ending conversion advisories for edited text files.
