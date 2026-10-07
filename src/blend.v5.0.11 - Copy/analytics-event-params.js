const EVENT_NAMES = new Set([
  'page_view',
  'experience_play',
  'experience_pause',
  'experience_complete',
  'share',
  'experience_share'
]);

const MEDIA_EVENTS = new Set([
  'experience_play',
  'experience_pause',
  'experience_complete',
  'share',
  'experience_share'
]);

const SHARE_EVENTS = new Set(['share', 'experience_share']);
const MEDIA_TYPES = new Set(['audio', 'image', 'video']);
const MEDIA_LAYERS = new Set(['playlist', 'slideshow']);
const SHARE_METHODS = new Set([
  'bluesky',
  'copy',
  'email',
  'facebook',
  'linkedin',
  'mastodon',
  'native',
  'reddit',
  'whatsapp',
  'x'
]);

const ACTION_OUTCOMES = new Map([
  ['success', 'success'],
  ['opened', 'success'],
  ['copied_fallback', 'success'],
  ['error', 'failure'],
  ['blocked', 'failure']
]);

/**
 * Keep analytics to coarse product metrics. Names, identifiers, URLs, paths,
 * page details, and arbitrary caller metadata are deliberately not forwarded.
 */
export function buildAnalyticsEventParams(eventName, params = {}) {
  if (!EVENT_NAMES.has(eventName)) return null;
  if (eventName === 'page_view') return {};

  const source = params && typeof params === 'object' ? params : {};
  const safe = {};

  if (MEDIA_EVENTS.has(eventName)) {
    if (MEDIA_TYPES.has(source.media_type)) safe.media_type = source.media_type;
    if (MEDIA_LAYERS.has(source.media_layer)) safe.media_layer = source.media_layer;
  }

  if (SHARE_EVENTS.has(eventName)) {
    if (SHARE_METHODS.has(source.method)) safe.method = source.method;
    const outcome = ACTION_OUTCOMES.get(source.action_outcome) || ACTION_OUTCOMES.get(source.outcome);
    if (outcome) safe.action_outcome = outcome;
  }

  return safe;
}
