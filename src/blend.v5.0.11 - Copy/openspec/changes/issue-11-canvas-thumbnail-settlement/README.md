# issue-11-canvas-thumbnail-settlement

Issue 11: Canvas exceptions can leave thumbnail promises and queue slots pending

Source report: `ai-prompts/pre-mortem-2026-10-12-00-11-24.html#issue-11`
Beads: `blend-tu3` — Canvas exceptions can leave thumbnail promises and queue slots pending (closed after verification)

## Verification

- `npm run check` — passed.
- `npm run test:regression` — 347 passed, 0 failed.
- `npm run test:e2e -- tests/e2e/thumbnail-failures.e2e.spec.mjs` — 9 passed across Chromium, Firefox, and WebKit.
- `npm run test:e2e -- tests/e2e/local-import-bounds.e2e.spec.mjs` — 4 passed in Chromium.
- `openspec validate issue-11-canvas-thumbnail-settlement --strict` — valid.
- `git diff --check` — passed; Git emitted only its existing CRLF normalization notices for dirty working files.

The injected canvas failures and missing media events settled the helper promises, cleared the helper-owned elements, drained the queue, revoked source object URLs, preserved accessible rows and media-icon fallback, and allowed playback from the original local media source. No unhandled page error or unclassified browser console error was observed.

## Browser limitation

The WebKit run verified row availability and playback in memory, but its explicit library snapshot save returned `false` and the app logged a handled IndexedDB `experience_snapshot_write` `UnknownError`. Durable library persistence was therefore verified only in Chromium and Firefox. This persistence result is recorded as a browser limitation; it is not evidence that the injected canvas exception caused the snapshot error.

## Evidence boundary

The unguarded asynchronous canvas and media-event callbacks were confirmed in the inspected implementation. No spontaneous canvas failure was reproduced; fault behavior was exercised through browser injection. These local checks do not establish behavior on every device, codec, or deployed environment.
