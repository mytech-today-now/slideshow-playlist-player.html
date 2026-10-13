# Design

## Evidence

- `package.json` provides syntax, regression, E2E, and staging-policy checks, with no static-app publish or rollback command.
- `.github/workflows/playwright.yml` runs checks and Playwright on pushes and pull requests; it has no publish or deployment job.
- `README.md` requires the web manifest and two icons beside `index.html` and describes their shared asset version.
- `pwa-config.js` owns the app, asset, and cache versions and required precache list; the active page, manifests, and `VERSIONS.md` currently agree on the asset/cache generation.
- No authorized external host record was available to establish the release owner, artifact, publication process, or rollback mechanism. The public GitHub workflow and release pages could not be retrieved during this inspection.

## Decision

Make no product or release-tooling change in this checkout. The possibility that a manual partial upload could mix modules, manifests, icons, or cache versions remains a testable assumption; no mismatch or failed publication was reproduced or documented. Keep Issue 19 open until an authorized owner/process record is available. If that evidence establishes this repository owns release and an incomplete publication risk is demonstrated, design a separate, buildless stage with a complete version-consistent artifact, an atomic activation point, and an immutable prior artifact for exact rollback. A rollback must not clear IndexedDB or other user data.

## Verification Boundary

Local file inspection confirms only the current checkout and checked-in workflow. It does not establish what a host publishes, whether external CI deploys the app, or whether deployed rollback preserves the prior artifact.

## Local Check Results

- `npm run check`: passed.
- `npm run test:regression`: passed, 353/353.
- `npm run test:e2e`: 258 passed, 16 failed, 7 skipped. Failures occurred in Add URL, analytics consent, compatibility entry, directory scan, experience import/lifecycle, IPFS deep link, local import bounds, media recovery, relinking, playback controls, private media export, sharing, and Supabase auth. No product source was changed for Issue 19, so these are recorded as current-checkout results, not attributed to this change.
- The same E2E run passed root and nested manifest/icon loading and offline app-shell reload. It did not exercise publication atomicity or deployed rollback.
