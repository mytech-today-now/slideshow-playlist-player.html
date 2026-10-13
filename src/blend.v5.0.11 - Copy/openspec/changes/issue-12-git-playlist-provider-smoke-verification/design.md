# Design

## Context

See `proposal.md` for the verification gap. `git-playlist-storage.js` already fixes provider origins and request policy, rejects redirects, sanitizes errors, protects GitHub updates with file SHA, disables Bitbucket writes, and requires a remote read after an uncertain submission. Existing deterministic tests cover these local contracts; a live check must exercise the same module from a browser to observe provider CORS.

## Goals / Non-Goals

**Goals:**

- Make live checks an explicit Playwright command, outside CI and network-free by default.
- Require a provider-specific token and repository coordinates; require an exact repository-specific confirmation and a private `blend-smoke-` repository before GitHub writes.
- Use a fixed fixture path and harmless public media URL. Restore the validated original playlist after GitHub smoke writes, and verify the restoration.
- For Bitbucket, verify private repository, branch, and playlist reads only. Preserve Blend's no-write boundary.
- Report only provider, operation label, method, HTTP status, and a stable sanitized outcome. Do not record URLs, path or repository coordinates, headers, bodies, token values, or raw exceptions.
- Keep the existing user playlist and coordinates independent of this smoke.

**Non-Goals:**

- Creating provider repositories or tokens, changing account policy, changing the app's publish flow, or testing against a production repository.
- Proving provider uptime, production deployment policy, or access scope beyond the disposable repository exercised.
- Adding Bitbucket writes while the provider contract lacks an atomic branch condition.

## Decisions

1. **Use the existing Playwright browser runner.** The test page imports the same side-effect-free client module and uses browser `fetch`, so real CORS and preflight behavior apply. A Node-only `fetch` smoke would not enforce browser CORS. The live spec is run explicitly and skips before launching a page when its required configuration is absent.

2. **Constrain live targets before mutation.** Require a private repository whose slug starts with `blend-smoke-`, use the fixed `blend-smoke/playlist.json` fixture path, and require GitHub confirmation to include the exact owner/repository. Check live visibility before the first write. Provider setup remains manual; the tool never creates or deletes a repository.

3. **Use two independent provider checks.** GitHub performs fixture read, harmless reviewed publish, readback, a stale reviewed-snapshot conflict, and restoration/readback of the original validated document. Bitbucket performs connect and fixture read only. Its outgoing-review and no-POST behavior remain covered by deterministic tests.

4. **Make diagnostics an allowlist.** A small test helper wraps the browser fetch, rejects a non-provider origin or misplaced sentinel, derives a fixed operation label from the request shape, and records only status and stable classification. A failure without an HTTP response records a sanitized network/timeout category. No response headers are read or serialized.

5. **Recover only known smoke states.** A GitHub cleanup read must match either the original validated fixture or one of this run's exact candidate documents before restoration. An uncertain submission is reconciled by reading first. If the remote state is unexpected or unavailable, stop without overwriting it and report that the user should inspect the disposable repository.

6. **Keep tokens out of artifacts and child services.** Credentials are read from process environment, passed only to the in-page client, and are removed from the fixture web-server environment. The test does not print configuration, attach request traces, or include provider responses in failures.

## Risks / Trade-offs

- **A provider may accept a write and lose its response.** The current client marks the outcome uncertain; cleanup first performs a remote read and restores only a recognized smoke document. If inspection fails, the disposable repository may need manual recovery.
- **A live smoke mutates Git history.** The confirmation, private visibility check, repository-name prefix, fixed fixture path, and explicit command constrain writes; cleanup restores content but does not erase commits.
- **Provider response behavior can change after verification.** Store only a local test result summary; repeat the opt-in smoke when provider behavior needs current evidence. No result is production assurance.
- **Missing or incomplete configuration can be mistaken for success.** Each provider's test status is skipped unless all required inputs are present; the output includes the specified not-run fallback.

## Migration Plan

No migration. Remove the opt-in smoke spec/helper and package script to roll back the tooling. If a run was interrupted after a write, inspect only the confirmed disposable private repository and restore its original validated fixture manually before revoking the synthetic token.
