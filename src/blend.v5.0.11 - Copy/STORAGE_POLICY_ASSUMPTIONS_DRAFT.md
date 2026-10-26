# Assumption-Based Supabase Storage Policy Copy

> **Status: hypothetical review draft.** This is not an export from the current project, not a rollback copy, not owner-reviewed, and not deployment evidence. It must not be run or used to mark the release gate as passed.

Report finding: `ai-prompts/pre-mortem-2026-10-22-23-55-46.html#issue-01` — **Private Storage authorization remains an unpassed release gate**.

## Assumptions for this example

These values and rules are illustrative labels, not facts about the deployed project:

1. `private-media` is a private bucket and `public-media` is a separately configured public bucket. The actual bucket IDs and visibility have not been verified.
2. The private fixture belongs to one user. `storage.objects.owner_id` contains that user's JWT subject (`sub`). Owner A matches the private fixture; unrelated User B does not.
3. Access modeled here is read access for playback and signed-URL creation. This draft grants no upload, update, delete, move, or copy access.
4. The project uses individual object ownership. Organization membership, folder ownership, and other authorization rules are outside this example.
5. No other applicable `SELECT` policy grants broader private-bucket access. This assumption must be checked against the complete policy export because PostgreSQL combines applicable permissive policies with `OR`.
6. “Anonymous” means a request without an authenticated user identity. Supabase anonymous-auth users have an authenticated identity and must be evaluated according to their actual object ownership.

## Hypothetical private-object read rule

Supabase documents an owner-read policy that compares the JWT subject with `owner_id`. The following example is intentionally commented out so copying the block into a SQL editor does not execute it. The bucket name and owner model are assumptions only.

```sql
-- REVIEW DRAFT ONLY. NOT AN EXPORT OR ROLLBACK COPY. DO NOT EXECUTE.
-- create policy "assumed_private_media_owner_select"
-- on storage.objects
-- for select
-- to authenticated
-- using (
--   bucket_id = 'private-media'
--   and (select auth.jwt()->>'sub') = owner_id
-- );
```

This rule would allow a matching authenticated owner to read rows in the assumed private bucket. It would not match an unauthenticated request or an unrelated user's subject. Actual results also depend on every other applicable policy and the deployed bucket configuration.

## Expected outcomes under these assumptions

These are design expectations, not observed provider results:

| Principal | Private fixture | Public fixture |
|---|---|---|
| Anonymous request | Denied | Allowed if the bucket is actually public |
| Owner A, whose subject matches `owner_id` | Allowed | Allowed if the bucket is actually public |
| Unrelated User B, whose subject does not match `owner_id` | Denied | Allowed if the bucket is actually public |

Supabase documents that private-bucket downloads use Storage access policies, while public buckets bypass access controls for retrieving and serving objects. Public-bucket writes and other operations remain separately controlled. This draft does not change the app's public-bucket allowlist.

## Required owner review before any use

- Compare this example with an owner-approved, redacted export of every applicable `storage.objects` policy and confirm there are no broader policies or grants.
- Confirm the real private and public bucket IDs, each bucket's visibility, the ownership predicate, the behavior of existing objects, and whether organization membership is required.
- Review the complete rule set and rollback procedure with the authorized policy owner.
- Run the six-cell matrix only in an owner-confirmed disposable project, with synthetic fixtures, after the owner approves the exact policy revision.

## Rollback copy status

**Not generated.** A rollback copy must reproduce the exact reviewed pre-change policy state. Assumptions cannot establish that state. Obtain and retain the owner's redacted pre-change export, revision or hash, review record, and restoration procedure in the approved evidence location.

## References

- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Storage bucket access models](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
