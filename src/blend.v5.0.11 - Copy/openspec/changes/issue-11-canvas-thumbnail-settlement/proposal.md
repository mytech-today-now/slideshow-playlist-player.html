# Proposal

## Why

Thumbnail generation runs as optional work, but a thrown canvas operation or missing media event can leave its Promise unsettled and hold one of the queue's two slots. This change makes preview work resolve and release its media resources on every outcome while preserving playback and library state when a preview is unavailable.

## What Changes

- Require image and video thumbnail helpers to settle exactly once with a Blob or `null` after success, callback failure, media error, or a finite deadline.
- Ensure cleanup failures cannot prevent settlement, and keep diagnostic data limited to a sanitized error type.
- Verify that queue capacity is released, later previews finish, and local media rows and playback remain available after preview failure.

## Capabilities

### New Capabilities

- `thumbnail-generation`: Defines bounded settlement, resource cleanup, queue recovery, and failure isolation for optional thumbnail generation.

### Modified Capabilities

None. The checkout has no existing base specifications; this adds one focused capability.

## Impact

The change affects the thumbnail helpers and queue handling in `app.js`, focused Playwright coverage, and the Playwright project matrix. It does not change persisted formats, the thumbnail cache contract, the object URL cache bound, import behavior, or playback sources. The report's un-reproduced canvas failure remains a testable assumption; the unguarded asynchronous callback paths are confirmed in the current code.
