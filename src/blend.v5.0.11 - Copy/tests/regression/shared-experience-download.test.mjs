import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHARED_EXPERIENCE_LIMIT_MESSAGE,
  SharedExperienceDownloadError,
  fetchSharedExperienceJson
} from '../../shared-experience-download.js';

const EXPERIENCE = {
  schema: 'player.blend.experience.v2',
  type: 'experience',
  name: 'Bounded fixture',
  playlist: { type: 'playlist', items: [], order: [] },
  slideshow: { type: 'slideshow', items: [], order: [] }
};

function makeResponse(text, {
  contentType = 'application/json; charset=utf-8',
  contentLength,
  chunkSize = 7,
  holdOpenAtEnd = false,
  onChunk = () => {},
  onCancel = () => {}
} = {}) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  let releaseHoldOpen = null;
  const headers = { 'content-type': contentType };
  if (contentLength != null) headers['content-length'] = String(contentLength);
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        if (holdOpenAtEnd) return new Promise(resolve => { releaseHoldOpen = resolve; });
        controller.close();
        return;
      }
      const end = Math.min(bytes.byteLength, offset + chunkSize);
      const chunk = bytes.subarray(offset, end);
      onChunk(chunk.byteLength);
      controller.enqueue(chunk);
      offset = end;
    },
    cancel(reason) {
      releaseHoldOpen?.();
      onCancel(reason);
    }
  });
  return new Response(body, { status: 200, headers });
}

test('accepts a bounded JSON experience with absent or inaccurate Content-Length', async () => {
  const text = JSON.stringify(EXPERIENCE);
  const cases = [
    { label: 'missing length', contentLength: undefined },
    { label: 'false high length', contentLength: text.length + 100 }
  ];

  for (const fixture of cases) {
    const result = await fetchSharedExperienceJson('https://fixture.invalid/shared.json', {
      fetchImpl: async () => makeResponse(text, { contentLength: fixture.contentLength }),
      maxBytes: new TextEncoder().encode(text).byteLength
    });
    assert.equal(result.payload.name, EXPERIENCE.name, fixture.label);
    assert.equal(result.text, text, fixture.label);
    assert.equal(result.bytesRead, new TextEncoder().encode(text).byteLength, fixture.label);
  }
});

test('rejects the first byte over the streamed cap and cancels both request and reader', async () => {
  const text = `${JSON.stringify(EXPERIENCE)}${' '.repeat(40)}`;
  const maxBytes = new TextEncoder().encode(text).byteLength - 1;
  const controller = new AbortController();
  let readerCancelled = false;
  let bytesYielded = 0;
  const response = makeResponse(text, {
    contentLength: 1,
    chunkSize: 1,
    holdOpenAtEnd: true,
    onChunk: bytes => { bytesYielded += bytes; },
    onCancel: () => { readerCancelled = true; }
  });

  await assert.rejects(
    () => fetchSharedExperienceJson('https://fixture.invalid/shared.json', {
      controller,
      fetchImpl: async () => response,
      maxBytes
    }),
    error => error instanceof SharedExperienceDownloadError && error.code === 'size_limit'
  );
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.signal.aborted, true);
  assert.equal(readerCancelled, true);
  assert.equal(bytesYielded, maxBytes + 1);
  assert.equal(SHARED_EXPERIENCE_LIMIT_MESSAGE.includes('size limit'), true);
});

test('aborts a fetch that stalls before response headers', async () => {
  const controller = new AbortController();
  let fetchAborted = false;
  await assert.rejects(
    () => fetchSharedExperienceJson('https://fixture.invalid/stalled-headers.json', {
      controller,
      timeoutMs: 15,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          fetchAborted = true;
          reject(signal.reason);
        }, { once: true });
      })
    }),
    error => error instanceof SharedExperienceDownloadError && error.code === 'timeout'
  );
  assert.equal(fetchAborted, true);
  assert.equal(controller.signal.aborted, true);
});

test('cancels a body reader that stalls after response headers', async () => {
  const controller = new AbortController();
  let readerCancelled = false;
  let releasePull;
  const body = new ReadableStream({
    start(streamController) {
      streamController.enqueue(new TextEncoder().encode('{"type":"experience"'));
    },
    pull() {
      return new Promise(resolve => { releasePull = resolve; });
    },
    cancel() {
      readerCancelled = true;
      releasePull?.();
    }
  });

  await assert.rejects(
    () => fetchSharedExperienceJson('https://fixture.invalid/stalled-body.json', {
      controller,
      timeoutMs: 15,
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }),
    error => error instanceof SharedExperienceDownloadError && error.code === 'timeout'
  );
  assert.equal(controller.signal.aborted, true);
  assert.equal(readerCancelled, true);
});

test('rejects HTML, malformed JSON, and unsupported experience schemas without echoing payloads', async () => {
  const cases = [
    { body: '<html>secret-response-body</html>', contentType: 'text/html', code: 'invalid_content_type' },
    { body: 'malformed-secret-response', contentType: 'application/json', code: 'invalid_json' },
    { body: JSON.stringify({ schema: 'player.blend.list.v1', type: 'playlist' }), contentType: 'application/json', code: 'invalid_schema' }
  ];

  for (const fixture of cases) {
    await assert.rejects(
      () => fetchSharedExperienceJson('https://fixture.invalid/shared.json?token=private-query', {
        fetchImpl: async () => makeResponse(fixture.body, { contentType: fixture.contentType })
      }),
      error => {
        assert.equal(error.code, fixture.code);
        assert.doesNotMatch(error.message, /secret-response|private-query/);
        return true;
      }
    );
  }
});
