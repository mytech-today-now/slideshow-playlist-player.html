# thumbnail-canvas-bounds Specification

## Purpose

Keeps generated image and video thumbnail canvases within a fixed output dimension bound while retaining the source media as the authoritative playable item.

## Requirements

### Requirement: Thumbnail canvas output dimensions are bounded
Generated image and video thumbnail canvases MUST have each dimension at or below 320 pixels, independent of source dimensions, while preserving source aspect ratio within integer pixel rounding.

#### Scenario: Large landscape source is reduced proportionally
- **WHEN** an image or video source exceeds the output bound in landscape orientation
- **THEN** its thumbnail canvas is reduced proportionally and neither dimension exceeds 320 pixels

#### Scenario: Extreme portrait source cannot produce a tall canvas
- **WHEN** an image or video source has portrait dimensions with a height far greater than its width
- **THEN** its thumbnail canvas height is at most 320 pixels and its width is reduced proportionally

### Requirement: Thumbnail sizing never rejects the playable media item
An unavailable or bounded thumbnail MUST remain an optional preview outcome and MUST NOT reject, remove, reorder, or replace its imported media item or playable source.

#### Scenario: Preview canvas creation or encoding fails
- **WHEN** bounded thumbnail generation encounters a canvas error or cannot produce a preview Blob
- **THEN** the existing media item remains in the library and available to playback with the established preview fallback
