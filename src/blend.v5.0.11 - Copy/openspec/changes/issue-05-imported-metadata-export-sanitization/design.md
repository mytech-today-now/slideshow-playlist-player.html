# Design

## Context

See `proposal.md` for motivation. `url-share.js` already recursively clones export values and removes credential fields and bearer URLs. App JSON exporters create sanitized media records at that boundary; imported metadata remains on the original library record. Compressed sharing also sanitizes records so direct serializer callers receive the same protection. `pwa-config.js` versions and precaches both `app.js` and `url-share.js`.

## Goals / Non-Goals

**Goals:**

- Filter only string values in media metadata that represent absolute local filesystem paths.
- Carry an omission signal alongside serialization so the UI can disclose it without changing the exported schema.
- Keep all sanitization work on cloned output values.

**Non-Goals:**

- Filtering import data or changing persisted records.
- Changing top-level media reference normalization, authorization gates, or share scope.
- Replacing the metadata format with a new allowlist or adding a runtime dependency.

## Decisions

1. Extend the existing recursive sanitizer with metadata context and a narrow absolute-path detector. Recognize drive-letter paths, UNC paths, single-backslash-rooted Windows paths, and slash-rooted POSIX paths. Do not classify full `http(s)://` or `supabase://` references as filesystem paths. Apply the rule only below a `metadata` key, leaving existing top-level path and URL behavior intact. Filter a derived storage-reference candidate if it includes an absolute path value from metadata. A whole-value allowlist was considered, but would discard documented and third-party metadata that is safe and portable.
2. Add an optional omission callback to the media-record sanitizer. The app passes an action-scoped tracker while constructing list, library, experience, and share payloads. It uses the result for a status message after JSON downloads and for a status note in the share dialog. A serialized marker was rejected because it would add a new field to existing round-trip schemas.
3. Keep source values immutable. The sanitizer already returns a recursive clone; the callback records only whether a metadata path was omitted. No state save or IndexedDB operation is added.
4. Advance `ASSET_VERSION` and `CACHE_VERSION` together, and use the same asset tag in the HTML shell and app module imports. This triggers the existing service-worker upgrade path so installed clients do not continue using a cached pre-fix serializer. The database version stays unchanged.

## Risks / Trade-offs

- [Risk] Slash-rooted metadata can also represent a root-relative web route → Match POSIX paths only in metadata values, and preserve full public URLs before applying the detector.
- [Risk] Unknown platform path syntax could evade a narrow detector → Cover Windows drive, UNC, and POSIX cases with synthetic sentinels and search every serialized string leaf.
- [Risk] Multiple records may each report an omission → Use one boolean tracker per user action and show one notice.
- [Risk] Existing clients may continue serving the old sanitizer from cache → Advance the asset and cache version markers and verify the configured precache references those versions.

## Migration Plan

No data migration is needed because filtering occurs only in serialized copies. Reverting the change restores the previous export behavior without rewriting saved records.
