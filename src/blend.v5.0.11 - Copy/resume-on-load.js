export const RESUME_ON_LOAD_READY_MESSAGE = 'Your last session is ready. Select Play to resume.';

export function normalizeResumeOnLoadSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const explicit = source.resumeOnLoadExplicit === true;
  return {
    resumeOnLoadExplicit: explicit,
    resumeOnLoad: explicit && source.resumeOnLoad === true
  };
}

export function isResumeOnLoadEnabled(settings = {}) {
  return normalizeResumeOnLoadSettings(settings).resumeOnLoad;
}

function layerLabel(name) {
  return name === 'slideshow' ? 'slideshow' : 'playlist';
}

export function createResumeOnLoadPlan({ enabled = false, playlist = {}, slideshow = {} } = {}) {
  const layers = [
    { name: 'playlist', present: playlist.present === true, ready: playlist.ready === true },
    { name: 'slideshow', present: slideshow.present === true, ready: slideshow.ready === true }
  ];
  const present = layers.filter(layer => layer.present);
  const ready = present.filter(layer => layer.ready);
  const failed = present.filter(layer => !layer.ready);

  if (!enabled || !present.length) {
    return {
      enabled: enabled === true,
      shouldPrepare: false,
      hasSavedLayers: present.length > 0,
      transport: 'stopped',
      readyLayers: [],
      failedLayers: [],
      message: ''
    };
  }

  let message = '';
  if (ready.length && !failed.length) {
    message = RESUME_ON_LOAD_READY_MESSAGE;
  } else if (ready.length) {
    const failedNames = failed.map(layer => layerLabel(layer.name)).join(' and ');
    message = `Your last session is partially ready. ${failedNames} media could not be restored; your saved lists are intact. Select Play to continue with the available layer.`;
  } else {
    const failedNames = failed.map(layer => layerLabel(layer.name)).join(' and ');
    message = `Your saved ${failedNames} media could not be restored. Your saved lists are intact. Check local file access or refresh private media access.`;
  }

  return {
    enabled: true,
    shouldPrepare: true,
    hasSavedLayers: true,
    transport: ready.length ? 'paused' : 'stopped',
    readyLayers: ready.map(layer => layer.name),
    failedLayers: failed.map(layer => layer.name),
    message
  };
}
