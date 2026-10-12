# Design

## Context

The client reads a Bitbucket branch head and target file before publishing, then uses the Source API upload with `branch` and `parents`. The reviewed Atlassian endpoint documents those fields and `201 Created`, but no conditional compare-and-set guarantee. The API basis was rechecked against the [Bitbucket Cloud Source API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/). GitHub Contents updates already send the reviewed blob SHA.

The publish review is currently cleared in a `finally` block after any outcome. That discards the outgoing JSON and the review snapshot after both conflicts and uncertain submissions.

## Goals / Non-Goals

**Goals:**

- Prevent Blend from issuing an unconditional Bitbucket branch update.
- Keep reviewed content and revision visible after an unsuccessful or unresolved operation, and provide a user initiated download.
- Require a fresh remote read and comparison before another attempt following an uncertain submission.
- Preserve GitHub's stale-SHA write condition and existing request security boundaries.

**Non-Goals:**

- Guess at undocumented Bitbucket request headers or server behavior.
- Add a sync engine, remote conflict branch, persisted conflict format, or automatic retry.
- Change playlist serialization, IndexedDB, or user repository settings.

## Decisions

### Pause direct Bitbucket branch publishing

Keep Bitbucket reads and review available. The client still performs its preflight comparison, returns `remote_conflict` when the observed state has changed, and otherwise stops with a specific unsupported-conditional-write error before sending a POST. Disable the publish action in the UI as a clear product boundary, while keeping the client guard so programmatic calls also fail closed.

Do not send a guessed `If-Match` or similar header. The documented API describes `branch` and `parents`, but does not state that either field conditionally rejects an update when the destination ref moves. An isolated branch or conflict artifact could be considered if Bitbucket later documents a safe, supported contract.

### Retain the review until an explicit replacement or cancellation

On a failure, preserve the existing in-memory review object and displayed JSON/revision. Uncheck publish confirmation. A visible download control serializes only the reviewed allowlisted document after the user activates it; it does not write to browser storage or download automatically. A successful publish, explicit cancel, or explicit creation of a replacement review may clear or replace that review.

### Reconcile uncertain submissions before another attempt

Set an in-memory reconciliation gate when a write may have reached a provider without a conclusive response. Keep publishing disabled until the user reads or prepares against the newest remote state and Blend compares its revision and file text with both the reviewed baseline and outgoing document. Do not treat equality as proof that this particular request created the version. GitHub's SHA precondition remains the final server-side protection.

### Keep provider-specific semantics distinct

GitHub stale-SHA conflicts remain server-enforced and retain the review. Bitbucket preflight conflicts remain local observations, and unsupported conditional writes are reported separately. No provider body or credential is included in user-facing errors.

## Risks / Trade-offs

- [Risk] Bitbucket users can no longer publish through Blend until an atomic contract is documented → Keep reads, review, JSON download, and repository coordinates available; continue GitHub publishing with stale-SHA protection.
- [Risk] A page reload loses the in-memory review and reconciliation flag → The local playlist remains unchanged and can be reviewed again; do not claim the remote write's result until the user reads the provider state.

## Migration Plan

No persisted data migration is required. Deploy the UI, client guard, tests, and documentation together. Rollback may restore the prior Bitbucket write path, but it also restores the documented lost-update race; keep this safety change unless a verified conditional provider operation replaces it.
