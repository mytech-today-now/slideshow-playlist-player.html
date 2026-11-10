export const PLAYBACK_MODE_SEQUENTIAL = 'sequential';
export const PLAYBACK_MODE_RANDOM = 'random';
export const EXPERIENCE_END_TARGET_PLAYLIST = 'playlist';
export const EXPERIENCE_END_TARGET_SLIDESHOW = 'slideshow';
export const DEFAULT_EXPERIENCE_END_TARGET = EXPERIENCE_END_TARGET_PLAYLIST;

export function normalizeLayerPlaybackMode(value) {
  return value === PLAYBACK_MODE_RANDOM ? PLAYBACK_MODE_RANDOM : PLAYBACK_MODE_SEQUENTIAL;
}

export function normalizeExperienceEndTarget(value) {
  return value === EXPERIENCE_END_TARGET_SLIDESHOW
    ? EXPERIENCE_END_TARGET_SLIDESHOW
    : DEFAULT_EXPERIENCE_END_TARGET;
}

export function isExperienceEndSatisfied({
  endTarget = DEFAULT_EXPERIENCE_END_TARGET,
  playlistDone = false,
  slideshowDone = false,
  playlistHasPlayableItems = false,
  slideshowHasPlayableItems = false
} = {}) {
  const target = normalizeExperienceEndTarget(endTarget);
  const targetHasPlayableItems = target === EXPERIENCE_END_TARGET_PLAYLIST
    ? playlistHasPlayableItems
    : slideshowHasPlayableItems;
  const targetDone = target === EXPERIENCE_END_TARGET_PLAYLIST ? playlistDone : slideshowDone;
  if (targetHasPlayableItems) return targetDone;

  const companionHasPlayableItems = target === EXPERIENCE_END_TARGET_PLAYLIST
    ? slideshowHasPlayableItems
    : playlistHasPlayableItems;
  if (!companionHasPlayableItems) return true;
  return target === EXPERIENCE_END_TARGET_PLAYLIST ? slideshowDone : playlistDone;
}

export function normalizeLayerPlaybackSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    playbackModePlaylist: normalizeLayerPlaybackMode(source.playbackModePlaylist),
    playbackModeSlideshow: normalizeLayerPlaybackMode(source.playbackModeSlideshow)
  };
}

function playableIndicesFrom(value) {
  const indices = Array.isArray(value)
    ? value
    : (value instanceof Set ? Array.from(value) : []);
  return Array.from(new Set(indices.filter(index => Number.isInteger(index) && index >= 0)))
    .sort((a, b) => a - b);
}

export function getPlayableListIndices(items, isPlayable) {
  if (!Array.isArray(items) || typeof isPlayable !== 'function') return [];
  const indices = [];
  for (let index = 0; index < items.length; index++) {
    if (isPlayable(items[index], index)) indices.push(index);
  }
  return indices;
}

export function selectNextLayerIndex({
  mode = PLAYBACK_MODE_SEQUENTIAL,
  currentIndex = -1,
  playableIndices = [],
  visitedIndices,
  random = Math.random,
  wrap = false
} = {}) {
  const playable = playableIndicesFrom(playableIndices);
  if (!playable.length) return -1;

  if (normalizeLayerPlaybackMode(mode) === PLAYBACK_MODE_RANDOM) {
    let choices;
    if (visitedIndices === undefined) {
      const alternatives = playable.filter(index => index !== currentIndex);
      choices = alternatives.length ? alternatives : playable;
    } else {
      const visited = new Set(playableIndicesFrom(visitedIndices));
      const unvisited = playable.filter(index => !visited.has(index));
      choices = unvisited.length ? unvisited : (wrap ? playable : []);
    }
    if (!choices.length) return -1;
    const sample = Number(random());
    const normalizedSample = Number.isFinite(sample) ? Math.min(1 - Number.EPSILON, Math.max(0, sample)) : 0;
    return choices[Math.min(choices.length - 1, Math.floor(normalizedSample * choices.length))];
  }

  const current = Number.isFinite(currentIndex) ? Math.floor(currentIndex) : -1;
  const next = playable.find(index => index > current);
  return next ?? (wrap ? playable[0] : -1);
}

export function selectPreviousLayerIndex({
  currentIndex = -1,
  playableIndices = [],
  history = []
} = {}) {
  const playable = playableIndicesFrom(playableIndices);
  if (!playable.length) return { index: -1, historyIndex: -1 };

  // Keep history useful when a saved random experience is changed back to Sequential.
  if (Array.isArray(history)) {
    for (let historyIndex = history.length - 1; historyIndex >= 0; historyIndex--) {
      const candidate = history[historyIndex];
      if (Number.isInteger(candidate) && playable.includes(candidate)) {
        return { index: candidate, historyIndex };
      }
    }
  }

  const current = Number.isFinite(currentIndex) ? Math.floor(currentIndex) : -1;
  const previous = playable.filter(index => index < current).at(-1);
  return { index: previous ?? playable.at(-1), historyIndex: -1 };
}
