# Tasks

## 1. Local evidence and release gate

- [x] 1.1 Inspect README.md, package.json, .github/workflows, .deployignore, .ftpignore, manifests, PWA version wiring, and the related Issue 19 change; verify the design inventory against those local files without inferring a host or process from Git metadata.
- [x] 1.2 Record release readiness as UNKNOWN, preserve the owner-evidence gate, and confirm this review made no publication, sibling copy, app/version change, or user-data mutation; verify with the final Git diff and command record.

## 2. Owner-approved release record

- [ ] 2.1 Obtain and record an authorized evidence source naming the release owner, target, immutable published artifact revision/hash, publication process, exact prior artifact or recovery point, rollback owner, and rollback steps; verify every field against that source before changing readiness.
