# Spec Delta

## Purpose

Bound explicitly requested online README downloads while retaining the installed version guide as the safe, readable fallback.

## ADDED Requirements

### Requirement: Online README responses have a streamed byte ceiling

When the user explicitly selects online documentation, the app SHALL count bytes from the response stream and accept no more than 512 KiB. It SHALL NOT use an unbounded text fallback when the body stream is unavailable, and `Content-Length` SHALL NOT replace the actual streamed byte count as the size authority.

#### Scenario: Complete response is at or below the cap

- **WHEN** a successful online README response contains at most 512 KiB of valid UTF-8 Markdown
- **THEN** the complete document is decoded, validated, and may be cached and displayed as online documentation

#### Scenario: Response exceeds the cap

- **WHEN** streamed online README bytes exceed 512 KiB, whether or not `Content-Length` is present or accurate
- **THEN** the reader is cancelled, no partial document is returned or cached, and the installed guide remains displayed

### Requirement: Only complete valid online README documents replace or update cache

The app SHALL write online README cache data only after the complete response stream has been read, strict UTF-8 decoding succeeds, and Markdown validation succeeds. A remote failure SHALL leave any prior valid cache unchanged and preserve the installed guide with a sanitized, accessible status and user-triggered retry.

#### Scenario: Response fails after headers

- **WHEN** the body times out or errors after response headers are received
- **THEN** the request deadline is cleaned up, no partial online document is cached or rendered, and the installed guide remains readable

#### Scenario: Online text or Markdown is invalid

- **WHEN** the complete body contains invalid UTF-8 or Markdown validation fails
- **THEN** the online document is not cached or displayed, the installed guide remains selected, and the status does not expose internal error details

#### Scenario: Oversized documentation fallback is announced

- **WHEN** an online README exceeds the byte ceiling
- **THEN** a status message says "The online guide is too large or unavailable. You are still viewing the installed Blend guide for version 5.0.11. Retry online help later." and exposes a retry button named "Retry online help"

