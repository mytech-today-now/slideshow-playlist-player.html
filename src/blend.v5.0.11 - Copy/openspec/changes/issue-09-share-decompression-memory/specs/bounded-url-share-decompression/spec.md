# Bounded URL-share decompression

## ADDED Requirements

### Requirement: URL shares have a bounded decompressed output

The app SHALL accept URL-share output up to and including 8 MiB and reject output above 8 MiB before parsing or changing the current experience. An over-limit rejection SHALL retain the `SHARE_DECOMPRESS_OUTPUT_LIMIT` error code.

#### Scenario: Output below or at the limit

- **WHEN** a valid URL share decompresses to fewer than or exactly 8 MiB
- **THEN** the app validates and imports it through the existing persistence path
- **AND** the compression format and `experience` and `data` parameters remain compatible

#### Scenario: Output exceeds the limit

- **WHEN** decompression produces the first byte beyond 8 MiB
- **THEN** the app cancels decompression and rejects with `SHARE_DECOMPRESS_OUTPUT_LIMIT`
- **AND** it does not parse the payload or mutate the current experience
- **AND** it leaves the source share parameter in the URL
- **AND** it explains that the current experience is unchanged and offers a smaller share link or JSON backup recovery

### Requirement: Failed URL-share imports remain recoverable

The app SHALL preserve the current experience and source URL parameters when decompression, validation, or persistence fails. It SHALL remove the share parameter only after the imported experience has committed successfully.

#### Scenario: Malformed or interrupted share import

- **WHEN** a URL share is malformed, truncated, cancelled, or its persistence transaction aborts
- **THEN** the current experience remains available
- **AND** the source URL parameters remain available for retry

#### Scenario: Successful share import

- **WHEN** the URL-shared experience has been persisted successfully
- **THEN** the app activates it and clears the share parameters as it does today
