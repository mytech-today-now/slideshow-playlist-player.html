# Design

## Context

See `proposal.md` for the finding and scope. The inspected checkout documents publishing `manifest.webmanifest`, `icon.svg`, and `icon-maskable.svg` beside `index.html` in `README.md:93`. `package.json` has local syntax, regression, E2E, and staging-policy commands but no app publish or rollback command. `.github/workflows/playwright.yml` runs checks and uploads a Playwright report; it has no app publication job. `.deployignore` and `.ftpignore` list exclusions, not a release target or procedure. `manifest.webmanifest` and `pwa-config.js` share the current app/cache asset version, but that does not identify a published artifact.

The existing `issue-19-no-app-local-deployment-rollback` OpenSpec change records the same external-process uncertainty and still has its authorized-record task open. No authorized external release record was present in the inspected checkout. A Git remote, repository path, or test workflow is not evidence of an authorized host, owner, publication process, or rollback procedure.

## Goals / Non-Goals

**Goals:**

- Keep release readiness explicitly `UNKNOWN` until an authorized source establishes the release owner, target, exact published artifact, publication process, prior recovery point, rollback owner, and rollback steps.
- Preserve an auditable local evidence record and keep the acceptance gate open while that evidence is missing.

**Non-Goals:**

- Add deployment scripts, hosting configuration, release automation, or a speculative checklist for an unconfirmed target.
- Change app, service-worker, manifest, cache, database, or runtime versions; publish files; or copy this checkout to a sibling version.
- Infer external ownership or publication from Git metadata or CI test jobs.

## Decisions

- **Record evidence and uncertainty separately.** List the verified local files and commands, then state what remains unknown. This avoids turning the absence of a local script into a claim that no external process exists.
- **Require owner-approved evidence before changing release readiness.** The record must name its authorized source and identify the owner, target, artifact revision/hash, publication process, exact prior artifact or recovery point, rollback owner, and rollback steps. A source revision or version string alone is not a published-artifact identity.
- **Keep the current change documentation-only.** The project has no confirmed app-local deployment responsibility, and Issue 19 already leaves the external record pending. Adding pipeline code now could act on an unverified system.
- **Use `skip_specs: true`.** This change records operational evidence and does not alter observable application behavior or an existing capability requirement.

## Risks / Trade-offs

- **[Release readiness can remain unknown indefinitely]** → Keep the gate open and require an authorized evidence source before publication.
- **[An external process may exist outside this checkout]** → Do not claim organization-wide absence; update this record only from owner-confirmed evidence.
- **[Future rollback may affect installed PWA clients]** → Before any authorized publication, identify the exact prior artifact and verify recovery steps without clearing IndexedDB or other user data.

## Migration Plan

There is no deployment or rollback action in this change. No app files or user data are modified. A future release action requires an authorized target and immutable artifact/recovery record first; if that record is not available, stop before publishing.

## Tracking

- Beads: `blend-mh7` (in progress; linked by `external_ref`).
- Related open record: `issue-19-no-app-local-deployment-rollback`; it is retained separately and is not treated as satisfying Issue 18 acceptance.
