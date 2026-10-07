import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeEntriesAt,
  buildPlaybackTimeline,
  completedEntriesAt,
  formatTimelineTime,
  getUrlHealth,
  projectionTimeAt,
  startedEntriesAt
} from '../../timeline-analysis.js';

const library = new Map([
  ['intro', { id: 'intro', type: 'video', duration: 15 }],
  ['video', { id: 'video', type: 'video', duration: 25 }],
  ['outro', { id: 'outro', type: 'audio', duration: 10 }],
  ['logo', { id: 'logo', type: 'image' }],
  ['speaker', { id: 'speaker', type: 'image' }],
  ['product', { id: 'product', type: 'image' }]
]);

test('buildPlaybackTimeline keeps both layers on one concurrent clock', () => {
  const timeline = buildPlaybackTimeline({
    library,
    playlist: [{ id: 'intro' }, { id: 'video' }, { id: 'outro' }],
    slideshow: [
      { id: 'logo', displayDuration: 8 },
      { id: 'speaker', displayDuration: 14 },
      { id: 'product', displayDuration: 15 }
    ],
    defaultImageDuration: 4
  });

  assert.equal(timeline.playlist.entries[1].start, 15);
  assert.equal(timeline.playlist.entries[2].start, 40);
  assert.equal(timeline.slideshow.entries[1].start, 8);
  assert.equal(timeline.slideshow.entries[2].start, 22);
  assert.equal(timeline.duration, 50);

  const started = startedEntriesAt(timeline, 23);
  assert.deepEqual(started.playlist.map(entry => entry.id), ['intro', 'video']);
  assert.deepEqual(started.slideshow.map(entry => entry.id), ['logo', 'speaker', 'product']);
  assert.deepEqual(activeEntriesAt(timeline, 23).map(entry => entry.id).sort(), ['product', 'video']);
  assert.deepEqual(completedEntriesAt(timeline, 23).map(entry => entry.id).sort(), ['intro', 'logo', 'speaker']);
  assert.equal(projectionTimeAt(timeline, 23), 22);
});

test('timeline preserves zero durations and marks subsequent timings unknown after missing media duration', () => {
  const timeline = buildPlaybackTimeline({
    library: new Map([
      ['zero', { id: 'zero', type: 'image' }],
      ['unknown', { id: 'unknown', type: 'video', duration: null }],
      ['after', { id: 'after', type: 'video', duration: 5 }]
    ]),
    playlist: [{ id: 'unknown' }, { id: 'after' }],
    slideshow: [{ id: 'zero', displayDuration: 0 }],
    defaultImageDuration: 4
  });

  assert.equal(timeline.slideshow.entries[0].duration, 0);
  assert.equal(timeline.slideshow.entries[0].start, 0);
  assert.equal(timeline.slideshow.entries[0].end, 0);
  assert.equal(timeline.playlist.entries[0].start, 0);
  assert.equal(timeline.playlist.entries[0].end, null);
  assert.equal(timeline.playlist.entries[1].start, null);
  assert.equal(timeline.duration, null);
});

test('timeline applies configured crossfade overlap to the next start', () => {
  const timeline = buildPlaybackTimeline({
    library: new Map([
      ['one', { id: 'one', type: 'video', duration: 10 }],
      ['two', { id: 'two', type: 'video', duration: 10 }]
    ]),
    playlist: [{ id: 'one' }, { id: 'two' }],
    slideshow: [],
    overlapSeconds: 2
  });
  assert.equal(timeline.playlist.entries[1].start, 8);
  assert.equal(timeline.duration, 18);
  assert.deepEqual(activeEntriesAt(timeline, 9).map(entry => entry.id).sort(), ['one', 'two']);
});

test('timeline prefers refreshed media metadata and reports total media duration without overlap', () => {
  const timeline = buildPlaybackTimeline({
    library: new Map([
      ['video', { id: 'video', type: 'video', duration: 42 }],
      ['image', { id: 'image', type: 'image' }]
    ]),
    // A stale imported reference must not override the actual media duration.
    playlist: [{ id: 'video', duration: 9 }],
    slideshow: [{ id: 'image', displayDuration: 8 }],
    overlapSeconds: 2
  });

  assert.equal(timeline.playlist.entries[0].duration, 42);
  assert.equal(timeline.playlist.mediaDuration, 42);
  assert.equal(timeline.slideshow.mediaDuration, 8);
  assert.equal(timeline.totalMediaDuration, 50);
  assert.equal(timeline.duration, 42, 'session runtime remains the longest concurrent layer');
});

test('formatTimelineTime chooses compact MM:SS and HH:MM:SS output', () => {
  assert.equal(formatTimelineTime(0), '00:00');
  assert.equal(formatTimelineTime(65), '01:05');
  assert.equal(formatTimelineTime(3661), '01:01:01');
  assert.equal(formatTimelineTime(null), 'Unknown');
});

test('getUrlHealth honors 75%, exact-limit, and over-limit boundaries', () => {
  assert.equal(getUrlHealth(1536, 2048).label, 'SAFE');
  assert.equal(getUrlHealth(1537, 2048).label, 'WARNING');
  assert.equal(getUrlHealth(2048, 2048).label, 'WARNING');
  const over = getUrlHealth(2049, 2048);
  assert.equal(over.label, 'OVER LIMIT');
  assert.equal(over.excess, 1);
});
