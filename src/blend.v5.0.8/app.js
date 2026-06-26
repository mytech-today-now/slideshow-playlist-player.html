import { attachGlobalErrorHandlers, createLogger } from './logger.js?v=20260626-v5.0.8-exp-load';
import { createPointerReorderFallback } from './drag-sort.js?v=20260626-v5.0.8-exp-load';
import { computeMoveOrder, isIdentityOrder, buildIndexRemap } from './list-reorder.js?v=20260626-v5.0.8-exp-load';
import { getBlendRuntimeConfig } from './supabase-config.js?v=20260626-v5.0.8-exp-load';
import { createSupabaseAuthClient, SupabaseAuthError } from './supabase-auth.js?v=20260626-v5.0.8-exp-load';
import {
  StorageResolverError,
  createStorageUrlResolver,
  isLegacyIpfsReference,
  isSupabaseStorageReference,
  legacyIpfsCidFromReference,
  sanitizeLegacyIpfsReference,
  sanitizeSupabaseStorageReference
} from './storage-url-resolver.js?v=20260626-v5.0.8-exp-load';
import {
  createTransitionManager,
  defaultTransitionSettings,
  listTransitionEffects,
  normalizeTransitionSettings
} from './transition-manager.js?v=20260626-v5.0.8-exp-load';
import {
  TRANSPORT,
  transportToggleAction,
  ElapsedClock,
  PausableTimer
} from './playback-clock.js?v=20260626-v5.0.8-exp-load';
import { renderMarkdown } from './markdown.js?v=20260626-v5.0.8-exp-load';
import {
  compressExperience,
  decompressExperience,
  estimateShareUrlSize,
  URL_SHARE_PARAM,
  URL_SHARE_PARAM_ALIAS,
  URL_SHARE_SIZE_LIMIT
} from './url-share.js?v=20260626-v5.0.8-exp-load';
import { createExperienceLoadProgress, ITEM_STATUS as LOAD_ITEM_STATUS } from './experience-load-progress.js?v=20260626-v5.0.8-exp-load';

const log = createLogger('Blend', {
  storageKey: 'blend-debug-log-v1',
  persist: true,
  maxEntries: 500
});

attachGlobalErrorHandlers(log);

// =====================================================
// Blend version 4.12  (Experience UX + Source Filtering, June 2026)
// Dual-layer local media playback studio
//
// Complete refactor of the original single-file folder player
// into a professional creative instrument for curating + performing
// with local images, video, and audio using File System Access API
// and IndexedDB persistence.
//
// Non-negotiables kept from v1:
//   • Elegant dark aesthetic with purple --accent
//   • Inline Fluent-style SVG icons
//   • Keyboard-first discoverability (? help)
//   • PWA-ready manifest + service worker
//   • Zero hard dependencies for normal use
//   • Graceful handling of exotic filenames (emoji, long, prefixes)
//
// Major new subsystems (see ARCHITECTURE-PLAN-v2.md):
//   • Dual independent sequencers (Playlist base + Slideshow overlay)
//   • Live blend opacity + three volume controls + master mute
//   • Ken Burns (rAF) + elegant cross-fades + effect intensity
//   • Full FSA pickers + drag-from-OS + handle verification on load
//   • IDB-backed library + lists + thumbnails + settings
//   • Import/Export (JSON primary) + toasts with undo
//
// v2.2 — JSON Export Standards:
//   • Explicit JSON schemas with order arrays for playlists/slideshows/library
//   • Path-preserving exports using imported paths, directory-relative hints, or filenames
//   • Backward-compatible JSON imports with validation and friendly feedback
//
// v2.4 — Large Library Performance:
//   • Virtualized Media Library and Playlist/Slideshow editors for 10,000+ items
//   • IntersectionObserver-driven lazy thumbnails with bounded object URL cache
//   • Web Worker filtering/sorting for large library projections
//   • Delegated row events, rAF scroll rendering, and bounded media preloading
//
// v2.4.1 — MOV Playback Compatibility:
//   • .mov/QuickTime files get explicit MIME typing for playlist and slideshow video elements
//   • Shared object URL creation path keeps thumbnails, preload, and playback behavior consistent
//
// v4.0 — Multi-Experience Workspaces:
//   • Experience catalog with fast switching between saved Playlist + Slideshow pairs
//   • Rename, delete, import, and export experiences as timestamped JSON files
//   • Active experience selection persists locally while the media library remains shared
//
// v2.3 — Playlist Import/Export & Library Sorting:
//   • List JSON includes list name, description, createdAt, fullPath, pathKind, and exact order
//   • Media Library sorting includes filename, full path, duration, size, date added, and metadata
//   • Import paths are normalized and rejected when they contain unsafe traversal segments
//
// v2.1 — Import & Polish:
//   • Recursive Add Folder with live scan progress and directory handles
//   • Tolerant .txt/.md/.json/.jsonl list import for quoted Windows paths
//   • Sort, Reverse, Export JSON/.txt, drop-to-list routing, and import undo
//
// Testing corpus (must exercise on every major change):
//   videos/The Los Angeles Lakers - Same arena...💜💛-....mp4
//   videos/mkv-Sintel_Trailer1.480p.DivX_Plus_HD.mkv
//   videos/webm-big-buck-bunny_trailer.webm
//   videos/fake with a really long title...
//   videos/nba_*.mp4 + subtitles (must be filtered)
// =====================================================

const VERSION = '5.0.8';
const CACHE_VERSION = 'blend-player-v5.0.8-20260626-exp-load';
const DB_NAME = 'player-blend-v1';
const DB_VERSION = 4;
const EXPERIENCE_STORE = 'experiences';
const EXPERIENCE_ACTIVE_KEY = 'blend-active-experience-id';
const EXPERIENCE_EXPORT_SCHEMA = 'player.blend.experience.v2';
const DEFAULT_EXPERIENCE_NAME = 'Untitled Session';
const INSTALL_BANNER_KEY = 'blend-install-banner-hidden-v4';
const WELCOME_KEY = 'blend-welcome-v4';
const ANALYTICS_CONSENT_KEY = 'blend-analytics-consent-v1';
const MASTODON_INSTANCE_KEY = 'blend-share-mastodon-instance-v1';
const GA_MEASUREMENT_ID = 'G-5NVWHE6T4V';
const SHARE_DEEP_LINK_PARAM_EXPERIENCE = 'exp';
const SHARE_DEEP_LINK_PARAM_LAYER = 'layer';
const SHARE_DEEP_LINK_PARAM_ITEM = 'item';
const THEME_COLOR_DARK = '#0a0a0a';
const THEME_COLOR_LIGHT = '#f8fafc';
const DEFAULT_SOCIAL_DESCRIPTION = 'Dual-layer media playback powered by Blend.';
const DEFAULT_SOCIAL_IMAGE = './icon.svg';
const DEFAULT_SOCIAL_TYPE = 'website';
const EXPERIENCE_PLAYBACK_MODE_LOOP = 'loop';
const EXPERIENCE_PLAYBACK_MODE_STOP = 'stop';
const EXPERIENCE_PLAYBACK_MODE_NEXT = 'next-experience';
const DEFAULT_TRANSITION_SETTINGS = defaultTransitionSettings();
const RUNTIME_CONFIG = getBlendRuntimeConfig();
const DEFAULT_SETTINGS = {
  defaultImageDuration: 4.0,
  effectIntensity: 'subtle',
  playlistVolume: 1.0,
  slideshowVolume: 0.65,
  masterVolume: 1.0,
  playbackModePlaylist: 'sequential',
  playbackModeSlideshow: 'sequential',
  experiencePlaybackMode: EXPERIENCE_PLAYBACK_MODE_LOOP,
  loopExperienceCatalog: false,
  opacity: 0.5,
  transitionDurationMs: DEFAULT_TRANSITION_SETTINGS.transitionDurationMs,
  transitionOverlapMs: DEFAULT_TRANSITION_SETTINGS.transitionOverlapMs,
  enabledTransitionIds: DEFAULT_TRANSITION_SETTINGS.enabledTransitionIds.slice(),
  transitionWeights: { ...DEFAULT_TRANSITION_SETTINGS.transitionWeights },
  transitionRandomizeOrder: DEFAULT_TRANSITION_SETTINGS.transitionRandomizeOrder,
  transitionMaxHeavyInRow: DEFAULT_TRANSITION_SETTINGS.transitionMaxHeavyInRow,
  qualityAutoAdjust: DEFAULT_TRANSITION_SETTINGS.qualityAutoAdjust,
  showFps: DEFAULT_TRANSITION_SETTINGS.showFps,
  importBehavior: 'append',
  librarySortKey: 'date',
  librarySortDir: 'asc',
  resumeOnLoad: true,
  autoVerifyOnStartup: true,
  themeMode: 'auto',
  storageDefaultBucket: RUNTIME_CONFIG.defaultBucket || 'media',
  storageSignedUrlTtlSeconds: RUNTIME_CONFIG.signedUrlTtlSeconds || 1209600,
  privateMediaRequiresAuth: true
};

function createDefaultSettings(overrides = {}) {
  const base = {
    ...DEFAULT_SETTINGS,
    enabledTransitionIds: DEFAULT_SETTINGS.enabledTransitionIds.slice(),
    transitionWeights: { ...DEFAULT_SETTINGS.transitionWeights }
  };
  const merged = {
    ...base,
    ...(overrides && typeof overrides === 'object' ? overrides : {})
  };
  const normalizedTransitions = normalizeTransitionSettings({
    transitionDurationMs: merged.transitionDurationMs,
    transitionOverlapMs: merged.transitionOverlapMs,
    enabledTransitionIds: merged.enabledTransitionIds,
    transitionWeights: merged.transitionWeights,
    transitionRandomizeOrder: merged.transitionRandomizeOrder,
    transitionMaxHeavyInRow: merged.transitionMaxHeavyInRow,
    qualityAutoAdjust: merged.qualityAutoAdjust,
    showFps: merged.showFps
  });
  merged.transitionDurationMs = normalizedTransitions.transitionDurationMs;
  merged.transitionOverlapMs = normalizedTransitions.transitionOverlapMs;
  merged.enabledTransitionIds = normalizedTransitions.enabledTransitionIds.slice();
  merged.transitionWeights = { ...normalizedTransitions.transitionWeights };
  merged.transitionRandomizeOrder = normalizedTransitions.transitionRandomizeOrder;
  merged.transitionMaxHeavyInRow = normalizedTransitions.transitionMaxHeavyInRow;
  merged.qualityAutoAdjust = normalizedTransitions.qualityAutoAdjust;
  merged.showFps = normalizedTransitions.showFps;
  merged.experiencePlaybackMode = normalizeExperiencePlaybackMode(merged.experiencePlaybackMode);
  merged.loopExperienceCatalog = !!merged.loopExperienceCatalog;
  return merged;
}

// Supported media types
const MEDIA_TYPES = {
  video: ['mp4','m4v','mov','mkv','webm','ogv','avi'],
  audio: ['mp3','m4a','wav','ogg','flac','aac'],
  image: ['jpg','jpeg','png','gif','svg','webp','bmp','ico','apng','avif','jfif','heic','heif']
};
const MEDIA_MIME_BY_EXT = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  apng: 'image/apng',
  jfif: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif'
};
const MEDIA_PICKER_TYPES = [{
  description: 'Media',
  accept: {
    'video/*': MEDIA_TYPES.video.map(ext => '.' + ext),
    'audio/*': MEDIA_TYPES.audio.map(ext => '.' + ext),
    'image/*': MEDIA_TYPES.image.map(ext => '.' + ext)
  }
}];
const LIST_FILE_EXTS = ['json','jsonl','txt','md'];
const MAX_FOLDER_DEPTH = 6;
const PERF = {
  LIBRARY_ROW_HEIGHT: 52,
  LIST_ROW_HEIGHT: 58,
  VIRTUAL_OVERSCAN: 10,
  WORKER_THRESHOLD: 800,
  THUMB_CACHE_LIMIT: 360,
  THUMB_ROOT_MARGIN: '420px 0px',
  MEDIA_PRELOAD_AHEAD: 2
};

const supabaseAuthClient = createSupabaseAuthClient({
  supabaseUrl: RUNTIME_CONFIG.supabaseUrl,
  supabaseAnonKey: RUNTIME_CONFIG.supabaseAnonKey,
  authRedirectUrl: RUNTIME_CONFIG.authRedirectUrl,
  logger: log
});

const storageUrlResolver = createStorageUrlResolver({
  config: RUNTIME_CONFIG,
  authClient: supabaseAuthClient,
  logger: log
});

let db = null;
let state = {
  projectName: DEFAULT_EXPERIENCE_NAME,
  library: new Map(),          // id -> {id, handle, name, size, type, duration?, ...}
  directoryHandles: new Map(), // id -> {id, handle, name, addedAt}
  playlist: [],                // [{id, addedAt}]
  slideshow: [],               // [{id, displayDuration?, includeAudio?}]
  listMeta: {
    playlist: defaultListMeta('playlist'),
    slideshow: defaultListMeta('slideshow')
  },
  settings: createDefaultSettings(),
  experiences: [],
  activeExperienceId: null,
  ui: {
    activeList: 'playlist',
    selectedLibrary: new Set(),
    lastSelectedLibraryId: null,
    visibleLibraryIds: [],
    currentFilter: 'all',
    currentSourceFilter: 'all',
    search: '',
    // Multi-selection for the active list editor, tracked by ref id so it
    // survives reorders/sorts. Anchor id supports shift-range selection.
    listSelection: new Set(),
    listSelectionAnchorId: null
  },
  runtime: {
    playlistIndex: 0,
    slideshowIndex: 0,
    isPlaying: false,
    transport: TRANSPORT.STOPPED,
    historyPlaylist: [],
    historySlideshow: []
  }
};

// True while a URL-shared experience is being decompressed and imported.
// Keyboard transport shortcuts are silenced and #transport buttons are
// disabled during this window to prevent accidental state mutations.
let experienceLoading = false;

let playlistVideoA = null, playlistVideoB = null;
let slideshowMedia = null; // current img or video in top layer
let kenBurnsRAF = null;
let crossfadeTimer = null;
// Transport: 'stopped' | 'playing' | 'paused'. Pause banks positions so Play
// resumes exactly where it left off; Stop tears everything down so Play
// restarts from the beginning. See playback-clock.js for the pure helpers.
let transportMode = TRANSPORT.STOPPED;
// Image-slide auto-advance that survives a pause (banks remaining time).
const slideTimer = new PausableTimer();
// Ken Burns elapsed clock + the parameters needed to keep animating after a
// pause/resume without restarting or jumping the zoom/pan.
const kenBurnsClock = new ElapsedClock();
let kenBurnsState = null; // { el, durationMs, maxZoom, dirX, dirY }
let currentPlaylistItem = null;
let currentSlideshowItem = null;
let saveTimer = null;
let deferredInstallPrompt = null;
let isMuted = false;
let lastNonZeroMasterVolume = DEFAULT_SETTINGS.masterVolume;
let browserStorageResetting = false;
const objectUrls = new Set();
const objectUrlRevokeTimers = new Map();
const slideshowPreload = new Map();
const playlistPreload = new Map();
const thumbUrlCache = new Map();
const thumbRequests = new Map();
const thumbElementState = new WeakMap();
let thumbObserver = null;
let libraryVirtualList = null;
let listVirtualList = null;
let listPointerReorder = null;
// Set immediately after a pointer drag completes so the synthetic click
// that follows pointerup does not start playback or alter selection.
let listDragJustHappened = false;
let libraryProjectionWorker = null;
let libraryProjectionWorkerUrl = null;
let activeLibraryProjectionJob = 0;
const libraryProjectionResolvers = new Map();
const sharePlatformRegistry = new Map();
let activeExperienceContext = null;
let pendingDeepLinkRequest = null;
let socialMetaWriteToken = 0;
let analyticsConsentGranted = false;
let analyticsTrackingAllowed = false;
let analyticsConfigured = false;
let lastTrackedVirtualPageKey = '';
let lastTrackedVirtualPageAt = 0;
let pendingIpfsExperienceRequest = null;
let pendingUrlShareRequest = null;
let activeIpfsShareController = null;
let activeIpfsLoadController = null;
let lastAuthPromptAt = 0;
let transitionManager = null;
const transitionEffectCatalog = listTransitionEffects();
const mediaOverlapBindings = new WeakMap();
let playlistAdvanceInFlight = false;
let slideshowAdvanceInFlight = false;
let experienceTransitionToken = 0;
let layerCompletionState = {
  playlistDone: false,
  slideshowDone: false,
  handlingCompletion: false
};

// ====================== UTILITIES ======================
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function debounce(fn, ms = 600) {
  let t;
  const wrapped = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

function rafThrottle(fn) {
  let raf = 0, lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      fn(...(lastArgs || []));
    });
  };
}

function runWhenIdle(fn, timeout = 1000) {
  if ('requestIdleCallback' in window) return requestIdleCallback(fn, { timeout });
  return setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 0 }), 16);
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function wait(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

class VirtualList {
  constructor(container, options) {
    this.container = container;
    this.options = options;
    this.count = 0;
    this.rows = new Map();
    this.spacer = null;
    this.raf = 0;
    this.forceRender = false;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.lastCount = -1;
    this.onScroll = rafThrottle(() => this.render());
    this.onResize = rafThrottle(() => this.render(true));
    container.addEventListener('scroll', this.onScroll, { passive: true });
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(container);
    } else {
      window.addEventListener('resize', this.onResize, { passive: true });
    }
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
  }

  setCount(count) {
    this.count = Math.max(0, count | 0);
    if (!this.count) return;
    this.ensureDom();
    this.spacer.style.height = `${this.count * this.options.itemHeight}px`;
    this.renderSoon(true);
  }

  ensureDom() {
    if (this.spacer && this.container.contains(this.spacer)) return;
    this.cleanupRows();
    this.container.innerHTML = '';
    this.spacer = document.createElement('div');
    this.spacer.className = 'virtual-spacer';
    this.itemsLayer = document.createElement('div');
    this.itemsLayer.className = 'virtual-items';
    this.spacer.appendChild(this.itemsLayer);
    this.container.appendChild(this.spacer);
  }

  clear(emptyHtml = '') {
    this.cleanupRows();
    this.container.innerHTML = emptyHtml;
    this.spacer = null;
    this.itemsLayer = null;
    this.count = 0;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.lastCount = -1;
  }

  cleanupRows() {
    for (const row of this.rows.values()) {
      this.options.cleanupRow?.(row);
      row.remove();
    }
    this.rows.clear();
  }

  renderSoon(force = false) {
    this.forceRender = this.forceRender || force;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      const shouldForce = this.forceRender;
      this.raf = 0;
      this.forceRender = false;
      this.render(shouldForce);
    });
  }

  render(force = false) {
    if (!this.count) return;
    this.ensureDom();
    const itemHeight = this.options.itemHeight;
    const viewportHeight = Math.max(this.container.clientHeight || 0, itemHeight);
    const scrollTop = this.container.scrollTop || 0;
    const overscan = this.options.overscan ?? PERF.VIRTUAL_OVERSCAN;
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(this.count, Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan);

    if (!force && start === this.lastStart && end === this.lastEnd && this.count === this.lastCount) return;

    const nextKeys = new Set();
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index++) {
      const key = String(this.options.getKey(index) ?? index);
      nextKeys.add(key);
      let row = this.rows.get(key);
      const isNew = !row;
      row = this.options.renderItem(index, row);
      if (!row) continue;
      row.dataset.virtualKey = key;
      row.style.transform = `translateY(${index * itemHeight}px)`;
      if (isNew) {
        this.rows.set(key, row);
        fragment.appendChild(row);
      }
    }
    if (fragment.childNodes.length) this.itemsLayer.appendChild(fragment);

    for (const [key, row] of this.rows) {
      if (nextKeys.has(key)) continue;
      this.options.cleanupRow?.(row);
      row.remove();
      this.rows.delete(key);
    }

    this.lastStart = start;
    this.lastEnd = end;
    this.lastCount = this.count;
    this.options.onRangeChange?.(start, end);
  }

  refresh() {
    this.renderSoon(true);
  }

  scrollToIndex(index, behavior = 'smooth') {
    if (!this.count) return;
    const clamped = Math.max(0, Math.min(this.count - 1, index | 0));
    const itemHeight = this.options.itemHeight;
    const top = clamped * itemHeight;
    const bottom = top + itemHeight;
    const viewTop = this.container.scrollTop;
    const viewBottom = viewTop + this.container.clientHeight;
    if (top >= viewTop && bottom <= viewBottom) {
      this.refresh();
      return;
    }
    this.container.scrollTo({
      top: Math.max(0, top - itemHeight),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior
    });
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.cleanupRows();
    this.container.removeEventListener('scroll', this.onScroll);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    else window.removeEventListener('resize', this.onResize);
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(i ? 1 : 0) + ' ' + sizes[i];
}

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function uid() { return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2)); }

function getFileExt(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const clean = raw
    .replace(/[?#].*$/, '')
    .replace(/[)\],;:]+$/, '');
  return (clean.split('.').pop() || '').toLowerCase();
}

function getMediaType(name) {
  const ext = getFileExt(name);
  if (MEDIA_TYPES.video.includes(ext)) return 'video';
  if (MEDIA_TYPES.audio.includes(ext)) return 'audio';
  if (MEDIA_TYPES.image.includes(ext)) return 'image';
  return null;
}

function getMediaMime(name, file = null) {
  const ext = getFileExt(name || file?.name || '');
  const inferred = MEDIA_MIME_BY_EXT[ext] || '';
  const declared = String(file?.type || '').toLowerCase();
  // MOV files often arrive from local handles as an empty Blob type; QuickTime MIME
  // nudges Chromium/WebKit into the correct decode path for H.264/AAC MOV files.
  if (ext === 'mov' || ext === 'qt') return 'video/quicktime';
  return declared || inferred;
}

function createMediaObjectUrl(file, itemOrName = null) {
  const name = typeof itemOrName === 'string' ? itemOrName : (itemOrName?.name || file?.name || '');
  const ext = getFileExt(name);
  const mime = getMediaMime(name, file);
  const declared = String(file?.type || '').toLowerCase();
  const shouldRetype = !!mime && (
    !declared ||
    declared === 'application/octet-stream' ||
    ext === 'mov' ||
    ext === 'qt'
  );
  const blob = shouldRetype ? file.slice(0, file.size, mime) : file;
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function scheduleObjectUrlRevoke(url, delayMs = 250) {
  if (!url) return;
  const existingTimer = objectUrlRevokeTimers.get(url);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    objectUrlRevokeTimers.delete(url);
    objectUrls.delete(url);
    try { URL.revokeObjectURL(url); } catch (_) {}
  }, Math.max(0, delayMs | 0));
  objectUrlRevokeTimers.set(url, timer);
}

function revokeObjectUrlNow(url) {
  if (!url) return;
  const timer = objectUrlRevokeTimers.get(url);
  if (timer) {
    clearTimeout(timer);
    objectUrlRevokeTimers.delete(url);
  }
  objectUrls.delete(url);
  try { URL.revokeObjectURL(url); } catch (_) {}
}

function isListFile(name) {
  return LIST_FILE_EXTS.includes(getFileExt(name));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function basenameFromPath(path) {
  return String(path || '').trim().replace(/^["'`]|["'`]$/g, '').replace(/[\\/]+$/g, '').split(/[\\/]/).pop() || '';
}

function quotePath(path) {
  return `"${String(path || '').replace(/"/g, '\\"')}"`;
}

function fallbackRelativePath(name) {
  const base = basenameFromPath(name);
  return base ? `./${base}` : '';
}

function isIpfsUri(value) {
  return isLegacyIpfsReference(value);
}

function sanitizeIpfsUri(value) {
  return sanitizeLegacyIpfsReference(value);
}

function cidFromIpfsUri(value) {
  return legacyIpfsCidFromReference(value);
}

function validateCid(value) {
  const cid = String(value || '').trim();
  return /^[a-zA-Z0-9]{20,180}$/.test(cid);
}

function sanitizeCid(value) {
  const cid = String(value || '').trim();
  return validateCid(cid) ? cid : '';
}

function isSupabaseRef(value) {
  return isSupabaseStorageReference(value);
}

function sanitizeSupabaseRef(value) {
  return sanitizeSupabaseStorageReference(value);
}

function normalizePathForExport(path) {
  let value = String(path || '').trim().replace(/^["'`]|["'`]$/g, '');
  if (!value) return '';
  if (isIpfsUri(value)) return sanitizeIpfsUri(value);
  if (isSupabaseRef(value)) return sanitizeSupabaseRef(value);
  if (isRemoteUrl(value)) return value;
  value = value.replace(/\\/g, '/');
  const isUnc = value.startsWith('//');
  value = isUnc ? value.slice(2) : value;
  value = value.replace(/\/+/g, '/');
  return (isUnc ? '//' : '') + value;
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isPortableRemoteRef(value, opts = {}) {
  const allowSupabaseBucketPath = !!opts.allowSupabaseBucketPath;
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (isRemoteUrl(raw) || isIpfsUri(raw)) return true;
  if (/^(supabase|storage):\/\//i.test(raw)) return !!sanitizeSupabaseRef(raw);
  return allowSupabaseBucketPath ? !!sanitizeSupabaseRef(raw) : false;
}

function sanitizeImportPath(path) {
  const raw = String(path || '').trim().replace(/^["'`]|["'`]$/g, '');
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
  if (isIpfsUri(raw)) return sanitizeIpfsUri(raw);
  if (isSupabaseRef(raw)) return sanitizeSupabaseRef(raw);
  if (isRemoteUrl(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.replace(/\\/g, '/'))) return '';
  const normalized = normalizePathForExport(raw);
  const withoutDrive = normalized.replace(/^[a-zA-Z]:\//, '');
  const segments = withoutDrive.split('/').filter(Boolean);
  if (segments.some(segment => segment === '..')) return '';
  return normalized;
}

function mediaBasenameFromImportPath(path) {
  const normalized = sanitizeImportPath(path);
  if (!normalized) return '';
  if (isRemoteUrl(normalized)) {
    try {
      return basenameFromPath(new URL(normalized).pathname || normalized);
    } catch (_) {
      return basenameFromPath(normalized);
    }
  }
  if (isSupabaseRef(normalized)) {
    const payload = normalized.replace(/^(supabase|storage):\/\//i, '');
    const slashIndex = payload.indexOf('/');
    return slashIndex > 0 ? basenameFromPath(payload.slice(slashIndex + 1)) : '';
  }
  if (isIpfsUri(normalized)) {
    const payload = normalized.replace(/^ipfs:\/\//i, '');
    const slashIndex = payload.indexOf('/');
    return slashIndex >= 0 ? basenameFromPath(payload.slice(slashIndex + 1)) : '';
  }
  return basenameFromPath(normalized);
}

function bestPathForItem(item) {
  return normalizePathForExport(item?.sourceUrl || item?.pathHint || fallbackRelativePath(item?.name));
}

function pathKind(path) {
  const normalized = normalizePathForExport(path);
  if (!normalized) return 'unknown';
  if (isIpfsUri(normalized)) return 'legacy-ipfs';
  if (isSupabaseRef(normalized)) return 'remote';
  if (isRemoteUrl(normalized)) return 'remote';
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/') || normalized.startsWith('//')) return 'absolute';
  return 'relative';
}

function libraryItemSourceKind(item) {
  const sourceUrl = sanitizeImportPath(item?.sourceUrl || '');
  if (isIpfsUri(sourceUrl)) return 'url';
  if (isSupabaseRef(sourceUrl)) return 'url';
  if (isRemoteUrl(sourceUrl)) return 'url';
  const path = bestPathForItem(item);
  if (isIpfsUri(path)) return 'url';
  if (isSupabaseRef(path)) return 'url';
  return isRemoteUrl(path) ? 'url' : 'local';
}

function defaultListMeta(which) {
  return {
    name: which === 'playlist' ? 'Playlist' : 'Slideshow',
    description: '',
    createdAt: new Date().toISOString()
  };
}

function normalizeListMeta(which, meta = {}) {
  meta = meta && typeof meta === 'object' ? meta : {};
  const fallback = defaultListMeta(which);
  const parsedDate = Date.parse(meta.createdAt || meta.created || '');
  return {
    name: String(meta.name || meta.title || fallback.name).trim() || fallback.name,
    description: String(meta.description || '').trim(),
    createdAt: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : fallback.createdAt
  };
}

function extractListMeta(payload, which) {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = {
    name: payload.name || payload.playlistName || payload.slideshowName || payload.title,
    description: payload.description,
    createdAt: payload.createdAt || payload.created || payload.exportedAt
  };
  if (!candidate.name && !candidate.description && !candidate.createdAt) return null;
  return normalizeListMeta(which, candidate);
}

function clonePlain(value) {
  if (value == null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) {}
  }
  try { return JSON.parse(JSON.stringify(value)); } catch (_) {
    return Array.isArray(value) ? value.slice() : { ...value };
  }
}

function cloneListRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const copy = { ...ref };
  if (ref.metadata && typeof ref.metadata === 'object') copy.metadata = clonePlain(ref.metadata);
  return copy;
}

function sanitizeDisplayText(value, maxLength = 260) {
  const clean = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  return clean.slice(0, Math.max(1, maxLength | 0));
}

function sanitizeDeepLinkToken(value, maxLength = 180) {
  const clean = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .trim();
  if (!clean) return '';
  return clean.slice(0, Math.max(1, maxLength | 0));
}

function normalizeSharePlatformId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '');
}

function canonicalEntryUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function safeAbsoluteUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/^(blob:|data:|mailto:|tel:)/i.test(raw)) return raw;
  try {
    return new URL(raw, canonicalEntryUrl()).toString();
  } catch (_) {
    return fallback;
  }
}

function pagePathFromUrl(value) {
  try {
    const url = new URL(value, canonicalEntryUrl());
    return `${url.pathname}${url.search}`;
  } catch (_) {
    return window.location.pathname + window.location.search;
  }
}

function firstMetadataString(obj, keys = []) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeHashtagList(value) {
  const entries = Array.isArray(value)
    ? value
    : String(value || '').split(/[,\s]+/g);
  const tags = entries
    .map(tag => String(tag || '').replace(/[^a-z0-9_]+/gi, '').trim())
    .filter(Boolean);
  return Array.from(new Set(tags)).slice(0, 8);
}

function normalizeSocialObject(value) {
  if (!value || typeof value !== 'object') return null;
  const normalized = {};
  const title = sanitizeDisplayText(value.title || value.ogTitle || '', 140);
  const description = sanitizeDisplayText(value.description || value.ogDescription || '', 320);
  const text = sanitizeDisplayText(value.text || value.message || '', 320);
  const imageCandidate = sanitizeImportPath(
    value.image ||
    value.thumbnail ||
    value.thumbnailUrl ||
    value.poster ||
    value.posterUrl ||
    ''
  ) || String(value.image || value.thumbnail || '').trim();
  const targetUrl = sanitizeImportPath(value.url || value.href || '') || String(value.url || value.href || '').trim();
  const type = sanitizeDisplayText(value.type || value.ogType || '', 40).toLowerCase();
  const hashtags = normalizeHashtagList(value.hashtags);
  const mastodonInstance = sanitizeDisplayText(value.mastodonInstance || value.instance || '', 120);

  if (title) normalized.title = title;
  if (description) normalized.description = description;
  if (text) normalized.text = text;
  if (imageCandidate) normalized.image = imageCandidate;
  if (targetUrl) normalized.url = targetUrl;
  if (type) normalized.type = type;
  if (hashtags.length) normalized.hashtags = hashtags;
  if (mastodonInstance) normalized.mastodonInstance = mastodonInstance;

  if (value.platforms && typeof value.platforms === 'object') {
    normalized.platforms = clonePlain(value.platforms);
  }
  return Object.keys(normalized).length ? normalized : null;
}

function extractSocialOverrides(ref = null, item = null) {
  const merged = {};
  const candidates = [
    item?.metadata?.social,
    item?.metadata?.share,
    item?.metadata?.og,
    ref?.metadata?.social,
    ref?.metadata?.share,
    ref?.metadata?.og,
    ref?.social,
    ref?.share,
    ref?.og
  ];
  for (const candidate of candidates) {
    const normalized = normalizeSocialObject(candidate);
    if (!normalized) continue;
    Object.assign(merged, normalized);
  }
  return merged;
}

function sourceKindForItem(item = null, ref = null) {
  const remoteSource = sanitizeImportPath(item?.sourceUrl || ref?.sourceUrl || '');
  if (isIpfsUri(remoteSource)) return 'legacy-ipfs';
  if (isSupabaseRef(remoteSource)) return 'supabase';
  if (isRemoteUrl(remoteSource)) return 'url';
  const path = sanitizeImportPath(item?.pathHint || ref?.path || '');
  if (isIpfsUri(path)) return 'legacy-ipfs';
  if (isSupabaseRef(path)) return 'supabase';
  if (item?.handle?.remote) return 'url';
  if (item?.handle) return 'local';
  return 'missing';
}

function remoteUrlForItem(item = null, ref = null) {
  const sourceUrl = sanitizeImportPath(item?.sourceUrl || ref?.sourceUrl || '');
  if (isRemoteUrl(sourceUrl)) return sourceUrl;
  const path = sanitizeImportPath(item?.pathHint || ref?.path || '');
  return isRemoteUrl(path) ? path : '';
}

function storageReferenceForItem(item = null, ref = null) {
  const candidates = [
    item?.metadata?.storageReference,
    ref?.metadata?.storageReference,
    item?.metadata?.storagePath,
    ref?.metadata?.storagePath,
    item?.sourceUrl,
    ref?.sourceUrl,
    item?.pathHint,
    ref?.path
  ];
  for (const candidate of candidates) {
    const normalized = sanitizeImportPath(candidate || '');
    if (!normalized) continue;
    if (isSupabaseRef(normalized) || isIpfsUri(normalized)) return normalized;
  }
  return '';
}

function hasResolvableRemoteReference(item = null, ref = null) {
  if (remoteUrlForItem(item, ref)) return true;
  return !!storageReferenceForItem(item, ref);
}

function normalizeStorageMetadata(item = null, ref = null) {
  const metadata = {
    ...(item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}),
    ...(ref?.metadata && typeof ref.metadata === 'object' ? ref.metadata : {})
  };
  return metadata;
}

function shouldPromptForAuth(error) {
  if (!(error instanceof StorageResolverError) && !(error instanceof SupabaseAuthError)) return false;
  return error.code === 'auth_required' || error.code === 'auth_sign_in_failed' || error.status === 401;
}

async function resolvePlayableUrlForItem(item = null, ref = null, opts = {}) {
  const directUrl = remoteUrlForItem(item, ref);
  if (directUrl) return directUrl;
  const reference = storageReferenceForItem(item, ref);
  if (!reference) return '';
  const metadata = normalizeStorageMetadata(item, ref);
  const bucket = metadata.storageBucket || metadata.bucket || state.settings.storageDefaultBucket || RUNTIME_CONFIG.defaultBucket;
  try {
    const resolved = await storageUrlResolver.resolve({
      sourceUrl: reference,
      bucket,
      path: metadata.storagePath || metadata.path || ''
    }, {
      defaultBucket: state.settings.storageDefaultBucket || RUNTIME_CONFIG.defaultBucket,
      signedUrlTtlSeconds: state.settings.storageSignedUrlTtlSeconds || RUNTIME_CONFIG.signedUrlTtlSeconds
    });
    const playable = sanitizeImportPath(resolved.url || '');
    if (!playable || !isRemoteUrl(playable)) return '';
    if (item) {
      item.sourceUrl = playable;
      item.stale = false;
      item.metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      item.metadata.storageReference = reference;
      if (resolved.bucket) item.metadata.storageBucket = resolved.bucket;
      if (resolved.path) item.metadata.storagePath = resolved.path;
      if (resolved.signed && resolved.expiresAt) item.metadata.signedUrlExpiresAt = resolved.expiresAt;
    }
    if (ref) {
      ref.sourceUrl = playable;
      ref.metadata = ref.metadata && typeof ref.metadata === 'object' ? ref.metadata : {};
      ref.metadata.storageReference = reference;
    }
    return playable;
  } catch (error) {
    if (item) {
      item.metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      item.metadata.lastStorageError = String(error?.code || error?.message || 'storage_error');
    }
    if (shouldPromptForAuth(error) && (Date.now() - lastAuthPromptAt) > 4000) {
      lastAuthPromptAt = Date.now();
      showToast('Provide an API token to access private media in Supabase Storage.', {
        timeout: 4200,
        action: {
          label: 'Use token',
          run: () => { void shareCurrentExperienceThroughIpfs({ reason: 'auth_required' }); }
        }
      });
    } else if (opts.showErrorToast !== false) {
      showToast(error?.message || 'Could not resolve media URL', { timeout: 3200 });
    }
    return '';
  }
}

function isRemotePlayableItem(item = null, ref = null) {
  return hasResolvableRemoteReference(item, ref) && ['video', 'audio', 'image'].includes(item?.type || ref?.type || '');
}

function buildDeepLinkUrl({ experienceId = '', layer = '', itemId = '' } = {}) {
  const url = new URL(canonicalEntryUrl());
  const expToken = sanitizeDeepLinkToken(experienceId, 120);
  const itemToken = sanitizeDeepLinkToken(itemId, 220);
  const layerToken = layer === 'playlist' || layer === 'slideshow' ? layer : '';
  if (expToken) url.searchParams.set(SHARE_DEEP_LINK_PARAM_EXPERIENCE, expToken);
  if (layerToken) url.searchParams.set(SHARE_DEEP_LINK_PARAM_LAYER, layerToken);
  if (itemToken) url.searchParams.set(SHARE_DEEP_LINK_PARAM_ITEM, itemToken);
  return url.toString();
}

function pickInitialSocialImage(overrides = {}, item = null, ref = null) {
  if (overrides.image) {
    return {
      url: safeAbsoluteUrl(overrides.image, safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl())),
      explicit: true
    };
  }
  const metadataImage = firstMetadataString(item?.metadata, ['thumbnailUrl', 'thumbnail', 'posterUrl', 'poster', 'image']);
  if (metadataImage) {
    return { url: safeAbsoluteUrl(metadataImage, safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl())), explicit: true };
  }
  const sourceUrl = sanitizeImportPath(item?.sourceUrl || ref?.sourceUrl || '');
  if (isRemoteUrl(sourceUrl) && (item?.type === 'image' || ref?.type === 'image')) {
    return { url: safeAbsoluteUrl(sourceUrl, safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl())), explicit: true };
  }
  return {
    url: safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl()),
    explicit: false
  };
}

function buildExperienceContext(which, ref, index, opts = {}) {
  if (!ref) return null;
  const item = state.library.get(ref.id) || null;
  const overrides = extractSocialOverrides(ref, item);
  const experienceId = sanitizeDeepLinkToken(state.activeExperienceId || '', 120);
  const experienceName = sanitizeDisplayText(state.projectName || DEFAULT_EXPERIENCE_NAME, 140) || DEFAULT_EXPERIENCE_NAME;
  const mediaName = sanitizeDisplayText(
    overrides.title ||
    ref.name ||
    item?.name ||
    basenameFromPath(ref.path || item?.pathHint || item?.sourceUrl || '') ||
    'Media item',
    140
  ) || 'Media item';
  const description = sanitizeDisplayText(
    overrides.description ||
    firstMetadataString(item?.metadata, ['description', 'summary', 'caption']) ||
    `${mediaName} in ${experienceName}`,
    320
  ) || DEFAULT_SOCIAL_DESCRIPTION;
  const deepLink = buildDeepLinkUrl({
    experienceId,
    layer: which,
    itemId: String(ref.id || '')
  });
  const pageLocation = safeAbsoluteUrl(overrides.url, deepLink);
  const imageChoice = pickInitialSocialImage(overrides, item, ref);
  const mediaType = item?.type || ref.type || 'media';
  const layerLabel = which === 'slideshow' ? 'slideshow' : 'playlist';
  const pageTitle = sanitizeDisplayText(`${mediaName} • ${experienceName} • Blend`, 180) || `${experienceName} • Blend`;
  const shareText = sanitizeDisplayText(overrides.text || `${mediaName} — ${description}`, 320) || mediaName;
  return {
    contextKey: `${experienceId || 'none'}:${layerLabel}:${sanitizeDeepLinkToken(ref.id || '', 220)}:${Number.isFinite(index) ? index : 0}`,
    experienceId,
    experienceName,
    mediaId: String(ref.id || ''),
    mediaName,
    mediaType,
    mediaLayer: layerLabel,
    listIndex: Number.isFinite(index) ? index : 0,
    pageTitle,
    pageLocation,
    pagePath: pagePathFromUrl(pageLocation),
    description,
    imageUrl: imageChoice.url,
    imageExplicit: imageChoice.explicit,
    ogType: sanitizeDisplayText(overrides.type || (mediaType === 'video' ? 'video.other' : DEFAULT_SOCIAL_TYPE), 40) || DEFAULT_SOCIAL_TYPE,
    shareText,
    hashtags: normalizeHashtagList(overrides.hashtags),
    platformOverrides: overrides.platforms && typeof overrides.platforms === 'object' ? clonePlain(overrides.platforms) : {},
    mastodonInstance: overrides.mastodonInstance || '',
    sourceKind: sourceKindForItem(item, ref)
  };
}

function buildProjectContext(opts = {}) {
  const experienceId = sanitizeDeepLinkToken(state.activeExperienceId || '', 120);
  const experienceName = sanitizeDisplayText(state.projectName || DEFAULT_EXPERIENCE_NAME, 140) || DEFAULT_EXPERIENCE_NAME;
  const pageLocation = buildDeepLinkUrl({ experienceId });
  const pageTitle = sanitizeDisplayText(`${experienceName} • Blend`, 180) || `${DEFAULT_EXPERIENCE_NAME} • Blend`;
  return {
    contextKey: `${experienceId || 'none'}:project`,
    experienceId,
    experienceName,
    mediaId: '',
    mediaName: experienceName,
    mediaType: 'experience',
    mediaLayer: 'experience',
    listIndex: 0,
    pageTitle,
    pageLocation,
    pagePath: pagePathFromUrl(pageLocation),
    description: sanitizeDisplayText(opts.description || DEFAULT_SOCIAL_DESCRIPTION, 320) || DEFAULT_SOCIAL_DESCRIPTION,
    imageUrl: safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl()),
    imageExplicit: false,
    ogType: DEFAULT_SOCIAL_TYPE,
    shareText: sanitizeDisplayText(opts.shareText || `${experienceName} on Blend`, 320) || `${experienceName} on Blend`,
    hashtags: [],
    platformOverrides: {},
    mastodonInstance: '',
    sourceKind: 'project'
  };
}

function contextFromRuntimeLayer(which) {
  if (which !== 'playlist' && which !== 'slideshow') return null;
  const list = listFor(which);
  if (!Array.isArray(list) || !list.length) return null;
  const runtimeIndex = which === 'playlist' ? state.runtime.playlistIndex : state.runtime.slideshowIndex;
  const idx = clampExperienceIndex(runtimeIndex, list.length);
  const ref = list[idx];
  if (!ref) return null;
  return buildExperienceContext(which, ref, idx, { trigger: 'runtime' });
}

function persistResolvedSocialMetadata(context) {
  if (!context || (context.mediaLayer !== 'playlist' && context.mediaLayer !== 'slideshow') || !context.mediaId) return;
  const list = listFor(context.mediaLayer);
  if (!Array.isArray(list) || !list.length) return;
  const idx = Number.isFinite(context.listIndex) ? clampExperienceIndex(context.listIndex, list.length) : list.findIndex(ref => String(ref?.id) === String(context.mediaId));
  const ref = idx >= 0 ? list[idx] : null;
  if (!ref) return;
  ref.metadata = ref.metadata && typeof ref.metadata === 'object' ? ref.metadata : {};
  const stableImage = /^(https?:|file:)/i.test(String(context.imageUrl || '')) ? context.imageUrl : '';
  const snapshot = {
    title: context.pageTitle || '',
    description: context.description || '',
    url: context.pageLocation || '',
    image: stableImage || undefined,
    type: context.ogType || DEFAULT_SOCIAL_TYPE
  };
  const prior = ref.metadata.socialResolved && typeof ref.metadata.socialResolved === 'object' ? ref.metadata.socialResolved : {};
  if (
    prior.title === snapshot.title &&
    prior.description === snapshot.description &&
    prior.url === snapshot.url &&
    prior.image === snapshot.image &&
    prior.type === snapshot.type
  ) return;
  ref.metadata.socialResolved = snapshot;
  saveStateDebounced();
}

function refreshExperienceMetadataFromState(opts = {}) {
  let context = null;
  if (activeExperienceContext?.mediaLayer === 'playlist' || activeExperienceContext?.mediaLayer === 'slideshow') {
    context = contextFromRuntimeLayer(activeExperienceContext.mediaLayer);
  }
  if (!context) context = buildProjectContext();
  activeExperienceContext = context;
  applySocialMeta(context, opts);
}

function upsertMetaTag(attrName, attrValue, content) {
  if (!attrName || !attrValue) return;
  let tag = null;
  const query = `meta[${attrName}]`;
  for (const candidate of $all(query)) {
    if (candidate.getAttribute(attrName) === attrValue) {
      tag = candidate;
      break;
    }
  }
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attrName, attrValue);
    document.head.appendChild(tag);
  }
  const value = String(content ?? '');
  if (tag.content !== value) tag.content = value;
}

function upsertLinkTag(rel, href) {
  if (!rel) return;
  let tag = null;
  for (const candidate of $all('link[rel]')) {
    if (candidate.getAttribute('rel') === rel) {
      tag = candidate;
      break;
    }
  }
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    document.head.appendChild(tag);
  }
  const value = String(href ?? '');
  if (tag.getAttribute('href') !== value) tag.setAttribute('href', value);
}

function applySocialMeta(context, opts = {}) {
  const active = context || buildProjectContext();
  const title = sanitizeDisplayText(active.pageTitle || `${state.projectName} • Blend`, 180) || `${state.projectName} • Blend`;
  const description = sanitizeDisplayText(active.description || DEFAULT_SOCIAL_DESCRIPTION, 320) || DEFAULT_SOCIAL_DESCRIPTION;
  const url = safeAbsoluteUrl(active.pageLocation, canonicalEntryUrl());
  const image = safeAbsoluteUrl(active.imageUrl, safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl()));
  const ogType = sanitizeDisplayText(active.ogType || DEFAULT_SOCIAL_TYPE, 40) || DEFAULT_SOCIAL_TYPE;

  if (document.title !== title) document.title = title;
  upsertMetaTag('name', 'description', description);
  upsertMetaTag('property', 'og:title', title);
  upsertMetaTag('property', 'og:description', description);
  upsertMetaTag('property', 'og:url', url);
  upsertMetaTag('property', 'og:image', image);
  upsertMetaTag('property', 'og:image:alt', sanitizeDisplayText(active.mediaName || active.experienceName || 'Blend media', 160) || 'Blend media');
  upsertMetaTag('property', 'og:type', ogType);
  upsertMetaTag('name', 'twitter:title', title);
  upsertMetaTag('name', 'twitter:description', description);
  upsertMetaTag('name', 'twitter:url', url);
  upsertMetaTag('name', 'twitter:image', image);
  upsertMetaTag('name', 'twitter:image:alt', sanitizeDisplayText(active.mediaName || active.experienceName || 'Blend media', 160) || 'Blend media');
  upsertMetaTag('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
  upsertLinkTag('canonical', url);

  if (opts.log) {
    log.info('[meta] updated', {
      title,
      url,
      mediaId: active.mediaId,
      mediaLayer: active.mediaLayer
    });
  }
}

async function resolveShareImageForContext(context) {
  if (!context) return safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl());
  if (context.imageExplicit && context.imageUrl) return context.imageUrl;
  if (context.mediaLayer !== 'playlist' && context.mediaLayer !== 'slideshow') {
    return context.imageUrl || safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl());
  }
  const list = listFor(context.mediaLayer);
  if (!Array.isArray(list) || !list.length) {
    return context.imageUrl || safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl());
  }
  const idx = Number.isFinite(context.listIndex) ? clampExperienceIndex(context.listIndex, list.length) : list.findIndex(ref => String(ref?.id) === String(context.mediaId || ''));
  const ref = idx >= 0 ? list[idx] : list.find(entry => String(entry?.id) === String(context.mediaId || ''));
  const item = ref ? state.library.get(ref.id) : null;
  const overrides = extractSocialOverrides(ref, item);
  const candidate = safeAbsoluteUrl(overrides.image || '', '');
  if (candidate) return candidate;
  const metadataImage = firstMetadataString(item?.metadata, ['thumbnailUrl', 'thumbnail', 'posterUrl', 'poster', 'image']);
  if (metadataImage) return safeAbsoluteUrl(metadataImage, context.imageUrl || safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl()));
  const sourceUrl = sanitizeImportPath(item?.sourceUrl || ref?.sourceUrl || '');
  if (isRemoteUrl(sourceUrl) && (item?.type === 'image' || ref?.type === 'image')) {
    return safeAbsoluteUrl(sourceUrl, context.imageUrl || safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl()));
  }
  if (item?.handle && typeof item.handle.getFile === 'function' && (item.type === 'image' || item.type === 'video')) {
    try {
      const thumb = await generateThumbnail(item.handle, item);
      if (thumb) return safeAbsoluteUrl(thumb, context.imageUrl || safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl()));
    } catch (error) {
      log.warn('thumbnail generation for social metadata failed', error);
    }
  }
  return context.imageUrl || safeAbsoluteUrl(DEFAULT_SOCIAL_IMAGE, canonicalEntryUrl());
}

function activateExperienceContext(context, opts = {}) {
  const nextContext = context || buildProjectContext();
  activeExperienceContext = nextContext;
  persistResolvedSocialMetadata(nextContext);
  applySocialMeta(nextContext);
  if (opts.trackVirtualPage !== false) {
    trackVirtualPageView(nextContext, opts.trigger || 'context');
  }

  const token = ++socialMetaWriteToken;
  void resolveShareImageForContext(nextContext).then(imageUrl => {
    if (!imageUrl || token !== socialMetaWriteToken) return;
    if (!activeExperienceContext || activeExperienceContext.contextKey !== nextContext.contextKey) return;
    if (activeExperienceContext.imageUrl === imageUrl) return;
    activeExperienceContext = { ...activeExperienceContext, imageUrl };
    applySocialMeta(activeExperienceContext);
  }).catch(error => {
    log.warn('social image resolution failed', error);
  });
  return nextContext;
}

function readStoredAnalyticsConsent() {
  try {
    const value = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === '1';
  } catch (_) {
    return false;
  }
}

function getPrivacyPreferenceSignals() {
  const dntRaw = String(navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack || '').toLowerCase();
  return {
    doNotTrack: dntRaw === '1' || dntRaw === 'yes',
    globalPrivacyControl: navigator.globalPrivacyControl === true,
    localFileContext: window.location.protocol === 'file:'
  };
}

function syncAnalyticsConsentControl(signals = getPrivacyPreferenceSignals()) {
  const control = $('#analytics-consent');
  if (!control) return;
  control.checked = !!analyticsConsentGranted;
  const blockedBySignal = signals.doNotTrack || signals.globalPrivacyControl || signals.localFileContext;
  if (blockedBySignal && analyticsConsentGranted) {
    control.title = 'Analytics is currently blocked by a privacy or local-file safeguard.';
  } else {
    control.title = 'Allow anonymous usage analytics for this browser.';
  }
}

function updateAnalyticsConsentState(opts = {}) {
  if (typeof opts.consent === 'boolean') analyticsConsentGranted = opts.consent;
  const signals = getPrivacyPreferenceSignals();
  analyticsTrackingAllowed = !!analyticsConsentGranted && !signals.doNotTrack && !signals.globalPrivacyControl && !signals.localFileContext;
  window[`ga-disable-${GA_MEASUREMENT_ID}`] = !analyticsTrackingAllowed;

  if (analyticsTrackingAllowed && !analyticsConfigured) {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function gtag(){ window.dataLayer.push(arguments); };
    }
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, {
      send_page_view: false,
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
    analyticsConfigured = true;
  }

  try {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, analyticsConsentGranted ? '1' : '0');
  } catch (_) {}

  syncAnalyticsConsentControl(signals);
  if (opts.announce && (signals.doNotTrack || signals.globalPrivacyControl || signals.localFileContext) && analyticsConsentGranted) {
    showToast('Analytics remains off due browser privacy settings or local-file mode.', { timeout: 3400 });
  }
  return {
    allowed: analyticsTrackingAllowed,
    consent: analyticsConsentGranted,
    signals
  };
}

function analyticsContextParams(context = null) {
  const active = context || activeExperienceContext || buildProjectContext();
  return {
    experience_id: active.experienceId || '(none)',
    experience_name: active.experienceName || state.projectName || DEFAULT_EXPERIENCE_NAME,
    media_id: active.mediaId || '(none)',
    media_name: active.mediaName || '',
    media_type: active.mediaType || 'media',
    media_layer: active.mediaLayer || 'experience',
    source_kind: active.sourceKind || 'unknown'
  };
}

function trackAnalyticsEvent(eventName, params = {}) {
  if (!analyticsTrackingAllowed || typeof window.gtag !== 'function') return false;
  try {
    window.gtag('event', eventName, params);
    return true;
  } catch (error) {
    log.warn('ga4 event failed', { eventName, error });
    return false;
  }
}

function trackVirtualPageView(context = null, trigger = 'view') {
  const active = context || activeExperienceContext || buildProjectContext();
  const pageLocation = safeAbsoluteUrl(active.pageLocation, canonicalEntryUrl());
  const pagePath = pagePathFromUrl(pageLocation);
  const dedupeKey = `${active.contextKey}|${pagePath}|${trigger}`;
  const now = Date.now();
  if (lastTrackedVirtualPageKey === dedupeKey && (now - lastTrackedVirtualPageAt) < 900) return false;
  const tracked = trackAnalyticsEvent('page_view', {
    page_title: active.pageTitle || `${state.projectName} • Blend`,
    page_location: pageLocation,
    page_path: pagePath,
    trigger,
    ...analyticsContextParams(active)
  });
  if (tracked) {
    lastTrackedVirtualPageKey = dedupeKey;
    lastTrackedVirtualPageAt = now;
  }
  return tracked;
}

function trackPlaybackEvent(eventName, context = null, extra = {}) {
  const active = context || activeExperienceContext || buildProjectContext();
  return trackAnalyticsEvent(eventName, {
    ...analyticsContextParams(active),
    ...extra
  });
}

function trackShareEvent(method, context = null, extra = {}) {
  const active = context || activeExperienceContext || buildProjectContext();
  const params = {
    method,
    content_type: 'media_experience',
    item_id: active.mediaId || active.experienceId || '(none)',
    ...analyticsContextParams(active),
    ...extra
  };
  trackAnalyticsEvent('share', params);
  trackAnalyticsEvent('experience_share', params);
}

function parseDeepLinkRequest(value = window.location.search) {
  const params = new URLSearchParams(value || '');
  const experienceId = sanitizeDeepLinkToken(params.get(SHARE_DEEP_LINK_PARAM_EXPERIENCE), 120);
  const layer = sanitizeDeepLinkToken(params.get(SHARE_DEEP_LINK_PARAM_LAYER), 20).toLowerCase();
  const itemId = sanitizeDeepLinkToken(params.get(SHARE_DEEP_LINK_PARAM_ITEM), 220);
  const autoplayRaw = sanitizeDeepLinkToken(params.get('autoplay'), 8).toLowerCase();
  const autoplay = autoplayRaw === '1' || autoplayRaw === 'true' || autoplayRaw === 'yes';
  const normalizedLayer = layer === 'playlist' || layer === 'slideshow' ? layer : '';
  if (!experienceId && !normalizedLayer && !itemId && !autoplay) return null;
  return {
    experienceId,
    layer: normalizedLayer,
    itemId,
    autoplay
  };
}

async function applyDeepLinkRequest(request) {
  if (!request) return false;

  if (request.experienceId) {
    const target = state.experiences.find(exp => exp.id === request.experienceId);
    if (target && target.id !== state.activeExperienceId) {
      await switchExperienceById(target.id, { saveCurrent: false, silent: true });
    }
  }

  let targetLayer = request.layer || state.ui.activeList || 'playlist';
  if (targetLayer !== 'playlist' && targetLayer !== 'slideshow') targetLayer = 'playlist';
  if (request.layer) setActiveList(targetLayer);

  let targetIndex = -1;
  if (request.itemId) {
    const tryList = layer => {
      const list = listFor(layer);
      if (!Array.isArray(list) || !list.length) return -1;
      return list.findIndex(ref => String(ref?.id) === request.itemId);
    };
    targetIndex = tryList(targetLayer);
    if (targetIndex < 0 && !request.layer) {
      const playlistIndex = tryList('playlist');
      if (playlistIndex >= 0) {
        targetLayer = 'playlist';
        targetIndex = playlistIndex;
      } else {
        const slideshowIndex = tryList('slideshow');
        if (slideshowIndex >= 0) {
          targetLayer = 'slideshow';
          targetIndex = slideshowIndex;
        }
      }
      setActiveList(targetLayer);
    }
  }

  if (targetIndex >= 0) {
    if (targetLayer === 'playlist') state.runtime.playlistIndex = targetIndex;
    else state.runtime.slideshowIndex = targetIndex;

    const list = listFor(targetLayer);
    const ref = list[targetIndex];
    if (ref) {
      const context = buildExperienceContext(targetLayer, ref, targetIndex, { trigger: 'deep_link' });
      if (context) {
        activateExperienceContext(context, { trackVirtualPage: true, trigger: 'deep_link_open' });
      }
      scrollListItemIntoView(targetIndex);
    }
    renderListEditor();
    updateHUD();

    if (request.autoplay) {
      await playFromHere(targetLayer, targetIndex);
    } else {
      applyTransportMode(TRANSPORT.STOPPED);
    }
    return true;
  }

  if (request.itemId) {
    showToast('Shared item is not available in this session.', { timeout: 3200 });
  }
  activateExperienceContext(buildProjectContext(), { trackVirtualPage: true, trigger: 'deep_link_open' });
  return false;
}

function normalizeMastodonInstance(value) {
  let text = sanitizeDisplayText(value || '', 180);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

function rememberMastodonInstance(value) {
  const normalized = normalizeMastodonInstance(value);
  if (!normalized) return '';
  try { localStorage.setItem(MASTODON_INSTANCE_KEY, normalized); } catch (_) {}
  return normalized;
}

function loadMastodonInstance() {
  try {
    return normalizeMastodonInstance(localStorage.getItem(MASTODON_INSTANCE_KEY) || '');
  } catch (_) {
    return '';
  }
}

function registerSharePlatform(id, config) {
  const normalizedId = normalizeSharePlatformId(id);
  if (!normalizedId || !config || typeof config !== 'object' || typeof config.buildUrl !== 'function') return false;
  const label = sanitizeDisplayText(config.label || normalizedId, 40) || normalizedId;
  sharePlatformRegistry.set(normalizedId, {
    id: normalizedId,
    label,
    buildUrl: config.buildUrl,
    sort: Number.isFinite(config.sort) ? config.sort : 1000
  });
  return true;
}

function listSharePlatforms() {
  return Array.from(sharePlatformRegistry.values()).sort((a, b) => {
    const sortDiff = (a.sort || 1000) - (b.sort || 1000);
    if (sortDiff) return sortDiff;
    return a.label.localeCompare(b.label);
  });
}

function registerDefaultSharePlatforms() {
  registerSharePlatform('facebook', {
    label: 'Facebook',
    sort: 30,
    buildUrl: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`
  });
  registerSharePlatform('x', {
    label: 'X.com',
    sort: 40,
    buildUrl: ({ url, text }) => `https://x.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  });
  registerSharePlatform('bluesky', {
    label: 'Bluesky',
    sort: 50,
    buildUrl: ({ url, text }) => `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${url}`.trim())}`
  });
  registerSharePlatform('mastodon', {
    label: 'Mastodon',
    sort: 60,
    buildUrl: ({ url, text, context }) => {
      const contextOverride = normalizeMastodonInstance(context?.mastodonInstance || context?.platformOverrides?.mastodon?.instance || '');
      const persisted = loadMastodonInstance();
      let instance = contextOverride || persisted;
      if (!instance) {
        const prompted = window.prompt('Enter your Mastodon instance URL', 'https://mastodon.social');
        instance = rememberMastodonInstance(prompted || '');
      }
      if (!instance && persisted) instance = persisted;
      if (!instance) return '';
      return `${instance}/share?text=${encodeURIComponent(`${text} ${url}`.trim())}`;
    }
  });
  registerSharePlatform('linkedin', {
    label: 'LinkedIn',
    sort: 70,
    buildUrl: ({ url }) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
  });
  registerSharePlatform('reddit', {
    label: 'Reddit',
    sort: 80,
    buildUrl: ({ url, title }) => `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`
  });
  registerSharePlatform('whatsapp', {
    label: 'WhatsApp',
    sort: 90,
    buildUrl: ({ url, text }) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`.trim())}`
  });
  registerSharePlatform('email', {
    label: 'Email',
    sort: 100,
    buildUrl: ({ url, title, text }) => `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
  });
}

function platformShareText(context, platformId) {
  const baseText = sanitizeDisplayText(context?.shareText || context?.description || context?.mediaName || context?.pageTitle || '', 320);
  const platformOverride = context?.platformOverrides?.[platformId];
  if (typeof platformOverride === 'string') {
    return sanitizeDisplayText(platformOverride, 320) || baseText;
  }
  if (platformOverride && typeof platformOverride === 'object') {
    const overrideText = sanitizeDisplayText(platformOverride.text || platformOverride.message || '', 320);
    if (overrideText) return overrideText;
  }
  return baseText;
}

async function buildPlatformShareUrl(platformId, context) {
  const platform = sharePlatformRegistry.get(normalizeSharePlatformId(platformId));
  if (!platform) return '';
  const url = safeAbsoluteUrl(context?.pageLocation || buildDeepLinkUrl({ experienceId: state.activeExperienceId }), canonicalEntryUrl());
  const title = sanitizeDisplayText(context?.pageTitle || `${state.projectName} • Blend`, 180);
  const text = platformShareText(context, platform.id);
  const built = await Promise.resolve(platform.buildUrl({ url, title, text, context }));
  return String(built || '').trim();
}

async function copyToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {}
  }
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', 'readonly');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (_) {
    copied = false;
  }
  ta.remove();
  return copied;
}

async function shareWithWebShare(context) {
  if (!navigator.share) return false;
  const payload = {
    title: sanitizeDisplayText(context?.pageTitle || `${state.projectName} • Blend`, 180),
    text: platformShareText(context, 'native'),
    url: safeAbsoluteUrl(context?.pageLocation || buildDeepLinkUrl({ experienceId: state.activeExperienceId }), canonicalEntryUrl())
  };
  try {
    if (navigator.canShare && !navigator.canShare(payload)) {
      delete payload.url;
    }
    await navigator.share(payload);
    showToast('Shared');
    trackShareEvent('native', context, { outcome: 'success' });
    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') {
      showToast('Could not open native share sheet', { timeout: 2600 });
      trackShareEvent('native', context, { outcome: 'error' });
    }
    return false;
  }
}

async function shareContextByMethod(method, context = null) {
  const active = context || activeExperienceContext || buildProjectContext();
  if (method === 'native') {
    return shareWithWebShare(active);
  }
  if (method === 'copy') {
    const copied = await copyToClipboard(active.pageLocation);
    if (copied) {
      showToast('Share link copied');
      trackShareEvent('copy', active, { outcome: 'success' });
    } else {
      showToast('Could not copy share link', { timeout: 2600 });
      trackShareEvent('copy', active, { outcome: 'error' });
    }
    return copied;
  }

  const shareUrl = await buildPlatformShareUrl(method, active);
  if (!shareUrl) {
    showToast('Could not build that share URL', { timeout: 2600 });
    trackShareEvent(method, active, { outcome: 'error' });
    return false;
  }

  if (/^mailto:/i.test(shareUrl)) {
    window.location.href = shareUrl;
    trackShareEvent(method, active, { outcome: 'opened' });
    return true;
  }

  const popup = window.open(shareUrl, '_blank', 'noopener,noreferrer');
  if (!popup) {
    const copied = await copyToClipboard(active.pageLocation);
    if (copied) showToast('Popup blocked. Link copied instead.', { timeout: 3200 });
    else showToast('Popup blocked. Could not copy link.', { timeout: 3200 });
    trackShareEvent(method, active, { outcome: copied ? 'copied_fallback' : 'blocked' });
    return copied;
  }
  trackShareEvent(method, active, { outcome: 'opened' });
  return true;
}

function openShareMenuForContext(anchor, context = null) {
  if (!anchor) return;
  const active = context || activeExperienceContext || contextFromRuntimeLayer('slideshow') || contextFromRuntimeLayer('playlist') || buildProjectContext();
  const options = [];
  if (navigator.share) {
    options.push({
      label: 'Share via device',
      run: () => { void shareContextByMethod('native', active); }
    });
  }
  options.push({
    label: 'Copy share link',
    run: () => { void shareContextByMethod('copy', active); }
  });
  for (const platform of listSharePlatforms()) {
    options.push({
      label: `Share on ${platform.label}`,
      run: () => { void shareContextByMethod(platform.id, active); }
    });
  }
  showButtonMenu(anchor, options);
}

function openShareMenuForListRow(anchor, which, index) {
  const list = listFor(which);
  if (!Array.isArray(list) || !list.length) {
    showToast('No item available to share', { timeout: 2200 });
    return;
  }
  const idx = clampExperienceIndex(index, list.length);
  const ref = list[idx];
  if (!ref) {
    showToast('No item available to share', { timeout: 2200 });
    return;
  }
  const context = buildExperienceContext(which, ref, idx, { trigger: 'share_menu' }) || buildProjectContext();
  activateExperienceContext(context, { trackVirtualPage: false, trigger: 'share_menu' });
  openShareMenuForContext(anchor, context);
}

// ====================== CLOUD STORAGE ======================
function ipfsConfigFromState(overrides = {}) {
  return {
    enabled: true,
    supabaseUrl: RUNTIME_CONFIG.supabaseUrl,
    signedUrlTtlSeconds: Math.max(1, Number(state.settings.storageSignedUrlTtlSeconds) || RUNTIME_CONFIG.signedUrlTtlSeconds || 1209600),
    defaultBucket: String(state.settings.storageDefaultBucket || RUNTIME_CONFIG.defaultBucket || 'media').trim() || 'media',
    privateMediaRequiresAuth: state.settings.privateMediaRequiresAuth !== false,
    mediaMetadataSource: RUNTIME_CONFIG.mediaMetadataSource || 'browser',
    ...overrides
  };
}

function currentAuthReadiness() {
  const config = ipfsConfigFromState();
  const hasSession = supabaseAuthClient.isAuthenticated();
  if (!config.privateMediaRequiresAuth) {
    return {
      state: 'ready',
      canAccessPrivateMedia: true,
      message: 'Private media token auth is optional in this environment.'
    };
  }
  if (hasSession) {
    return {
      state: 'ready',
      canAccessPrivateMedia: true,
      message: 'Supabase API token connected for private media.'
    };
  }
  return {
    state: 'unauthorized',
    canAccessPrivateMedia: false,
    message: 'Provide API token to access private Supabase media.'
  };
}

function updateIpfsShareButtonState(readiness = currentAuthReadiness()) {
  const shareBtn = $('#btn-share');
  if (!shareBtn) return;
  const connected = readiness?.state === 'ready';
  shareBtn.dataset.ipfsState = connected ? 'ready' : 'unauthorized';
  shareBtn.classList.toggle('attention', !connected);
  shareBtn.title = connected ? 'Supabase API token connected' : (readiness?.message || 'Provide Supabase API token');
  shareBtn.setAttribute('aria-label', connected ? 'Supabase API token connected' : 'Provide Supabase API token');
}

function syncIpfsControls() {
  const config = ipfsConfigFromState();
  const readiness = currentAuthReadiness();
  const bucketInput = $('#supabase-default-bucket');
  const ttlInput = $('#supabase-signed-url-ttl');
  const statusEl = $('#supabase-auth-status');
  const signInBtn = $('#supabase-sign-in');
  const signOutBtn = $('#supabase-sign-out');
  const privateToggle = $('#private-media-auth-required');

  if (bucketInput) bucketInput.value = config.defaultBucket;
  if (ttlInput) ttlInput.value = String(config.signedUrlTtlSeconds);
  if (privateToggle) privateToggle.checked = config.privateMediaRequiresAuth;
  if (statusEl) {
    statusEl.textContent = readiness.message;
    statusEl.dataset.state = readiness.state;
  }
  if (signInBtn) signInBtn.disabled = readiness.state === 'ready';
  if (signOutBtn) signOutBtn.disabled = readiness.state !== 'ready';
  updateIpfsShareButtonState(readiness);
}

function resetShareWarningFromUrlIfRequested() {
  return false;
}

function parseIpfsExperienceRequest(value = window.location.search) {
  const params = value instanceof URLSearchParams ? value : new URLSearchParams(String(value || '').replace(/^.*\?/, ''));
  const reference = sanitizeImportPath(
    params.get('storageExperience') ||
    params.get('experienceUrl') ||
    params.get('ipfsExperience') ||
    ''
  );
  if (!reference || !isPortableRemoteRef(reference, { allowSupabaseBucketPath: true })) return null;
  const autoplay = /^(1|true|yes)$/i.test(String(params.get('autoplay') || ''));
  return { reference, autoplay };
}

function buildIpfsExperienceShareUrl(mediaReference) {
  const ref = sanitizeImportPath(mediaReference || '');
  if (!ref || !isPortableRemoteRef(ref, { allowSupabaseBucketPath: true })) return '';
  const url = new URL(canonicalEntryUrl());
  url.searchParams.set('storageExperience', ref);
  return url.toString();
}

// ====================== URL SHARING (v5.0.7) ======================

/**
 * Detect a compressed experience payload in the current URL.
 * Accepts both ?experience= and ?data= query parameters.
 *
 * @param {string} [value] - URL search string to parse (defaults to window.location.search)
 * @returns {{ payload: string } | null}
 */
function parseUrlShareRequest(value = window.location.search) {
  const params = new URLSearchParams(String(value || '').replace(/^.*\?/, ''));
  const raw = params.get(URL_SHARE_PARAM) || params.get(URL_SHARE_PARAM_ALIAS) || '';
  const payload = raw.replace(/[\s\r\n]/g, '');
  if (!payload || payload.length < 10) return null;
  // Quick validity check: must look like Base64URL (not a UUID or short token)
  if (!/^[A-Za-z0-9_\-=]{10,}$/.test(payload)) return null;
  return { payload };
}

/**
 * Decompress and import an experience from a URL share request (v5.0.8).
 *
 * Improvements over v5.0.7:
 *  - Prominent animated progress overlay replaces the bare toast.
 *  - All transport controls (play/pause/next/prev/seek/volume) are frozen for
 *    the duration of the import; the ⚙️ config gear (a sibling element, not
 *    inside #transport) remains fully functional throughout.
 *  - Per-item progress flows from materializeImportedEntries via onItemProgress,
 *    populating a scrolling item list in the overlay in real time.
 *  - Keyboard transport shortcuts are blocked via the experienceLoading flag.
 *  - Cleans the ?experience= param from the URL on success or failure.
 *
 * @param {{ payload: string }} request
 * @returns {Promise<object|null>} the imported experience record, or null on failure
 */
async function loadUrlSharedExperience(request) {
  if (!request?.payload) return null;

  // Bind the progress tracker to the overlay element defined in index.html.
  // createExperienceLoadProgress() returns a no-op object when the element is absent.
  const progress = createExperienceLoadProgress($('#experience-load-overlay'));

  experienceLoading = true;
  freezeTransportControls();
  progress.start();
  progress.update(2, 'Starting…');

  try {
    // ── Step 1: Decompress gzip+Base64URL payload (0 → 12%) ────────────────
    progress.update(5, 'Decompressing share link…');
    let parsed;
    try {
      parsed = await decompressExperience(request.payload);
    } catch (decodeError) {
      throw new Error(`Could not decode share link: ${decodeError.message}`);
    }

    // ── Step 2: Validate schema (12%) ──────────────────────────────────────
    progress.update(12, 'Validating experience schema…');
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Share link payload is not a valid object');
    }
    const isExperience = parsed.type === 'experience' || String(parsed.schema || '').includes('experience');
    if (!isExperience) {
      throw new Error('Share link does not contain an experience (wrong schema)');
    }

    // ── Steps 3-7 delegated to importExperienceFromFile (12 → 100%) ────────
    // We wrap importExperienceFromFile's 0-100 range onto our 12-100 range so
    // the overlay bar moves smoothly without any jump or gap.
    const json = JSON.stringify(parsed);
    const file = new File([json], 'shared-experience.json', { type: 'application/json' });

    const record = await importExperienceFromFile(file, {
      suppressToast: true,

      // Map importExperienceFromFile's 0-100 onto overlay's 12-100.
      onProgress: (pct, msg) => {
        const mapped = 12 + Math.round(pct * 0.88);
        progress.update(mapped, msg);
      },

      // Add each materialized item to the scrolling item list.
      onItemProgress: ({ name, status }) => {
        // Map materializeImportedEntries status values to LOAD_ITEM_STATUS constants.
        const itemStatus =
          status === 'loaded'  ? LOAD_ITEM_STATUS.LOADED  :
          status === 'missing' ? LOAD_ITEM_STATUS.MISSING :
          status === 'error'   ? LOAD_ITEM_STATUS.ERROR   :
          LOAD_ITEM_STATUS.LOADED; // duplicates treated as already loaded
        progress.addItem(`item-${String(name).slice(0, 24)}-${Date.now()}`, name, itemStatus);
      }
    });

    if (!record) throw new Error('Share link experience payload is invalid or could not be saved');

    // ── Clean the share parameter from the URL ──────────────────────────────
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete(URL_SHARE_PARAM);
      clean.searchParams.delete(URL_SHARE_PARAM_ALIAS);
      history.replaceState(null, '', clean.toString());
    } catch (_) {}

    const plCount = (record.payload?.playlist || []).length;
    const ssCount = (record.payload?.slideshow || []).length;
    const summary  = `${plCount} playlist, ${ssCount} slideshow item${ssCount !== 1 ? 's' : ''}`;
    progress.complete(true, `Loaded "${record.name}" — ${summary}`);
    showToast(`Loaded shared experience "${record.name}" (${summary})`);
    return record;

  } catch (error) {
    log.error('[url-share] load failed', error);
    const msg = error?.message || 'Could not load shared experience';
    progress.complete(false, msg);
    showToast(msg, { timeout: 5200 });

    // Also clean the URL on failure so repeated refreshes don't loop.
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete(URL_SHARE_PARAM);
      clean.searchParams.delete(URL_SHARE_PARAM_ALIAS);
      history.replaceState(null, '', clean.toString());
    } catch (_) {}

    return null;
  } finally {
    experienceLoading = false;
    unfreezeTransportControls();
  }
}

/**
 * Compress the current active experience and copy a share URL to clipboard.
 * Opens #url-share-modal with the URL and size information.
 */
async function shareExperienceViaUrl() {
  const btn = $('#experience-share-url');
  const transportBtn = $('#btn-share');
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Compressing…'; }
    if (transportBtn) { transportBtn.disabled = true; }

    const payload = buildExperienceExportPayload();
    let compressed;
    try {
      compressed = await compressExperience(payload);
    } catch (compressionError) {
      showToast(`Cannot share: ${compressionError.message}`, { timeout: 5000 });
      return;
    }

    const shareUrl = buildUrlShareLink(compressed);
    const payloadBytes = estimateShareUrlSize(compressed);
    const oversized = payloadBytes > URL_SHARE_SIZE_LIMIT;

    // Copy to clipboard (non-blocking — modal still shows if this fails).
    let copied = false;
    try {
      await navigator.clipboard.writeText(shareUrl);
      copied = true;
    } catch (_) {}

    showUrlShareModal(shareUrl, payloadBytes, oversized, copied, payload);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Share URL'; }
    if (transportBtn) { transportBtn.disabled = false; }
  }
}

/**
 * Extract the current experience as a plain JSON-serialisable object,
 * matching the format produced by exportExperience().
 */
function buildExperienceExportPayload() {
  const libraryItems = sortLibraryEntries(Array.from(state.library.entries()))
    .map(([, item], index) => exportLibraryRecord(item, index));
  return {
    version: VERSION,
    schema: EXPERIENCE_EXPORT_SCHEMA,
    type: 'experience',
    id: state.activeExperienceId,
    name: state.projectName,
    project: state.projectName,
    exportedAt: new Date().toISOString(),
    settings: {
      ...state.settings,
      resumeOnLoad: false
    },
    library: {
      order: libraryItems.map(item => item.id),
      items: libraryItems
    },
    playlist: makeListExportPayload('playlist'),
    slideshow: makeListExportPayload('slideshow')
  };
}

/**
 * Build the full share URL string from a Base64URL compressed payload.
 */
function buildUrlShareLink(base64Url) {
  const url = new URL(canonicalEntryUrl());
  url.searchParams.set(URL_SHARE_PARAM, base64Url);
  return url.toString();
}

/**
 * Display the url-share-modal with the generated share URL.
 */
function showUrlShareModal(shareUrl, payloadBytes, oversized, alreadyCopied, payload) {
  const modal = $('#url-share-modal');
  if (!modal) return;

  const urlInput = $('#url-share-url-input');
  if (urlInput) urlInput.value = shareUrl;

  const sizeEl = $('#url-share-size');
  if (sizeEl) {
    const kb = (payloadBytes / 1024).toFixed(1);
    sizeEl.textContent = `Compressed size: ${kb} KB`;
  }

  const warningEl = $('#url-share-warning');
  if (warningEl) {
    if (oversized) {
      warningEl.textContent = `Warning: This URL is ${(payloadBytes / 1024).toFixed(0)} KB. Very large URLs may not work in some browsers or link-shorteners. Consider downloading as JSON instead.`;
      warningEl.classList.remove('hidden');
    } else {
      warningEl.classList.add('hidden');
    }
  }

  const copyBtn = $('#url-share-copy');
  if (copyBtn) {
    copyBtn.textContent = alreadyCopied ? 'Copied ✓' : 'Copy URL';
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 2000);
      } catch (_) {
        // Fallback: select the input text for manual copy.
        if (urlInput) { urlInput.select(); }
        showToast('Press Ctrl+C / Cmd+C to copy the URL', { timeout: 3000 });
      }
    };
  }

  const downloadBtn = $('#url-share-download');
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      if (payload) {
        downloadJson(payload, experienceExportFilename(state.projectName));
        showToast(`Downloaded ${state.projectName} as JSON`);
      }
    };
  }

  const closeBtn = $('#url-share-close');
  if (closeBtn) closeBtn.onclick = () => modal.close();

  modal.showModal();

  if (alreadyCopied) {
    showToast('Share URL copied to clipboard', { timeout: 2600 });
  }
}

async function bootstrapAuthSession() {
  await supabaseAuthClient.bootstrap();
  syncIpfsControls();
}

function buildAuthDialog() {
  const dialog = $('#supabase-auth-modal');
  if (!dialog) return null;
  const form = dialog.querySelector('form');
  const accessToken = dialog.querySelector('[name="accessToken"]');
  const refreshToken = dialog.querySelector('[name="refreshToken"]');
  const error = dialog.querySelector('[data-auth-error]');
  const submit = dialog.querySelector('[data-auth-submit]');
  const cancel = dialog.querySelector('[data-auth-cancel]');
  if (!form || !accessToken || !refreshToken || !submit || !cancel) return null;
  return { dialog, form, accessToken, refreshToken, error, submit, cancel };
}

async function promptSupabaseSignIn() {
  const parts = buildAuthDialog();
  if (!parts) {
    showToast('Supabase auth dialog is unavailable in this build.', { timeout: 3200 });
    return null;
  }
  const { dialog, form, accessToken, refreshToken, error, submit, cancel } = parts;
  if (dialog.open) dialog.close();
  error.textContent = '';
  submit.disabled = false;
  cancel.disabled = false;
  accessToken.value = '';
  refreshToken.value = '';

  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancelEvent);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onCancel = () => finish(null);
    const onCancelEvent = event => {
      event.preventDefault();
      finish(null);
    };
    const onClose = () => {
      if (!settled) finish(null);
    };
    const onSubmit = async event => {
      event.preventDefault();
      submit.disabled = true;
      cancel.disabled = true;
      error.textContent = '';
      try {
        const session = await supabaseAuthClient.signInWithApiToken({
          accessToken: accessToken.value,
          refreshToken: refreshToken.value
        });
        syncIpfsControls();
        showToast('Supabase API token connected.', { timeout: 2800 });
        finish(session);
      } catch (authError) {
        error.textContent = authError?.message || 'Token connection failed. Check the token and try again.';
        submit.disabled = false;
        cancel.disabled = false;
      }
    };
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancelEvent);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    requestAnimationFrame(() => accessToken.focus());
  });
}

async function ensureAuthenticatedSession({ interactive = false } = {}) {
  await bootstrapAuthSession();
  if (supabaseAuthClient.isAuthenticated()) return supabaseAuthClient.getSession();
  if (!interactive) return null;
  return await promptSupabaseSignIn();
}

async function shareCurrentExperienceThroughIpfs() {
  if (activeIpfsShareController) return null;
  const session = await ensureAuthenticatedSession({ interactive: true });
  if (!session) {
    showToast('An API token is required to access private Supabase media.', { timeout: 3200 });
    return null;
  }
  syncIpfsControls();
  return session;
}

async function loadSharedIpfsExperience(request) {
  if (!request?.reference) return null;
  if (activeIpfsLoadController) {
    showToast('A shared experience is already loading', { timeout: 2600 });
    return null;
  }
  const controller = new AbortController();
  activeIpfsLoadController = controller;
  try {
    const resolved = await storageUrlResolver.resolve(request.reference, {
      defaultBucket: state.settings.storageDefaultBucket || RUNTIME_CONFIG.defaultBucket,
      signedUrlTtlSeconds: state.settings.storageSignedUrlTtlSeconds || RUNTIME_CONFIG.signedUrlTtlSeconds
    });
    const response = await fetch(resolved.url, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Could not fetch shared experience (${response.status})`);
    const text = await response.text();
    const file = new File([text], 'shared-experience.json', { type: 'application/json' });
    const imported = await importExperienceFromFile(file);
    if (!imported) throw new Error('Shared experience payload is invalid.');
    if (request.autoplay) await togglePlay();
    return imported;
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    log.error('shared experience load failed', error);
    showToast(error?.message || 'Could not load shared experience', { timeout: 4200 });
    return null;
  } finally {
    activeIpfsLoadController = null;
  }
}

supabaseAuthClient.onAuthStateChange(() => {
  syncIpfsControls();
  updateIpfsShareButtonState();
});

registerDefaultSharePlatforms();

function normalizeExperienceName(name, fallback = DEFAULT_EXPERIENCE_NAME) {
  const value = String(name ?? '').replace(/\s+/g, ' ').trim();
  return value || fallback;
}

function sanitizeFilenamePart(name) {
  return normalizeExperienceName(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim() || DEFAULT_EXPERIENCE_NAME;
}

function formatFilenameStamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function experienceExportFilename(name, date = new Date()) {
  return `${sanitizeFilenamePart(name)} - ${formatFilenameStamp(date)}.json`;
}

function clampExperienceIndex(value, length) {
  const n = Number.isFinite(value) ? Math.floor(value) : 0;
  if (!length) return 0;
  return Math.max(0, Math.min(n, Math.max(0, length - 1)));
}

function sortExperienceRecords(records = []) {
  return [...records].sort((a, b) => {
    const an = normalizeExperienceName(a?.name || a?.projectName || a?.payload?.projectName);
    const bn = normalizeExperienceName(b?.name || b?.projectName || b?.payload?.projectName);
    const nameCmp = an.localeCompare(bn, undefined, { numeric: true, sensitivity: 'base' });
    if (nameCmp) return nameCmp;
    const at = Date.parse(a?.updatedAt || a?.createdAt || 0) || 0;
    const bt = Date.parse(b?.updatedAt || b?.createdAt || 0) || 0;
    return bt - at;
  });
}

function ensureUniqueExperienceName(name, ignoreId = null) {
  const base = normalizeExperienceName(name);
  const used = new Set(
    state.experiences
      .filter(exp => exp.id !== ignoreId)
      .map(exp => normalizeExperienceName(exp.name || exp.projectName || exp.payload?.projectName).toLowerCase())
  );
  if (!used.has(base.toLowerCase())) return base;
  let suffix = 2;
  let candidate = `${base} (${suffix})`;
  while (used.has(candidate.toLowerCase())) {
    suffix++;
    candidate = `${base} (${suffix})`;
  }
  return candidate;
}

function experienceRecordName(record) {
  return normalizeExperienceName(record?.name || record?.projectName || record?.payload?.projectName || DEFAULT_EXPERIENCE_NAME);
}

function findExperienceByName(name, ignoreId = null) {
  const target = normalizeExperienceName(name).toLowerCase();
  return state.experiences.find(record => {
    if (!record || record.id === ignoreId) return false;
    return experienceRecordName(record).toLowerCase() === target;
  }) || null;
}

function metadataSortValue(item) {
  const metadata = item?.metadata;
  if (!metadata || typeof metadata !== 'object') return '';
  const preferredKeys = ['sortTitle', 'title', 'artist', 'album', 'genre', 'tag', 'date'];
  for (const key of preferredKeys) {
    if (metadata[key] != null && typeof metadata[key] !== 'object') return String(metadata[key]).toLocaleLowerCase();
  }
  const firstKey = Object.keys(metadata).sort()[0];
  const value = firstKey ? metadata[firstKey] : '';
  return value == null || typeof value === 'object' ? '' : String(value).toLocaleLowerCase();
}

function showToast(message, opts = {}) {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  const label = document.createElement('span');
  label.textContent = message;
  toast.appendChild(label);
  if (opts.undo) {
    const u = document.createElement('span');
    u.className = 'undo';
    u.textContent = 'Undo';
    u.onclick = () => { opts.undo(); toast.remove(); };
    toast.appendChild(u);
  }
  if (opts.action) {
    const a = document.createElement('button');
    a.className = 'btn';
    a.type = 'button';
    a.textContent = opts.action.label;
    a.onclick = () => { opts.action.run(); toast.remove(); };
    toast.appendChild(a);
  }
  container.appendChild(toast);
  const timeout = opts.timeout === 0 ? 0 : (opts.timeout || 4200);
  if (timeout) setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, timeout);
  return { toast, label, close: () => toast.remove() };
}

// ====================== INDEXEDDB ======================
async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('library')) d.createObjectStore('library', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('playlist')) d.createObjectStore('playlist', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('slideshow')) d.createObjectStore('slideshow', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      if (!d.objectStoreNames.contains(EXPERIENCE_STORE)) d.createObjectStore(EXPERIENCE_STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('thumbnails')) d.createObjectStore('thumbnails', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('dirHandles')) d.createObjectStore('dirHandles', { keyPath: 'id' });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  if (!db) return;
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function idbGet(storeName, key) {
  if (!db) return null;
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readonly');
    const r = tx.objectStore(storeName).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbGetAll(storeName) {
  if (!db) return [];
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readonly');
    const r = tx.objectStore(storeName).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function idbDelete(storeName, key) {
  if (!db) return;
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ====================== THUMBNAILS (IDB) ======================
const thumbQueue = [];
let thumbRunning = 0;
const THUMB_CONCURRENCY = 2;

function thumbKey(name, size, lastMod = 0) {
  return `${name}:${size}:${lastMod}`;
}

function mediaIcon(type) {
  return type === 'video' ? '🎬' : type === 'audio' ? '🎵' : '🖼️';
}

function itemThumbCacheKey(item) {
  return `${item.id}:${item.name}:${item.size || 0}:${item.type}`;
}

function rememberThumbUrl(key, url) {
  if (!url) return null;
  if (thumbUrlCache.has(key)) {
    const existing = thumbUrlCache.get(key);
    thumbUrlCache.delete(key);
    if (existing !== url) scheduleObjectUrlRevoke(existing, 1000);
  }
  thumbUrlCache.set(key, url);
  while (thumbUrlCache.size > PERF.THUMB_CACHE_LIMIT) {
    const [oldKey, oldUrl] = thumbUrlCache.entries().next().value;
    thumbUrlCache.delete(oldKey);
    scheduleObjectUrlRevoke(oldUrl, 1000);
  }
  return url;
}

function touchThumbUrl(key) {
  if (!thumbUrlCache.has(key)) return null;
  const url = thumbUrlCache.get(key);
  thumbUrlCache.delete(key);
  thumbUrlCache.set(key, url);
  return url;
}

function initThumbnailObserver() {
  if (thumbObserver || !('IntersectionObserver' in window)) return;
  thumbObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      thumbObserver.unobserve(entry.target);
      loadThumbForElement(entry.target);
    }
  }, { root: null, rootMargin: PERF.THUMB_ROOT_MARGIN, threshold: 0.01 });
}

function releaseThumbnailElement(root) {
  const thumbs = root.matches?.('[data-thumb-key]') ? [root] : Array.from(root.querySelectorAll?.('[data-thumb-key]') || []);
  thumbs.forEach(el => {
    if (thumbObserver) thumbObserver.unobserve(el);
    thumbElementState.delete(el);
  });
}

function requestThumbnailForElement(el, item) {
  if (!el || !item) return;
  initThumbnailObserver();
  const key = itemThumbCacheKey(item);
  const prev = thumbElementState.get(el);
  if (prev?.key === key && el.dataset.thumbLoaded === 'true') return;
  if (thumbObserver && prev) thumbObserver.unobserve(el);

  thumbElementState.set(el, { item, key });
  el.dataset.thumbKey = key;
  el.dataset.thumbLoaded = 'false';
  el.replaceChildren(document.createTextNode(mediaIcon(item.type)));

  if (item.type === 'audio') {
    el.dataset.thumbLoaded = 'true';
    return;
  }

  const cached = touchThumbUrl(key);
  if (cached) {
    setThumbImage(el, item, cached);
    return;
  }

  if (thumbObserver) thumbObserver.observe(el);
  else loadThumbForElement(el);
}

function setThumbImage(el, item, url) {
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = url;
  el.dataset.thumbLoaded = 'true';
  el.replaceChildren(img);
}

async function loadThumbForElement(el) {
  const stateForEl = thumbElementState.get(el);
  if (!stateForEl || el.dataset.thumbLoading === 'true') return;
  el.dataset.thumbLoading = 'true';
  try {
    const url = await getThumbnailUrl(stateForEl.item);
    const latest = thumbElementState.get(el);
    if (url && latest?.key === stateForEl.key) setThumbImage(el, stateForEl.item, url);
  } finally {
    el.dataset.thumbLoading = 'false';
  }
}

function getThumbnailUrl(item) {
  const key = itemThumbCacheKey(item);
  const cached = touchThumbUrl(key);
  if (cached) return Promise.resolve(cached);
  if (thumbRequests.has(key)) return thumbRequests.get(key);

  const promise = new Promise(resolve => {
    thumbQueue.push({ item, key, resolve });
    pumpThumbQueue();
  });
  thumbRequests.set(key, promise);
  return promise;
}

function pumpThumbQueue() {
  while (thumbRunning < THUMB_CONCURRENCY && thumbQueue.length) {
    const job = thumbQueue.shift();
    thumbRunning++;
    runWhenIdle(async () => {
      try {
        const url = await generateThumbnail(job.item.handle, job.item);
        job.resolve(url ? rememberThumbUrl(job.key, url) : null);
      } catch (e) {
            log.warn('thumb load failed', e);
        job.resolve(null);
      } finally {
        thumbRequests.delete(job.key);
        thumbRunning--;
        pumpThumbQueue();
      }
    }, 1200);
  }
}

async function getCachedThumb(key) {
  const rec = await idbGet('thumbnails', key);
  return rec ? rec.blob : null;
}

async function saveCachedThumb(key, blob) {
  await idbPut('thumbnails', { key, blob, at: Date.now() });
}

async function generateThumbnail(handle, meta) {
  const remoteUrl = remoteUrlForItem(meta);
  if (remoteUrl && meta?.type === 'image') return remoteUrl;
  if (!handle || typeof handle.getFile !== 'function') return null;
  const file = await handle.getFile().catch(() => null);
  if (!file) return null;

  const key = thumbKey(meta.name, meta.size, file.lastModified || 0);
  const cached = await getCachedThumb(key);
  if (cached) return URL.createObjectURL(cached);

  const type = meta.type;
  let url = createMediaObjectUrl(file, meta);
  let thumbBlob = null;

  try {
    if (type === 'video') {
      thumbBlob = await videoFrameToBlob(url, 0.12);
    } else if (type === 'image') {
      thumbBlob = await imageToThumbBlob(url);
    } else {
      // audio icon fallback later
    }
  } catch (e) { log.warn('thumb gen failed', e); }

  scheduleObjectUrlRevoke(url, 1000);

  if (thumbBlob) {
    await saveCachedThumb(key, thumbBlob);
    return URL.createObjectURL(thumbBlob);
  }
  return null;
}

async function videoFrameToBlob(src, pos = 0.1) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true;
    const cleanup = () => {
      v.removeAttribute('src');
      v.load();
      v.remove();
    };
    v.onloadedmetadata = () => {
      const seekTo = Math.max(0.5, Math.min(v.duration * pos, v.duration - 0.5));
      v.currentTime = seekTo;
    };
    v.onseeked = () => {
      const c = document.createElement('canvas');
      const w = 320, h = Math.round(w * (v.videoHeight / v.videoWidth || 9/16));
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { alpha: false });
      ctx.drawImage(v, 0, 0, w, h);
      c.toBlob(b => {
        cleanup();
        resolve(b);
      }, 'image/jpeg', 0.82);
    };
    v.onerror = () => { cleanup(); resolve(null); };
    v.src = src;
  });
}

async function imageToThumbBlob(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const w = 320, h = Math.round(w * (img.height / img.width || 9/16));
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { alpha: false });
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(b => {
        img.src = '';
        resolve(b);
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { img.src = ''; resolve(null); };
    img.src = src;
  });
}

// ====================== STATE & PERSISTENCE ======================
const saveStateDebounced = debounce(() => saveStateNow(), 850);

function experienceSnapshotFromState() {
  return {
    projectName: state.projectName,
    settings: clonePlain(state.settings),
    playlist: state.playlist.map(cloneListRef).filter(Boolean),
    slideshow: state.slideshow.map(cloneListRef).filter(Boolean),
    listMeta: {
      playlist: normalizeListMeta('playlist', state.listMeta.playlist),
      slideshow: normalizeListMeta('slideshow', state.listMeta.slideshow)
    },
    runtime: {
      playlistIndex: state.runtime.playlistIndex || 0,
      slideshowIndex: state.runtime.slideshowIndex || 0,
      isPlaying: !!state.runtime.isPlaying,
      historyPlaylist: Array.isArray(state.runtime.historyPlaylist) ? state.runtime.historyPlaylist.slice() : [],
      historySlideshow: Array.isArray(state.runtime.historySlideshow) ? state.runtime.historySlideshow.slice() : []
    },
    ui: {
      activeList: state.ui.activeList === 'slideshow' ? 'slideshow' : 'playlist'
    }
  };
}

function normalizeExperienceSnapshot(snapshot = {}) {
  const settings = createDefaultSettings(snapshot && typeof snapshot.settings === 'object' ? snapshot.settings : {});
  const playlist = Array.isArray(snapshot.playlist) ? snapshot.playlist.map(cloneListRef).filter(Boolean) : [];
  const slideshow = Array.isArray(snapshot.slideshow) ? snapshot.slideshow.map(cloneListRef).filter(Boolean) : [];
  const runtime = snapshot && typeof snapshot.runtime === 'object' ? snapshot.runtime : {};
  const ui = snapshot && typeof snapshot.ui === 'object' ? snapshot.ui : {};
  return {
    projectName: normalizeExperienceName(snapshot.projectName || snapshot.name || DEFAULT_EXPERIENCE_NAME),
    settings,
    playlist,
    slideshow,
    listMeta: {
      playlist: normalizeListMeta('playlist', snapshot.listMeta?.playlist || snapshot.playlistMeta || snapshot.playlist?.meta || {}),
      slideshow: normalizeListMeta('slideshow', snapshot.listMeta?.slideshow || snapshot.slideshowMeta || snapshot.slideshow?.meta || {})
    },
    runtime: {
      playlistIndex: clampExperienceIndex(runtime.playlistIndex, playlist.length),
      slideshowIndex: clampExperienceIndex(runtime.slideshowIndex, slideshow.length),
      isPlaying: !!runtime.isPlaying,
      historyPlaylist: Array.isArray(runtime.historyPlaylist) ? runtime.historyPlaylist.filter(Number.isFinite) : [],
      historySlideshow: Array.isArray(runtime.historySlideshow) ? runtime.historySlideshow.filter(Number.isFinite) : []
    },
    ui: {
      activeList: ui.activeList === 'slideshow' ? 'slideshow' : 'playlist'
    }
  };
}

function currentExperienceRecord() {
  return state.experiences.find(exp => exp.id === state.activeExperienceId) || null;
}

function experienceDebugContext(extra = {}) {
  return {
    ...extra,
    activeExperienceId: state.activeExperienceId,
    projectName: state.projectName,
    playlistCount: state.playlist.length,
    slideshowCount: state.slideshow.length,
    activeList: state.ui.activeList,
    experienceCount: state.experiences.length
  };
}

function makeExperienceRecord(snapshot, opts = {}) {
  const normalized = normalizeExperienceSnapshot(snapshot);
  const now = new Date().toISOString();
  const id = opts.id || `exp-${uid()}`;
  const createdAt = opts.createdAt || now;
  const updatedAt = opts.updatedAt || now;
  const name = normalizeExperienceName(opts.name || normalized.projectName);
  return {
    id,
    name: opts.uniqueName ? ensureUniqueExperienceName(name, id) : name,
    createdAt,
    updatedAt,
    payload: normalized
  };
}

function setActiveExperienceId(id) {
  state.activeExperienceId = id || null;
  if (state.activeExperienceId) {
    localStorage.setItem(EXPERIENCE_ACTIVE_KEY, state.activeExperienceId);
  } else {
    localStorage.removeItem(EXPERIENCE_ACTIVE_KEY);
  }
}

function applyThemeMode(mode = state.settings.themeMode || 'auto') {
  const normalized = mode === 'dark' || mode === 'light' ? mode : 'auto';
  const resolved = normalized === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : normalized;
  document.documentElement.dataset.theme = normalized;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = resolved === 'light' ? THEME_COLOR_LIGHT : THEME_COLOR_DARK;
}

function ensureTransitionPickerRows() {
  const list = $('#enabled-transitions-list');
  if (!list) return;
  if (list.dataset.ready === 'true') return;
  list.innerHTML = '';
  for (const effect of transitionEffectCatalog) {
    if (effect.id === 'hard-cut') continue;
    const row = document.createElement('div');
    row.className = 'transition-option';
    row.dataset.effectId = effect.id;
    row.innerHTML = `
      <label class="transition-option__toggle">
        <input type="checkbox" data-transition-check="${effect.id}" aria-label="Enable ${effect.label}">
        <span>${escapeHtml(effect.label)}</span>
      </label>
      <div class="transition-option__weight">
        <input type="range" min="0" max="10" step="0.5" value="${effect.defaultWeight}" data-transition-weight="${effect.id}" aria-label="${effect.label} weight">
        <span data-transition-weight-value="${effect.id}">${effect.defaultWeight.toFixed(1)}</span>
      </div>
    `;
    list.appendChild(row);
  }
  list.dataset.ready = 'true';
}

function syncTransitionPickerRows() {
  ensureTransitionPickerRows();
  const enabled = new Set(Array.isArray(state.settings.enabledTransitionIds) ? state.settings.enabledTransitionIds : []);
  const weights = state.settings.transitionWeights && typeof state.settings.transitionWeights === 'object'
    ? state.settings.transitionWeights
    : {};
  for (const effect of transitionEffectCatalog) {
    if (effect.id === 'hard-cut') continue;
    const check = $(`[data-transition-check="${effect.id}"]`);
    const weightInput = $(`[data-transition-weight="${effect.id}"]`);
    const weightLabel = $(`[data-transition-weight-value="${effect.id}"]`);
    const weight = clampNumber(weights[effect.id], 0, 100, effect.defaultWeight);
    if (check) check.checked = enabled.has(effect.id);
    if (weightInput) weightInput.value = String(weight);
    if (weightLabel) weightLabel.textContent = weight.toFixed(1);
  }
}

function readTransitionPickerRows() {
  const enabled = [];
  const weights = {};
  for (const effect of transitionEffectCatalog) {
    if (effect.id === 'hard-cut') continue;
    const check = $(`[data-transition-check="${effect.id}"]`);
    const weightInput = $(`[data-transition-weight="${effect.id}"]`);
    if (check?.checked) enabled.push(effect.id);
    weights[effect.id] = clampNumber(weightInput?.value, 0, 100, effect.defaultWeight);
  }
  return { enabledTransitionIds: enabled, transitionWeights: weights };
}

function syncExperienceControls() {
  renderExperiencePicker();
  $('#app-version').textContent = `v${VERSION}`;
  const opacity = Number.isFinite(state.settings.opacity) ? state.settings.opacity : DEFAULT_SETTINGS.opacity;
  const themeMode = state.settings.themeMode === 'dark' || state.settings.themeMode === 'light'
    ? state.settings.themeMode
    : 'auto';
  $('#blend-slider').value = Math.round(opacity * 100);
  $('#blend-value').textContent = Math.round(opacity * 100) + '%';
  $('#vol-playlist').value = state.settings.playlistVolume;
  $('#vol-slideshow').value = state.settings.slideshowVolume;
  $('#vol-master').value = state.settings.masterVolume;
  if (state.settings.masterVolume > 0) lastNonZeroMasterVolume = state.settings.masterVolume;
  $('#default-duration').value = state.settings.defaultImageDuration;
  $('#effect-intensity').value = state.settings.effectIntensity;
  $('#theme-mode').value = themeMode;
  $('#import-behavior').value = state.settings.importBehavior || 'append';
  $('#experience-playback-mode').value = normalizeExperiencePlaybackMode(state.settings.experiencePlaybackMode);
  $('#loop-experience-catalog').checked = !!state.settings.loopExperienceCatalog;
  $('#transition-duration').value = String(Math.round(transitionDurationMs()));
  $('#transition-overlap').value = String(Math.round(transitionOverlapMs()));
  $('#transition-randomize-order').checked = state.settings.transitionRandomizeOrder !== false;
  $('#transition-max-heavy').value = String(clampNumber(state.settings.transitionMaxHeavyInRow, 0, 8, DEFAULT_TRANSITION_SETTINGS.transitionMaxHeavyInRow));
  $('#quality-auto-adjust').checked = state.settings.qualityAutoAdjust !== false;
  $('#show-transition-fps').checked = !!state.settings.showFps;
  $('#resume-on-load').checked = !!state.settings.resumeOnLoad;
  $('#auto-verify').checked = !!state.settings.autoVerifyOnStartup;
  syncTransitionPickerRows();
  syncAnalyticsConsentControl();
  syncIpfsControls();
  syncMasterVolumeUI();
  updateVolumeLabels();
  updateTransitionControlLabels();
  updateTransitionFpsHud();
  applyThemeMode(themeMode);
  refreshExperienceMetadataFromState();
}

function renderExperiencePicker() {
  const select = $('#experience-select');
  if (!select) return;
  const records = sortExperienceRecords(state.experiences);
  const activeId = state.activeExperienceId;

  select.innerHTML = '';
  select.disabled = records.length === 0;
  if (!records.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No experiences';
    select.appendChild(empty);
    select.value = '';
    return;
  }

  for (const record of records) {
    const option = document.createElement('option');
    option.value = record.id;
    option.textContent = experienceRecordName(record);
    select.appendChild(option);
  }

  const activeRecord = records.find(record => record.id === activeId) || records[0];
  select.value = activeRecord.id;
}

async function commitExperienceInputValue(rawValue) {
  const current = currentExperienceRecord();
  if (!current) return null;
  const normalized = normalizeExperienceName(rawValue);
  const matching = findExperienceByName(normalized, current.id);
  if (matching) {
    if (matching.id !== state.activeExperienceId) {
      await switchExperienceById(matching.id);
    } else {
      syncExperienceControls();
      renderExperiencePicker();
    }
    return matching;
  }

  const nextName = ensureUniqueExperienceName(normalized, current.id);
  if (nextName !== state.projectName) {
    state.projectName = nextName;
    updateExperienceCatalog(serializeActiveExperience(current));
    syncExperienceControls();
    renderExperiencePicker();
    saveStateDebounced();
  } else {
    syncExperienceControls();
    renderExperiencePicker();
  }
  return current;
}

function updateExperienceCatalog(record) {
  const idx = state.experiences.findIndex(exp => exp.id === record.id);
  if (idx >= 0) state.experiences[idx] = record;
  else state.experiences.push(record);
  state.experiences = sortExperienceRecords(state.experiences);
  renderExperiencePicker();
}

function serializeActiveExperience(existing = null) {
  const payload = experienceSnapshotFromState();
  const current = existing || currentExperienceRecord();
  return makeExperienceRecord(payload, {
    id: current?.id || state.activeExperienceId || `exp-${uid()}`,
    name: state.projectName,
    createdAt: current?.createdAt,
    updatedAt: new Date().toISOString()
  });
}

function applyExperienceSnapshot(snapshot, opts = {}) {
  const normalized = normalizeExperienceSnapshot(snapshot);

  log.info('[experience] applying snapshot', {
    projectName: normalized.projectName,
    playlistCount: normalized.playlist.length,
    slideshowCount: normalized.slideshow.length,
    activeList: normalized.ui.activeList,
    preservePlaybackState: !!opts.preservePlaybackState
  });

  state.projectName = normalized.projectName;
  state.settings = createDefaultSettings(normalized.settings);
  state.settings.experiencePlaybackMode = normalizeExperiencePlaybackMode(state.settings.experiencePlaybackMode);
  state.settings.loopExperienceCatalog = !!state.settings.loopExperienceCatalog;
  applyNormalizedTransitionSettings(state.settings);
  state.playlist = normalized.playlist;
  state.slideshow = normalized.slideshow;
  state.listMeta = {
    playlist: normalized.listMeta.playlist,
    slideshow: normalized.listMeta.slideshow
  };
  state.runtime = {
    playlistIndex: normalized.runtime.playlistIndex,
    slideshowIndex: normalized.runtime.slideshowIndex,
    isPlaying: !!opts.preservePlaybackState && !!normalized.runtime.isPlaying,
    historyPlaylist: normalized.runtime.historyPlaylist.slice(),
    historySlideshow: normalized.runtime.historySlideshow.slice()
  };
  state.ui.selectedLibrary.clear();
  state.ui.lastSelectedLibraryId = null;

  setActiveList(normalized.ui.activeList);
  syncExperienceControls();
  setBlend(state.settings.opacity ?? DEFAULT_SETTINGS.opacity);
  applyVolumes();
  renderExperiencePicker();
  refreshLibraryRows();
  updateHUD();
  activateExperienceContext(buildProjectContext(), { trackVirtualPage: false, trigger: 'experience_snapshot' });

  log.info('[experience] snapshot applied', experienceDebugContext({
    sourcePlaylistCount: normalized.playlist.length,
    sourceSlideshowCount: normalized.slideshow.length,
    sourceActiveList: normalized.ui.activeList,
    runtimePlaylistIndex: state.runtime.playlistIndex,
    runtimeSlideshowIndex: state.runtime.slideshowIndex
  }));
}

async function saveStateNow() {
  if (!db || browserStorageResetting) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    // library (store handles + meta)
    for (const [id, item] of state.library.entries()) {
      const isTransient = !!item.handle?.transient;
      const sourceUrl = item.sourceUrl || item.handle?.sourceUrl || null;
      await idbPut('library', {
        id,
        handle: isTransient ? null : item.handle,
        file: isTransient ? item.handle.file : undefined,
        transient: isTransient,
        name: item.name,
        size: item.size,
        type: item.type,
        duration: item.duration,
        pathHint: item.pathHint,
        sourceUrl,
        directoryId: item.directoryId,
        metadata: item.metadata,
        addedAt: item.addedAt || Date.now(),
        lastVerified: item.lastVerified || Date.now(),
        stale: !!item.stale
      });
    }
    const liveIds = new Set(state.library.keys());
    for (const rec of await idbGetAll('library')) {
      if (!liveIds.has(rec.id)) await idbDelete('library', rec.id);
    }

    for (const [id, item] of state.directoryHandles.entries()) {
      await idbPut('dirHandles', {
        id,
        handle: item.handle,
        name: item.name,
        addedAt: item.addedAt || Date.now()
      });
    }

    const existing = currentExperienceRecord();
    const activeRecord = serializeActiveExperience(existing);
    if (!state.activeExperienceId) setActiveExperienceId(activeRecord.id);
    await idbPut(EXPERIENCE_STORE, activeRecord);
    updateExperienceCatalog(activeRecord);

    await idbPut('playlist', { key: 'default', items: state.playlist, mode: state.settings.playbackModePlaylist, index: state.runtime.playlistIndex, meta: state.listMeta.playlist });
    await idbPut('slideshow', { key: 'default', items: state.slideshow, mode: state.settings.playbackModeSlideshow, index: state.runtime.slideshowIndex, meta: state.listMeta.slideshow });
    await idbPut('settings', { key: 'global', ...state.settings, projectName: state.projectName, opacity: state.settings.opacity });

    // prune removed library items (optional, keep simple)
  } catch (e) { log.error('save failed', e); }
}

async function hydrateState() {
  if (!db) await openDB();

  // library
  const libItems = await idbGetAll('library');
      state.library.clear();
      for (const rec of libItems) {
        const handle = rec.handle || (rec.file ? transientHandleFromFile(rec.file, {
          sourceUrl: rec.sourceUrl || null,
          name: rec.name || basenameFromPath(rec.pathHint) || rec.id
        }) : null);
        if (!rec?.id) continue;
        const sourceUrl = isPortableRemoteRef(rec.sourceUrl || '', { allowSupabaseBucketPath: true }) ? sanitizeImportPath(rec.sourceUrl) : null;
        state.library.set(rec.id, {
          id: rec.id,
          handle: handle || null,
          name: rec.name || basenameFromPath(rec.pathHint) || rec.id,
          size: Number.isFinite(rec.size) ? rec.size : 0,
          type: rec.type || getMediaType(rec.name || rec.pathHint || '') || 'image',
          duration: rec.duration,
          pathHint: sanitizeImportPath(rec.pathHint || rec.path || rec.fullPath || rec.name) || fallbackRelativePath(rec.name || rec.id),
          sourceUrl,
          directoryId: rec.directoryId,
          metadata: rec.metadata,
          addedAt: rec.addedAt || rec.lastVerified || Date.now(),
          lastVerified: rec.lastVerified || rec.addedAt || Date.now(),
          stale: rec.stale || !handle
        });
      }

  state.directoryHandles.clear();
  for (const rec of await idbGetAll('dirHandles')) {
    if (rec.handle) state.directoryHandles.set(rec.id, rec);
  }

  const records = await idbGetAll(EXPERIENCE_STORE);
  state.experiences = sortExperienceRecords(records.map(rec => ({
    ...rec,
    payload: normalizeExperienceSnapshot(rec.payload || rec.snapshot || rec.data || {})
  })));

  let activeRecord = null;
  const savedActiveId = localStorage.getItem(EXPERIENCE_ACTIVE_KEY);
  if (state.experiences.length) {
    activeRecord = state.experiences.find(rec => rec.id === savedActiveId) || state.experiences[0];
  }

  if (!activeRecord) {
    const legacySettings = await idbGet('settings', 'global');
    const legacyPlaylist = await idbGet('playlist', 'default');
    const legacySlideshow = await idbGet('slideshow', 'default');
    const legacySnapshot = {
      projectName: legacySettings?.projectName || DEFAULT_EXPERIENCE_NAME,
      settings: createDefaultSettings(legacySettings || {}),
      playlist: legacyPlaylist?.items || [],
      slideshow: legacySlideshow?.items || [],
      listMeta: {
        playlist: normalizeListMeta('playlist', legacyPlaylist?.meta),
        slideshow: normalizeListMeta('slideshow', legacySlideshow?.meta)
      },
      runtime: {
        playlistIndex: legacyPlaylist?.index || 0,
        slideshowIndex: legacySlideshow?.index || 0,
        isPlaying: false,
        historyPlaylist: [],
        historySlideshow: []
      },
      ui: { activeList: 'playlist' }
    };
    applyExperienceSnapshot(legacySnapshot);
    activeRecord = makeExperienceRecord(legacySnapshot, {
      id: `exp-${uid()}`,
      name: state.projectName,
      uniqueName: true
    });
    state.experiences = [activeRecord];
    await idbPut(EXPERIENCE_STORE, activeRecord);
    setActiveExperienceId(activeRecord.id);
  } else {
    setActiveExperienceId(activeRecord.id);
    applyExperienceSnapshot(activeRecord.payload || activeRecord, { preservePlaybackState: false });
  }

  syncExperienceControls();
  renderExperiencePicker();
  refreshExperienceMetadataFromState();
}

async function verifyLibraryHandles() {
  if (!state.settings.autoVerifyOnStartup) return;
  let changed = false;
  for (const [id, item] of state.library) {
    try {
      if (!item.handle || typeof item.handle.queryPermission !== 'function') {
        item.stale = true;
        changed = true;
        continue;
      }
      const perm = await item.handle.queryPermission({ mode: 'read' });
      if (perm === 'granted' || perm === 'prompt') {
        const file = await item.handle.getFile();
        item.size = file.size;
        item.stale = false;
        item.lastVerified = Date.now();
        // refresh duration for video/audio if missing (lightweight)
        if ((item.type === 'video' || item.type === 'audio') && !item.duration) {
          // duration will be populated on first play or can be done async
        }
      } else {
        item.stale = true;
      }
    } catch (e) {
      item.stale = true;
    }
    changed = true;
  }
  if (changed) {
    await saveStateNow();
    renderLibrary();
  }
}

// ====================== MEDIA LIBRARY ======================
function transientHandleFromFile(file, extras = {}) {
  const name = String(extras.name || file?.name || 'media').trim() || 'media';
  return {
    kind: 'file',
    name,
    transient: true,
    file,
    sourceUrl: extras.sourceUrl || null,
    getFile: async () => file,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted'
  };
}

function contentTypeToMediaType(contentType = '') {
  const normalized = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (!normalized) return null;
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.startsWith('image/')) return 'image';
  return null;
}

function contentTypeToExtension(contentType = '') {
  const normalized = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (normalized === 'video/quicktime') return 'mov';
  if (normalized === 'video/mp4') return 'mp4';
  if (normalized === 'video/webm') return 'webm';
  if (normalized === 'video/ogg') return 'ogv';
  if (normalized === 'audio/mpeg') return 'mp3';
  if (normalized === 'audio/mp4') return 'm4a';
  if (normalized === 'audio/wav') return 'wav';
  if (normalized === 'audio/ogg') return 'ogg';
  if (normalized === 'audio/flac') return 'flac';
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/jfif') return 'jfif';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/bmp' || normalized === 'image/x-ms-bmp') return 'bmp';
  if (normalized === 'image/apng') return 'apng';
  if (normalized === 'image/x-icon' || normalized === 'image/vnd.microsoft.icon') return 'ico';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/svg+xml') return 'svg';
  if (normalized === 'image/avif') return 'avif';
  if (normalized === 'image/heic') return 'heic';
  if (normalized === 'image/heif') return 'heif';
  return '';
}

function deriveFilenameFromUrl(url, contentType = '') {
  try {
    const parsed = new URL(String(url));
    const base = basenameFromPath(parsed.pathname || '');
    if (base && getMediaType(base)) return base;
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) return base;
    const ext = contentTypeToExtension(contentType);
    return `${base || 'remote-media'}${ext ? `.${ext}` : ''}`;
  } catch (_) {
    const ext = contentTypeToExtension(contentType);
    return `remote-media${ext ? `.${ext}` : ''}`;
  }
}

function blobToFile(blob, name, type = '') {
  const mime = type || blob?.type || '';
  if (typeof File === 'function') {
    return new File([blob], name, { type: mime });
  }
  const copy = blob.slice(0, blob.size, mime);
  try { copy.name = name; } catch (_) {}
  return copy;
}

async function fetchRemoteMedia(url) {
  const normalized = sanitizeImportPath(url);
  if (!isRemoteUrl(normalized)) throw new Error('Please enter an http(s) URL');
  const response = await fetch(normalized, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const blob = await response.blob();
  const contentType = String(response.headers.get('content-type') || blob.type || '').toLowerCase();
  const name = deriveFilenameFromUrl(normalized, contentType);
  const type = getMediaType(name) || contentTypeToMediaType(contentType);
  if (!type) throw new Error('URL does not point to supported media');
  const file = blobToFile(blob, name, contentType || getMediaMime(name, blob));
  const handle = transientHandleFromFile(file, { sourceUrl: normalized, name });
  handle.sourceUrl = normalized;
  handle.remote = true;
  return { handle, file, name, type, size: file.size, sourceUrl: normalized, contentType };
}

function remoteHandleFromUrl(url, name = '') {
  return {
    kind: 'file',
    name: name || deriveFilenameFromUrl(url),
    transient: true,
    remote: true,
    sourceUrl: url,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted'
  };
}

async function resolveIncomingMediaReference(input, meta = {}) {
  const normalized = sanitizeImportPath(input);
  if (!normalized || !isPortableRemoteRef(normalized, { allowSupabaseBucketPath: true })) {
    throw new Error('Please enter an http(s), supabase://, or ipfs:// media reference');
  }
  if (isRemoteUrl(normalized)) {
    return {
      sourceReference: normalized,
      playableUrl: normalized,
      bucket: '',
      path: '',
      signed: false
    };
  }
  const resolved = await storageUrlResolver.resolve(normalized, {
    defaultBucket: state.settings.storageDefaultBucket || RUNTIME_CONFIG.defaultBucket,
    signedUrlTtlSeconds: state.settings.storageSignedUrlTtlSeconds || RUNTIME_CONFIG.signedUrlTtlSeconds
  });
  return {
    sourceReference: normalized,
    playableUrl: sanitizeImportPath(resolved.url || ''),
    bucket: resolved.bucket || '',
    path: resolved.path || '',
    signed: !!resolved.signed,
    expiresAt: resolved.expiresAt || 0
  };
}

async function ensureRemoteUrlInLibrary(url, meta = {}) {
  const incoming = await resolveIncomingMediaReference(url, meta);
  const normalized = incoming.playableUrl;
  const sourceReference = incoming.sourceReference;
  const existing = Array.from(state.library.values()).find(item => {
    const existingSource = sanitizeImportPath(item.metadata?.storageReference || '');
    if (existingSource && existingSource === sourceReference) return true;
    return sanitizeImportPath(item.sourceUrl || item.pathHint || '') === normalized;
  });
  if (existing) {
    existing.name = existing.name || meta.name || deriveFilenameFromUrl(normalized || sourceReference);
    existing.type = existing.type || meta.type || getMediaType(existing.name || normalized) || contentTypeToMediaType(meta.metadata?.contentType || '');
    existing.pathHint = sourceReference || normalized;
    existing.sourceUrl = normalized;
    existing.handle = existing.handle || remoteHandleFromUrl(normalized, existing.name);
    existing.handle.remote = true;
    existing.handle.sourceUrl = normalized;
    existing.stale = false;
    existing.metadata = {
      ...(existing.metadata || {}),
      ...(meta.metadata && typeof meta.metadata === 'object' ? meta.metadata : {}),
      sourceUrl: normalized,
      storageReference: sourceReference || normalized,
      ...(incoming.bucket ? { storageBucket: incoming.bucket } : {}),
      ...(incoming.path ? { storagePath: incoming.path } : {}),
      ...(incoming.expiresAt ? { signedUrlExpiresAt: incoming.expiresAt } : {})
    };
    return { id: existing.id, status: 'existing', item: existing, sourceUrl: normalized };
  }

  const name = normalizeExperienceName(meta.name || deriveFilenameFromUrl(normalized || sourceReference) || basenameFromPath(normalized || sourceReference) || 'remote-media');
  const type = ['video', 'audio', 'image'].includes(meta.type)
    ? meta.type
    : getMediaType(name || normalized) || contentTypeToMediaType(meta.metadata?.contentType || '');
  if (!type) throw new Error('URL does not point to supported media');
  const id = String(meta.id || uid());
  const item = {
    id,
    handle: remoteHandleFromUrl(normalized, name),
    name,
    size: Number(meta.size) || 0,
    type,
    duration: Number.isFinite(Number(meta.duration)) ? Number(meta.duration) : null,
    pathHint: sourceReference || normalized,
    sourceUrl: normalized,
    metadata: {
      ...(meta.metadata && typeof meta.metadata === 'object' ? meta.metadata : {}),
      sourceUrl: normalized,
      storageReference: sourceReference || normalized,
      ...(incoming.bucket ? { storageBucket: incoming.bucket } : {}),
      ...(incoming.path ? { storagePath: incoming.path } : {}),
      ...(incoming.expiresAt ? { signedUrlExpiresAt: incoming.expiresAt } : {})
    },
    addedAt: meta.addedAt || Date.now(),
    lastVerified: Date.now(),
    stale: false,
    importedFromExperience: !!meta.importedFromExperience
  };
  item.handle.remote = true;
  state.library.set(id, item);
  return { id, status: 'added', item, sourceUrl: normalized };
}

async function addRemoteMediaUrl(url, meta = {}) {
  const normalized = sanitizeImportPath(url);
  if (!normalized || !isPortableRemoteRef(normalized, { allowSupabaseBucketPath: true })) {
    throw new Error('Please enter an http(s), supabase://, or ipfs:// media reference');
  }

  const existing = Array.from(state.library.values()).find(item => {
    const ref = sanitizeImportPath(item.metadata?.storageReference || '');
    return ref === normalized || sanitizeImportPath(item.sourceUrl || '') === normalized;
  });
  if (existing && existing.handle && !existing.stale) return { id: existing.id, status: 'existing', item: existing };
  return await ensureRemoteUrlInLibrary(normalized, meta);
}

function inputAcceptForMedia() {
  return [
    ...MEDIA_TYPES.video.map(ext => '.' + ext),
    ...MEDIA_TYPES.audio.map(ext => '.' + ext),
    ...MEDIA_TYPES.image.map(ext => '.' + ext)
  ].join(',');
}

function pickFilesWithInput({ directory = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = inputAcceptForMedia();
    if (directory) {
      input.webkitdirectory = true;
      input.directory = true;
    }
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.onchange = () => {
      const handles = Array.from(input.files || [])
        .filter(file => getMediaType(file.name))
        .map(file => {
          const handle = transientHandleFromFile(file);
          handle.pathHint = file.webkitRelativePath || file.name;
          return handle;
        });
      input.remove();
      resolve(handles);
    };
    input.oncancel = () => {
      input.remove();
      resolve([]);
    };
    input.click();
  });
}

async function addFilesFromPicker() {
  try {
    if (typeof window.showOpenFilePicker !== 'function') {
      const handles = await pickFilesWithInput();
      if (handles.length) await addHandles(handles);
      else showToast('No media files selected', { timeout: 1800 });
      return;
    }
    const handles = await window.showOpenFilePicker({ multiple: true, types: MEDIA_PICKER_TYPES });
    await addHandles(handles);
  } catch (e) {
    if (e.name === 'TypeError') {
      try {
        const handles = typeof window.showOpenFilePicker === 'function'
          ? await window.showOpenFilePicker({ multiple: true })
          : await pickFilesWithInput();
        await addHandles(handles);
        return;
      } catch (fallbackError) {
        if (fallbackError.name !== 'AbortError') showToast('File picker error');
      }
    } else if (e.name !== 'AbortError') showToast('File picker error');
  }
}

async function addFolderFromPicker() {
  try {
    if (typeof window.showDirectoryPicker !== 'function') {
      const handles = await pickFilesWithInput({ directory: true });
      const result = await addHandles(handles, { directoryId: null });
      if (result.added || result.existing) {
        showToast(`Added ${result.added} item${result.added === 1 ? '' : 's'} from selected folder (${result.existing} already present)`);
      } else {
        showToast('No supported media found in that folder', { timeout: 2400 });
      }
      return;
    }
    const dirHandle = await window.showDirectoryPicker();
    const progress = showToast(`Scanning "${dirHandle.name}"... 0 files found`, { timeout: 0 });
    const handles = await walkDirectoryForMedia(dirHandle, {
      onProgress: count => { progress.label.textContent = `Scanning "${dirHandle.name}"... ${count} files found`; }
    });
    progress.close();
    const directoryId = rememberDirectoryHandle(dirHandle);
    const result = await addHandles(handles, { directoryId });
    showToast(`Added ${result.added} item${result.added === 1 ? '' : 's'} from "${dirHandle.name}" (${result.existing} already present)`);
  } catch (e) { if (e.name !== 'AbortError') showToast('Folder picker cancelled or blocked'); }
}

function rememberDirectoryHandle(handle) {
  for (const existing of state.directoryHandles.values()) {
    if (existing.name === handle.name) return existing.id;
  }
  const id = 'dir-' + uid();
  state.directoryHandles.set(id, { id, handle, name: handle.name, addedAt: Date.now() });
  return id;
}

async function walkDirectoryForMedia(dirHandle, opts = {}) {
  const maxDepth = opts.maxDepth ?? MAX_FOLDER_DEPTH;
  const queue = [{ handle: dirHandle, depth: 0, path: dirHandle.name || '' }];
  const handles = [];
  let scanned = 0;

  while (queue.length) {
    const { handle, depth, path } = queue.shift();
    try {
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          if (getMediaType(entry.name)) {
            try { entry.pathHint = path ? `${path}/${entry.name}` : entry.name; } catch (_) {}
            handles.push(entry);
          }
        } else if (entry.kind === 'directory' && depth < maxDepth) {
          queue.push({ handle: entry, depth: depth + 1, path: path ? `${path}/${entry.name}` : entry.name });
        }
        scanned++;
        if (scanned % 24 === 0) {
          opts.onProgress?.(handles.length);
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }
    } catch (e) {
      log.warn('Directory scan skipped a branch', e);
    }
  }
  opts.onProgress?.(handles.length);
  return handles;
}

async function ensureHandleInLibrary(handle, meta = {}) {
  const name = handle.name;
  const type = getMediaType(name);
  if (!type) return { id: null, status: 'skipped' };
  const sourceUrl = sanitizeImportPath(meta.sourceUrl || handle.sourceUrl || '');

  let size = meta.size || 0;
  try {
    if (!size) {
      const f = await handle.getFile();
      size = f.size;
    }
  } catch (_) {}

  for (const [id, it] of state.library) {
    const sameName = it.name === name;
    const sameSize = !size || !it.size || it.size === size;
    const sameSource = sourceUrl && sanitizeImportPath(it.sourceUrl || '') === sourceUrl;
    if ((sameSource || (!sourceUrl && sameName)) && sameSize) {
      const existingPathHint = sanitizeImportPath(meta.pathHint || handle.pathHint || '');
      if (existingPathHint && !it.pathHint) it.pathHint = existingPathHint;
      if (sourceUrl && !it.sourceUrl) it.sourceUrl = sourceUrl;
      if (meta.metadata && typeof meta.metadata === 'object') it.metadata = { ...(it.metadata || {}), ...meta.metadata };
      if (!it.handle || it.stale) {
        it.handle = handle;
        it.size = size || it.size || 0;
        it.type = type || it.type;
        it.stale = false;
        it.lastVerified = Date.now();
      }
      return { id, status: 'existing' };
    }
  }

  const id = uid();
  const pathHint = sanitizeImportPath(meta.pathHint || handle.pathHint || '') || fallbackRelativePath(name);
  state.library.set(id, {
    id,
    handle,
    name,
    size,
    type,
    duration: meta.duration ?? null,
    pathHint,
    sourceUrl: sourceUrl || null,
    directoryId: meta.directoryId,
    metadata: meta.metadata && typeof meta.metadata === 'object' ? meta.metadata : undefined,
    addedAt: meta.addedAt || Date.now(),
    lastVerified: Date.now(),
    stale: false
  });
  return { id, status: 'added' };
}

async function addHandles(handles, meta = {}) {
  let added = 0, existing = 0, skipped = 0;
  const ids = [];
  for (const h of handles) {
    const result = await ensureHandleInLibrary(h, { ...meta, pathHint: meta.pathHint || h.pathHint });
    if (result.id) ids.push(result.id);
    if (result.status === 'added') added++;
    else if (result.status === 'existing') existing++;
    else skipped++;
  }
  renderLibrary();
  await saveStateNow();
  if (added) showToast(`Added ${added} item${added>1?'s':''}${existing || skipped ? ` (${existing + skipped} skipped)` : ''}`);
  return { ids, added, existing, skipped };
}

function ensureLibraryVirtualList() {
  if (libraryVirtualList) return libraryVirtualList;
  libraryVirtualList = new VirtualList($('#library-grid'), {
    itemHeight: PERF.LIBRARY_ROW_HEIGHT,
    overscan: PERF.VIRTUAL_OVERSCAN,
    getKey: index => state.ui.visibleLibraryIds[index],
    renderItem: renderLibraryRow,
    cleanupRow: releaseThumbnailElement
  });
  return libraryVirtualList;
}

function libraryEmptyMessage() {
  const hasLibrary = state.library.size > 0;
  const label = hasLibrary ? 'No matching media' : 'Add media files to begin';
  return `<div class="empty" role="status">${label}</div>`;
}

function renderLibrary() {
  const q = state.ui.search.toLowerCase();
  const filter = state.ui.currentFilter;
  const sourceFilter = state.ui.currentSourceFilter || 'all';
  const jobId = ++activeLibraryProjectionJob;
  const grid = $('#library-grid');
  grid.setAttribute('aria-busy', 'true');

  if (state.library.size >= PERF.WORKER_THRESHOLD && typeof Worker !== 'undefined') {
    projectLibraryInWorker(q, filter, sourceFilter, jobId)
      .then(ids => {
        if (jobId === activeLibraryProjectionJob) applyLibraryProjection(ids);
      })
      .catch(() => {
        if (jobId === activeLibraryProjectionJob) {
          applyLibraryProjection(getVisibleLibraryEntries(q, filter, sourceFilter).map(([id]) => id));
        }
      });
    return;
  }

  applyLibraryProjection(getVisibleLibraryEntries(q, filter, sourceFilter).map(([id]) => id));
}

function applyLibraryProjection(ids) {
  const grid = $('#library-grid');
  grid.setAttribute('aria-busy', 'false');
  state.ui.visibleLibraryIds = ids;
  $('#lib-count').textContent = `(${ids.length})`;
  updateSelectedToolbar();

  if (!ids.length) {
    ensureLibraryVirtualList().clear(libraryEmptyMessage());
    return;
  }

  const virtualList = ensureLibraryVirtualList();
  virtualList.setCount(ids.length);
  virtualList.refresh();
}

function renderLibraryRow(index, row) {
  const id = state.ui.visibleLibraryIds[index];
  const item = state.library.get(id);
  if (!item) return row || document.createElement('div');

  row = row || document.createElement('div');
  const selected = state.ui.selectedLibrary.has(id);
  const path = bestPathForItem(item);
  const signature = `${id}|${item.name}|${path}|${item.size}|${item.type}|${item.stale ? 1 : 0}`;

  row.className = `lib-card virtual-row ${item.stale ? 'stale' : ''} ${selected ? 'selected' : ''}`;
  row.dataset.id = id;
  row.dataset.idx = index;
  row.tabIndex = 0;
  row.draggable = true;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', selected ? 'true' : 'false');
  row.setAttribute('aria-posinset', String(index + 1));
  row.setAttribute('aria-setsize', String(state.ui.visibleLibraryIds.length));
  row.setAttribute('aria-label', `${item.name}, ${item.type}, ${formatBytes(item.size)}`);

  if (row.dataset.signature !== signature) {
    releaseThumbnailElement(row);
    row.innerHTML = `
      <span class="drag" aria-hidden="true">≡</span>
      <div class="thumb"></div>
      <div class="meta">
        <div class="name" title="${escapeHtml(path)}">${escapeHtml(item.name)}</div>
        <div class="sub">${escapeHtml(path)} • ${formatBytes(item.size)}</div>
      </div>
      <div class="badge">${item.type}</div>
    `;
    row.dataset.signature = signature;
  }

  requestThumbnailForElement(row.querySelector('.thumb'), item);
  return row;
}

function refreshLibraryRows() {
  if (libraryVirtualList && state.ui.visibleLibraryIds.length) libraryVirtualList.refresh();
  updateSelectedToolbar();
}

function wireLibraryGridEvents() {
  const grid = $('#library-grid');
  if (grid.dataset.eventsWired === 'true') return;
  grid.dataset.eventsWired = 'true';

  grid.addEventListener('click', event => {
    const card = event.target.closest('.lib-card');
    if (!card) return;
    selectLibraryItem(card.dataset.id, event);
  });

  grid.addEventListener('keydown', event => {
    const card = event.target.closest('.lib-card');
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const ids = state.ui.selectedLibrary.size ? Array.from(state.ui.selectedLibrary) : (card ? [card.dataset.id] : []);
      if (ids.length) deleteLibraryItems(ids, { save: true });
      return;
    }
    if (!card || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    selectLibraryItem(card.dataset.id, event);
  });

  grid.addEventListener('dblclick', event => {
    const card = event.target.closest('.lib-card');
    if (!card) return;
    addToList(state.ui.activeList, [card.dataset.id]);
  });

  grid.addEventListener('dragstart', event => {
    const card = event.target.closest('.lib-card');
    if (!card) return;
    const id = card.dataset.id;
    const selected = state.ui.selectedLibrary.has(id) && state.ui.selectedLibrary.size
      ? Array.from(state.ui.selectedLibrary)
      : [id];
    event.dataTransfer.setData('text/plain', JSON.stringify({ ids: selected }));
    event.dataTransfer.effectAllowed = 'copy';
  });
}

function makeLibraryProjectionRows() {
  return Array.from(state.library.entries()).map(([id, item]) => ({
    id,
    name: item.name || '',
    path: bestPathForItem(item),
    type: item.type || '',
    sourceKind: libraryItemSourceKind(item),
    size: item.size || 0,
    duration: item.duration || 0,
    metadata: metadataSortValue(item),
    date: item.addedAt || item.lastVerified || 0
  }));
}

function getLibraryProjectionWorker() {
  if (libraryProjectionWorker) return libraryProjectionWorker;
  try {
    const source = `
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      function sortValue(row, key) {
        if (key === 'name') return row.name || '';
        if (key === 'path') return row.path || '';
        if (key === 'size') return row.size || 0;
        if (key === 'type') return row.type || '';
        if (key === 'duration') return row.duration || 0;
        if (key === 'metadata') return row.metadata || '';
        return row.date || 0;
      }
      self.onmessage = event => {
        try {
          const { jobId, rows, search, filter, sourceFilter, sortKey, sortDir } = event.data;
          const q = String(search || '').toLowerCase();
          const mult = sortDir === 'desc' ? -1 : 1;
          const filtered = rows.filter(row => {
            if (filter !== 'all' && row.type !== filter) return false;
            if (sourceFilter === 'local' && row.sourceKind === 'url') return false;
            if (sourceFilter === 'url' && row.sourceKind !== 'url') return false;
            return !q || String(row.name || '').toLowerCase().includes(q) || String(row.path || '').toLowerCase().includes(q);
          });
          filtered.sort((a, b) => {
            const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
            if (av === bv) return 0;
            if (typeof av === 'string' || typeof bv === 'string') return collator.compare(String(av), String(bv)) * mult;
            return (av - bv) * mult;
          });
          self.postMessage({ jobId, ids: filtered.map(row => row.id) });
        } catch (error) {
          self.postMessage({ jobId: event.data && event.data.jobId, error: error && error.message || 'worker failed' });
        }
      };
    `;
    libraryProjectionWorkerUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    libraryProjectionWorker = new Worker(libraryProjectionWorkerUrl);
    libraryProjectionWorker.onmessage = event => {
      const { jobId, ids, error } = event.data || {};
      const resolver = libraryProjectionResolvers.get(jobId);
      if (!resolver) return;
      libraryProjectionResolvers.delete(jobId);
      error ? resolver.reject(new Error(error)) : resolver.resolve(ids || []);
    };
    libraryProjectionWorker.onerror = error => {
      for (const [, resolver] of libraryProjectionResolvers) resolver.reject(error);
      libraryProjectionResolvers.clear();
    };
  } catch (e) {
      log.warn('Projection worker unavailable', e);
    libraryProjectionWorker = null;
  }
  return libraryProjectionWorker;
}

function projectLibraryInWorker(search, filter, sourceFilter, jobId) {
  const worker = getLibraryProjectionWorker();
  if (!worker) return Promise.reject(new Error('No worker'));
  const rows = makeLibraryProjectionRows();
  return new Promise((resolve, reject) => {
    libraryProjectionResolvers.set(jobId, { resolve, reject });
    worker.postMessage({
      jobId,
      rows,
      search,
      filter,
      sourceFilter: sourceFilter || 'all',
      sortKey: state.settings.librarySortKey || 'date',
      sortDir: state.settings.librarySortDir || 'asc'
    });
  });
}

function getVisibleLibraryEntries(
  q = state.ui.search.toLowerCase(),
  filter = state.ui.currentFilter,
  sourceFilter = state.ui.currentSourceFilter
) {
  const entries = Array.from(state.library.entries()).filter(([, item]) => {
    if (filter !== 'all' && item.type !== filter) return false;
    const sourceKind = libraryItemSourceKind(item);
    if (sourceFilter === 'local' && sourceKind === 'url') return false;
    if (sourceFilter === 'url' && sourceKind !== 'url') return false;
    return !(q && !item.name.toLowerCase().includes(q) && !(item.pathHint || '').toLowerCase().includes(q));
  });
  return sortLibraryEntries(entries);
}

function sortLibraryEntries(entries) {
  const key = state.settings.librarySortKey || 'date';
  const dir = state.settings.librarySortDir || 'asc';
  const mult = dir === 'desc' ? -1 : 1;
  const value = ([, item]) => {
    if (key === 'name') return (item.name || '').toLocaleLowerCase();
    if (key === 'path') return bestPathForItem(item).toLocaleLowerCase();
    if (key === 'size') return item.size || 0;
    if (key === 'type') return item.type || '';
    if (key === 'duration') return item.duration || 0;
    if (key === 'metadata') return metadataSortValue(item);
    return item.addedAt || item.lastVerified || 0;
  };
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => {
    const av = value(a.entry), bv = value(b.entry);
    if (av === bv) return a.index - b.index;
    if (typeof av === 'string') return av.localeCompare(String(bv)) * mult;
    return (av - bv) * mult;
  }).map(row => row.entry);
}

function selectLibraryItem(id, event = {}) {
  const visible = state.ui.visibleLibraryIds.length ? state.ui.visibleLibraryIds : getVisibleLibraryEntries().map(([entryId]) => entryId);
  const additive = !!(event.ctrlKey || event.metaKey);
  if (event.shiftKey && state.ui.lastSelectedLibraryId && visible.includes(state.ui.lastSelectedLibraryId)) {
    const a = visible.indexOf(state.ui.lastSelectedLibraryId);
    const b = visible.indexOf(id);
    const [start, end] = a < b ? [a, b] : [b, a];
    if (!additive) state.ui.selectedLibrary.clear();
    visible.slice(start, end + 1).forEach(rangeId => state.ui.selectedLibrary.add(rangeId));
  } else if (additive) {
    if (state.ui.selectedLibrary.has(id)) state.ui.selectedLibrary.delete(id);
    else state.ui.selectedLibrary.add(id);
    state.ui.lastSelectedLibraryId = id;
  } else {
    state.ui.selectedLibrary.clear();
    state.ui.selectedLibrary.add(id);
    state.ui.lastSelectedLibraryId = id;
  }
  refreshLibraryRows();
}

function updateSelectedToolbar() {
  const n = state.ui.selectedLibrary.size;
  const pl = $('#add-selected-playlist');
  const ss = $('#add-selected-slideshow');
  const del = $('#remove-selected-library');
  if (pl) {
    pl.textContent = n ? `Add Selected (${n}) → Playlist` : 'Add Selected → Playlist';
    pl.disabled = n === 0;
  }
  if (ss) {
    ss.textContent = n ? `Add Selected (${n}) → Slideshow` : 'Add Selected → Slideshow';
    ss.disabled = n === 0;
  }
  if (del) {
    del.textContent = n ? `Remove Selected (${n})` : 'Remove Selected';
    del.disabled = n === 0;
  }
}

function pruneListRefs(list, removedIds) {
  const removed = removedIds instanceof Set ? removedIds : new Set(removedIds || []);
  return (list || []).filter(ref => ref?.id && !removed.has(ref.id));
}

async function deleteLibraryItems(ids = [], opts = {}) {
  const removedIds = new Set((ids || []).map(id => String(id)).filter(Boolean));
  if (!removedIds.size) return { removed: 0, affectedExperiences: 0 };

  let affectedExperiences = 0;
  for (const exp of state.experiences) {
    const payload = exp.payload || {};
    const nextPlaylist = pruneListRefs(payload.playlist, removedIds);
    const nextSlideshow = pruneListRefs(payload.slideshow, removedIds);
    const changed = nextPlaylist.length !== (payload.playlist || []).length || nextSlideshow.length !== (payload.slideshow || []).length;
    if (!changed) continue;
    exp.payload = {
      ...payload,
      playlist: nextPlaylist,
      slideshow: nextSlideshow
    };
    exp.updatedAt = new Date().toISOString();
    await idbPut(EXPERIENCE_STORE, exp);
    affectedExperiences++;
  }

  let removed = 0;
  for (const id of removedIds) {
    if (state.library.delete(id)) removed++;
  }

  state.playlist = pruneListRefs(state.playlist, removedIds);
  state.slideshow = pruneListRefs(state.slideshow, removedIds);
  state.runtime.playlistIndex = clampExperienceIndex(state.runtime.playlistIndex, state.playlist.length);
  state.runtime.slideshowIndex = clampExperienceIndex(state.runtime.slideshowIndex, state.slideshow.length);
  state.ui.selectedLibrary = new Set(Array.from(state.ui.selectedLibrary).filter(id => !removedIds.has(id)));
  state.ui.lastSelectedLibraryId = state.ui.selectedLibrary.size ? state.ui.lastSelectedLibraryId : null;
  state.experiences = sortExperienceRecords(state.experiences);

  renderLibrary();
  renderListEditor();
  renderExperiencePicker();
  updateHUD();

  if (opts.save !== false) await saveStateNow();
  return { removed, affectedExperiences };
}

function clearLibraryView() {
  // Keep items referenced by any saved experience, not just the active one.
  const used = new Set();
  const addIds = list => {
    for (const ref of list || []) {
      if (ref?.id) used.add(ref.id);
    }
  };
  for (const exp of state.experiences) {
    const payload = exp.payload || {};
    addIds(payload.playlist);
    addIds(payload.slideshow);
  }
  addIds(state.playlist);
  addIds(state.slideshow);
  const removable = Array.from(state.library.keys()).filter(id => !used.has(id));
  state.ui.selectedLibrary.clear();
  return deleteLibraryItems(removable, { save: true });
}

function removeSelectedLibraryItems() {
  return deleteLibraryItems(Array.from(state.ui.selectedLibrary), { save: true });
}

async function removeStale() {
  let removed = 0;
  for (const [id, item] of [...state.library]) {
    if (item.stale) {
      state.library.delete(id);
      removed++;
    }
  }
  if (removed) {
    renderLibrary();
    await saveStateNow();
    showToast(`Removed ${removed} stale item(s)`);
  }
}

function filterLibrary(type) {
  state.ui.currentFilter = type;
  $all('.type-pill').forEach(p => p.classList.toggle('active', p.dataset.filter === type));
  $all('.source-pill').forEach(p => p.classList.toggle('active', p.dataset.sourceFilter === state.ui.currentSourceFilter));
  renderLibrary();
}

function filterLibrarySource(sourceKind) {
  state.ui.currentSourceFilter = sourceKind;
  $all('.type-pill').forEach(p => p.classList.toggle('active', p.dataset.filter === state.ui.currentFilter));
  $all('.source-pill').forEach(p => p.classList.toggle('active', p.dataset.sourceFilter === sourceKind));
  renderLibrary();
}

// ====================== LISTS (PLAYLIST / SLIDESHOW) ======================
function setActiveList(which) {
  if (state.ui.activeList !== which) clearListSelection();
  state.ui.activeList = which;
  $all('.segmented button').forEach(b => b.classList.toggle('active', b.dataset.tab === which));
  $all('.segmented button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === which ? 'true' : 'false'));
  renderListEditor();
}

function parseInternalDrag(ev) {
  try { return JSON.parse(ev.dataTransfer.getData('text/plain') || '{}'); }
  catch (_) { return {}; }
}

function dropIndexForRow(row, fromIndex, clientY, which) {
  if (!row) return null;
  const list = which === 'playlist' ? state.playlist : state.slideshow;
  const rowIndex = Number.parseInt(row.dataset.idx, 10);
  if (!Number.isFinite(rowIndex)) return null;
  const rect = row.getBoundingClientRect();
  let insertIndex = clientY <= rect.top + rect.height / 2 ? rowIndex : rowIndex + 1;
  if (Number.isFinite(fromIndex) && fromIndex < insertIndex) insertIndex -= 1;
  return Math.max(0, Math.min(insertIndex, list.length));
}

function wireListDropZone(container, which) {
  container.ondragenter = e => {
    const data = parseInternalDrag(e);
    if (data.reorder && data.list !== which) return;
    e.preventDefault();
    container.classList.add('list-drop-active');
  };
  container.ondragover = e => {
    const data = parseInternalDrag(e);
    if (data.reorder && data.list !== which) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = data.reorder ? 'move' : 'copy';
    container.classList.add('list-drop-active');
    const row = e.target.closest?.('.list-item');
    container.querySelector('.list-item.drop-target')?.classList.remove('drop-target');
    row?.classList.add('drop-target');
  };
  container.ondragleave = e => {
    if (!container.contains(e.relatedTarget)) container.classList.remove('list-drop-active');
    e.target.closest?.('.list-item')?.classList.remove('drop-target');
  };
  container.ondrop = async ev => {
    ev.preventDefault();
    container.classList.remove('list-drop-active');
    container.querySelector('.list-item.drop-target')?.classList.remove('drop-target');
    const row = ev.target.closest?.('.list-item');
    const atIndex = row ? parseInt(row.dataset.idx, 10) : null;
    const data = parseInternalDrag(ev);
    if (row && data.reorder && data.list === which) {
      const dropIndex = dropIndexForRow(row, data.from, ev.clientY, which);
      reorderList(which, data.from, dropIndex);
    } else if (data.reorder) {
      return;
    } else if (row && data.ids) {
      const dropIndex = dropIndexForRow(row, Number.NaN, ev.clientY, which);
      insertIntoListAt(which, data.ids, dropIndex ?? atIndex);
    } else {
      await handleListDrop(ev, which, Number.isInteger(atIndex) ? atIndex : null);
    }
  };
}

async function handleListDrop(ev, which, atIndex = null) {
  const data = parseInternalDrag(ev);
  if (data.reorder) return;
  if (data.ids) {
    if (Number.isInteger(atIndex)) insertIntoListAt(which, data.ids, atIndex);
    else addToList(which, data.ids);
    return;
  }

  const entries = await collectDropEntries(ev.dataTransfer);
  if (!entries.length) return;

  let mediaIds = [];
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      const progress = showToast(`Scanning "${entry.handle.name}"... 0 files found`, { timeout: 0 });
      const handles = await walkDirectoryForMedia(entry.handle, {
        onProgress: count => { progress.label.textContent = `Scanning "${entry.handle.name}"... ${count} files found`; }
      });
      progress.close();
      const directoryId = rememberDirectoryHandle(entry.handle);
      const result = await addHandles(handles, { directoryId });
      mediaIds.push(...result.ids);
    } else if (entry.kind === 'file') {
      const name = entry.handle?.name || entry.file?.name || '';
      if (isListFile(name)) {
        const file = entry.file || await entry.handle.getFile();
        await importListFromFile(file, { which });
      } else if (getMediaType(name) && entry.handle) {
        const result = await addHandles([entry.handle]);
        mediaIds.push(...result.ids);
      }
    }
  }

  if (mediaIds.length) {
    if (Number.isInteger(atIndex)) insertIntoListAt(which, mediaIds, atIndex);
    else addToList(which, mediaIds);
  }
}

async function collectDropEntries(dataTransfer) {
  const out = [];
  const items = Array.from(dataTransfer.items || []);
  for (const it of items) {
    if (it.kind !== 'file') continue;
    try {
      if (it.getAsFileSystemHandle) {
        const handle = await it.getAsFileSystemHandle();
        if (handle?.kind === 'directory') out.push({ kind: 'directory', handle });
        else if (handle?.kind === 'file') out.push({ kind: 'file', handle });
        continue;
      }
    } catch (_) {}
    const file = it.getAsFile?.();
    if (file) out.push({ kind: 'file', file });
  }
  if (!out.length) {
    for (const file of Array.from(dataTransfer.files || [])) {
      if (file) out.push({ kind: 'file', file });
    }
  }
  return out;
}

function ensureListVirtualList() {
  if (listVirtualList) return listVirtualList;
  listVirtualList = new VirtualList($('#list-editor'), {
    itemHeight: PERF.LIST_ROW_HEIGHT,
    overscan: PERF.VIRTUAL_OVERSCAN,
    getKey: index => {
      const which = state.ui.activeList;
      const list = which === 'playlist' ? state.playlist : state.slideshow;
      const ref = list[index];
      return ref ? `${which}:${index}:${ref.id}` : `${which}:${index}`;
    },
    renderItem: renderListRow,
    cleanupRow: releaseThumbnailElement
  });
  return listVirtualList;
}

function activeEditorItems() {
  return state.ui.activeList === 'playlist' ? state.playlist : state.slideshow;
}

function listFor(which) {
  return which === 'playlist' ? state.playlist : state.slideshow;
}

function allowedListTypes(which) {
  return which === 'playlist' ? ['video', 'audio'] : ['video', 'image'];
}

function isAllowedListType(which, type) {
  return allowedListTypes(which).includes(type);
}

function isPlayableListRef(which, ref) {
  if (!ref) return false;
  const item = state.library.get(ref.id);
  if (!item) return false;
  if (!isAllowedListType(which, item.type)) return false;
  if (isRemotePlayableItem(item, ref)) return true;
  if (item.stale || !item.handle || typeof item.handle.getFile !== 'function') return false;
  return true;
}

function findPlayableListIndex(which, startIndex, direction = 1) {
  const list = listFor(which);
  const length = list.length;
  if (!length) return -1;
  const step = direction >= 0 ? 1 : -1;
  const origin = Number.isFinite(startIndex) ? Math.floor(startIndex) : 0;
  let idx = origin;
  for (let checked = 0; checked < length; checked++, idx += step) {
    const next = ((idx % length) + length) % length;
    if (isPlayableListRef(which, list[next])) return next;
  }
  return -1;
}

function clearPlaylistPlayback() {
  cleanupVideoUrl(playlistVideoA);
  cleanupVideoUrl(playlistVideoB);
  currentPlaylistItem = null;
  const fallback = contextFromRuntimeLayer('slideshow') || contextFromRuntimeLayer('playlist') || buildProjectContext();
  activateExperienceContext(fallback, { trackVirtualPage: false, trigger: 'playlist_clear' });
}

function clearSlideshowPlayback() {
  const layer = $('#slideshow-layer');
  const wrapper = layer?.querySelector('.kenburns-wrapper') || layer;
  if (slideshowMedia) cleanupMediaElement(slideshowMedia);
  if (wrapper) {
    $all('*', wrapper).forEach(child => {
      if (child !== slideshowMedia) cleanupMediaElement(child);
    });
  }
  slideshowMedia = null;
  currentSlideshowItem = null;
  slideTimer.cancel();
  stopKenBurns();
  const fallback = contextFromRuntimeLayer('playlist') || contextFromRuntimeLayer('slideshow') || buildProjectContext();
  activateExperienceContext(fallback, { trackVirtualPage: false, trigger: 'slideshow_clear' });
}

function playbackBlockedError(error) {
  return error?.name === 'NotAllowedError' || /user.*interact|play\(\).*interrupted|not allowed/i.test(error?.message || '');
}

function mediaElementErrorMessage(media, fallback = 'Media could not be loaded') {
  const code = media?.error?.code;
  if (code === 1) return 'Media loading was aborted';
  if (code === 2) return 'Media network request failed';
  if (code === 3) return 'Media decode failed';
  if (code === 4) return 'Media source is not supported or could not be found';
  return fallback;
}

function waitForMediaElementReady(media, timeoutMs = 15000) {
  if (!media) return Promise.reject(new Error('Media element is not available'));
  const haveMetadata = Number(media.HAVE_METADATA) || 1;
  if (media.readyState >= haveMetadata) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const cleanup = () => {
      media.removeEventListener('loadedmetadata', onReady);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('error', onError);
      if (timer) clearTimeout(timer);
    };
    const finish = fn => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onReady = () => finish(resolve);
    const onError = () => finish(() => reject(new Error(mediaElementErrorMessage(media))));
    media.addEventListener('loadedmetadata', onReady);
    media.addEventListener('canplay', onReady);
    media.addEventListener('error', onError);
    timer = setTimeout(() => {
      if (media.readyState >= haveMetadata) finish(resolve);
      else finish(() => reject(new Error('Timed out while loading media')));
    }, Math.max(1000, Number(timeoutMs) || 15000));
  });
}

async function playPlaylistAtIndex(startIndex, opts = {}) {
  if (!state.playlist.length) {
    clearPlaylistPlayback();
    markLayerComplete('playlist', opts.reason || 'empty');
    updateHUD();
    return false;
  }
  const attempted = opts.attempted instanceof Set ? opts.attempted : new Set();
  if (attempted.size >= state.playlist.length) {
    clearPlaylistPlayback();
    markLayerComplete('playlist', opts.reason || 'exhausted');
    updateHUD();
    return false;
  }
  const direction = opts.direction ?? 1;
  const allowWrap = opts.allowWrap !== false;
  const idx = allowWrap
    ? findPlayableListIndex('playlist', startIndex, direction)
    : findPlayableListIndexNoWrap('playlist', startIndex, direction);
  if (idx < 0) {
    clearPlaylistPlayback();
    markLayerComplete('playlist', opts.reason || 'end');
    updateHUD();
    return false;
  }
  const ref = state.playlist[idx];
  const attemptKey = `${idx}:${ref?.id || ''}`;
  if (attempted.has(attemptKey)) {
    clearPlaylistPlayback();
    updateHUD();
    return false;
  }
  attempted.add(attemptKey);
  state.runtime.playlistIndex = idx;
  const success = await loadPlaylistItem(ref, idx % 2 === 1, {
    withTransition: opts.withTransition !== false,
    effectId: opts.effectId || ''
  });
  if (success) {
    layerCompletionState.playlistDone = false;
    if (opts.save !== false) saveStateDebounced();
    return true;
  }
  return playPlaylistAtIndex(idx + direction, { ...opts, attempted, allowWrap });
}

async function playSlideshowAtIndex(startIndex, opts = {}) {
  if (!state.slideshow.length) {
    clearSlideshowPlayback();
    markLayerComplete('slideshow', opts.reason || 'empty');
    updateHUD();
    return false;
  }
  const direction = opts.direction ?? 1;
  const allowWrap = opts.allowWrap !== false;
  const idx = allowWrap
    ? findPlayableListIndex('slideshow', startIndex, direction)
    : findPlayableListIndexNoWrap('slideshow', startIndex, direction);
  if (idx < 0) {
    clearSlideshowPlayback();
    markLayerComplete('slideshow', opts.reason || 'end');
    updateHUD();
    return false;
  }
  state.runtime.slideshowIndex = idx;
  const success = await loadSlideshowItem(state.slideshow[idx], opts.withCrossfade !== false);
  if (success) {
    layerCompletionState.slideshowDone = false;
    if (opts.save !== false) saveStateDebounced();
    return true;
  }
  return playSlideshowAtIndex(idx + direction, { ...opts, allowWrap });
}

function runtimeIndexKey(which) {
  return which === 'playlist' ? 'playlistIndex' : 'slideshowIndex';
}

function remapIndexAfterMove(index, from, to, length) {
  if (!Number.isInteger(index) || length <= 0) return 0;
  const current = clampExperienceIndex(index, length);
  const source = clampExperienceIndex(from, length);
  const insertion = Math.max(0, Math.min(Number.isFinite(to) ? Math.floor(to) : 0, length));

  if (current === source) {
    return Math.min(insertion, Math.max(0, length - 1));
  }

  if (source < insertion) {
    if (current > source && current <= insertion) return current - 1;
  } else if (insertion < source) {
    if (current >= insertion && current < source) return current + 1;
  }

  return current;
}

// ====================== LIST SELECTION ======================
// Selection is tracked by ref id so it follows items through reorders,
// sorts and shuffles. Helpers below normalize to indices when needed.

function listSelectionSet() {
  if (!(state.ui.listSelection instanceof Set)) state.ui.listSelection = new Set();
  return state.ui.listSelection;
}

function clearListSelection({ render = false } = {}) {
  const sel = listSelectionSet();
  const had = sel.size > 0;
  sel.clear();
  state.ui.listSelectionAnchorId = null;
  if (render && had) renderListEditor();
}

function selectedListIndices(which) {
  const list = listFor(which);
  const sel = listSelectionSet();
  if (!sel.size) return [];
  const out = [];
  list.forEach((ref, index) => { if (ref && sel.has(ref.id)) out.push(index); });
  return out;
}

function setListSelectionToIndex(which, idx) {
  const ref = listFor(which)[idx];
  const sel = listSelectionSet();
  sel.clear();
  if (ref) {
    sel.add(ref.id);
    state.ui.listSelectionAnchorId = ref.id;
  }
}

function toggleListSelectionAt(which, idx) {
  const ref = listFor(which)[idx];
  if (!ref) return;
  const sel = listSelectionSet();
  if (sel.has(ref.id)) {
    sel.delete(ref.id);
  } else {
    sel.add(ref.id);
    state.ui.listSelectionAnchorId = ref.id;
  }
  renderListEditor();
}

function rangeSelectListTo(which, idx) {
  const list = listFor(which);
  const sel = listSelectionSet();
  let anchorIdx = list.findIndex(ref => ref && ref.id === state.ui.listSelectionAnchorId);
  if (anchorIdx < 0) anchorIdx = idx;
  const lo = Math.min(anchorIdx, idx);
  const hi = Math.max(anchorIdx, idx);
  sel.clear();
  for (let i = lo; i <= hi; i++) {
    const ref = list[i];
    if (ref) sel.add(ref.id);
  }
  renderListEditor();
}

// ====================== LIST REORDER ======================
// `selectedIndices` are the items to move; `insertBefore` is the gap in
// original list coordinates (0..length). Selected items keep their
// relative order and land as a contiguous block at the insertion point.
function applyListMove(which, selectedIndices, insertBefore) {
  const list = listFor(which);
  if (!Array.isArray(list) || !list.length) return false;

  const order = computeMoveOrder(list.length, selectedIndices, insertBefore);
  if (isIdentityOrder(order)) return false;

  const remap = buildIndexRemap(order);
  const reordered = order.map(i => list[i]);
  if (which === 'playlist') state.playlist = reordered; else state.slideshow = reordered;

  const runtimeKey = runtimeIndexKey(which);
  const current = state.runtime[runtimeKey];
  if (Number.isInteger(current) && remap.has(current)) {
    state.runtime[runtimeKey] = remap.get(current);
  }
  const historyKey = which === 'playlist' ? 'historyPlaylist' : 'historySlideshow';
  if (Array.isArray(state.runtime[historyKey])) {
    state.runtime[historyKey] = state.runtime[historyKey]
      .map(idx => (remap.has(idx) ? remap.get(idx) : idx))
      .filter(Number.isInteger);
  }

  renderListEditor();
  void saveStateNow();
  return true;
}

// Single-item move kept for callers that pass an already-resolved gap.
function moveListItem(which, from, to) {
  if (!Number.isInteger(from)) return false;
  return applyListMove(which, [from], to);
}

// Entry point for a drag: move the whole selection when the dragged row
// belongs to a multi-selection, otherwise move (and select) just that row.
function handleListReorder(which, fromIndex, insertBefore) {
  if (!Number.isInteger(fromIndex)) return false;
  const selected = selectedListIndices(which);
  const moving = (selected.length > 1 && selected.includes(fromIndex)) ? selected : [fromIndex];
  if (moving.length === 1) setListSelectionToIndex(which, fromIndex);
  return applyListMove(which, moving, insertBefore);
}

// Keyboard reorder: move the current selection (or focused row) one slot.
function moveListSelectionByStep(which, direction) {
  const list = listFor(which);
  if (!list.length) return false;
  let indices = selectedListIndices(which);
  if (!indices.length) {
    const focused = document.activeElement?.closest?.('.list-item');
    const idx = focused ? Number.parseInt(focused.dataset.idx, 10) : NaN;
    if (Number.isInteger(idx)) {
      setListSelectionToIndex(which, idx);
      indices = [idx];
    }
  }
  if (!indices.length) return false;
  const insertBefore = direction < 0 ? Math.min(...indices) - 1 : Math.max(...indices) + 2;
  return applyListMove(which, indices, insertBefore);
}

function listEmptyMessage(which) {
  return `<div class="empty" aria-label="Drop media here">Drop media here<br><strong>${which === 'playlist' ? 'Playlist accepts video & audio' : 'Slideshow accepts images & video'}</strong></div>`;
}

function renderListEditor() {
  const container = $('#list-editor');
  const which = state.ui.activeList;
  const items = activeEditorItems();
  wireListDropZone(container, which);
  listPointerReorder?.refresh();
  container.setAttribute('aria-label', `${which === 'playlist' ? 'Playlist' : 'Slideshow'} editor`);
  $('#pl-count').textContent = `(${state.playlist.length})`;
  $('#ss-count').textContent = `(${state.slideshow.length})`;

  if (!items.length) {
    ensureListVirtualList().clear(listEmptyMessage(which));
    return;
  }

  const virtualList = ensureListVirtualList();
  virtualList.setCount(items.length);
  virtualList.render(true);
}

function renderListRow(idx, row) {
  const which = state.ui.activeList;
  const items = activeEditorItems();
  const ref = items[idx];
  const item = ref ? state.library.get(ref.id) : null;
  row = row || document.createElement('div');

  if (!ref) {
    row.className = 'list-item virtual-row';
    row.dataset.idx = idx;
    row.draggable = false;
    row.innerHTML = '<div class="info"><div class="name">Missing item</div></div><span class="del" title="Remove">✕</span>';
    return row;
  }

  const isSelected = listSelectionSet().has(ref.id);

  const available = isPlayableListRef(which, ref);
  const entryType = item?.type || ref.type || '';
  const path = item ? bestPathForItem(item) : (ref.path || ref.sourceUrl || ref.id || '');
  const name = item?.name || ref.name || basenameFromPath(path) || 'Not Available';
  const size = item ? formatBytes(item.size) : '';
  const isCurrent = which === 'playlist' ? idx === state.runtime.playlistIndex : idx === state.runtime.slideshowIndex;
  const signature = `${which}|${idx}|${ref.id}|${name}|${path}|${size}|${entryType}|${ref.displayDuration || ''}|${ref.includeAudio ? 1 : 0}|${available ? 1 : 0}|${ref.available === false ? 1 : 0}|${item?.stale ? 1 : 0}`;

  row.className = `list-item virtual-row ${available ? '' : 'not-available'} ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}`.replace(/\s+/g, ' ').trim();
  row.dataset.id = ref.id;
  row.dataset.idx = idx;
  row.tabIndex = 0;
  // Reordering is handled by the pointer-driven sortable (drag-sort.js),
  // not native HTML5 drag, so rows are not natively draggable.
  row.draggable = false;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  row.setAttribute('aria-posinset', String(idx + 1));
  row.setAttribute('aria-setsize', String(items.length));
  row.setAttribute('aria-label', `${idx + 1}. ${name}${available ? `, ${entryType || 'media'}` : ', Not Available'}`);

  if (row.dataset.signature !== signature) {
    releaseThumbnailElement(row);
    let extra = '';
    if (which === 'slideshow') {
      const dur = ref.displayDuration || state.settings.defaultImageDuration;
      if (entryType === 'image') {
        extra = `<input type="number" step="0.5" min="0.5" value="${dur}" title="Display seconds" aria-label="Display seconds">s`;
      } else if (entryType === 'video') {
        const checked = ref.includeAudio ? 'checked' : '';
        extra = `<label class="audio-flag"><input type="checkbox" ${checked} aria-label="Include audio"> Include audio</label>`;
      }
    }

    row.innerHTML = `
      <span class="drag" aria-hidden="true">≡</span>
      <div class="thumb-sm${available ? '' : ' thumb-sm--missing'}">${available ? '' : 'NA'}</div>
      <div class="info">
        <div class="name" title="${escapeHtml(path)}">${escapeHtml(name)}</div>
        <div class="path">${escapeHtml(path || 'Unknown path')}${size ? ` • ${escapeHtml(size)}` : ''}</div>
        ${available ? '' : '<div class="availability">Not Available</div>'}
      </div>
      ${extra}
      <button class="share" type="button" title="Share this item" aria-label="Share this item" aria-haspopup="menu" aria-expanded="false">↗</button>
      <span class="del" title="Remove" role="button" aria-label="Remove">✕</span>
    `;
    row.dataset.signature = signature;
  }

  if (available) requestThumbnailForElement(row.querySelector('.thumb-sm'), item);
  return row;
}

function wireListEditorEvents() {
  const container = $('#list-editor');
  if (container.dataset.eventsWired === 'true') return;
  container.dataset.eventsWired = 'true';
  if (!listPointerReorder) {
    listPointerReorder = createPointerReorderFallback(container, {
      getItemCount: () => activeEditorItems().length,
      onDragStart: ({ fromIndex }) => {
        // Dim the whole block when dragging a multi-selection.
        const selected = selectedListIndices(state.ui.activeList);
        if (selected.length > 1 && selected.includes(fromIndex)) {
          container.querySelectorAll('.list-item.selected').forEach(el => el.classList.add('dragging'));
        }
      },
      onDragEnd: () => {
        container.querySelectorAll('.list-item.dragging').forEach(el => el.classList.remove('dragging'));
        // Suppress the click that fires immediately after a real drag.
        listDragJustHappened = true;
        setTimeout(() => { listDragJustHappened = false; }, 0);
      },
      onReorder: ({ fromIndex, insertIndex }) => handleListReorder(state.ui.activeList, fromIndex, insertIndex)
    });
  }

  container.addEventListener('click', event => {
    const row = event.target.closest('.list-item');
    if (!row) return;
    const idx = parseInt(row.dataset.idx, 10);
    if (!Number.isInteger(idx)) return;
    const which = state.ui.activeList;
    if (event.target.closest('.share')) {
      event.stopPropagation();
      openShareMenuForListRow(event.target.closest('.share'), which, idx);
      return;
    }
    if (event.target.closest('.del')) {
      event.stopPropagation();
      removeFromList(which, idx);
      return;
    }
    if (event.target.closest('input,label,button')) return;
    // Ignore the synthetic click dispatched right after a pointer drag.
    if (listDragJustHappened) { listDragJustHappened = false; return; }
    // Multi-select: Ctrl/Cmd toggles a row, Shift extends a range.
    if (event.shiftKey) {
      event.preventDefault();
      rangeSelectListTo(which, idx);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      toggleListSelectionAt(which, idx);
      return;
    }
    // Plain click selects just this row and plays from here.
    setListSelectionToIndex(which, idx);
    renderListEditor();
    playFromHere(which, idx);
  });

  container.addEventListener('change', event => {
    const row = event.target.closest('.list-item');
    if (!row || state.ui.activeList !== 'slideshow') return;
    const idx = parseInt(row.dataset.idx, 10);
    const ref = state.slideshow[idx];
    if (!ref) return;
    if (event.target.matches('input[type="number"]')) {
      ref.displayDuration = parseFloat(event.target.value) || state.settings.defaultImageDuration;
      saveStateDebounced();
    } else if (event.target.matches('input[type="checkbox"]')) {
      ref.includeAudio = event.target.checked;
      saveStateDebounced();
    }
    renderListEditor();
  });
}

function createListRef(which, item, extras = {}) {
  const path = sanitizeImportPath(extras.path || (item ? bestPathForItem(item) : '')) || '';
  const type = extras.type || item?.type || getMediaType(path) || '';
  const name = normalizeExperienceName(extras.name || item?.name || basenameFromPath(path) || 'Media item');
  const ref = {
    id: String(extras.id || item?.id || `ref-${uid()}`),
    addedAt: extras.addedAt || Date.now(),
    path,
    name,
    type,
    sourceUrl: sanitizeImportPath(extras.sourceUrl || item?.sourceUrl || '') || undefined,
    available: extras.available === false ? false : true
  };
  if (extras.metadata || item?.metadata) ref.metadata = clonePlain(extras.metadata || item.metadata);
  const social = normalizeSocialObject(extras.social || extras.share || extras.og);
  if (social) {
    ref.metadata = ref.metadata && typeof ref.metadata === 'object' ? ref.metadata : {};
    ref.metadata.social = {
      ...(ref.metadata.social && typeof ref.metadata.social === 'object' ? ref.metadata.social : {}),
      ...social
    };
  }
  if (which === 'slideshow') {
    if (type === 'image') ref.displayDuration = extras.displayDuration ?? state.settings.defaultImageDuration;
    if (type === 'video') ref.includeAudio = extras.includeAudio ?? false;
  }
  return ref;
}

function createUnavailableListRef(which, entry, extras = {}) {
  const path = sanitizeImportPath(extras.path || entry?.path || entry?.sourceUrl || '') || '';
  const type = extras.type || entry?.type || getMediaType(path) || '';
  const name = normalizeExperienceName(extras.name || entry?.name || basenameFromPath(path) || 'Not Available');
  const ref = createListRef(which, null, {
    id: extras.id || entry?.id,
    addedAt: extras.addedAt,
    path,
    name,
    type,
    sourceUrl: extras.sourceUrl || entry?.sourceUrl || '',
    available: false,
    metadata: extras.metadata || entry?.metadata,
    displayDuration: extras.displayDuration ?? entry?.displayDuration,
    includeAudio: extras.includeAudio ?? entry?.includeAudio,
    reason: extras.reason
  });
  if (extras.reason) ref.reason = extras.reason;
  return ref;
}

function listLinkCandidates(ref, item = null) {
  const seen = new Set();
  const candidates = [];
  const add = value => {
    const normalized = sanitizeImportPath(value);
    if (!normalized) return;
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(normalized);
    const base = basenameFromPath(normalized);
    if (base) {
      const baseKey = base.toLocaleLowerCase();
      if (!seen.has(baseKey)) {
        seen.add(baseKey);
        candidates.push(base);
      }
    }
  };

  add(ref?.sourceUrl);
  add(ref?.path);
  add(item?.sourceUrl);
  add(item?.pathHint);
  add(item ? bestPathForItem(item) : '');
  add(ref?.name);
  add(item?.name);

  return candidates;
}

function pathSegmentsForResolution(path) {
  return String(path || '')
    .replace(/^\.\/+/, '')
    .replace(/\\/g, '/')
    .split('/')
    .map(seg => seg.trim())
    .filter(seg => seg && seg !== '.');
}

async function resolveStoredFileHandle(path) {
  const normalized = sanitizeImportPath(path);
  if (!normalized || isPortableRemoteRef(normalized)) return null;

  const roots = Array.from(state.directoryHandles.values()).filter(rec => rec?.handle);
  const candidates = [normalized];
  const base = basenameFromPath(normalized);
  if (base && base !== normalized) candidates.push(base);

  for (const candidate of candidates) {
    const segments = pathSegmentsForResolution(candidate);
    if (!segments.length) continue;

    for (const record of roots) {
      const rootName = String(record.name || record.handle?.name || '').trim().toLocaleLowerCase();
      const attempts = [segments];
      if (rootName) {
        for (let i = segments.length - 1; i >= 0; i--) {
          if (segments[i].toLocaleLowerCase() === rootName) {
            const tail = segments.slice(i + 1);
            if (tail.length) attempts.push(tail);
            break;
          }
        }
      }

      for (const parts of attempts) {
        if (!parts.length) continue;
        try {
          let current = record.handle;
          for (let i = 0; i < parts.length - 1; i++) {
            current = await current.getDirectoryHandle(parts[i], { create: false });
          }
          const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: false });
          return { handle: fileHandle, directoryId: record.id, pathHint: candidate };
        } catch (_) {}
      }
    }
  }

  return null;
}

function updateListRefFromItem(ref, item, extras = {}) {
  if (!ref || !item) return ref;
  ref.id = item.id;
  ref.name = normalizeExperienceName(item.name || ref.name || basenameFromPath(ref.path || bestPathForItem(item)) || 'Media item');
  ref.type = item.type || ref.type;
  ref.path = sanitizeImportPath(extras.path || bestPathForItem(item) || ref.path || '') || ref.path || '';
  if (item.sourceUrl || extras.sourceUrl || isPortableRemoteRef(ref.sourceUrl || '', { allowSupabaseBucketPath: true })) {
    ref.sourceUrl = sanitizeImportPath(item.sourceUrl || extras.sourceUrl || ref.sourceUrl || '') || ref.sourceUrl;
  } else if (ref.sourceUrl && !isPortableRemoteRef(ref.sourceUrl, { allowSupabaseBucketPath: true })) {
    delete ref.sourceUrl;
  }
  ref.available = true;
  delete ref.reason;
  if (item.metadata && typeof item.metadata === 'object') ref.metadata = clonePlain(item.metadata);
  return ref;
}

async function resolveListRefLink(which, ref) {
  try {
    const item = state.library.get(ref.id);
    if (item && item.handle && !item.stale && isAllowedListType(which, item.type)) {
      if (ref.available === false || ref.reason) updateListRefFromItem(ref, item);
      return { status: 'resolved', item };
    }

    const candidates = listLinkCandidates(ref, item);
    for (const candidate of candidates) {
      if (!candidate) continue;

      if (isPortableRemoteRef(candidate)) {
        try {
          const fetched = await addRemoteMediaUrl(candidate, {
            pathHint: ref.path || item?.pathHint || candidate,
            metadata: ref.metadata || item?.metadata || undefined
          });
          const resolved = fetched.id ? state.library.get(fetched.id) : fetched.item || null;
          if (resolved && resolved.handle && !resolved.stale && isAllowedListType(which, resolved.type)) {
            updateListRefFromItem(ref, resolved, { path: ref.path || item?.pathHint || candidate, sourceUrl: candidate });
            return { status: 'resolved', item: resolved };
          }
        } catch (error) {
          log.warn('resolve links: remote fetch failed', error);
        }
        continue;
      }

      const matchId = findLibraryMatch(candidate);
      const matched = matchId ? state.library.get(matchId) : null;
      if (matched && matched.handle && !matched.stale && isAllowedListType(which, matched.type)) {
        updateListRefFromItem(ref, matched, { path: candidate });
        return { status: 'resolved', item: matched };
      }

      const sourceItem = matched || item;
      const directoryResolution = await resolveStoredFileHandle(sourceItem?.pathHint || candidate);
      if (!directoryResolution?.handle) continue;

      const ensured = await ensureHandleInLibrary(directoryResolution.handle, {
        pathHint: directoryResolution.pathHint || sourceItem?.pathHint || candidate,
        directoryId: directoryResolution.directoryId,
        metadata: ref.metadata || sourceItem?.metadata || undefined,
        sourceUrl: sourceItem?.sourceUrl || ref.sourceUrl || undefined
      });
      const ensuredItem = ensured.id ? state.library.get(ensured.id) : null;
      if (ensuredItem && ensuredItem.handle && !ensuredItem.stale && isAllowedListType(which, ensuredItem.type)) {
        updateListRefFromItem(ref, ensuredItem, { path: candidate, sourceUrl: ref.sourceUrl || ensuredItem.sourceUrl || undefined });
        return { status: 'resolved', item: ensuredItem };
      }
    }
  } catch (error) {
    log.warn('resolve links failed', error);
  }

  ref.available = false;
  if (!ref.reason) ref.reason = 'unresolved';
  return { status: 'unresolved' };
}

async function resolveUnavailableListLinks() {
  const pending = [];
  for (const which of ['playlist', 'slideshow']) {
    for (const ref of listFor(which)) {
      if (!ref) continue;
      if (isPlayableListRef(which, ref)) continue;
      pending.push({ which, ref });
    }
  }

  if (!pending.length) {
    showToast('No unavailable links to resolve', { timeout: 2200 });
    return;
  }

  const progress = showToast(`Resolving ${pending.length} unavailable link${pending.length === 1 ? '' : 's'}...`, { timeout: 0 });
  let resolved = 0;
  let unresolved = 0;

  try {
    for (let i = 0; i < pending.length; i++) {
      const { which, ref } = pending[i];
      const result = await resolveListRefLink(which, ref);
      if (result.status === 'resolved') resolved++;
      else unresolved++;
      if (i % 3 === 0 || i === pending.length - 1) {
        progress.label.textContent = `Resolving ${pending.length} unavailable link${pending.length === 1 ? '' : 's'}... ${i + 1}/${pending.length}`;
      }
      if (i % 6 === 0) await new Promise(resolve => requestAnimationFrame(resolve));
    }

    renderLibrary();
    renderListEditor();
    await saveStateNow();

    const summary = [];
    if (resolved) summary.push(`Resolved ${resolved}`);
    if (unresolved) summary.push(`${unresolved} still unavailable`);
    showToast(summary.length ? summary.join(', ') : 'No links changed', { timeout: 3200 });
  } catch (error) {
    log.warn('resolve links batch failed', error);
    showToast('Could not resolve links', { timeout: 2600 });
  } finally {
    progress.close();
  }
}

function scrollListItemIntoView(idx) {
  requestAnimationFrame(() => {
    if (listVirtualList && activeEditorItems().length) {
      listVirtualList.scrollToIndex(idx);
      return;
    }
    const row = $(`#list-editor .list-item[data-idx="${idx}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

function addToList(which, ids) {
  const list = which === 'playlist' ? state.playlist : state.slideshow;
  const allowed = which === 'playlist' ? ['video','audio'] : ['video','image'];

  let added = 0, rejected = 0, firstIndex = list.length;
  ids.forEach(id => {
    const item = state.library.get(id);
    if (!item || !allowed.includes(item.type)) { rejected++; return; }
    if (list.some(r => r.id === id)) return; // dedupe
    list.push(createListRef(which, item));
    added++;
  });
  if (added) {
    setActiveList(which);
    saveStateDebounced();
    scrollListItemIntoView(firstIndex);
    showToast(`Added ${added} to ${which}`);
  } else {
    showToast(rejected ? (which === 'playlist' ? 'Playlist only accepts video & audio' : 'Slideshow only accepts images & video') : `Already in ${which}`, {timeout: 1800});
  }
  return { added, firstIndex };
}

function insertIntoListAt(which, ids, atIndex) {
  const list = which === 'playlist' ? state.playlist : state.slideshow;
  const allowed = which === 'playlist' ? ['video','audio'] : ['video','image'];
  let added = 0, rejected = 0, firstIndex = atIndex;
  ids.forEach(id => {
    const item = state.library.get(id);
    if (!item || !allowed.includes(item.type)) { rejected++; return; }
    if (list.some(r => r.id === id)) return;
    list.splice(atIndex, 0, createListRef(which, item));
    atIndex++;
    added++;
  });
  if (!added && rejected) showToast(which === 'playlist' ? 'Playlist only accepts video & audio' : 'Slideshow only accepts images & video', { timeout: 1800 });
  setActiveList(which);
  saveStateDebounced();
  if (added) scrollListItemIntoView(firstIndex);
  return { added, firstIndex };
}

function reorderList(which, from, to) {
  moveListItem(which, from, to);
}

function removeFromList(which, idx) {
  const list = which === 'playlist' ? state.playlist : state.slideshow;
  const removed = list.splice(idx, 1)[0];
  renderListEditor();
  saveStateDebounced();

  // undo
  showToast(`Removed from ${which}`, {
    undo: () => {
      list.splice(idx, 0, removed);
      renderListEditor();
      saveStateDebounced();
    }
  });
}

function clearList(which) {
  const oldItems = (which === 'playlist' ? state.playlist : state.slideshow).slice();
  if (!oldItems.length) return showToast(`${which[0].toUpperCase() + which.slice(1)} is already empty`, { timeout: 1600 });
  if (which === 'playlist') state.playlist = []; else state.slideshow = [];
  renderListEditor();
  saveStateDebounced();
  showToast(`Cleared ${which}`, {
    timeout: 5000,
    undo: () => {
      if (which === 'playlist') state.playlist = oldItems; else state.slideshow = oldItems;
      setActiveList(which);
      saveStateDebounced();
    }
  });
}

function shuffleList(which) {
  const list = which === 'playlist' ? state.playlist : state.slideshow;
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  state.runtime.historyPlaylist = [];
  state.runtime.historySlideshow = [];
  renderListEditor();
  saveStateDebounced();
  showToast(`Shuffled ${which}`);
}

function reverseList(which) {
  const list = which === 'playlist' ? state.playlist : state.slideshow;
  list.reverse();
  renderListEditor();
  saveStateDebounced();
  showToast(`Reversed ${which}`);
}

function sortList(which, key, dir = 'asc') {
  const list = which === 'playlist' ? state.playlist : state.slideshow;
  const mult = dir === 'desc' ? -1 : 1;
  const value = ref => {
    const item = state.library.get(ref.id) || {};
    if (key === 'name') return (item.name || '').toLocaleLowerCase();
    if (key === 'path') return bestPathForItem(item).toLocaleLowerCase();
    if (key === 'duration') return item.duration || ref.displayDuration || 0;
    if (key === 'date') return ref.addedAt || 0;
    if (key === 'type') return item.type || '';
    if (key === 'size') return item.size || 0;
    return 0;
  };
  list.sort((a, b) => {
    const av = value(a), bv = value(b);
    if (typeof av === 'string') return av.localeCompare(String(bv)) * mult;
    return (av - bv) * mult;
  });
  renderListEditor();
  saveStateDebounced();
  showToast(`Sorted ${which}`);
}

// ====================== PLAYBACK ENGINE ======================
function normalizeExperiencePlaybackMode(mode) {
  if (mode === EXPERIENCE_PLAYBACK_MODE_STOP) return EXPERIENCE_PLAYBACK_MODE_STOP;
  if (mode === EXPERIENCE_PLAYBACK_MODE_NEXT) return EXPERIENCE_PLAYBACK_MODE_NEXT;
  return EXPERIENCE_PLAYBACK_MODE_LOOP;
}

function transitionSettingsFromState() {
  return normalizeTransitionSettings({
    transitionDurationMs: state.settings.transitionDurationMs,
    transitionOverlapMs: state.settings.transitionOverlapMs,
    enabledTransitionIds: state.settings.enabledTransitionIds,
    transitionWeights: state.settings.transitionWeights,
    transitionRandomizeOrder: state.settings.transitionRandomizeOrder,
    transitionMaxHeavyInRow: state.settings.transitionMaxHeavyInRow,
    qualityAutoAdjust: state.settings.qualityAutoAdjust,
    showFps: state.settings.showFps
  });
}

function applyNormalizedTransitionSettings(settings) {
  const normalized = normalizeTransitionSettings(settings);
  state.settings.transitionDurationMs = normalized.transitionDurationMs;
  state.settings.transitionOverlapMs = normalized.transitionOverlapMs;
  state.settings.enabledTransitionIds = normalized.enabledTransitionIds.slice();
  state.settings.transitionWeights = { ...normalized.transitionWeights };
  state.settings.transitionRandomizeOrder = normalized.transitionRandomizeOrder;
  state.settings.transitionMaxHeavyInRow = normalized.transitionMaxHeavyInRow;
  state.settings.qualityAutoAdjust = normalized.qualityAutoAdjust;
  state.settings.showFps = normalized.showFps;
  transitionManager?.updateSettings(normalized);
  updateTransitionControlLabels();
}

function transitionDurationMs() {
  return clampNumber(state.settings.transitionDurationMs, 200, 10000, DEFAULT_TRANSITION_SETTINGS.transitionDurationMs);
}

function transitionOverlapMs() {
  return clampNumber(state.settings.transitionOverlapMs, 0, 10000, DEFAULT_TRANSITION_SETTINGS.transitionOverlapMs);
}

function updateTransitionControlLabels() {
  const durationLabel = $('#transition-duration-val');
  if (durationLabel) durationLabel.textContent = `${Math.round(transitionDurationMs())}ms`;
  const overlapLabel = $('#transition-overlap-val');
  if (overlapLabel) overlapLabel.textContent = `${Math.round(transitionOverlapMs())}ms`;
}

function updateTransitionFpsHud(metrics = null) {
  const el = $('#transition-fps');
  if (!el) return;
  const snapshot = metrics || transitionManager?.snapshot?.() || { fps: 0, qualityTier: 'high' };
  const showFps = !!state.settings.showFps;
  el.classList.toggle('hidden', !showFps);
  if (!showFps) return;
  const fps = Math.max(0, Math.round(snapshot.fps || 0));
  const quality = snapshot.qualityTier || 'high';
  el.textContent = `FPS ${fps} • ${quality}`;
}

function setupTransitionManager() {
  if (transitionManager) {
    transitionManager.destroy();
    transitionManager = null;
  }
  transitionManager = createTransitionManager({
    settings: transitionSettingsFromState()
  });
  transitionManager.onMetrics(metrics => {
    updateTransitionFpsHud(metrics);
  });
  transitionManager.startFpsMonitoring();
  applyNormalizedTransitionSettings(state.settings);
  updateTransitionFpsHud();
}

function listHasPlayableItems(which) {
  const list = which === 'playlist' ? state.playlist : state.slideshow;
  if (!Array.isArray(list) || !list.length) return false;
  for (const ref of list) {
    if (isPlayableListRef(which, ref)) return true;
  }
  return false;
}

function resetLayerCompletionState() {
  experienceTransitionToken += 1;
  layerCompletionState = {
    playlistDone: false,
    slideshowDone: false,
    handlingCompletion: false
  };
}

function markLayerComplete(which, reason = 'ended') {
  if (which === 'playlist') layerCompletionState.playlistDone = true;
  if (which === 'slideshow') layerCompletionState.slideshowDone = true;
  const playlistSatisfied = layerCompletionState.playlistDone || !listHasPlayableItems('playlist');
  const slideshowSatisfied = layerCompletionState.slideshowDone || !listHasPlayableItems('slideshow');
  if (!state.runtime.isPlaying) return;
  if (!playlistSatisfied || !slideshowSatisfied) return;
  void handleExperienceCompletion(reason);
}

function orderedExperienceRecords() {
  return sortExperienceRecords(state.experiences || []);
}

function nextExperienceId({ wrap = false } = {}) {
  const records = orderedExperienceRecords();
  if (!records.length) return '';
  const currentIdx = records.findIndex(record => record.id === state.activeExperienceId);
  if (currentIdx < 0) return records[0]?.id || '';
  if (currentIdx < records.length - 1) return records[currentIdx + 1].id;
  return wrap ? (records[0]?.id || '') : '';
}

async function startPlaybackFromCurrentIndices(opts = {}) {
  let started = false;
  if (state.playlist.length) {
    started = !!(await playPlaylistAtIndex(state.runtime.playlistIndex, { direction: 1, save: opts.save, allowWrap: true })) || started;
  }
  if (state.slideshow.length) {
    started = !!(await playSlideshowAtIndex(state.runtime.slideshowIndex, { direction: 1, withCrossfade: false, save: opts.save, allowWrap: true })) || started;
  }
  return started;
}

async function restartExperienceFromBeginning() {
  state.runtime.playlistIndex = 0;
  state.runtime.slideshowIndex = 0;
  state.runtime.historyPlaylist = [];
  state.runtime.historySlideshow = [];
  resetLayerCompletionState();
  applyTransportMode(TRANSPORT.PLAYING);
  const started = await startPlaybackFromCurrentIndices({ save: false });
  applyTransportMode(started ? TRANSPORT.PLAYING : TRANSPORT.STOPPED);
  if (!started) {
    clearPlaylistPlayback();
    clearSlideshowPlayback();
  }
  saveStateDebounced();
  return started;
}

async function switchToNextExperienceAndPlay() {
  const wrap = !!state.settings.loopExperienceCatalog;
  const targetId = nextExperienceId({ wrap });
  if (!targetId || targetId === state.activeExperienceId) return false;
  const switched = await switchExperienceById(targetId, { silent: true });
  if (!switched) return false;
  resetLayerCompletionState();
  applyTransportMode(TRANSPORT.PLAYING);
  const started = await startPlaybackFromCurrentIndices({ save: false });
  applyTransportMode(started ? TRANSPORT.PLAYING : TRANSPORT.STOPPED);
  if (started) {
    showToast(`Now playing ${state.projectName}`, { timeout: 2200 });
  }
  return started;
}

async function handleExperienceCompletion(reason = 'ended') {
  if (!state.runtime.isPlaying || layerCompletionState.handlingCompletion) return;
  layerCompletionState.handlingCompletion = true;
  const guardToken = experienceTransitionToken;
  const mode = normalizeExperiencePlaybackMode(state.settings.experiencePlaybackMode);
  try {
    if (mode === EXPERIENCE_PLAYBACK_MODE_LOOP) {
      const restarted = await restartExperienceFromBeginning();
      if (!restarted) {
        applyTransportMode(TRANSPORT.STOPPED);
      }
      return;
    }
    if (mode === EXPERIENCE_PLAYBACK_MODE_NEXT) {
      const moved = await switchToNextExperienceAndPlay();
      if (moved) return;
    }

    if (guardToken !== experienceTransitionToken) return;
    applyTransportMode(TRANSPORT.STOPPED);
    if (playlistVideoA) playlistVideoA.pause();
    if (playlistVideoB) playlistVideoB.pause();
    if (slideshowMedia?.tagName === 'VIDEO') slideshowMedia.pause();
    slideTimer.cancel();
    stopKenBurns();
    showToast('Experience finished', { timeout: 2000 });
    saveStateDebounced();
  } finally {
    layerCompletionState.handlingCompletion = false;
  }
}

function clearMediaOverlapBinding(media) {
  if (!media) return;
  const binding = mediaOverlapBindings.get(media);
  if (binding?.timeupdate) media.removeEventListener('timeupdate', binding.timeupdate);
  mediaOverlapBindings.delete(media);
}

function bindMediaOverlapAdvance(media, which) {
  if (!media || media.tagName !== 'VIDEO') return;
  clearMediaOverlapBinding(media);
  const overlap = transitionOverlapMs();
  if (!state.runtime.isPlaying || overlap <= 0) return;
  let fired = false;
  const onTimeUpdate = () => {
    if (fired || !state.runtime.isPlaying) return;
    const duration = media.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const remainingMs = (duration - media.currentTime) * 1000;
    if (remainingMs > overlap + 48) return;
    fired = true;
    if (which === 'playlist') advancePlaylist({ reason: 'overlap' });
    else advanceSlideshow({ reason: 'overlap' });
  };
  media.addEventListener('timeupdate', onTimeUpdate);
  mediaOverlapBindings.set(media, { timeupdate: onTimeUpdate });
}

function setupMediaLayers() {
  const plLayer = $('#playlist-layer');
  plLayer.innerHTML = '';
  playlistVideoA = document.createElement('video');
  playlistVideoB = document.createElement('video');
  [playlistVideoA, playlistVideoB].forEach(v => {
    v.style.position = 'absolute'; v.style.inset = '0';
    v.style.width = '100%'; v.style.height = '100%'; v.style.objectFit = 'contain';
    v.preload = 'metadata';
    v.muted = false; v.playsInline = true;
    plLayer.appendChild(v);
  });
  playlistVideoA.style.zIndex = '1';
  playlistVideoB.style.zIndex = '2';

  const ssLayer = $('#slideshow-layer');
  ssLayer.innerHTML = '';
  // container for ken burns + crossfade
  const wrapper = document.createElement('div');
  wrapper.className = 'kenburns-wrapper';
  wrapper.style.width = '100%'; wrapper.style.height = '100%';
  ssLayer.appendChild(wrapper);
  slideshowMedia = null; // created on demand

  // ended handlers
  playlistVideoA.onended = () => {
    if (!state.runtime.isPlaying) return;
    const completionContext = contextFromRuntimeLayer('playlist');
    trackPlaybackEvent('experience_complete', completionContext, { completion_reason: 'ended' });
    advancePlaylist({ reason: 'ended' });
  };
  playlistVideoB.onended = () => {
    if (!state.runtime.isPlaying) return;
    const completionContext = contextFromRuntimeLayer('playlist');
    trackPlaybackEvent('experience_complete', completionContext, { completion_reason: 'ended' });
    advancePlaylist({ reason: 'ended' });
  };

  // wire blend slider live
  const blend = $('#blend-slider');
  blend.oninput = () => {
    const val = parseInt(blend.value, 10) / 100;
    state.settings.opacity = val;
    $('#slideshow-layer').style.opacity = val;
    $('#blend-value').textContent = Math.round(val * 100) + '%';
    saveStateDebounced();
  };
}

function setBlend(val01) {
  const v = Math.max(0, Math.min(1, val01));
  state.settings.opacity = v;
  $('#slideshow-layer').style.opacity = v;
  $('#blend-slider').value = Math.round(v * 100);
  $('#blend-value').textContent = Math.round(v * 100) + '%';
}

async function loadPlaylistItem(itemRef, useB = false, opts = {}) {
  const item = state.library.get(itemRef.id);
  if (!item || !isPlayableListRef('playlist', itemRef)) return false;

  const target = useB ? playlistVideoB : playlistVideoA;
  const other = useB ? playlistVideoA : playlistVideoB;

  try {
    const preloaded = await getPreloadedPlaylistUrl(itemRef);
    if (!preloaded?.url) throw new Error('Could not load media');
    const url = preloaded.url;

    // crossfade
    cleanupVideoUrl(target);
    target.style.transition = '';
    target.style.opacity = '0';
    if (!preloaded.remote) target.dataset.objectUrl = url;
    target.src = url;
    target.volume = (state.settings.playlistVolume || 1) * (state.settings.masterVolume || 1);
    target.load?.();
    await waitForMediaElementReady(target);
    await target.play();
    bindMediaOverlapAdvance(target, 'playlist');

    const duration = opts.withTransition === false ? 0 : transitionDurationMs();
    if (transitionManager) {
      await transitionManager.applyTransition({
        container: $('#playlist-layer'),
        incoming: target,
        outgoing: other?.src ? other : null,
        durationMs: duration,
        effectId: opts.effectId || (duration <= 0 ? 'hard-cut' : '')
      });
    } else {
      requestAnimationFrame(() => {
        target.style.transition = 'opacity 420ms cubic-bezier(0.2,0,0,1)';
        other.style.transition = 'opacity 420ms cubic-bezier(0.2,0,0,1)';
        target.style.opacity = '1';
        other.style.opacity = '0';
      });
      await wait(Math.max(200, duration || 420));
    }
    if (other && other !== target && other.src) {
      setTimeout(() => cleanupVideoUrl(other), Math.max(220, duration + 140));
    }

    currentPlaylistItem = item;
    const playlistContext = buildExperienceContext('playlist', itemRef, state.runtime.playlistIndex, { trigger: 'playlist_load' });
    if (playlistContext) {
      activateExperienceContext(playlistContext, { trackVirtualPage: true, trigger: 'playlist_load' });
      trackPlaybackEvent('experience_play', playlistContext, {
        play_reason: 'playlist_load',
        playback_active: state.runtime.isPlaying ? 1 : 0
      });
    }
    updateHUD();
    preloadUpcomingPlaylistItems();
    return true;
  } catch (e) {
    log.warn('playlist load failed', e);
    const failureReason = mediaElementErrorMessage(target, e?.message || 'unavailable');
    cleanupVideoUrl(target);
    target.removeAttribute('src');
    target.load?.();
    if (playbackBlockedError(e)) {
      showToast('Press Play to start playlist audio', { timeout: 2800 });
    } else {
      item.stale = true;
      itemRef.available = false;
      itemRef.reason = failureReason;
    }
    saveStateDebounced();
    renderLibrary();
    renderListEditor();
    return false;
  }
}

async function getPreloadedPlaylistUrl(itemRef) {
  const cached = playlistPreload.get(itemRef.id);
  if (cached) {
    playlistPreload.delete(itemRef.id);
    return cached.catch(() => null);
  }
  return createPlaylistPreload(itemRef);
}

async function createPlaylistPreload(itemRef) {
  const item = state.library.get(itemRef.id);
  if (!item) return null;
  const remoteUrl = await resolvePlayableUrlForItem(item, itemRef, { showErrorToast: false });
  if (remoteUrl && isAllowedListType('playlist', item.type)) return { url: remoteUrl, remote: true };
  if (item.stale || !item.handle || typeof item.handle.getFile !== 'function') return null;
  const file = await item.handle.getFile().catch(() => null);
  if (!file) return null;
  const url = createMediaObjectUrl(file, item);
  return { url, remote: false };
}

function cleanupPreloadedUrl(preloaded) {
  if (!preloaded?.url || preloaded.remote) return;
  scheduleObjectUrlRevoke(preloaded.url, 1000);
}

function preloadUpcomingPlaylistItems() {
  if (!state.playlist.length) return;
  const keep = new Set();
  const ahead = Math.min(PERF.MEDIA_PRELOAD_AHEAD, state.playlist.length - 1);
  for (let offset = 1; offset <= ahead; offset++) {
    const idx = (state.runtime.playlistIndex + offset) % state.playlist.length;
    const ref = state.playlist[idx];
    if (!ref) continue;
    keep.add(ref.id);
    if (!playlistPreload.has(ref.id)) playlistPreload.set(ref.id, createPlaylistPreload(ref));
  }
  for (const [id, promise] of playlistPreload) {
    if (keep.has(id)) continue;
    promise.then(cleanupPreloadedUrl).catch(() => {});
    playlistPreload.delete(id);
  }
}

function cleanupVideoUrl(video) {
  if (!video) return;
  clearMediaOverlapBinding(video);
  try {
    video.pause();
    const url = video.dataset.objectUrl || (video.src && video.src.startsWith('blob:') ? video.src : '');
    if (url) {
      scheduleObjectUrlRevoke(url, 1000);
    }
    delete video.dataset.objectUrl;
    video.removeAttribute('src');
    video.load();
  } catch (_) {}
}

async function loadSlideshowItem(itemRef, withCrossfade = true) {
  const item = state.library.get(itemRef.id);
  if (!item || !isPlayableListRef('slideshow', itemRef)) return false;

  slideTimer.cancel();
  stopKenBurns();
  const layer = $('#slideshow-layer');
  const wrapper = layer.querySelector('.kenburns-wrapper') || layer;
  const previous = slideshowMedia;
  const loading = $('#slideshow-loading');

  loading?.classList.add('visible');
  let preloaded = await getPreloadedSlideshowElement(itemRef);
  loading?.classList.remove('visible');
  if (!preloaded) {
    item.stale = true;
    saveStateDebounced();
    renderLibrary();
    renderListEditor();
    return false;
  }

  const { el, url, remote } = preloaded;
  if (!remote) el.dataset.objectUrl = url;
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.margin = 'auto';
  el.style.maxWidth = '100%';
  el.style.maxHeight = '100%';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.objectFit = 'contain';
  el.style.opacity = withCrossfade ? '0' : '1';
  el.style.transition = '';
  wrapper.appendChild(el);

  if (item.type === 'image') {
    startKenBurns(el, itemRef.displayDuration || state.settings.defaultImageDuration);
  } else {
    el.volume = (itemRef.includeAudio ? state.settings.slideshowVolume : 0) * state.settings.masterVolume;
    el.currentTime = Math.max(0, el.currentTime || 0);
    el.play().catch(()=>{});
    bindMediaOverlapAdvance(el, 'slideshow');
    el.onended = () => {
      if (!state.runtime.isPlaying) return;
      const completionContext = buildExperienceContext('slideshow', itemRef, state.runtime.slideshowIndex, { trigger: 'slideshow_ended' });
      trackPlaybackEvent('experience_complete', completionContext, { completion_reason: 'ended' });
      advanceSlideshow({ reason: 'ended' });
    };
  }

  const duration = withCrossfade ? transitionDurationMs() : 0;
  if (transitionManager) {
    await transitionManager.applyTransition({
      container: wrapper,
      incoming: el,
      outgoing: previous && previous !== el ? previous : null,
      durationMs: duration,
      effectId: withCrossfade ? '' : 'hard-cut'
    });
  } else {
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 720ms cubic-bezier(0.2,0,0,1)';
      el.style.opacity = '1';
      if (previous && previous !== el) {
        previous.style.transition = 'opacity 720ms cubic-bezier(0.2,0,0,1)';
        previous.style.opacity = '0';
      }
    });
    await wait(Math.max(220, duration || 720));
  }
  if (previous && previous !== el) {
    setTimeout(() => cleanupMediaElement(previous), Math.max(220, duration + 140));
  } else if (!withCrossfade) {
    Array.from(wrapper.children).forEach(child => { if (child !== el) cleanupMediaElement(child); });
  }

  slideshowMedia = el;
  currentSlideshowItem = item;
  const slideshowContext = buildExperienceContext('slideshow', itemRef, state.runtime.slideshowIndex, { trigger: 'slideshow_load' });
  if (slideshowContext) {
    activateExperienceContext(slideshowContext, { trackVirtualPage: true, trigger: 'slideshow_load' });
    trackPlaybackEvent('experience_play', slideshowContext, {
      play_reason: 'slideshow_load',
      playback_active: state.runtime.isPlaying ? 1 : 0
    });
  }

  // schedule next for images via a pausable timer so a pause banks the
  // remaining display time and resume continues from there.
  if (item.type === 'image') {
    if (state.runtime.isPlaying) {
      const dur = (itemRef.displayDuration || state.settings.defaultImageDuration) * 1000;
      const delay = Math.max(80, dur - transitionOverlapMs());
      slideTimer.start(() => {
        const completionContext = buildExperienceContext('slideshow', itemRef, state.runtime.slideshowIndex, { trigger: 'slideshow_timer' });
        trackPlaybackEvent('experience_complete', completionContext, { completion_reason: 'duration_elapsed' });
        advanceSlideshow({ reason: delay < dur ? 'overlap' : 'duration_elapsed' });
      }, delay);
    } else {
      slideTimer.cancel();
    }
  }

  updateHUD();
  preloadUpcomingSlideshowItems();
  return true;
}

function cleanupMediaElement(el) {
  if (!el) return;
  clearMediaOverlapBinding(el);
  try {
    if (el.tagName === 'VIDEO') {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } else if (el.tagName === 'IMG') {
      el.removeAttribute('src');
    }
    el.onended = el.onerror = el.onload = null;
    if (el.dataset.objectUrl) {
      scheduleObjectUrlRevoke(el.dataset.objectUrl, 1000);
    }
  } catch (_) {}
  el.remove();
}

async function getPreloadedSlideshowElement(itemRef) {
  const cached = slideshowPreload.get(itemRef.id);
  if (cached) {
    slideshowPreload.delete(itemRef.id);
    return cached.catch(() => null);
  }
  return createSlideshowElement(itemRef);
}

async function createSlideshowElement(itemRef) {
  const item = state.library.get(itemRef.id);
  if (!item) return null;
  const remoteUrl = await resolvePlayableUrlForItem(item, itemRef, { showErrorToast: false });
  const remote = !!remoteUrl && isAllowedListType('slideshow', item.type);
  if (!remote && (item.stale || !item.handle || typeof item.handle.getFile !== 'function')) return null;
  const file = remote ? null : await item.handle.getFile().catch(() => null);
  if (!remote && !file) return null;
  const url = remote ? remoteUrl : createMediaObjectUrl(file, item);
  let el;
  if (item.type === 'image') {
    el = document.createElement('img');
    el.decoding = 'async';
    el.src = url;
    await (el.decode ? el.decode().catch(() => null) : new Promise(resolve => {
      el.onload = resolve; el.onerror = resolve;
    }));
  } else {
    el = document.createElement('video');
    el.src = url;
    el.preload = 'auto';
    el.playsInline = true;
    el.loop = false;
    el.muted = !itemRef.includeAudio;
    await new Promise(resolve => {
      const done = () => resolve();
      el.onloadeddata = done;
      el.onloadedmetadata = done;
      el.onerror = done;
      setTimeout(done, 1400);
    });
  }
  return { el, url, remote };
}

function preloadUpcomingSlideshowItems() {
  if (!state.slideshow.length) return;
  const keep = new Set();
  for (let offset = 1; offset <= Math.min(PERF.MEDIA_PRELOAD_AHEAD, state.slideshow.length - 1); offset++) {
    const idx = (state.runtime.slideshowIndex + offset) % state.slideshow.length;
    const ref = state.slideshow[idx];
    if (!ref) continue;
    keep.add(ref.id);
    if (slideshowPreload.has(ref.id)) continue;
    slideshowPreload.set(ref.id, createSlideshowElement(ref));
  }
  for (const [id, promise] of slideshowPreload) {
    if (keep.has(id)) continue;
    promise.then(preloaded => {
      if (preloaded?.el) cleanupMediaElement(preloaded.el);
      else if (preloaded?.url && !preloaded.remote) {
        scheduleObjectUrlRevoke(preloaded.url, 1000);
      }
    }).catch(() => {});
    slideshowPreload.delete(id);
  }
}

function startKenBurns(mediaEl, durationSec) {
  stopKenBurns();
  const intensity = getIntensityMultiplier();
  if (intensity <= 0.05) { kenBurnsState = null; return; } // off

  kenBurnsState = {
    el: mediaEl,
    durationMs: Math.max(1, (Number(durationSec) || 0) * 1000),
    maxZoom: 1 + (0.07 * intensity),
    dirX: (Math.random() - 0.5) * 2 * (4 * intensity),
    dirY: (Math.random() - 0.5) * 2 * (3 * intensity)
  };
  kenBurnsClock.start();
  kenBurnsRAF = requestAnimationFrame(kenBurnsFrame);
}

// Drives the Ken Burns transform off an ElapsedClock so a pause freezes the
// animation and resume continues from exactly the same offset.
function kenBurnsFrame() {
  if (!kenBurnsState || !kenBurnsState.el) { kenBurnsRAF = null; return; }
  const { el, durationMs, maxZoom, dirX, dirY } = kenBurnsState;
  const p = Math.min(1, kenBurnsClock.elapsed() / durationMs);
  const z = 1 + (maxZoom - 1) * p;
  el.style.transform = `scale(${z}) translate(${dirX * p}%, ${dirY * p}%)`;
  if (p < 1 && kenBurnsClock.running) {
    kenBurnsRAF = requestAnimationFrame(kenBurnsFrame);
  } else {
    kenBurnsRAF = null;
  }
}

function pauseKenBurns() {
  kenBurnsClock.pause();
  if (kenBurnsRAF) { cancelAnimationFrame(kenBurnsRAF); kenBurnsRAF = null; }
}

function resumeKenBurns() {
  if (!kenBurnsState) return;
  if (kenBurnsClock.elapsed() >= kenBurnsState.durationMs) return; // already done
  kenBurnsClock.resume();
  if (!kenBurnsRAF) kenBurnsRAF = requestAnimationFrame(kenBurnsFrame);
}

function stopKenBurns() {
  if (kenBurnsRAF) { cancelAnimationFrame(kenBurnsRAF); kenBurnsRAF = null; }
  kenBurnsClock.reset();
  kenBurnsState = null;
}

function getIntensityMultiplier() {
  const i = state.settings.effectIntensity;
  if (i === 'off') return 0;
  if (i === 'subtle') return 1;
  if (i === 'medium') return 1.7;
  if (i === 'strong') return 2.6;
  return 1;
}

function findPlayableListIndexNoWrap(which, startIndex, direction = 1) {
  const list = listFor(which);
  const length = list.length;
  if (!length) return -1;
  const start = Number.isFinite(startIndex) ? Math.floor(startIndex) : 0;
  if (direction >= 0) {
    for (let idx = Math.max(0, start); idx < length; idx++) {
      if (isPlayableListRef(which, list[idx])) return idx;
    }
    return -1;
  }
  for (let idx = Math.min(length - 1, start); idx >= 0; idx--) {
    if (isPlayableListRef(which, list[idx])) return idx;
  }
  return -1;
}

function advancePlaylist(opts = {}) {
  if (playlistAdvanceInFlight) return;
  if (!state.playlist.length) {
    clearPlaylistPlayback();
    markLayerComplete('playlist', opts.reason || 'empty');
    updateHUD();
    return;
  }
  const mode = state.settings.playbackModePlaylist || 'sequential';
  if (mode === 'random') {
    const playable = state.playlist
      .map((ref, index) => (isPlayableListRef('playlist', ref) ? index : -1))
      .filter(index => index >= 0);
    if (!playable.length) {
      clearPlaylistPlayback();
      markLayerComplete('playlist', opts.reason || 'unplayable');
      updateHUD();
      return;
    }
    layerCompletionState.playlistDone = false;
    state.runtime.historyPlaylist.push(state.runtime.playlistIndex);
    const pool = playable.filter(index => index !== state.runtime.playlistIndex);
    const choicePool = pool.length ? pool : playable;
    const next = choicePool[Math.floor(Math.random() * choicePool.length)];
    playlistAdvanceInFlight = true;
    void playPlaylistAtIndex(next, { direction: 1, allowWrap: true })
      .finally(() => { playlistAdvanceInFlight = false; });
    return;
  }

  const next = findPlayableListIndexNoWrap('playlist', state.runtime.playlistIndex + 1, 1);
  if (next < 0) {
    clearPlaylistPlayback();
    markLayerComplete('playlist', opts.reason || 'list_end');
    updateHUD();
    saveStateDebounced();
    return;
  }
  layerCompletionState.playlistDone = false;
  playlistAdvanceInFlight = true;
  void playPlaylistAtIndex(next, { direction: 1, allowWrap: false })
    .finally(() => { playlistAdvanceInFlight = false; });
  saveStateDebounced();
}

function advanceSlideshow(opts = {}) {
  if (slideshowAdvanceInFlight) return;
  slideTimer.cancel();
  stopKenBurns();

  if (!state.slideshow.length) {
    clearSlideshowPlayback();
    markLayerComplete('slideshow', opts.reason || 'empty');
    updateHUD();
    return;
  }
  const next = findPlayableListIndexNoWrap('slideshow', state.runtime.slideshowIndex + 1, 1);
  if (next < 0) {
    clearSlideshowPlayback();
    markLayerComplete('slideshow', opts.reason || 'list_end');
    updateHUD();
    saveStateDebounced();
    return;
  }
  layerCompletionState.slideshowDone = false;
  slideshowAdvanceInFlight = true;
  void playSlideshowAtIndex(next, { direction: 1, withCrossfade: true, allowWrap: false })
    .finally(() => { slideshowAdvanceInFlight = false; });
  saveStateDebounced();
}

// ====================== TRANSPORT STATE ======================
// One place that keeps the transport mode, the persisted isPlaying flag and
// the play-button UI (label / icon / aria) in lock-step. Every code path that
// changes playing/paused/stopped goes through here.
function applyTransportMode(mode) {
  transportMode = mode;
  state.runtime.isPlaying = (mode === TRANSPORT.PLAYING);
  state.runtime.transport = mode;
  updatePlayButtonUI();
}

function updatePlayButtonUI() {
  const btn = $('#btn-play');
  if (btn) {
    const playing = transportMode === TRANSPORT.PLAYING;
    btn.textContent = playing ? '⏸' : '▶';
    btn.classList.toggle('is-playing', playing);
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    btn.setAttribute('aria-label', playing ? 'Pause playback' : 'Play');
    btn.title = playing ? 'Pause (Space or K)' : 'Play (Space or K)';
  }
  const stopBtn = $('#btn-stop');
  if (stopBtn) stopBtn.disabled = (transportMode === TRANSPORT.STOPPED);
  if (document.body) document.body.dataset.transport = transportMode;
}

async function playFromHere(which, idx) {
  // Clicking an item plays from there. When starting from stopped/paused we
  // also kick the *other* layer from its current index (matching the original
  // "click an item → both layers start" behavior).
  const startOtherLayer = transportMode !== TRANSPORT.PLAYING;
  applyTransportMode(TRANSPORT.PLAYING);
  resetLayerCompletionState();
  playlistAdvanceInFlight = false;
  slideshowAdvanceInFlight = false;
  if (which === 'playlist') {
    await playPlaylistAtIndex(idx, { direction: 1, allowWrap: true });
    if (startOtherLayer && state.slideshow.length) {
      await playSlideshowAtIndex(state.runtime.slideshowIndex, { direction: 1, withCrossfade: false, allowWrap: true });
    }
  } else {
    await playSlideshowAtIndex(idx, { direction: 1, withCrossfade: false, allowWrap: true });
    if (startOtherLayer && state.playlist.length) {
      await playPlaylistAtIndex(state.runtime.playlistIndex, { direction: 1, allowWrap: true });
    }
  }
}

// Play / Pause toggle. The action is decided purely by the transport mode:
//   playing -> pause (bank positions), paused -> resume (exact positions),
//   stopped -> fresh start from the current indices.
async function togglePlay() {
  const action = transportToggleAction(transportMode);
  if (action === 'pause') { pausePlayback(); return; }
  if (action === 'resume') { await resumePlayback(); return; }
  await startPlayback();
}

async function startPlayback() {
  applyTransportMode(TRANSPORT.PLAYING);
  resetLayerCompletionState();
  playlistAdvanceInFlight = false;
  slideshowAdvanceInFlight = false;
  let started = false;
  if (state.playlist.length) {
    started = !!(await playPlaylistAtIndex(state.runtime.playlistIndex, { direction: 1, allowWrap: true })) || started;
  }
  if (state.slideshow.length) {
    started = !!(await playSlideshowAtIndex(state.runtime.slideshowIndex, { direction: 1, withCrossfade: false, allowWrap: true })) || started;
  }
  if (!started) {
    applyTransportMode(TRANSPORT.STOPPED);
    updateHUD();
    return false;
  }
  const playContext = activeExperienceContext || contextFromRuntimeLayer('slideshow') || contextFromRuntimeLayer('playlist') || buildProjectContext();
  trackPlaybackEvent('experience_play', playContext, { play_reason: 'transport_toggle' });
  return true;
}

// Pause both layers at their EXACT current positions without unloading them,
// banking the image-slide timer and Ken Burns progress so resume is seamless.
function pausePlayback() {
  if (transportMode !== TRANSPORT.PLAYING) return;
  applyTransportMode(TRANSPORT.PAUSED);
  if (playlistVideoA) playlistVideoA.pause();
  if (playlistVideoB) playlistVideoB.pause();
  if (slideshowMedia && slideshowMedia.tagName === 'VIDEO') slideshowMedia.pause();
  slideTimer.pause();
  pauseKenBurns();
  const pauseContext = activeExperienceContext || contextFromRuntimeLayer('slideshow') || contextFromRuntimeLayer('playlist') || buildProjectContext();
  trackPlaybackEvent('experience_pause', pauseContext, { pause_reason: 'transport_toggle' });
  saveStateDebounced();
}

// Resume both layers from the banked positions. If the live media elements are
// gone (cleared/reloaded), fall back to a fresh start from the current indices.
async function resumePlayback() {
  if (transportMode !== TRANSPORT.PAUSED) return false;
  const activePlaylistVideo = (state.runtime.playlistIndex % 2 === 1) ? playlistVideoB : playlistVideoA;
  const hasLivePlaylist = !!(currentPlaylistItem && activePlaylistVideo && activePlaylistVideo.src);
  const hasLiveSlideshow = !!slideshowMedia;
  applyTransportMode(TRANSPORT.PLAYING);

  if (!hasLivePlaylist && !hasLiveSlideshow) {
    const started = await startPlaybackFromCurrentIndices({ save: true });
    if (!started) applyTransportMode(TRANSPORT.STOPPED);
    return started;
  }

  if (hasLivePlaylist) {
    try { await activePlaylistVideo.play(); } catch (_) {}
  }
  if (hasLiveSlideshow && slideshowMedia.tagName === 'VIDEO') {
    try { await slideshowMedia.play(); } catch (_) {}
  }
  // Image slides + Ken Burns continue from exactly where they were banked.
  resumeKenBurns();
  slideTimer.resume();

  const playContext = activeExperienceContext || contextFromRuntimeLayer('slideshow') || contextFromRuntimeLayer('playlist') || buildProjectContext();
  trackPlaybackEvent('experience_play', playContext, { play_reason: 'transport_resume' });
  saveStateDebounced();
  return true;
}

// Full stop: tear down both layers, reset to a black/blank screen and rewind
// to the very beginning so the next Play restarts the whole experience.
function stopPlayback() {
  const wasActive = transportMode !== TRANSPORT.STOPPED;
  const stopContext = activeExperienceContext || contextFromRuntimeLayer('slideshow') || contextFromRuntimeLayer('playlist') || buildProjectContext();
  playlistAdvanceInFlight = false;
  slideshowAdvanceInFlight = false;
  resetLayerCompletionState();
  applyTransportMode(TRANSPORT.STOPPED);
  cleanupVideoUrl(playlistVideoA);
  cleanupVideoUrl(playlistVideoB);
  const ssLayer = $('#slideshow-layer');
  $all('#slideshow-layer .kenburns-wrapper > *').forEach(cleanupMediaElement);
  clearPlaylistPreloads();
  clearSlideshowPreloads();
  ssLayer.innerHTML = '<div class="kenburns-wrapper" style="width:100%;height:100%"></div>';
  slideshowMedia = null;
  currentPlaylistItem = null;
  currentSlideshowItem = null;
  slideTimer.cancel();
  stopKenBurns();
  state.runtime.playlistIndex = 0;
  state.runtime.slideshowIndex = 0;
  state.runtime.historyPlaylist = [];
  state.runtime.historySlideshow = [];
  updateHUD();
  activateExperienceContext(buildProjectContext(), { trackVirtualPage: false, trigger: 'stop_playback' });
  if (wasActive) {
    trackPlaybackEvent('experience_pause', stopContext, { pause_reason: 'stop' });
  }
  saveStateDebounced();
}

function clearSlideshowPreloads() {
  for (const [, promise] of slideshowPreload) {
    promise.then(preloaded => {
      if (preloaded?.el) cleanupMediaElement(preloaded.el);
      else if (preloaded?.url) {
        scheduleObjectUrlRevoke(preloaded.url, 1000);
      }
    }).catch(() => {});
  }
  slideshowPreload.clear();
}

function clearPlaylistPreloads() {
  for (const [, promise] of playlistPreload) {
    promise.then(cleanupPreloadedUrl).catch(() => {});
  }
  playlistPreload.clear();
}

function cleanupRuntimeResources() {
  playlistAdvanceInFlight = false;
  slideshowAdvanceInFlight = false;
  resetLayerCompletionState();
  slideTimer.cancel();
  stopKenBurns();
  cleanupVideoUrl(playlistVideoA);
  cleanupVideoUrl(playlistVideoB);
  clearPlaylistPreloads();
  clearSlideshowPreloads();
  if (slideshowMedia) cleanupMediaElement(slideshowMedia);
  for (const url of objectUrls) revokeObjectUrlNow(url);
  objectUrls.clear();
  for (const url of thumbUrlCache.values()) revokeObjectUrlNow(url);
  thumbUrlCache.clear();
  thumbRequests.clear();
  thumbQueue.length = 0;
  if (thumbObserver) thumbObserver.disconnect();
  if (listPointerReorder) listPointerReorder.destroy();
  if (libraryProjectionWorker) libraryProjectionWorker.terminate();
  if (libraryProjectionWorkerUrl) revokeObjectUrlNow(libraryProjectionWorkerUrl);
  libraryProjectionResolvers.clear();
  if (transitionManager) {
    transitionManager.destroy();
    transitionManager = null;
  }
  supabaseAuthClient.shutdown();
  storageUrlResolver.clearCache();
}

function deleteIndexedDBDatabase(name) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      fn(value);
    };
    const timeoutId = setTimeout(() => {
      finish(reject, new Error(`Timed out deleting IndexedDB database "${name}"`));
    }, 5000);
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => finish(resolve);
    req.onerror = () => finish(reject, req.error);
    req.onblocked = () => log.warn('idb delete blocked', { name });
  });
}

async function clearBrowserStorage() {
  const confirmed = await showExperienceDialog({
    title: 'Clear browser storage',
    mode: 'confirm',
    message: 'This removes Blend browser data only: library entries, playlists, slideshows, experiences, settings, and cached thumbnails. Your media files on disk are not touched.',
    okText: '✓ Clear Browser Storage',
    okDanger: true
  });
  if (!confirmed) return false;

  browserStorageResetting = true;
  saveStateDebounced.cancel?.();
  clearTimeout(saveTimer);
  try {
    stopPlayback();
    cleanupRuntimeResources();

    state.projectName = DEFAULT_EXPERIENCE_NAME;
    state.library.clear();
    state.directoryHandles.clear();
    state.playlist = [];
    state.slideshow = [];
    state.listMeta = {
      playlist: defaultListMeta('playlist'),
      slideshow: defaultListMeta('slideshow')
    };
    state.settings = createDefaultSettings();
    state.experiences = [];
    state.activeExperienceId = null;
    state.ui.activeList = 'playlist';
    state.ui.selectedLibrary.clear();
    state.ui.lastSelectedLibraryId = null;
    state.ui.visibleLibraryIds = [];
    state.ui.currentFilter = 'all';
    state.ui.currentSourceFilter = 'all';
    state.ui.search = '';
    state.runtime = {
      playlistIndex: 0,
      slideshowIndex: 0,
      isPlaying: false,
      transport: TRANSPORT.STOPPED,
      historyPlaylist: [],
      historySlideshow: []
    };
    transportMode = TRANSPORT.STOPPED;
    currentPlaylistItem = null;
    currentSlideshowItem = null;
    isMuted = false;
    lastNonZeroMasterVolume = DEFAULT_SETTINGS.masterVolume;
    setActiveExperienceId(null);

    if (db) {
      try { db.close(); } catch (_) {}
      db = null;
    }

    try {
      await deleteIndexedDBDatabase(DB_NAME);
    } catch (error) {
      log.warn('browser storage clear: idb delete failed', error);
    }

    try {
      if ('caches' in window && caches?.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key === CACHE_VERSION || String(key).startsWith('blend-player')).map(key => caches.delete(key)));
      }
    } catch (error) {
      log.warn('browser storage clear: cache delete failed', error);
    }

    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(reg => reg.unregister()));
      }
    } catch (error) {
      log.warn('browser storage clear: service worker unregister failed', error);
    }

    try {
      await openDB();
    } catch (error) {
      log.warn('browser storage clear: db reopen failed', error);
    }

    localStorage.removeItem(EXPERIENCE_ACTIVE_KEY);
    localStorage.removeItem(INSTALL_BANNER_KEY);
    localStorage.removeItem(WELCOME_KEY);
    localStorage.removeItem(ANALYTICS_CONSENT_KEY);
    localStorage.removeItem(MASTODON_INSTANCE_KEY);
    analyticsConsentGranted = false;
    updateAnalyticsConsentState({ consent: false });

    syncExperienceControls();
    setBlend(DEFAULT_SETTINGS.opacity);
    applyVolumes();
    renderExperiencePicker();
    renderLibrary();
    renderListEditor();
    updateHUD();
    showToast('Browser storage cleared. Your media files were not touched.', { timeout: 3500 });
    return true;
  } finally {
    browserStorageResetting = false;
  }
}

function updateHUD() {
  const p = currentPlaylistItem ? currentPlaylistItem.name : '—';
  const s = currentSlideshowItem ? currentSlideshowItem.name : '—';
  $('#hud-playlist').textContent = p.length > 28 ? p.slice(0,25)+'…' : p;
  $('#hud-slideshow').textContent = s.length > 28 ? s.slice(0,25)+'…' : s;
  const blendPct = Math.round((state.settings.opacity || 0.5) * 100);
  $('#hud-blend').textContent = blendPct + '%';
}

function updateVolumeLabels() {
  $('#vol-playlist-val').textContent = Math.round($('#vol-playlist').value * 100) + '%';
  $('#vol-slideshow-val').textContent = Math.round($('#vol-slideshow').value * 100) + '%';
  const master = $('#vol-master');
  if (master) $('#vol-master-val').textContent = Math.round(parseFloat(master.value || state.settings.masterVolume || 0) * 100) + '%';
}

function clampVolume(value) {
  const v = Number.isFinite(value) ? value : DEFAULT_SETTINGS.masterVolume;
  return Math.max(0, Math.min(1, v));
}

function syncMasterVolumeUI() {
  const value = clampVolume(state.settings.masterVolume);
  isMuted = value <= 0;
  const btn = $('#btn-mute');
  if (btn) {
    btn.textContent = isMuted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', isMuted ? 'Unmute master volume' : 'Mute master volume');
    btn.title = isMuted ? 'Unmute master volume (M)' : 'Mute master volume (M)';
  }
  const control = $('#master-volume-control');
  if (control) control.dataset.muted = isMuted ? 'true' : 'false';
  const slider = $('#vol-master');
  if (slider) slider.value = String(value);
  const label = $('#vol-master-val');
  if (label) label.textContent = Math.round(value * 100) + '%';
}

function setMasterVolume(value, opts = {}) {
  const next = clampVolume(value);
  state.settings.masterVolume = next;
  if (next > 0) lastNonZeroMasterVolume = next;
  syncMasterVolumeUI();
  updateVolumeLabels();
  applyVolumes();
  if (opts.save !== false) saveStateDebounced();
}

function setPlaylistVolume(value, opts = {}) {
  const next = clampVolume(value);
  state.settings.playlistVolume = next;
  const slider = $('#vol-playlist');
  if (slider) slider.value = String(next);
  updateVolumeLabels();
  applyVolumes();
  if (opts.save !== false) saveStateDebounced();
}

function setSlideshowVolume(value, opts = {}) {
  const next = clampVolume(value);
  state.settings.slideshowVolume = next;
  const slider = $('#vol-slideshow');
  if (slider) slider.value = String(next);
  updateVolumeLabels();
  applyVolumes();
  if (opts.save !== false) saveStateDebounced();
}

/**
 * Disable all interactive controls inside #transport while a URL-shared
 * experience is loading. #config-gear is a sibling of #transport, not a
 * descendant, so it is completely unaffected and remains fully functional.
 */
function freezeTransportControls() {
  const transport = $('#transport');
  if (!transport) return;
  transport.dataset.frozen = 'true';
  transport.querySelectorAll('button, input').forEach(el => {
    if (!el.disabled) {
      el.dataset.frozenByLoad = '1';
      el.disabled = true;
    }
  });
}

/**
 * Re-enable only the controls that were disabled by freezeTransportControls().
 * Controls that were already disabled before the freeze remain disabled.
 */
function unfreezeTransportControls() {
  const transport = $('#transport');
  if (!transport) return;
  delete transport.dataset.frozen;
  transport.querySelectorAll('[data-frozen-by-load]').forEach(el => {
    el.disabled = false;
    delete el.dataset.frozenByLoad;
  });
}

function wireTransport() {
  $('#btn-play').onclick = togglePlay;
  $('#btn-prev').onclick = () => previousBoth();
  $('#btn-next').onclick = () => nextBoth();
  $('#btn-stop').onclick = stopPlayback;
  $('#slideshow-prev').onclick = () => previousSlideshow();
  $('#slideshow-next').onclick = () => nextSlideshow();
  const shareBtn = $('#btn-share');
  if (shareBtn) {
    shareBtn.setAttribute('aria-haspopup', 'dialog');
    shareBtn.setAttribute('aria-label', 'Share current experience via URL');
    shareBtn.onclick = () => { void shareExperienceViaUrl(); };
  }

  const blend = $('#blend-slider');
  blend.oninput = () => {
    setBlend(parseInt(blend.value, 10) / 100);
  };

  $('#btn-fullscreen').onclick = () => {
    const v = $('#viewport');
    if (document.fullscreenElement) document.exitFullscreen();
    else v.requestFullscreen().catch(()=>{});
  };

  $('#btn-mute').onclick = toggleMute;

  // volume wiring
  ['vol-playlist','vol-slideshow','vol-master'].forEach(id => {
    const el = $('#' + id);
    el.oninput = () => {
      const value = parseFloat(el.value);
      if (id === 'vol-master') setMasterVolume(value);
      else if (id === 'vol-playlist') setPlaylistVolume(value);
      else setSlideshowVolume(value);
    };
  });

  $('#effect-intensity').onchange = (e) => {
    state.settings.effectIntensity = e.target.value;
    saveStateDebounced();
  };
  $('#theme-mode').onchange = (e) => {
    state.settings.themeMode = e.target.value;
    syncExperienceControls();
    saveStateDebounced();
  };
  $('#default-duration').onchange = (e) => {
    state.settings.defaultImageDuration = parseFloat(e.target.value) || 4;
    saveStateDebounced();
  };
  const playbackModeSelect = $('#experience-playback-mode');
  if (playbackModeSelect) {
    playbackModeSelect.onchange = (e) => {
      state.settings.experiencePlaybackMode = normalizeExperiencePlaybackMode(e.target.value);
      saveStateDebounced();
    };
  }
  const loopExperienceCatalogToggle = $('#loop-experience-catalog');
  if (loopExperienceCatalogToggle) {
    loopExperienceCatalogToggle.onchange = (e) => {
      state.settings.loopExperienceCatalog = !!e.target.checked;
      saveStateDebounced();
    };
  }
  const transitionDurationInput = $('#transition-duration');
  if (transitionDurationInput) {
    transitionDurationInput.oninput = (e) => {
      state.settings.transitionDurationMs = clampNumber(e.target.value, 200, 10000, DEFAULT_TRANSITION_SETTINGS.transitionDurationMs);
      applyNormalizedTransitionSettings(state.settings);
    };
    transitionDurationInput.onchange = () => saveStateDebounced();
  }
  const transitionOverlapInput = $('#transition-overlap');
  if (transitionOverlapInput) {
    transitionOverlapInput.oninput = (e) => {
      state.settings.transitionOverlapMs = clampNumber(e.target.value, 0, 10000, DEFAULT_TRANSITION_SETTINGS.transitionOverlapMs);
      applyNormalizedTransitionSettings(state.settings);
    };
    transitionOverlapInput.onchange = () => saveStateDebounced();
  }
  const transitionRandomizeOrder = $('#transition-randomize-order');
  if (transitionRandomizeOrder) {
    transitionRandomizeOrder.onchange = (e) => {
      state.settings.transitionRandomizeOrder = !!e.target.checked;
      applyNormalizedTransitionSettings(state.settings);
      saveStateDebounced();
    };
  }
  const transitionMaxHeavy = $('#transition-max-heavy');
  if (transitionMaxHeavy) {
    transitionMaxHeavy.onchange = (e) => {
      state.settings.transitionMaxHeavyInRow = clampNumber(e.target.value, 0, 8, DEFAULT_TRANSITION_SETTINGS.transitionMaxHeavyInRow);
      applyNormalizedTransitionSettings(state.settings);
      saveStateDebounced();
    };
  }
  const qualityAutoAdjust = $('#quality-auto-adjust');
  if (qualityAutoAdjust) {
    qualityAutoAdjust.onchange = (e) => {
      state.settings.qualityAutoAdjust = !!e.target.checked;
      applyNormalizedTransitionSettings(state.settings);
      saveStateDebounced();
    };
  }
  const showTransitionFps = $('#show-transition-fps');
  if (showTransitionFps) {
    showTransitionFps.onchange = (e) => {
      state.settings.showFps = !!e.target.checked;
      applyNormalizedTransitionSettings(state.settings);
      updateTransitionFpsHud();
      saveStateDebounced();
    };
  }
  ensureTransitionPickerRows();
  const transitionPicker = $('#enabled-transitions-list');
  if (transitionPicker) {
    const applyPicker = (save) => {
      const picked = readTransitionPickerRows();
      applyNormalizedTransitionSettings({ ...state.settings, ...picked });
      if (save) saveStateDebounced();
    };
    transitionPicker.addEventListener('input', (event) => {
      const input = event.target;
      if (input?.matches('[data-transition-weight]')) {
        const id = input.getAttribute('data-transition-weight');
        const value = clampNumber(input.value, 0, 100, 1);
        const label = $(`[data-transition-weight-value="${id}"]`);
        if (label) label.textContent = value.toFixed(1);
      }
      applyPicker(false);
    });
    transitionPicker.addEventListener('change', () => applyPicker(true));
  }
  $('#resume-on-load').onchange = (e) => { state.settings.resumeOnLoad = e.target.checked; saveStateDebounced(); };
  $('#auto-verify').onchange = (e) => { state.settings.autoVerifyOnStartup = e.target.checked; saveStateDebounced(); };
  const analyticsConsentToggle = $('#analytics-consent');
  if (analyticsConsentToggle) {
    analyticsConsentToggle.onchange = (event) => {
      analyticsConsentGranted = !!event.target.checked;
      updateAnalyticsConsentState({ consent: analyticsConsentGranted, announce: true });
    };
  }

  const storageBucketInput = $('#supabase-default-bucket');
  if (storageBucketInput) {
    storageBucketInput.onchange = event => {
      state.settings.storageDefaultBucket = String(event.target.value || '').trim() || RUNTIME_CONFIG.defaultBucket || 'media';
      syncIpfsControls();
      saveStateDebounced();
    };
  }
  const storageTtlInput = $('#supabase-signed-url-ttl');
  if (storageTtlInput) {
    storageTtlInput.onchange = event => {
      const seconds = Number(event.target.value);
      state.settings.storageSignedUrlTtlSeconds = Number.isFinite(seconds)
        ? Math.max(60, Math.min(60 * 60 * 24 * 30, Math.floor(seconds)))
        : RUNTIME_CONFIG.signedUrlTtlSeconds;
      syncIpfsControls();
      saveStateDebounced();
    };
  }
  const privateAuthToggle = $('#private-media-auth-required');
  if (privateAuthToggle) {
    privateAuthToggle.onchange = event => {
      state.settings.privateMediaRequiresAuth = !!event.target.checked;
      syncIpfsControls();
      saveStateDebounced();
    };
  }
  const signInBtn = $('#supabase-sign-in');
  if (signInBtn) {
    signInBtn.onclick = () => {
      void shareCurrentExperienceThroughIpfs();
    };
  }
  const signOutBtn = $('#supabase-sign-out');
  if (signOutBtn) {
    signOutBtn.onclick = async () => {
      try {
        await supabaseAuthClient.signOut();
        storageUrlResolver.clearCache();
        showToast('Signed out from Supabase.', { timeout: 2600 });
      } catch (error) {
        showToast(error?.message || 'Could not sign out', { timeout: 3000 });
      } finally {
        syncIpfsControls();
      }
    };
  }
}

function applyVolumes() {
  const mp = state.settings.playlistVolume * state.settings.masterVolume;
  const ms = state.settings.slideshowVolume * state.settings.masterVolume;
  if (playlistVideoA) playlistVideoA.volume = mp;
  if (playlistVideoB) playlistVideoB.volume = mp;
  if (slideshowMedia && slideshowMedia.tagName === 'VIDEO') {
    const item = currentSlideshowItem;
    const ref = state.slideshow[state.runtime.slideshowIndex];
    slideshowMedia.volume = (ref && ref.includeAudio ? ms : 0);
  }
}

function toggleMute() {
  const next = state.settings.masterVolume > 0
    ? 0
    : (lastNonZeroMasterVolume > 0 ? lastNonZeroMasterVolume : DEFAULT_SETTINGS.masterVolume);
  setMasterVolume(next);
}

// Manual skip implies "play": engage the PLAYING transport so the newly
// loaded item actually advances (and the paused/stopped banked state is
// abandoned in favor of the item the user navigated to).
function engagePlaybackForNavigation() {
  if (transportMode !== TRANSPORT.PLAYING) applyTransportMode(TRANSPORT.PLAYING);
}

function nextBoth() {
  engagePlaybackForNavigation();
  if (state.playlist.length) advancePlaylist({ reason: 'manual_next' });
  if (state.slideshow.length) advanceSlideshow({ reason: 'manual_next' });
}

function previousBoth() {
  engagePlaybackForNavigation();
  // use history when available
  const plH = state.runtime.historyPlaylist;
  if (plH.length) {
    void playPlaylistAtIndex(plH.pop(), { direction: -1 });
  } else if (state.playlist.length) {
    void playPlaylistAtIndex(state.runtime.playlistIndex - 1, { direction: -1 });
  }

  if (state.slideshow.length) {
    void playSlideshowAtIndex(state.runtime.slideshowIndex - 1, { direction: -1, withCrossfade: false });
  }
}

function previousSlideshow() {
  if (!state.slideshow.length) return;
  engagePlaybackForNavigation();
  void playSlideshowAtIndex(state.runtime.slideshowIndex - 1, { direction: -1, withCrossfade: true });
}

function nextSlideshow() {
  if (!state.slideshow.length) return;
  engagePlaybackForNavigation();
  void playSlideshowAtIndex(state.runtime.slideshowIndex + 1, { direction: 1, withCrossfade: true, allowWrap: true });
}

// ====================== CONFIG PANEL ======================
let configFocusReturn = null;
let configTrapHandler = null;

// Returns the visible, tabbable elements inside a container, in DOM order.
function focusableWithin(container) {
  const selector = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  return $all(selector, container).filter(el => {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    // offsetParent is null for display:none; allow position:fixed elements too.
    return el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
  });
}

// Generic Tab focus trap for a modal container.
function trapFocusWithin(event, container) {
  if (event.key !== 'Tab') return;
  const focusable = focusableWithin(container);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function openConfig() {
  const panel = $('#config-panel');
  if (panel.classList.contains('open')) return;
  configFocusReturn = document.activeElement;
  panel.classList.add('open');
  panel.style.removeProperty('transform');
  panel.setAttribute('aria-hidden', 'false');
  $('#config-backdrop').classList.add('open');
  document.body.classList.add('config-open');
  syncExperienceControls();
  renderExperiencePicker();
  renderLibrary();
  renderListEditor();
  configTrapHandler = (event) => trapFocusWithin(event, panel);
  panel.addEventListener('keydown', configTrapHandler);
  const focusTarget = $('#experience-select') || $('#close-config') || panel;
  requestAnimationFrame(() => { try { focusTarget.focus(); } catch (_) {} });
}

function closeConfig() {
  const panel = $('#config-panel');
  if (!panel.classList.contains('open')) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  $('#config-backdrop').classList.remove('open');
  document.body.classList.remove('config-open');
  if (configTrapHandler) {
    panel.removeEventListener('keydown', configTrapHandler);
    configTrapHandler = null;
  }
  if (configFocusReturn && typeof configFocusReturn.focus === 'function') {
    try { configFocusReturn.focus(); } catch (_) {}
  }
  configFocusReturn = null;
}

// ====================== INFORMATION DIALOG ======================
const INFO_SCROLL_KEY = 'blend-info-scroll-v1';
const INFO_ACTIVE_TAB_KEY = 'blend-info-active-tab-v1';
let infoReadmeLoaded = false;
let infoScrollSaveTimer = null;

function wireInfoDialog() {
  const modal = $('#info-modal');
  const openBtn = $('#open-info');
  if (!modal) return;
  if (openBtn) openBtn.onclick = () => { void openInfoDialog(); };
  const closeBtn = $('#info-close');
  if (closeBtn) closeBtn.onclick = () => modal.close();

  $all('.info-tab', modal).forEach(tab => {
    tab.onclick = () => activateInfoTab(tab.dataset.tab, { focusTab: true });
    tab.addEventListener('keydown', onInfoTabKeydown);
  });

  $all('.info-panel', modal).forEach(panel => {
    panel.addEventListener('scroll', () => {
      clearTimeout(infoScrollSaveTimer);
      infoScrollSaveTimer = setTimeout(saveInfoScrollPositions, 200);
    }, { passive: true });
  });

  // Dismiss when clicking the backdrop (outside the dialog content box).
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.close();
  });
  modal.addEventListener('close', () => {
    saveInfoScrollPositions();
    document.body.classList.remove('info-open');
    try { $('#open-info')?.focus(); } catch (_) {}
  });
}

async function openInfoDialog() {
  const modal = $('#info-modal');
  if (!modal) return;
  await ensureReadmeRendered();
  const activeTab = localStorage.getItem(INFO_ACTIVE_TAB_KEY) || 'about';
  activateInfoTab(activeTab, { focusTab: false, restoreScroll: false });
  document.body.classList.add('info-open');
  if (typeof modal.showModal === 'function') {
    if (!modal.open) modal.showModal();
  } else {
    modal.setAttribute('open', '');
  }
  // Restore banked scroll positions after the dialog has laid out.
  requestAnimationFrame(() => restoreInfoScroll(activeTab));
}

async function ensureReadmeRendered() {
  if (infoReadmeLoaded) return;
  const target = $('#info-readme-content');
  if (!target) return;
  try {
    const res = await fetch('./README.md', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const markdown = await res.text();
    target.innerHTML = renderMarkdown(markdown);
    infoReadmeLoaded = true;
  } catch (error) {
    log.warn('README load failed', error);
    target.innerHTML = '<p class="info-readme-status">The README could not be loaded in this context. '
      + 'Visit <a href="https://mytech.today/" target="_blank" rel="noopener noreferrer">mytech.today</a> for documentation.</p>';
  }
}

function activateInfoTab(name, { focusTab = false } = {}) {
  const modal = $('#info-modal');
  if (!modal) return;
  // Bank the scroll of the panel we're leaving before switching.
  saveInfoScrollPositions();
  const tabName = name === 'readme' ? 'readme' : 'about';
  $all('.info-tab', modal).forEach(tab => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
    if (active && focusTab) { try { tab.focus(); } catch (_) {} }
  });
  $all('.info-panel', modal).forEach(panel => {
    const active = panel.dataset.tab === tabName;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  localStorage.setItem(INFO_ACTIVE_TAB_KEY, tabName);
  requestAnimationFrame(() => restoreInfoScroll(tabName));
}

function onInfoTabKeydown(event) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  event.preventDefault();
  const tabs = $all('.info-tab', $('#info-modal'));
  const current = tabs.findIndex(tab => tab.classList.contains('active'));
  if (current < 0) return;
  const delta = event.key === 'ArrowRight' ? 1 : -1;
  const next = tabs[(current + delta + tabs.length) % tabs.length];
  activateInfoTab(next.dataset.tab, { focusTab: true });
}

function readInfoScrollStore() {
  try { return JSON.parse(localStorage.getItem(INFO_SCROLL_KEY)) || {}; }
  catch (_) { return {}; }
}

function saveInfoScrollPositions() {
  const modal = $('#info-modal');
  if (!modal) return;
  const store = readInfoScrollStore();
  let changed = false;
  $all('.info-panel', modal).forEach(panel => {
    // Only record panels that are actually laid out (visible). When the dialog
    // is closed/reopening the panel is display:none with scrollTop 0 — saving
    // it then would clobber the position we banked while it was open.
    if (!panel.hidden && panel.clientHeight > 0) {
      store[panel.dataset.tab] = Math.round(panel.scrollTop);
      changed = true;
    }
  });
  if (changed) {
    try { localStorage.setItem(INFO_SCROLL_KEY, JSON.stringify(store)); } catch (_) {}
  }
}

function restoreInfoScroll(name) {
  const modal = $('#info-modal');
  const panel = modal?.querySelector(`.info-panel[data-tab="${name}"]`);
  if (!panel) return;
  const store = readInfoScrollStore();
  if (typeof store[name] === 'number') panel.scrollTop = store[name];
}

function wireConfig() {
  $('#config-gear').onclick = () => {
    if ($('#config-panel').classList.contains('open')) closeConfig();
    else openConfig();
  };
  $('#close-config').onclick = closeConfig;
  $('#config-backdrop').onclick = closeConfig;

  const experienceSelect = $('#experience-select');
  experienceSelect.onchange = async (e) => {
    const targetId = String(e.target.value || '');
    log.info('[experience] selector commit', experienceDebugContext({
      targetId,
      activeId: state.activeExperienceId
    }));
    if (!targetId || targetId === state.activeExperienceId) return;
    try {
      await switchExperienceById(targetId);
    } catch (error) {
      log.error('[experience] selector commit failed', experienceDebugContext({
        targetId,
        activeId: state.activeExperienceId,
        error
      }));
      syncExperienceControls();
      renderExperiencePicker();
    }
  };
  $('#experience-new').onclick = () => createExperience();
  $('#experience-rename').onclick = () => renameCurrentExperience();
  $('#experience-delete').onclick = () => deleteCurrentExperience();
  $('#experience-import').onclick = () => importExperience();
  $('#experience-export').onclick = () => exportExperience();
  const shareUrlBtn = $('#experience-share-url');
  if (shareUrlBtn) shareUrlBtn.onclick = () => { void shareExperienceViaUrl(); };
  $('#clear-browser-storage').onclick = clearBrowserStorage;

  // add buttons
  $('#add-files').onclick = addFilesFromPicker;
  $('#add-folder').onclick = addFolderFromPicker;
  $('#add-url').onclick = addUrlsFromPrompt;
  $('#library-sort').onclick = (e) => showLibrarySortMenu(e.currentTarget);
  $('#clear-library').onclick = clearLibraryView;
  $('#remove-stale').onclick = removeStale;

  $('#add-selected-playlist').onclick = () => {
    const ids = Array.from(state.ui.selectedLibrary);
    addToList('playlist', ids);
    state.ui.selectedLibrary.clear();
    refreshLibraryRows();
  };
  $('#add-selected-slideshow').onclick = () => {
    const ids = Array.from(state.ui.selectedLibrary);
    addToList('slideshow', ids);
    state.ui.selectedLibrary.clear();
    refreshLibraryRows();
  };
  $('#remove-selected-library').onclick = removeSelectedLibraryItems;

  // search
  const search = $('#library-search');
  search.oninput = debounce(() => {
    state.ui.search = search.value;
    renderLibrary();
  }, 120);

  // pills
  $all('.type-pill').forEach(p => {
    p.onclick = (event) => {
      event.preventDefault();
      filterLibrary(p.dataset.filter);
    };
  });
  $all('.source-pill').forEach(p => {
    p.onclick = () => filterLibrarySource(p.dataset.sourceFilter);
  });

  // segmented
  $all('.segmented button').forEach(b => {
    b.onclick = () => setActiveList(b.dataset.tab);
  });

  // list actions
  $('#list-clear').onclick = () => clearList(state.ui.activeList);
  $('#list-shuffle').onclick = () => shuffleList(state.ui.activeList);
  $('#list-sort').onclick = (e) => showSortMenu(e.currentTarget);
  $('#list-reverse').onclick = () => reverseList(state.ui.activeList);
  $('#list-resolve-links').onclick = () => resolveUnavailableListLinks();
  $('#list-export').onclick = (e) => showExportMenu(e.currentTarget);
  $('#list-import').onclick = importList;

  // drag drop on library grid for OS files
  wireLibraryGridEvents();
  wireListEditorEvents();
  const grid = $('#library-grid');
  grid.ondragover = e => { e.preventDefault(); grid.classList.add('drag-over'); };
  grid.ondragleave = () => grid.classList.remove('drag-over');
  grid.ondrop = async (e) => {
    e.preventDefault(); grid.classList.remove('drag-over');
    const entries = await collectDropEntries(e.dataTransfer);
    const handles = [];
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        const progress = showToast(`Scanning "${entry.handle.name}"... 0 files found`, { timeout: 0 });
        const found = await walkDirectoryForMedia(entry.handle, {
          onProgress: count => { progress.label.textContent = `Scanning "${entry.handle.name}"... ${count} files found`; }
        });
        progress.close();
        const directoryId = rememberDirectoryHandle(entry.handle);
        await addHandles(found, { directoryId });
      } else if (entry.kind === 'file' && entry.handle && getMediaType(entry.handle.name)) {
        handles.push(entry.handle);
      }
    }
    if (handles.length) await addHandles(handles);
  };

  // global settings live
  $('#vol-playlist').oninput = () => { setPlaylistVolume(parseFloat($('#vol-playlist').value)); };
  $('#import-behavior').onchange = e => { state.settings.importBehavior = e.target.value; saveStateDebounced(); };
  // (others already wired in wireTransport)

  // keyboard focus hint
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName === 'BODY') {
      e.preventDefault(); $('#library-search').focus(); openConfig();
    }
  });
}

function addAllVisible(which) {
  const q = state.ui.search.toLowerCase();
  const f = state.ui.currentFilter;
  const sf = state.ui.currentSourceFilter || 'all';
  const visible = getVisibleLibraryEntries(q, f, sf).map(([id]) => id);
  addToList(which, visible);
}

function showButtonMenu(anchor, options) {
  closeFloatingMenus();
  anchor.setAttribute('aria-expanded', 'true');
  const menu = document.createElement('div');
  menu.className = 'floating-menu';
  menu.setAttribute('role', 'menu');
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = opt.label;
    btn.onclick = () => {
      closeFloatingMenus();
      opt.run();
    };
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth || 170;
  menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px';
  menu.style.top = Math.min(rect.bottom + 6, innerHeight - menu.offsetHeight - 8) + 'px';
  const closeOnOutside = ev => {
    if (!menu.contains(ev.target) && ev.target !== anchor) closeFloatingMenus();
  };
  setTimeout(() => document.addEventListener('pointerdown', closeOnOutside, { once: true }), 0);
  menu.querySelector('button')?.focus();
}

function closeFloatingMenus() {
  $all('.floating-menu').forEach(m => m.remove());
  $all('[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function showSortMenu(anchor) {
  const which = state.ui.activeList;
  showButtonMenu(anchor, [
    { label: 'Filename (A-Z)', run: () => sortList(which, 'name', 'asc') },
    { label: 'Filename (Z-A)', run: () => sortList(which, 'name', 'desc') },
    { label: 'Full Path (A-Z)', run: () => sortList(which, 'path', 'asc') },
    { label: 'Full Path (Z-A)', run: () => sortList(which, 'path', 'desc') },
    { label: 'Duration (short first)', run: () => sortList(which, 'duration', 'asc') },
    { label: 'Duration (long first)', run: () => sortList(which, 'duration', 'desc') },
    { label: 'Date Added (oldest first)', run: () => sortList(which, 'date', 'asc') },
    { label: 'Date Added (newest first)', run: () => sortList(which, 'date', 'desc') },
    { label: 'Type (A-Z)', run: () => sortList(which, 'type', 'asc') },
    { label: 'Type (Z-A)', run: () => sortList(which, 'type', 'desc') },
    { label: 'Size (small first)', run: () => sortList(which, 'size', 'asc') },
    { label: 'Size (large first)', run: () => sortList(which, 'size', 'desc') }
  ]);
}

function showLibrarySortMenu(anchor) {
  showButtonMenu(anchor, [
    { label: 'Filename (A-Z)', run: () => sortLibrary('name', 'asc') },
    { label: 'Filename (Z-A)', run: () => sortLibrary('name', 'desc') },
    { label: 'Full Path (A-Z)', run: () => sortLibrary('path', 'asc') },
    { label: 'Full Path (Z-A)', run: () => sortLibrary('path', 'desc') },
    { label: 'File Size (small first)', run: () => sortLibrary('size', 'asc') },
    { label: 'File Size (large first)', run: () => sortLibrary('size', 'desc') },
    { label: 'Type (A-Z)', run: () => sortLibrary('type', 'asc') },
    { label: 'Type (Z-A)', run: () => sortLibrary('type', 'desc') },
    { label: 'Date Added (oldest first)', run: () => sortLibrary('date', 'asc') },
    { label: 'Date Added (newest first)', run: () => sortLibrary('date', 'desc') },
    { label: 'Duration (short first)', run: () => sortLibrary('duration', 'asc') },
    { label: 'Duration (long first)', run: () => sortLibrary('duration', 'desc') },
    { label: 'Metadata (A-Z)', run: () => sortLibrary('metadata', 'asc') },
    { label: 'Metadata (Z-A)', run: () => sortLibrary('metadata', 'desc') }
  ]);
}

function sortLibrary(key, dir) {
  state.settings.librarySortKey = key;
  state.settings.librarySortDir = dir;
  renderLibrary();
  saveStateDebounced();
  showToast('Sorted Media Library');
}

function showExportMenu(anchor) {
  const which = state.ui.activeList;
  showButtonMenu(anchor, [
    { label: 'Export JSON', run: () => exportList(which, 'json') },
    { label: 'Export .txt', run: () => exportList(which, 'txt') },
    { label: 'Export Media Library JSON', run: () => exportMediaLibrary() },
    { label: 'Export Full Experience JSON', run: () => exportExperience() }
  ]);
}

// ====================== IMPORT / EXPORT ======================
function exportItemRecord(ref, index, which) {
  const item = state.library.get(ref.id);
  const path = normalizePathForExport(item ? bestPathForItem(item) : ref.path || ref.id);
  const available = isPlayableListRef(which, ref);
  const record = {
    order: index,
    id: ref.id,
    path,
    fullPath: path,
    pathKind: pathKind(path),
    name: item?.name || ref.name || basenameFromPath(path) || ref.id,
    type: item?.type || ref.type,
    size: item?.size || 0,
    duration: item?.duration || null,
    addedAt: ref.addedAt || item?.addedAt || null,
    displayDuration: ref.displayDuration,
    includeAudio: ref.includeAudio,
    available
  };
  if (item?.sourceUrl) record.sourceUrl = normalizePathForExport(item.sourceUrl);
  const metadata = ref.metadata || item?.metadata;
  if (metadata && typeof metadata === 'object') record.metadata = clonePlain(metadata);
  const social = normalizeSocialObject(ref.social || ref.share || ref.og || metadata?.social || metadata?.share || metadata?.og);
  if (social) record.social = social;
  return record;
}

function exportLibraryRecord(item, index) {
  const path = normalizePathForExport(bestPathForItem(item));
  const record = {
    order: index,
    id: item.id,
    path,
    fullPath: path,
    pathKind: pathKind(path),
    name: item.name,
    type: item.type,
    size: item.size || 0,
    duration: item.duration || null,
    addedAt: item.addedAt || item.lastVerified || null,
    stale: !!item.stale,
    metadata: item.metadata && typeof item.metadata === 'object' ? clonePlain(item.metadata) : undefined
  };
  if (item.sourceUrl) record.sourceUrl = normalizePathForExport(item.sourceUrl);
  const social = normalizeSocialObject(record.metadata?.social || record.metadata?.share || record.metadata?.og);
  if (social) record.social = social;
  return record;
}

function makeListExportPayload(which) {
  const list = which === 'playlist' ? state.playlist : state.slideshow;
  const items = list.map((ref, index) => exportItemRecord(ref, index, which));
  const meta = normalizeListMeta(which, state.listMeta[which]);
  return {
    version: VERSION,
    schema: 'player.blend.list.v1',
    type: which,
    name: meta.name,
    description: meta.description,
    createdAt: meta.createdAt,
    project: state.projectName,
    exportedAt: new Date().toISOString(),
    order: items.map(item => item.id),
    items
  };
}

function exportList(which, format = 'json') {
  const payload = makeListExportPayload(which);
  const date = new Date().toISOString().slice(0,10);
  if (format === 'txt') {
    downloadBlob(payload.items.map(it => quotePath(it.path)).join('\r\n') + '\r\n', `blend-${which}-${date}.txt`, 'text/plain');
    return;
  }
  downloadJson(payload, `blend-${which}-${date}.json`);
  showToast(`Exported ${which} JSON (${payload.items.length} item${payload.items.length === 1 ? '' : 's'})`);
}

function exportMediaLibrary() {
  const items = sortLibraryEntries(Array.from(state.library.entries())).map(([, item], index) => exportLibraryRecord(item, index));
  const payload = {
    version: VERSION,
    schema: 'player.blend.library.v1',
    type: 'library',
    project: state.projectName,
    exportedAt: new Date().toISOString(),
    sort: {
      key: state.settings.librarySortKey || 'date',
      dir: state.settings.librarySortDir || 'asc'
    },
    order: items.map(item => item.id),
    items
  };
  downloadJson(payload, `blend-library-${new Date().toISOString().slice(0,10)}.json`);
  showToast(`Exported Media Library JSON (${items.length} item${items.length === 1 ? '' : 's'})`);
}

function exportExperience() {
  const payload = buildExperienceExportPayload();
  downloadJson(payload, experienceExportFilename(state.projectName));
  showToast(`Exported ${state.projectName} experience JSON`);
}

function downloadJson(payload, filename) {
  downloadBlob(JSON.stringify(payload, null, 2), filename, 'application/json');
}

function downloadBlob(text, filename, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  scheduleObjectUrlRevoke(a.href, 1000);
}

async function importList() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,.jsonl,.txt,.md'; inp.multiple = true;
  inp.onchange = async () => {
    for (const file of Array.from(inp.files || [])) {
      await importListFromFile(file, { which: state.ui.activeList });
    }
  };
  inp.click();
}

async function importListFromFile(file, opts = {}) {
  try {
    const text = await file.text();
    const parsed = parseImportEntries(text, file.name);
    const which = opts.which || parsed.which || state.ui.activeList;
    if (!parsed.entries.length) {
      showToast(`No media paths found in ${file.name}`, { timeout: 2400 });
      return null;
    }
    return await importEntries(parsed.entries, { which, sourceName: file.name, meta: parsed.meta });
  } catch (e) {
    log.error('import failed', e);
    showToast(`Import failed for ${file.name}: ${e.message || 'Invalid file'}`);
    return null;
  }
}

function parseImportEntries(text, filename = '') {
  const ext = getFileExt(filename);
  if (ext === 'json') {
    try {
      const parsed = JSON.parse(text);
      return parseJsonImportPayload(parsed);
    } catch (e) {
      throw new Error('Malformed JSON');
    }
  }
  if (ext === 'jsonl') {
    const entries = [];
    text.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try { entries.push(...normalizeImportItems([JSON.parse(trimmed)])); }
      catch (_) { entries.push(...parseTextPathEntries(trimmed, filename)); }
    });
    return { entries };
  }
  return { entries: parseTextPathEntries(text, filename) };
}

function parseJsonImportPayload(parsed) {
  if (Array.isArray(parsed)) return { entries: normalizeImportItems(parsed) };
  if (!parsed || typeof parsed !== 'object') throw new Error('JSON must be an object or array');

  if (parsed.type === 'experience') {
    const active = state.ui.activeList || 'playlist';
    const branch = parsed[active] || parsed.playlist || parsed.slideshow;
    return parseJsonImportPayload({ ...branch, type: branch?.type || active });
  }

  if (parsed.type === 'library') {
    return { which: state.ui.activeList, entries: normalizeImportItems(applyImportOrder(parsed.items || [], parsed.order)) };
  }

  const items = applyImportOrder(parsed.items || [], parsed.order);
  const which = (parsed.type === 'playlist' || parsed.type === 'slideshow') ? parsed.type : undefined;
  return {
    which,
    meta: which ? extractListMeta(parsed, which) : null,
    entries: normalizeImportItems(items)
  };
}

function parseExperienceImportPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('JSON must be an object');
  const isExperience = parsed.type === 'experience' || String(parsed.schema || '').includes('experience');
  if (!isExperience) throw new Error('Not an experience JSON file');

  const playlistBranch = parsed.playlist ? parseJsonImportPayload(parsed.playlist) : { entries: [], meta: null };
  const slideshowBranch = parsed.slideshow ? parseJsonImportPayload(parsed.slideshow) : { entries: [], meta: null };
  return {
    name: normalizeExperienceName(parsed.name || parsed.project || parsed.projectName || parsed.experienceName || parsed.title || DEFAULT_EXPERIENCE_NAME),
    settings: {
      ...DEFAULT_SETTINGS,
      ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {})
    },
    playlistEntries: playlistBranch.entries || [],
    slideshowEntries: slideshowBranch.entries || [],
    playlistMeta: playlistBranch.meta || null,
    slideshowMeta: slideshowBranch.meta || null,
    libraryItems: Array.isArray(parsed.library?.items)
      ? parsed.library.items.map(normalizeImportedLibraryRecord).filter(Boolean)
      : []
  };
}

function applyImportOrder(items, order) {
  if (!Array.isArray(items)) return [];
  if (!Array.isArray(order) || !order.length) {
    return items.slice().sort((a, b) => {
      const ao = Number.isFinite(a?.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(b?.order) ? b.order : Number.MAX_SAFE_INTEGER;
      return ao - bo;
    });
  }
  const byId = new Map(items.map(item => [String(item.id ?? item.path ?? item.name), item]));
  const ordered = order.map(id => byId.get(String(id))).filter(Boolean);
  const used = new Set(ordered);
  return ordered.concat(items.filter(item => !used.has(item)));
}

function deriveImportedSourceUrl(record, path, metadata = {}) {
  const rawSource = sanitizeImportPath(record?.sourceUrl || '');
  if (rawSource && isPortableRemoteRef(rawSource, { allowSupabaseBucketPath: true })) return rawSource;

  const storageReference = sanitizeImportPath(record?.storageReference || metadata?.storageReference || '');
  if (storageReference && isPortableRemoteRef(storageReference, { allowSupabaseBucketPath: true })) return storageReference;

  const bucket = String(record?.storageBucket || record?.bucket || metadata?.storageBucket || metadata?.bucket || '').trim();
  const objectPath = String(record?.storagePath || record?.objectPath || metadata?.storagePath || metadata?.path || '').trim();
  if (bucket && objectPath) {
    const built = sanitizeSupabaseRef(`supabase://${bucket}/${objectPath}`);
    if (built) return built;
  }

  const pathKind = String(record?.pathKind || record?.sourceKind || metadata?.pathKind || metadata?.sourceKind || '').trim().toLowerCase();
  if ((pathKind === 'remote' || pathKind === 'url' || pathKind === 'supabase')
      && isPortableRemoteRef(path, { allowSupabaseBucketPath: true })) {
    return sanitizeImportPath(path);
  }
  return isPortableRemoteRef(path) ? path : '';
}

function normalizeImportItems(items) {
  return (items || []).map(item => {
    if (typeof item === 'string') {
      const path = sanitizeImportPath(item);
      return path ? { path, sourceUrl: isPortableRemoteRef(path) ? path : '' } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const path = sanitizeImportPath(item.fullPath || item.path || item.file || item.relativePath || item.name || item.title);
    if (!path) return null;
    let metadata = item.metadata && typeof item.metadata === 'object'
      ? clonePlain(item.metadata)
      : (item.customMetadata && typeof item.customMetadata === 'object' ? clonePlain(item.customMetadata) : undefined);
    const social = normalizeSocialObject(
      item.social ||
      item.share ||
      item.og ||
      metadata?.social ||
      metadata?.share ||
      metadata?.og
    );
    if (social) {
      const baseMetadata = metadata && typeof metadata === 'object' ? metadata : {};
      baseMetadata.social = {
        ...(baseMetadata.social && typeof baseMetadata.social === 'object' ? baseMetadata.social : {}),
        ...social
      };
      if (baseMetadata.share && typeof baseMetadata.share === 'object') delete baseMetadata.share;
      if (baseMetadata.og && typeof baseMetadata.og === 'object') delete baseMetadata.og;
      metadata = baseMetadata;
    }
    return {
      id: item.id,
      path,
      fullPath: sanitizeImportPath(item.fullPath || '') || path,
      name: normalizeExperienceName(item.name || item.title || basenameFromPath(path) || ''),
      sourceUrl: deriveImportedSourceUrl(item, path, metadata || {}),
      displayDuration: item.displayDuration,
      includeAudio: item.includeAudio,
      order: item.order,
      type: item.type,
      available: item.available,
      reason: item.reason || item.unavailableReason || item.status,
      metadata
    };
  }).filter(Boolean);
}

function normalizeImportedLibraryRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = String(record.id || '').trim();
  if (!id) return null;
  const pathHint = sanitizeImportPath(record.path || record.fullPath || record.pathHint || record.relativePath || '');
  const sourceUrl = deriveImportedSourceUrl(record, pathHint, record.metadata && typeof record.metadata === 'object' ? record.metadata : {});
  const name = String(record.name || basenameFromPath(pathHint) || id).replace(/\s+/g, ' ').trim() || id;
  const type = ['video', 'audio', 'image'].includes(record.type) ? record.type : getMediaType(pathHint || name);
  if (!type) return null;
  let metadata = record.metadata && typeof record.metadata === 'object' ? clonePlain(record.metadata) : undefined;
  const social = normalizeSocialObject(
    record.social ||
    record.share ||
    record.og ||
    metadata?.social ||
    metadata?.share ||
    metadata?.og
  );
  if (social) {
    const baseMetadata = metadata && typeof metadata === 'object' ? metadata : {};
    baseMetadata.social = {
      ...(baseMetadata.social && typeof baseMetadata.social === 'object' ? baseMetadata.social : {}),
      ...social
    };
    if (baseMetadata.share && typeof baseMetadata.share === 'object') delete baseMetadata.share;
    if (baseMetadata.og && typeof baseMetadata.og === 'object') delete baseMetadata.og;
    metadata = baseMetadata;
  }
  return {
    id,
    handle: sourceUrl ? remoteHandleFromUrl(sourceUrl, name) : null,
    name,
    size: Number.isFinite(record.size) ? record.size : 0,
    type,
    duration: Number.isFinite(record.duration) ? record.duration : null,
    pathHint: pathHint || fallbackRelativePath(name),
    sourceUrl: sourceUrl || null,
    metadata,
    addedAt: record.addedAt || record.lastVerified || Date.now(),
    lastVerified: record.lastVerified || record.addedAt || Date.now(),
    stale: !sourceUrl,
    importedFromExperience: true
  };
}

function ensureImportedLibraryRecord(record) {
  const normalized = normalizeImportedLibraryRecord(record);
  if (!normalized) return null;
  const existing = state.library.get(normalized.id);
  if (existing) {
    existing.name = existing.name || normalized.name;
    existing.size = existing.size || normalized.size;
    existing.type = existing.type || normalized.type;
    existing.duration = existing.duration ?? normalized.duration;
    existing.pathHint = existing.pathHint || normalized.pathHint;
    existing.sourceUrl = existing.sourceUrl || normalized.sourceUrl || null;
    existing.metadata = { ...(existing.metadata || {}), ...(normalized.metadata || {}) };
    if (!existing.handle) existing.stale = true;
    return existing;
  }
  state.library.set(normalized.id, normalized);
  return normalized;
}

async function materializeImportedEntries(entries, opts = {}) {
  const which = opts.which || state.ui.activeList;
  const allowed = allowedListTypes(which);
  const preserveMissing = !!opts.preserveMissing;
  const preserveDuplicates = opts.preserveDuplicates ?? preserveMissing;
  const seen = preserveDuplicates ? new Set() : new Set((opts.existingIds || []).map(id => String(id)));
  const importedLibraryRecords = opts.libraryRecordsById || new Map();
  const items = [];
  const missing = [];
  let imported = 0, incompatible = 0, duplicate = 0, unavailable = 0;

  // Per-item progress reporting — each iteration increments this counter and
  // calls opts.onProgress({ done, total, name, id, status }) if provided.
  const totalEntries = (entries || []).length;
  let processedEntries = 0;
  const _reportItem = (name, id, status) => {
    if (typeof opts.onProgress === 'function') {
      opts.onProgress({ done: ++processedEntries, total: totalEntries, name, id, status });
    }
  };

  for (const entry of entries || []) {
    const directId = entry?.id != null ? String(entry.id) : '';
    const importedRecord = directId && importedLibraryRecords.has(directId) ? importedLibraryRecords.get(directId) : null;
    const entrySourceUrl = sanitizeImportPath(entry?.sourceUrl || '');
    const entryPath = sanitizeImportPath(entry?.path || '');
    const remoteReference = entrySourceUrl || '';
    const remoteCandidate = (
      (remoteReference && isPortableRemoteRef(remoteReference, { allowSupabaseBucketPath: true })) ||
      (!remoteReference && isPortableRemoteRef(entryPath))
    );
    let id = directId && state.library.has(directId) ? directId : null;
    let item = id ? state.library.get(id) : null;
    if (!item && entryPath && !remoteCandidate) {
      id = findLibraryMatch(entryPath);
      item = id ? state.library.get(id) : null;
    }
    if (!item && remoteCandidate) {
      try {
        const fetched = await addRemoteMediaUrl(remoteReference || entryPath, {
          pathHint: remoteReference || entryPath,
          metadata: {
            ...(importedRecord?.metadata && typeof importedRecord.metadata === 'object' ? importedRecord.metadata : {}),
            ...(entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}),
            sourceUrl: remoteReference || entryPath
          }
        });
        id = fetched.id;
        item = id ? state.library.get(id) : fetched.item || null;
      } catch (error) {
        log.warn('Remote media import failed', error);
      }
    }
    if (importedRecord) {
      if (!item) {
        if (importedRecord.sourceUrl) {
          try {
            const fetched = await addRemoteMediaUrl(importedRecord.sourceUrl, {
              pathHint: importedRecord.pathHint || importedRecord.sourceUrl,
              metadata: importedRecord.metadata || undefined
            });
            id = fetched.id;
            item = id ? state.library.get(id) : fetched.item || null;
          } catch (error) {
            log.warn('Imported remote media could not be reloaded', error);
          }
        }
        if (!item && !preserveMissing) {
          item = ensureImportedLibraryRecord(importedRecord);
          id = item?.id || directId || importedRecord.id || null;
        }
      }
      if (item) {
        if (!item.pathHint && importedRecord.pathHint) item.pathHint = importedRecord.pathHint;
        if (!item.sourceUrl && importedRecord.sourceUrl) item.sourceUrl = importedRecord.sourceUrl;
        if (importedRecord.metadata && typeof importedRecord.metadata === 'object') {
          item.metadata = { ...(item.metadata || {}), ...importedRecord.metadata };
        }
        if (importedRecord.sourceUrl && (!item.handle || item.stale)) {
          try {
            const fetched = await addRemoteMediaUrl(importedRecord.sourceUrl, {
              pathHint: importedRecord.pathHint || importedRecord.sourceUrl,
              metadata: importedRecord.metadata || undefined
            });
            id = fetched.id;
            item = id ? state.library.get(id) : fetched.item || item;
          } catch (error) {
            log.warn('Imported remote media could not be reloaded', error);
          }
        }
        if (!item.handle) item.stale = true;
      }
    }

    const resolvedId = id || directId || importedRecord?.id || null;
    const resolvedPath = entryPath || importedRecord?.pathHint || importedRecord?.path || entrySourceUrl || '';
    const resolvedName = normalizeExperienceName(entry.name || entry.title || basenameFromPath(resolvedPath) || resolvedId || 'Media item');
    const resolvedType = entry.type || item?.type || importedRecord?.type || getMediaType(resolvedPath) || '';

    if (!preserveDuplicates && resolvedId && seen.has(String(resolvedId))) {
      duplicate++;
      // Duplicates are silently skipped; report as 'loaded' since the item already exists.
      _reportItem(resolvedName, resolvedId, 'loaded');
      continue;
    }

    if (!item) {
      missing.push({ ...entry, path: resolvedPath, basename: basenameFromPath(resolvedPath) });
      if (preserveMissing) {
        items.push(createUnavailableListRef(which, {
          ...entry,
          path: resolvedPath,
          name: resolvedName,
          type: resolvedType,
          sourceUrl: entrySourceUrl || importedRecord?.sourceUrl || ''
        }, {
          id: resolvedId || `missing-${uid()}`,
          path: resolvedPath,
          name: resolvedName,
          type: resolvedType,
          sourceUrl: entrySourceUrl || importedRecord?.sourceUrl || '',
          metadata: entry.metadata || importedRecord?.metadata,
          displayDuration: entry.displayDuration,
          includeAudio: entry.includeAudio,
          reason: 'missing'
        }));
        unavailable++;
      }
      _reportItem(resolvedName, resolvedId, 'missing');
      continue;
    }

    if (!allowed.includes(item.type)) {
      incompatible++;
      if (preserveMissing) {
        items.push(createUnavailableListRef(which, {
          ...entry,
          path: resolvedPath,
          name: resolvedName,
          type: resolvedType,
          sourceUrl: entrySourceUrl || importedRecord?.sourceUrl || ''
        }, {
          id: resolvedId || item.id,
          path: resolvedPath,
          name: resolvedName,
          type: resolvedType,
          sourceUrl: entrySourceUrl || importedRecord?.sourceUrl || '',
          metadata: entry.metadata || importedRecord?.metadata || item.metadata,
          displayDuration: entry.displayDuration,
          includeAudio: entry.includeAudio,
          reason: 'incompatible'
        }));
        unavailable++;
      }
      _reportItem(resolvedName, resolvedId, 'error');
      continue;
    }

    if (!preserveDuplicates && resolvedId) seen.add(String(resolvedId));

    if (entryPath && /[\\/]/.test(entryPath)) item.pathHint = entryPath;
    if (entrySourceUrl && isPortableRemoteRef(entrySourceUrl, { allowSupabaseBucketPath: true })) item.sourceUrl = entrySourceUrl;
    if (entry.metadata && typeof entry.metadata === 'object') item.metadata = { ...(item.metadata || {}), ...entry.metadata };

    const ref = createListRef(which, item, {
      id: resolvedId || item.id,
      path: bestPathForItem(item),
      name: item.name,
      type: item.type,
      sourceUrl: item.sourceUrl || entrySourceUrl || undefined,
      metadata: entry.metadata || importedRecord?.metadata || item.metadata,
      available: isPlayableListRef(which, { id: item.id, type: item.type, sourceUrl: item.sourceUrl, path: item.pathHint })
    });
    if (entry.displayDuration != null) ref.displayDuration = entry.displayDuration;
    if (typeof entry.includeAudio === 'boolean') ref.includeAudio = entry.includeAudio;
    if (!ref.available) unavailable++;
    items.push(ref);
    imported++;
    _reportItem(resolvedName, resolvedId, 'loaded');
  }

  return { items, missing, imported, incompatible, duplicate, unavailable };
}

function parseTextPathEntries(text, filename = '') {
  const entries = [];
  const isMarkdown = getFileExt(filename) === 'md';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const clean = trimmed.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '').trim();
    splitPathLine(clean, isMarkdown).forEach(token => {
      const path = sanitizeImportPath(token.replace(/^`|`$/g, '').trim());
      if (looksLikeImportPath(path)) entries.push({ path });
    });
  }
  return entries;
}

function splitPathLine(line, includePipe = false) {
  const parts = [];
  let buf = '', quoted = false;
  const push = () => {
    const value = buf.trim().replace(/^["']|["']$/g, '').replace(/\\"/g, '"').trim();
    if (value) parts.push(value);
    buf = '';
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (ch === ',' || ch === ';' || ch === '\t' || (includePipe && ch === '|'))) {
      push();
      continue;
    }
    buf += ch;
  }
  push();
  return parts;
}

function looksLikeImportPath(path) {
  const base = mediaBasenameFromImportPath(path);
  return !!(base && getMediaType(base));
}

function findLibraryMatch(path) {
  const raw = String(path || '').trim();
  const base = basenameFromPath(raw);
  const rawLower = raw.toLocaleLowerCase();
  const baseLower = base.toLocaleLowerCase();

  for (const [id, item] of state.library) {
    if (item.pathHint === raw || item.name === raw || item.name === base) return id;
  }
  for (const [id, item] of state.library) {
    const hint = item.pathHint || '';
    if ((raw && raw.endsWith(item.name)) || (hint && (hint.endsWith(raw) || hint.endsWith(base)))) return id;
  }
  for (const [id, item] of state.library) {
    if ((item.name || '').toLocaleLowerCase() === baseLower || (item.pathHint || '').toLocaleLowerCase() === rawLower) return id;
  }
  return null;
}

async function importEntries(entries, opts = {}) {
  const which = opts.which || state.ui.activeList;
  const list = which === 'playlist' ? state.playlist : state.slideshow;
  const replaceCurrent = (state.settings.importBehavior || 'append') === 'replace';
  const previousItems = list.slice();
  if (replaceCurrent) list.length = 0;

  const firstIndex = list.length;
  const materialized = await materializeImportedEntries(entries, { which, existingIds: list.map(ref => ref.id) });
  list.push(...materialized.items);

  let restored = false;
  if (replaceCurrent && materialized.imported === 0 && previousItems.length) {
    list.splice(0, list.length, ...previousItems);
    restored = true;
  }

  setActiveList(which);
  if (opts.meta && materialized.imported) state.listMeta[which] = normalizeListMeta(which, opts.meta);
  saveStateDebounced();
  if (materialized.imported) scrollListItemIntoView(firstIndex);
  const result = { which, imported: materialized.imported, total: entries.length, missing: materialized.missing, incompatible: materialized.incompatible, duplicate: materialized.duplicate, restored, sourceName: opts.sourceName };
  showImportSummary(result);
  return result;
}

function showImportSummary(result) {
  const label = result.which === 'playlist' ? 'Playlist' : 'Slideshow';
  const note = result.missing.length
    ? `Imported ${result.imported}/${result.total} items into ${label}. ${result.missing.length} paths were missing${result.restored ? '; current list was kept' : ''}.`
    : `Imported ${result.imported}/${result.total} items into ${label}${result.restored ? '; current list was kept' : ''}.`;
  if (result.missing.length) {
    showToast(note, {
      timeout: 8000,
      action: { label: 'Resolve now', run: () => resolveMissingImports(result.missing, result.which) }
    });
    showMissingDialog(result);
  } else {
    showToast(note, { timeout: 4200 });
  }
  if (result.incompatible) showToast(`${result.incompatible} item${result.incompatible === 1 ? '' : 's'} skipped by ${label} type rules`, { timeout: 3200 });
}

function showMissingDialog(result) {
  const existing = $('#import-summary-modal');
  if (existing) existing.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'import-summary-modal';
  const rows = result.missing.slice(0, 14).map(m => `<li title="${escapeHtml(m.path)}">${escapeHtml(m.basename || m.path)}</li>`).join('');
  const more = result.missing.length > 14 ? `<p class="muted">...and ${result.missing.length - 14} more</p>` : '';
  dialog.innerHTML = `
    <div class="modal-header">Missing (${result.missing.length})</div>
    <div class="modal-body">
      <p>${escapeHtml(result.sourceName || 'Imported list')} referenced files that are not in the Media Library yet.</p>
      <ul>${rows}</ul>
      ${more}
    </div>
    <div class="modal-footer">
      <button class="btn" data-close>Close</button>
      <button class="btn primary" data-resolve>Resolve missing paths...</button>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('[data-resolve]').onclick = () => {
    dialog.close();
    resolveMissingImports(result.missing, result.which);
  };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

async function resolveMissingImports(missing, which) {
  try {
    const dirHandle = await window.showDirectoryPicker();
    const progress = showToast(`Scanning "${dirHandle.name}" for missing paths...`, { timeout: 0 });
    const handles = await walkDirectoryForMedia(dirHandle, {
      onProgress: count => { progress.label.textContent = `Scanning "${dirHandle.name}"... ${count} media files found`; }
    });
    progress.close();

    const directoryId = rememberDirectoryHandle(dirHandle);
    const byName = new Map(handles.map(h => [h.name.toLocaleLowerCase(), h]));
    const list = which === 'playlist' ? state.playlist : state.slideshow;
    const allowed = which === 'playlist' ? ['video','audio'] : ['video','image'];
    const firstIndex = list.length;
    let resolved = 0, incompatible = 0;

    for (const entry of missing) {
      const handle = byName.get((entry.basename || basenameFromPath(entry.path)).toLocaleLowerCase());
      if (!handle) continue;
      const ensured = await ensureHandleInLibrary(handle, { pathHint: entry.path, directoryId, metadata: entry.metadata });
      if (!ensured.id) continue;
      const item = state.library.get(ensured.id);
      if (!allowed.includes(item.type)) { incompatible++; continue; }
      if (list.some(ref => ref.id === ensured.id)) continue;
      if (entry.metadata && typeof entry.metadata === 'object') item.metadata = { ...(item.metadata || {}), ...entry.metadata };
      const ref = createListRef(which, item);
      if (entry.displayDuration) ref.displayDuration = entry.displayDuration;
      if (typeof entry.includeAudio === 'boolean') ref.includeAudio = entry.includeAudio;
      list.push(ref);
      resolved++;
    }

    renderLibrary();
    setActiveList(which);
    await saveStateNow();
    if (resolved) scrollListItemIntoView(firstIndex);
    showToast(`Resolved ${resolved}/${missing.length} missing path${missing.length === 1 ? '' : 's'}${incompatible ? ` (${incompatible} incompatible)` : ''}`);
  } catch (e) {
    if (e.name !== 'AbortError') showToast('Could not resolve missing paths');
  }
}

function createBlankExperienceSnapshot(name, settings = state.settings) {
  return {
    projectName: normalizeExperienceName(name),
    settings: createDefaultSettings(clonePlain(settings)),
    playlist: [],
    slideshow: [],
    listMeta: {
      playlist: defaultListMeta('playlist'),
      slideshow: defaultListMeta('slideshow')
    },
    runtime: {
      playlistIndex: 0,
      slideshowIndex: 0,
      isPlaying: false,
      historyPlaylist: [],
      historySlideshow: []
    },
    ui: {
      activeList: 'playlist'
    }
  };
}

async function switchExperienceById(id, opts = {}) {
  if (!id) return null;
  const record = state.experiences.find(exp => exp.id === id);
  if (!record) {
    showToast('That experience no longer exists');
    return null;
  }

  const startedAt = performance.now();
  log.info('[experience] switch requested', experienceDebugContext({
    targetId: record.id,
    targetName: record.name || record.projectName || record.payload?.projectName || '',
    saveCurrent: opts.saveCurrent !== false,
    silent: !!opts.silent
  }));

  try {
    const current = opts.saveCurrent !== false ? currentExperienceRecord() : null;
    if (current && current.id !== record.id) {
      const outgoing = serializeActiveExperience(current);
      log.info('[experience] queueing current experience save', experienceDebugContext({
        outgoingId: outgoing.id,
        outgoingName: outgoing.name,
        outgoingPlaylistCount: outgoing.payload?.playlist?.length || 0,
        outgoingSlideshowCount: outgoing.payload?.slideshow?.length || 0
      }));
      updateExperienceCatalog(outgoing);
      void idbPut(EXPERIENCE_STORE, outgoing)
        .then(() => log.info('[experience] current experience save complete', experienceDebugContext({
          savedId: outgoing.id
        })))
        .catch(e => log.warn('experience save failed', e));
    }

    stopPlayback();
    const persisted = record.payload ? null : await idbGet(EXPERIENCE_STORE, record.id).catch(() => null);
    const snapshot = persisted?.payload || persisted?.snapshot || persisted?.data || record.payload || record;
    log.info('[experience] snapshot resolved', experienceDebugContext({
      source: persisted ? 'idb' : (record.payload ? 'memory' : 'record'),
      targetId: record.id,
      targetName: record.name || record.projectName || record.payload?.projectName || '',
      playlistCount: snapshot?.playlist?.length || 0,
      slideshowCount: snapshot?.slideshow?.length || 0,
      activeList: snapshot?.ui?.activeList || 'playlist'
    }));

    setActiveExperienceId(record.id);
    applyExperienceSnapshot(snapshot, { preservePlaybackState: false });
    updateExperienceCatalog(serializeActiveExperience(record));
    renderExperiencePicker();
    renderListEditor();
    activateExperienceContext(buildProjectContext(), { trackVirtualPage: true, trigger: 'experience_switch' });
    void saveStateNow()
      .then(() => log.info('[experience] background save complete', experienceDebugContext({
        targetId: record.id,
        elapsedMs: Math.round(performance.now() - startedAt)
      })))
      .catch(error => log.warn('background save failed', error));
    if (!opts.silent) showToast(`Switched to ${state.projectName}`);
    log.info('[experience] switch complete', experienceDebugContext({
      targetId: record.id,
      elapsedMs: Math.round(performance.now() - startedAt)
    }));
    return record;
  } catch (error) {
    log.error('[experience] switch failed', experienceDebugContext({
      targetId: record.id,
      error,
      elapsedMs: Math.round(performance.now() - startedAt)
    }));
    throw error;
  }
}

let experienceDialogResolve = null;

function closeExperienceDialog(value = null) {
  const dialog = $('#experience-modal');
  const resolver = experienceDialogResolve;
  experienceDialogResolve = null;
  if (dialog.open) dialog.close();
  resolver?.(value);
}

function showExperienceDialog(opts = {}) {
  const dialog = $('#experience-modal');
  const title = $('#experience-modal-title');
  const message = $('#experience-modal-message');
  const label = $('#experience-modal-label');
  const input = $('#experience-modal-input');
  const ok = $('#experience-modal-ok');
  const cancel = $('#experience-modal-cancel');

  const wantInput = opts.mode !== 'confirm';
  title.textContent = opts.title || 'Experience';
  message.textContent = opts.message || '';
  message.style.display = opts.message ? '' : 'none';
  label.style.display = wantInput ? '' : 'none';
  input.style.display = wantInput ? '' : 'none';
  label.textContent = opts.labelText || 'Experience name';
  input.placeholder = opts.placeholder || 'Experience name';
  input.value = opts.value || '';
  ok.textContent = opts.okText || (wantInput ? 'Save' : 'OK');
  ok.classList.toggle('danger', !!opts.okDanger);
  ok.classList.toggle('primary', !opts.okDanger);

  if (experienceDialogResolve) closeExperienceDialog(null);

  return new Promise(resolve => {
    let settled = false;
    const resolveInput = wantInput
      ? (typeof opts.normalizeInput === 'function'
        ? opts.normalizeInput
        : opts.normalizeInput === false
          ? value => value
          : normalizeExperienceName)
      : null;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancelClick);
      experienceDialogResolve = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onOk = () => finish(wantInput ? resolveInput(input.value) : true);
    const onCancelClick = () => finish(null);
    const onCancel = (e) => {
      e.preventDefault();
      finish(null);
    };
    const onClose = () => {
      if (!settled) finish(null);
    };

    experienceDialogResolve = resolve;
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancelClick);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);

    dialog.showModal();
    requestAnimationFrame(() => {
      if (wantInput) {
        input.focus();
        input.select();
      } else {
        ok.focus();
      }
    });
  });
}

async function promptExperienceName(title, initialValue, ignoreId = null, message = 'Enter a name for this experience.') {
  const input = await showExperienceDialog({
    title,
    message,
    value: initialValue,
    placeholder: 'Experience name',
    okText: 'Save'
  });
  if (input == null || input === true) return null;
  const value = normalizeExperienceName(input);
  return value ? ensureUniqueExperienceName(value, ignoreId) : null;
}

async function promptMediaUrl() {
  const value = await showExperienceDialog({
    title: 'Add media URL',
    message: 'Paste an http(s), supabase://, or legacy ipfs:// media reference.',
    labelText: 'Media URL',
    placeholder: 'supabase://media/path/to/media.mp4',
    okText: 'Add',
    normalizeInput: false
  });
  if (value == null || value === true) return [];
  return String(value)
    .split(/[\s,]+/)
    .map(part => sanitizeImportPath(part.trim()))
    .filter(part => isPortableRemoteRef(part, { allowSupabaseBucketPath: true }));
}

async function addUrlsFromPrompt() {
  const urls = await promptMediaUrl();
  if (!urls.length) return null;

  let added = 0;
  let existing = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      const result = await addRemoteMediaUrl(url, { pathHint: url, metadata: { sourceUrl: url } });
      if (result?.status === 'existing') existing++;
      else if (result?.id) added++;
    } catch (error) {
      failed++;
      log.warn('Add URL failed', error);
    }
  }

  renderLibrary();
  await saveStateNow();
  if (added || existing) {
    showToast(`Added ${added} URL item${added === 1 ? '' : 's'}${existing ? ` (${existing} already present)` : ''}`);
  }
  if (failed) showToast(`Skipped ${failed} URL${failed === 1 ? '' : 's'} that could not be fetched`, { timeout: 3200 });
  return { added, existing, failed };
}

async function createExperience() {
  const suggested = ensureUniqueExperienceName('New Experience');
  const name = await promptExperienceName('New experience name', suggested);
  if (!name) return null;

  const snapshot = createBlankExperienceSnapshot(name, state.settings);
  const record = makeExperienceRecord(snapshot, {
    id: `exp-${uid()}`,
    name,
    uniqueName: true
  });
  state.experiences.push(record);
  state.experiences = sortExperienceRecords(state.experiences);
  await idbPut(EXPERIENCE_STORE, record);
  await switchExperienceById(record.id, { silent: true });
  await saveStateNow();
  showToast(`Created experience "${record.name}"`);
  return record;
}

async function renameCurrentExperience() {
  const current = currentExperienceRecord();
  if (!current) return;
  const name = await promptExperienceName('Rename experience', state.projectName, current.id);
  if (!name || name === current.name) return;

  state.projectName = name;
  updateExperienceCatalog(serializeActiveExperience(current));
  syncExperienceControls();
  renderExperiencePicker();
  await saveStateNow();
  showToast(`Renamed to "${name}"`);
}

async function deleteCurrentExperience() {
  const current = currentExperienceRecord();
  if (!current) return;
  const ok = await showExperienceDialog({
    title: 'Delete experience',
    mode: 'confirm',
    message: `Delete experience "${current.name}"? This cannot be undone.`,
    okText: 'Delete',
    okDanger: true
  });
  if (!ok) return;

  clearTimeout(saveTimer);
  const sortedBeforeDelete = sortExperienceRecords(state.experiences);
  const deletedIndex = sortedBeforeDelete.findIndex(exp => exp.id === current.id);
  stopPlayback();
  await idbDelete(EXPERIENCE_STORE, current.id);
  state.experiences = sortExperienceRecords(sortedBeforeDelete.filter(exp => exp.id !== current.id));

  if (!state.experiences.length) {
    const fallback = makeExperienceRecord(createBlankExperienceSnapshot(DEFAULT_EXPERIENCE_NAME, state.settings), {
      id: `exp-${uid()}`,
      name: DEFAULT_EXPERIENCE_NAME,
      uniqueName: true
    });
    state.experiences = [fallback];
    await idbPut(EXPERIENCE_STORE, fallback);
  }

  const next = state.experiences[Math.min(Math.max(deletedIndex, 0), state.experiences.length - 1)] || state.experiences[0];
  setActiveExperienceId(next.id);
  applyExperienceSnapshot(next.payload || next, { preservePlaybackState: false });
  renderExperiencePicker();
  await saveStateNow();
  showToast(`Deleted "${current.name}"`);
}

async function importExperience() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.multiple = true;
  inp.onchange = async () => {
    for (const file of Array.from(inp.files || [])) {
      await importExperienceFromFile(file);
    }
  };
  inp.click();
}

/**
 * Import an experience from a JSON File object.
 *
 * @param {File} file
 * @param {object} [importOpts]
 * @param {function(number,string):void} [importOpts.onProgress]
 *   Called with (percent 0-100, statusText) at key steps so callers can
 *   drive a progress bar. Omit for the plain toast-only flow.
 * @param {function({which,done,total,name,id,status}):void} [importOpts.onItemProgress]
 *   Called once per entry processed by materializeImportedEntries.
 *   which = 'playlist' | 'slideshow'; status = 'loaded' | 'missing' | 'error'
 * @param {boolean} [importOpts.suppressToast]
 *   When true, the function does not show a success or error toast so the
 *   caller can handle user messaging itself.
 */
async function importExperienceFromFile(file, importOpts = {}) {
  const onProgress     = typeof importOpts.onProgress     === 'function' ? importOpts.onProgress     : null;
  const onItemProgress = typeof importOpts.onItemProgress === 'function' ? importOpts.onItemProgress : null;
  const suppressToast  = !!importOpts.suppressToast;

  try {
    if (onProgress) onProgress(5, 'Reading experience data…');
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (onProgress) onProgress(12, 'Validating experience…');
    const payload = parseExperienceImportPayload(parsed);
    const importedLibraryRecords = new Map((payload.libraryItems || []).map(record => [String(record.id), record]));

    const playlistTotal  = (payload.playlistEntries  || []).length;
    const slideshowTotal = (payload.slideshowEntries || []).length;
    if (onProgress) onProgress(18, `Found ${playlistTotal + slideshowTotal} items…`);

    // Playlist entries → 20-60 %
    const playlist = await materializeImportedEntries(payload.playlistEntries, {
      which: 'playlist',
      libraryRecordsById: importedLibraryRecords,
      preserveMissing: true,
      preserveDuplicates: true,
      onProgress: onProgress ? ({ done, total, name, id, status }) => {
        const pct = 20 + Math.round((done / Math.max(1, total)) * 40);
        onProgress(pct, `Playlist ${done}/${total}: ${name}`);
        if (onItemProgress) onItemProgress({ which: 'playlist', done, total, name, id, status });
      } : (onItemProgress ? ({ done, total, name, id, status }) => {
        onItemProgress({ which: 'playlist', done, total, name, id, status });
      } : undefined)
    });

    if (onProgress) onProgress(60, 'Importing slideshow items…');

    // Slideshow entries → 60-90 %
    const slideshow = await materializeImportedEntries(payload.slideshowEntries, {
      which: 'slideshow',
      libraryRecordsById: importedLibraryRecords,
      preserveMissing: true,
      preserveDuplicates: true,
      onProgress: onProgress ? ({ done, total, name, id, status }) => {
        const pct = 60 + Math.round((done / Math.max(1, total)) * 30);
        onProgress(pct, `Slideshow ${done}/${total}: ${name}`);
        if (onItemProgress) onItemProgress({ which: 'slideshow', done, total, name, id, status });
      } : (onItemProgress ? ({ done, total, name, id, status }) => {
        onItemProgress({ which: 'slideshow', done, total, name, id, status });
      } : undefined)
    });

    if (onProgress) onProgress(90, 'Saving to storage…');
    const name = ensureUniqueExperienceName(payload.name || basenameFromPath(file.name) || DEFAULT_EXPERIENCE_NAME);
    const snapshot = createBlankExperienceSnapshot(name, payload.settings);
    snapshot.playlist = playlist.items;
    snapshot.slideshow = slideshow.items;
    snapshot.listMeta = {
      playlist: payload.playlistMeta || defaultListMeta('playlist'),
      slideshow: payload.slideshowMeta || defaultListMeta('slideshow')
    };

    const record = makeExperienceRecord(snapshot, {
      id: `exp-${uid()}`,
      name,
      uniqueName: true
    });

    await saveStateNow();
    state.experiences.push(record);
    state.experiences = sortExperienceRecords(state.experiences);
    await idbPut(EXPERIENCE_STORE, record);

    if (onProgress) onProgress(95, 'Activating experience…');
    await switchExperienceById(record.id, { saveCurrent: false, silent: true });
    await saveStateNow();

    if (onProgress) onProgress(100, 'Complete');

    const unavailable = (playlist.unavailable || 0) + (slideshow.unavailable || 0);
    const detail = `${playlist.items.length} playlist item${playlist.items.length === 1 ? '' : 's'}, ${slideshow.items.length} slideshow item${slideshow.items.length === 1 ? '' : 's'}${unavailable ? `, ${unavailable} marked Not Available` : ''}`;
    if (!suppressToast) showToast(`Imported experience "${record.name}" (${detail})`);
    return record;
  } catch (e) {
    log.error('experience import failed', e);
    if (!suppressToast) showToast(`Import failed for ${file.name}: ${e.message || 'Invalid file'}`);
    return null;
  }
}

function downloadExampleList() {
  const sacred = [
    String.raw`C:\Users\kyle_\Music\wedding\a-ha_-_Take_On_Me_Official_Video_4K [djV11Xbc914].mp4`,
    String.raw`C:\Users\kyle_\Music\wedding\AC_DC_-_Thunderstruck_Live_At_River_Plate_December_2009 [n_GFN3a0yj0].mp4`,
    String.raw`C:\Users\kyle_\Music\wedding\Alannah_Myles_-_Black_Velvet [tT4d1LQy4es].mp4`,
    String.raw`C:\Users\kyle_\Music\wedding\Berlin_-_Take_My_Breath_Away_Official_Video_-_Top_Gun [Bx51eegLTY8].mp4`,
    String.raw`C:\Users\kyle_\Music\wedding\Bob_Seger_The_Silver_Bullet_Band_-_Night_Moves_Official_Video [xH7cSSKnkL4].mp4`
  ];
  const fromLibrary = Array.from(state.library.values()).slice(0, 2).map(bestPathForItem);
  const repoSamples = [
    String.raw`videos\mkv-Sintel_Trailer1.480p.DivX_Plus_HD.mkv`,
    String.raw`videos\webm-big-buck-bunny_trailer.webm`
  ];
  const lines = sacred.concat(fromLibrary.length ? fromLibrary : repoSamples);
  downloadBlob(lines.map(quotePath).join('\r\n') + '\r\n', 'example-wedding-playlist.txt', 'text/plain');
}

// ====================== KEYBOARD ======================
function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const k = e.key.toLowerCase();

    // While a URL-shared experience is loading, pass through only safe keys
    // (config toggle, help, Escape); block all transport shortcuts.
    if (experienceLoading) {
      if (k === 'c') { $('#config-panel').classList.contains('open') ? closeConfig() : openConfig(); }
      else if (k === '?') { e.preventDefault(); $('#help-modal').showModal(); }
      else if (k === 'escape') {
        const modals = document.querySelectorAll('dialog[open]');
        if (modals.length) modals[modals.length - 1].close();
        else if ($('#config-panel').classList.contains('open')) closeConfig();
      }
      return;
    }

    if (e.altKey && k === 's') {
      e.preventDefault();
      openConfig();
      showLibrarySortMenu($('#library-sort'));
    }
    else if (e.altKey && (k === 'arrowup' || k === 'arrowdown')) {
      // Reorder the selected (or focused) list item(s) while editing.
      if ($('#config-panel').classList.contains('open')) {
        e.preventDefault();
        moveListSelectionByStep(state.ui.activeList, k === 'arrowup' ? -1 : 1);
      }
    }
    else if (k === ' ' || k === 'k') { e.preventDefault(); togglePlay(); }
    else if (k === 's' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); stopPlayback(); }
    else if (k === 'arrowleft' || k === 'j') { e.preventDefault(); previousBoth(); }
    else if (k === 'arrowright' || k === 'l') { e.preventDefault(); nextBoth(); }
    else if (k === '[') { setBlend((state.settings.opacity || 0.5) - 0.1); }
    else if (k === ']') { setBlend((state.settings.opacity || 0.5) + 0.1); }
    else if (k === 'c') { $('#config-panel').classList.contains('open') ? closeConfig() : openConfig(); }
    else if (k === 'f') { e.preventDefault(); $('#btn-fullscreen').click(); }
    else if (k === 'm') { e.preventDefault(); toggleMute(); }
    else if (k === '?') { e.preventDefault(); $('#help-modal').showModal(); }
    else if (k === 'escape') {
      if ($('.floating-menu')) { closeFloatingMenus(); return; }
      const modals = document.querySelectorAll('dialog[open]');
      if (modals.length) modals[modals.length-1].close();
      else if ($('#config-panel').classList.contains('open')) closeConfig();
    }
    else if (/^[1-9]$/.test(k) && playlistVideoA && !playlistVideoA.paused) {
      const p = parseInt(k, 10) / 10;
      if (playlistVideoA.duration) playlistVideoA.currentTime = playlistVideoA.duration * p;
    }
    else if (k === 'delete' || k === 'backspace') {
      // remove focused list item if any
      const focused = document.activeElement.closest('.list-item');
      if (focused) {
        const idx = parseInt(focused.dataset.idx, 10);
        removeFromList(state.ui.activeList, idx);
      }
    }
  });

  // ? button could be added to header
}

// ====================== PWA (adapted) ======================
async function setupPWA() {
      if (location.protocol === 'file:') return;
      try {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('./service-worker.js').catch(err => {
            log.warn('service worker registration failed', err);
          });
        }

    const themeQuery = matchMedia('(prefers-color-scheme: light)');
    const onThemeChange = () => {
      if ((state.settings.themeMode || 'auto') === 'auto') applyThemeMode('auto');
    };
    if (typeof themeQuery.addEventListener === 'function') themeQuery.addEventListener('change', onThemeChange);
    else if (typeof themeQuery.addListener === 'function') themeQuery.addListener(onThemeChange);

    const banner = $('#install-banner');
    const help = $('#install-help');
    const primary = $('#install-primary');
    const dismiss = $('#install-dismiss');
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    let bannerHidden = localStorage.getItem(INSTALL_BANNER_KEY);

    if (isIos && primary) primary.textContent = 'How to install';

    const showBanner = () => {
      if (!banner || bannerHidden) return;
      banner.classList.remove('hidden');
    };

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      showBanner();
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      banner?.classList.add('hidden');
      showToast('Blend installed');
    });

    primary?.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try {
          await deferredInstallPrompt.userChoice;
        } catch (_) {}
        deferredInstallPrompt = null;
        banner?.classList.add('hidden');
        return;
      }
      showToast(isIos
        ? 'On iPhone or iPad, use Share → Add to Home Screen.'
        : 'Use the browser menu to install this app on supported devices.', { timeout: 6000 });
    });

    help?.addEventListener('click', () => {
      showToast(isIos
        ? 'On iPhone or iPad, tap Share and choose Add to Home Screen.'
        : 'On desktop or Android, use the browser install action or menu.', { timeout: 6000 });
    });

    dismiss?.addEventListener('click', () => {
      banner?.classList.add('hidden');
      bannerHidden = '1';
      localStorage.setItem(INSTALL_BANNER_KEY, '1');
    });

    if (isIos && !bannerHidden) showBanner();
  } catch (_) {}
}

// ====================== FIRST RUN / WELCOME ======================
function maybeShowWelcome() {
  const seen = localStorage.getItem(WELCOME_KEY);
  if (seen) return;
  const m = $('#welcome-modal');
  m.showModal();
  $('#welcome-dismiss').onclick = () => { localStorage.setItem(WELCOME_KEY, '1'); m.close(); };
  $('#welcome-example-list').onclick = () => downloadExampleList();
  $('#welcome-add-folder').onclick = async () => {
    m.close(); localStorage.setItem(WELCOME_KEY, '1');
    await addFolderFromPicker();
  };
}

// ====================== INIT ======================
async function bootstrap() {
  pendingDeepLinkRequest = parseDeepLinkRequest();
  pendingIpfsExperienceRequest = parseIpfsExperienceRequest();
  pendingUrlShareRequest = parseUrlShareRequest();
  // URL share takes priority; suppress IPFS + deep link if a URL share is present.
  const hasUrlShareRequest = !!pendingUrlShareRequest;
  const hasIpfsExperienceRequest = !hasUrlShareRequest && !!pendingIpfsExperienceRequest;
  if (hasUrlShareRequest) { pendingIpfsExperienceRequest = null; pendingDeepLinkRequest = null; }
  analyticsConsentGranted = readStoredAnalyticsConsent();
  updateAnalyticsConsentState({ consent: analyticsConsentGranted });

  await openDB();
  await hydrateState();
  await bootstrapAuthSession();
  resetShareWarningFromUrlIfRequested();

  setupMediaLayers();
  setupTransitionManager();
  wireTransport();
  wireConfig();
  wireInfoDialog();
  wireKeyboard();
  // Sync the play/stop button UI + transport data-attribute with the loaded
  // (always stopped on boot — playback is never auto-resumed) transport mode.
  applyTransportMode(transportMode);
  window.addEventListener('focus', () => updateAnalyticsConsentState({ consent: analyticsConsentGranted }), { passive: true });
  await setupPWA();
  window.addEventListener('pagehide', cleanupRuntimeResources, { once: true });

  // initial renders
  renderLibrary();
  renderListEditor();
  setBlend(state.settings.opacity || 0.5);
  activateExperienceContext(activeExperienceContext || buildProjectContext(), { trackVirtualPage: true, trigger: 'app_bootstrap' });

  // verify handles (non-blocking)
  setTimeout(() => verifyLibraryHandles(), 1200);

  // restore last indices visually
  updateHUD();

  if (pendingUrlShareRequest) {
    await loadUrlSharedExperience(pendingUrlShareRequest);
    pendingUrlShareRequest = null;
  } else if (pendingIpfsExperienceRequest) {
    await loadSharedIpfsExperience(pendingIpfsExperienceRequest);
    pendingIpfsExperienceRequest = null;
  } else if (pendingDeepLinkRequest) {
    await applyDeepLinkRequest(pendingDeepLinkRequest);
    pendingDeepLinkRequest = null;
  } else if (!hasIpfsExperienceRequest) {
    // first run
    setTimeout(maybeShowWelcome, 900);
  }

  // keyboard hint
  log.info('Press ? for keyboard shortcuts. C to open editor.');

  // expose a little for debugging
  window.Blend = {
    state,
    saveStateNow,
    // Transport controls + introspection (used by e2e specs to assert the
    // pause-resume / stop-restart contract without poking private state).
    togglePlay,
    play: startPlayback,
    pause: pausePlayback,
    resume: resumePlayback,
    stop: stopPlayback,
    get transport() { return transportMode; },
    renderLibrary,
    renderListEditor,
    switchExperienceById,
    createExperience,
    renameCurrentExperience,
    deleteCurrentExperience,
    importExperience,
    exportExperience,
    clearBrowserStorage,
    // URL sharing (v5.0.7) + experience load progress (v5.0.8)
    shareExperienceViaUrl,
    loadUrlSharedExperience,
    buildUrlShareLink,
    parseUrlShareRequest,
    freezeTransportControls,
    unfreezeTransportControls,
    get experienceLoading() { return experienceLoading; },
    registerSharePlatform,
    listSharePlatforms,
    openShareMenuForContext,
    shareContextByMethod,
    shareCurrentExperienceThroughIpfs,
    loadSharedIpfsExperience,
    ipfsConfigFromState,
    buildIpfsExperienceShareUrl,
    updateAnalyticsConsentState,
    buildDeepLinkUrl,
    transitionEffects: transitionEffectCatalog,
    transitionManager,
    log
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

