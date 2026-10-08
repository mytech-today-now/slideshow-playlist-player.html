# Tasks

## 1. Compatibility redirect and regression coverage

- [x] 1.1 Update the compatibility page to forward its exact query and fragment to a fixed same-origin `index.html` target with `location.replace`, update its title, and provide honest no-script and construction-failure fallbacks; verify the focused E2E coverage for this navigation contract.
- [x] 1.2 Add Playwright E2E coverage for supported deep-link application, synthetic auth-fragment observation and cleanup, same-origin behavior with an external-looking query value, direct entry, Back behavior, keyboard-accessible fallback links, and all seven required responsive viewports; verify the focused E2E spec passes.

## 2. Integrated verification

- [x] 2.1 Run `npm run check`, `npm run test:regression`, `npm run test:e2e`, and `openspec validate issue-04-compatibility-redirect-state`; record exact outcomes and any runner or browser limitations.

## Verification record

- `npm run check` passed.
- `npm run test:regression` could not start its workers (`spawn EPERM`) before assertions. The serial fallback, `node --test --test-isolation=none tests/regression/*.test.mjs`, passed 276/276.
- Focused Playwright command `node node_modules/playwright/cli.js test --config=C:\Users\kyle_\AppData\Local\Temp\issue04-playwright-manual.config.mjs --workers=1 --timeout=30000 tests/e2e/compatibility-entry.e2e.spec.mjs` passed 12/12.
- `npm run test:e2e` completed with 123/144 passing and 21 failures in unrelated existing flows; all 12 compatibility-entry tests passed in that run.
- `openspec validate issue-04-compatibility-redirect-state` passed. OpenSpec apply instructions report 3/3 tasks complete.
- The no-script fallback was checked at 3840x2160, 1920x1080, 1024x768, 768x1024, 390x844, 844x390, and 360x800 for keyboard focus, 44px link targets, 200% text, and horizontal overflow. In-app Browser was unavailable; these browser checks ran through Playwright.
