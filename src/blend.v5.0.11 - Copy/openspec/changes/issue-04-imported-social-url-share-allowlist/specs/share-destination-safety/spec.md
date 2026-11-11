# Spec Delta

## Purpose

Defines safe share-address selection for imported experience metadata and generated item links. Share actions must not hand unsafe URL schemes to the clipboard, Web Share, browser navigation, or platform builders.

## ADDED Requirements

### Requirement: Share page locations use HTTP or HTTPS
The app MUST use only HTTP or HTTPS URLs as a share page location. It MUST fall back to the generated same-origin experience deep link when an imported override is unsafe or cannot be parsed. Explicit external HTTP(S) overrides remain supported.

#### Scenario: Explicit external HTTPS override is preserved
- **WHEN** an imported item has `metadata.share.url` set to `https://evil.example`
- **THEN** Share uses that explicit HTTPS override as its page location

#### Scenario: Unsafe metadata schemes fall back to the item deep link
- **WHEN** imported `social`, `share`, or `og` metadata supplies a `url` or `href` using `javascript:`, `data:`, `vbscript:`, `blob:`, or another non-HTTP(S) scheme
- **THEN** Share uses the generated same-origin item deep link and does not throw

### Requirement: Imported scheme-only values are not local paths
The app MUST reject imported path values with an unsupported URL scheme rather than normalizing them as local paths, while preserving classified HTTP(S), Supabase, IPFS, and Windows drive paths.

#### Scenario: Dangerous scheme-only import values are rejected
- **WHEN** import path normalization receives `javascript:alert(1)` or `data:text/html,...`
- **THEN** it returns an empty value

### Requirement: Share actions validate every destination
The app MUST pass only HTTP(S) share page locations to copy and Web Share, and only HTTP(S) platform navigation URLs to browser windows. It MAY use a `mailto:` destination only for the email platform; invalid platform destinations MUST fall back to copying the safe generated deep link.

#### Scenario: Copy and Web Share receive safe page locations
- **WHEN** a share action uses an unsafe or unparsable context page location
- **THEN** the action receives the generated same-origin HTTP(S) deep link

#### Scenario: Invalid platform builder output falls back safely
- **WHEN** a non-email platform builder returns a non-HTTP(S) URL, or an email builder returns a non-HTTP(S) and non-`mailto:` URL
- **THEN** the app does not navigate to that URL and copies the safe generated deep link instead

### Requirement: Ignored share addresses are announced without rewriting imports
When Share ignores an unsafe imported address, the app MUST show an accessible status message near the share action stating `Blend ignored an unsafe share address from this item and used the local experience link instead.` The app MUST preserve the imported item and its original metadata.

#### Scenario: Unsafe override produces accessible feedback and preserves metadata
- **WHEN** an operator shares an item whose imported metadata contains an unsafe address
- **THEN** the app announces the specified message through a screen-reader status region and leaves the item's stored metadata unchanged
