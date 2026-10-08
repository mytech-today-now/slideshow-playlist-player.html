# Tasks

## 1. Scan accounting

- [x] 1.1 Count each child directory skipped at the depth cap separately from read failures, keep the result partial, and log only the operation and bounded count; verify syntax with `npm run check`.

## 2. Recovery and regression coverage

- [x] 2.1 Show the depth count and deeper-folder recovery action in the accessible status toast for folder imports and missing-media scans, preserve existing outcome behavior, and style the toast for mobile wrapping and visible keyboard focus; verify synthetic boundary, recovery, reload/playback, baseline, and 360x800/390x844 Playwright coverage.
- [x] 2.2 Document the six-level cap and direct deeper-folder recovery in README.md; verify the wording matches the implemented behavior.

## 3. Integration verification

- [x] 3.1 Run `npm run check`, `npm run test:regression`, `npm run test:e2e`, and `openspec validate issue-03-folder-scan-depth-truncation`; record exact outcomes and any remaining limitations.

## Workflow follow-up

- Archive the OpenSpec change only after review requirements are satisfied.
