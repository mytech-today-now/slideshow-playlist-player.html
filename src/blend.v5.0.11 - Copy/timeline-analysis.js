// timeline-analysis.js
// ---------------------------------------------------------------------------
// Pure playback-timeline and URL-health helpers.  The editor uses this module
// for both layers so a playlist and a slideshow always share the same timing
// semantics, while DOM and compression concerns remain in app.js.

export const DEFAULT_SHARED_URL_LIMIT = 2048;

const EPSILON = 1e-7;

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function mediaFor(library, id) {
  if (!library || id === null || id === undefined) return null;
  if (library instanceof Map) return library.get(id) || null;
  if (typeof library.get === 'function') return library.get(id) || null;
  return library[id] || null;
}

/**
 * Format a non-negative elapsed time for the compact timeline UI.
 * Times under an hour use MM:SS; longer values use HH:MM:SS.
 */
export function formatTimelineTime(seconds) {
  const normalized = finiteNonNegative(seconds);
  if (normalized === null) return 'Unknown';
  const totalSeconds = Math.round(normalized);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const twoDigits = value => String(value).padStart(2, '0');
  return hours > 0
    ? `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(secs)}`
    : `${twoDigits(minutes)}:${twoDigits(secs)}`;
}

/**
 * Resolve the planned duration for a list reference. Images use their per-item
 * display duration; audio/video always prefer the live library metadata. A
 * duration retained on an imported reference is only a fallback until the
 * actual media metadata is available. `null` deliberately represents an
 * unknown duration rather than zero.
 */
export function resolveTimelineDuration(which, ref, media, defaultImageDuration) {
  const type = ref?.type || media?.type || '';
  if (type === 'image') {
    return finiteNonNegative(ref?.displayDuration ?? defaultImageDuration);
  }
  return finiteNonNegative(media?.duration ?? ref?.duration);
}

/**
 * Build one independent sequential layer timeline.  The optional overlap is
 * the real advance overlap used by the player, so adjacent entries can be
 * simultaneously active while retaining their individual end times.
 */
export function buildLayerTimeline(which, list, library, options = {}) {
  const refs = Array.isArray(list) ? list : [];
  const overlapSeconds = Math.max(0, finiteNonNegative(options.overlapSeconds) ?? 0);
  const defaultImageDuration = finiteNonNegative(options.defaultImageDuration);
  const entries = [];
  let nextStart = 0;
  let hasUnknownBoundary = false;
  let furthestEnd = 0;
  let mediaDuration = 0;
  let hasUnknownMediaDuration = false;

  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index] || {};
    const media = mediaFor(library, ref.id);
    const duration = resolveTimelineDuration(which, ref, media, defaultImageDuration);
    const start = hasUnknownBoundary ? null : nextStart;
    const end = start === null || duration === null ? null : start + duration;
    const entry = {
      key: `${which}:${index}`,
      which,
      index,
      id: ref.id ?? null,
      ref,
      media,
      duration,
      start,
      end,
      // Running playback time is the accumulated point at which this entry
      // completes. It is intentionally separate from `end` for UI clarity.
      runningTime: end
    };
    entries.push(entry);

    if (duration === null) hasUnknownMediaDuration = true;
    else mediaDuration += duration;

    if (end === null) {
      hasUnknownBoundary = true;
      continue;
    }

    furthestEnd = Math.max(furthestEnd, end);
    // The final item has no successor, but applying the same formula is safe
    // and keeps zero-duration items and overlap behavior deterministic.
    nextStart = Math.max(start, end - overlapSeconds);
  }

  return {
    which,
    entries,
    duration: hasUnknownBoundary ? null : furthestEnd,
    // Sum of the actual item durations without transition overlap. This is
    // useful for project summaries, exports, and status surfaces that need the
    // complete media contribution rather than elapsed layer runtime.
    mediaDuration: hasUnknownMediaDuration ? null : mediaDuration,
    hasUnknownDuration: hasUnknownBoundary || hasUnknownMediaDuration
  };
}

/**
 * Merge playlist and slideshow timelines into the shared playback clock.
 * Entries at the same moment are retained together so zero-duration items and
 * concurrent layer starts are all serialized at that playback position.
 */
export function buildPlaybackTimeline({ playlist, slideshow, library, defaultImageDuration, overlapSeconds = 0 } = {}) {
  const playlistTimeline = buildLayerTimeline('playlist', playlist, library, {
    defaultImageDuration,
    overlapSeconds
  });
  const slideshowTimeline = buildLayerTimeline('slideshow', slideshow, library, {
    defaultImageDuration,
    overlapSeconds
  });

  const entries = [...playlistTimeline.entries, ...slideshowTimeline.entries];
  const events = entries
    .filter(entry => entry.start !== null)
    .sort((a, b) => (
      a.start - b.start ||
      (a.which === b.which ? a.index - b.index : (a.which === 'playlist' ? -1 : 1))
    ));

  const eventTimes = [];
  for (const event of events) {
    const last = eventTimes[eventTimes.length - 1];
    if (last === undefined || Math.abs(last - event.start) > EPSILON) eventTimes.push(event.start);
  }

  const layerDurations = [playlistTimeline.duration, slideshowTimeline.duration];
  const mediaDurations = [playlistTimeline.mediaDuration, slideshowTimeline.mediaDuration];
  const combinedDuration = layerDurations.some(duration => duration === null)
    ? null
    : Math.max(0, ...layerDurations);

  return {
    playlist: playlistTimeline,
    slideshow: slideshowTimeline,
    entries,
    events,
    eventTimes,
    duration: combinedDuration,
    totalMediaDuration: mediaDurations.some(duration => duration === null)
      ? null
      : mediaDurations.reduce((sum, duration) => sum + duration, 0),
    hasUnknownDuration: layerDurations.some(duration => duration === null) || mediaDurations.some(duration => duration === null)
  };
}

/** Return the latest known serialization checkpoint at or before `time`. */
export function projectionTimeAt(timeline, time) {
  const times = timeline?.eventTimes || [];
  const target = finiteNonNegative(time);
  if (target === null || !times.length || target + EPSILON < times[0]) return null;
  let low = 0;
  let high = times.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (times[middle] <= target + EPSILON) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return times[result];
}

/**
 * Return all references that have started by a point in the shared timeline.
 * This is intentionally based on start time, not end time: completed entries
 * remain in a cumulative shared URL exactly as active entries do.
 */
export function startedEntriesAt(timeline, time) {
  const target = finiteNonNegative(time);
  if (target === null) return { playlist: [], slideshow: [], all: [] };
  const all = (timeline?.entries || []).filter(entry => entry.start !== null && entry.start <= target + EPSILON);
  return {
    playlist: all.filter(entry => entry.which === 'playlist'),
    slideshow: all.filter(entry => entry.which === 'slideshow'),
    all
  };
}

/** Entries active at a point, including an unknown-duration entry once begun. */
export function activeEntriesAt(timeline, time) {
  const target = finiteNonNegative(time);
  if (target === null) return [];
  return (timeline?.entries || []).filter(entry => (
    entry.start !== null &&
    entry.start <= target + EPSILON &&
    (entry.end === null || entry.end > target + EPSILON)
  ));
}

/** Entries whose planned end has elapsed at a point in the shared timeline. */
export function completedEntriesAt(timeline, time) {
  const target = finiteNonNegative(time);
  if (target === null) return [];
  return (timeline?.entries || []).filter(entry => entry.end !== null && entry.end <= target + EPSILON);
}

/**
 * Calculate one accessible URL health state.  The exactly-at-limit case is a
 * warning (not over-limit), because it remains technically valid but leaves no
 * compatibility headroom.
 */
export function getUrlHealth(length, limit = DEFAULT_SHARED_URL_LIMIT) {
  const safeLimit = Math.max(1, finiteNonNegative(limit) ?? DEFAULT_SHARED_URL_LIMIT);
  const normalizedLength = Math.max(0, finiteNonNegative(length) ?? 0);
  const percent = Math.round((normalizedLength / safeLimit) * 100);
  const remaining = Math.max(0, safeLimit - normalizedLength);

  if (normalizedLength > safeLimit) {
    return {
      label: 'OVER LIMIT',
      icon: '🔴',
      tone: 'over',
      length: normalizedLength,
      limit: safeLimit,
      remaining,
      excess: normalizedLength - safeLimit,
      percent,
      description: `Shared URL exceeds the ${safeLimit.toLocaleString()}-character compatibility limit.`
    };
  }
  if (normalizedLength > safeLimit * 0.75) {
    return {
      label: 'WARNING',
      icon: '🟡',
      tone: 'warning',
      length: normalizedLength,
      limit: safeLimit,
      remaining,
      excess: 0,
      percent,
      description: 'Shared URL is approaching the browser compatibility limit.'
    };
  }
  return {
    label: 'SAFE',
    icon: '🟢',
    tone: 'safe',
    length: normalizedLength,
    limit: safeLimit,
    remaining,
    excess: 0,
    percent,
    description: 'Shared URL is comfortably below the browser compatibility limit.'
  };
}
