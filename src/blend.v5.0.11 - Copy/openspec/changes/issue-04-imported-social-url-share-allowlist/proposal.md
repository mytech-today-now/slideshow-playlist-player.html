# Proposal

## Why

Imported `social`, `share`, and `og` metadata can supply a page URL that reaches Share destinations. Unsafe schemes can be copied or handed to a share provider, and an external HTTPS override can silently redirect operators away from the generated experience link.

## What Changes

- Restrict share page locations to absolute HTTP or HTTPS URLs and fall back to the generated same-origin experience deep link when an override is unsafe or cannot be parsed.
- Reject unsupported URL schemes in imported path normalization without treating them as local paths; preserve legitimate HTTP(S), Supabase, IPFS, and drive paths.
- Validate platform-builder destinations before navigation, allowing `mailto:` only for the email platform; copy the safe deep link when a platform destination is invalid.
- Announce ignored imported share addresses through an accessible message while preserving the imported item, metadata, display text, and image handling.

## Capabilities

### New Capabilities

- `share-destination-safety`: Safe URL selection and fallback behavior for Share destinations derived from imported metadata.

### Modified Capabilities

None.

## Impact

Affected surfaces are `app.js`, a small side-effect-free URL safety module, focused Node regression coverage, and sharing Playwright coverage. No persistence schema or share-file format changes are required. The existing generated deep-link and email-share contracts remain supported.
