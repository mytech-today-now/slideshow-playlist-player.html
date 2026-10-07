export const PLAYBACK_MODE_SEQUENTIAL = 'sequential';
export const PLAYBACK_MODE_RANDOM = 'random';

export function normalizeLayerPlaybackMode(value) {
  return value === PLAYBACK_MODE_RANDOM ? PLAYBACK_MODE_RANDOM : PLAYBACK_MODE_SEQUENTIAL;
}

export function normalizeLayerPlaybackSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    playbackModePlaylist: normalizeLayerPlaybackMode(source.playbackModePlaylist),
    playbackModeSlideshow: normalizeLayerPlaybackMode(source.playbackModeSlideshow)
  };
}

function playableIndicesFrom(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(index => Number.isInteger(index) && index >= 0)))
    .sort((a, b) => a - b);
}

export function selectNextLayerIndex({
  mode = PLAYBACK_MODE_SEQUENTIAL,
  currentIndex = -1,
  playableIndices = [],
  random = Math.random,
  wrap = false
} = {}) {
  const playable = playableIndicesFrom(playableIndices);
  if (!playable.length) return -1;

  if (normalizeLayerPlaybackMode(mode) === PLAYBACK_MODE_RANDOM) {
    const alternatives = playable.filter(index => index !== currentIndex);
    const choices = alternatives.length ? alternatives : playable;
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
