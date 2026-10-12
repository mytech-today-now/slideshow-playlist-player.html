# Spec Delta

## Purpose

Defines reliable settlement and failure isolation for optional image and video thumbnails so preview work cannot block later jobs or affect usable media.

## ADDED Requirements

### Requirement: Thumbnail generation settles within a bounded period
Each image or video thumbnail request MUST settle exactly once with a Blob or `null` after success, a null result, an exception, a media error, or a finite deadline.

#### Scenario: Canvas is unavailable or throws
- **WHEN** canvas context creation returns null or drawing/encoding throws
- **THEN** the thumbnail request resolves to null and releases its helper-owned media element

#### Scenario: Media fails or does not emit its required event
- **WHEN** the image or video reports an error, or a required load, metadata, seek, or encoding callback does not arrive before the deadline
- **THEN** the thumbnail request resolves to null and releases its helper-owned media element

#### Scenario: Callback produces a Blob or no Blob
- **WHEN** canvas encoding calls back with a Blob, null, or multiple callback values
- **THEN** the request resolves once, retaining the first result and cleaning up once

### Requirement: Thumbnail failures release queue capacity
The thumbnail queue MUST release each active slot after the request settles, including when preview generation fails, so later queued requests can complete.

#### Scenario: An early job fails before later jobs
- **WHEN** the first of multiple queued preview jobs fails
- **THEN** later jobs complete and the queue's active and pending counts return to zero

### Requirement: Preview failure does not disable media
An unavailable optional thumbnail MUST retain the existing media icon fallback and MUST NOT remove, reorder, or mark stale its library row or prevent playback from its original media source.

#### Scenario: Local preview fails
- **WHEN** a local image or video cannot produce a thumbnail
- **THEN** its library row remains accessible by its media name and the media remains available for playback

### Requirement: Thumbnail diagnostics omit exception details
Diagnostics for thumbnail callback or cleanup exceptions MUST contain only a sanitized error type and MUST omit exception messages and stacks.

#### Scenario: Canvas or cleanup throws
- **WHEN** thumbnail generation or cleanup catches an exception
- **THEN** diagnostics identify only a sanitized error type and the request still settles
