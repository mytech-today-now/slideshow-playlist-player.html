import { attachGlobalErrorHandlers, createLogger } from './logger.js?v=20260611-v4.6';
import { createPointerReorderFallback } from './drag-sort.js?v=20260611-v4.6';
import { initGA4, trackExperienceView, trackMediaEvent, trackExperienceSwitch, trackShareEvent, setAnalyticsConsent, getAnalyticsConsent, isAnalyticsActive, resetAnalyticsConsent } from './analytics.js?v=20260611-v4.6';
import { updateExperienceMeta, updateMediaItemMeta, resetToDefaults, setSiteDefaults } from './social-meta.js?v=20260611-v4.6';

import { mountDiagnosticsUI } from './diagnostics.js?v=20260611-v4.6';
const log = createLogger('Blend', {
 storageKey: 'blend-debug-log-v1',
  persist: true,
  maxEntries: 500
});

attachGlobalErrorHandlers(log);

// =====================================================
// Blend • player.html v4.6  (Experience UX + Source Filtering, June 2026)
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

const VERSION = '4.6';
const CACHE_VERSION = 'blend-player-v4.6-20260611';
const DB_NAME = 'player-blend-v1';
const DB_VERSION = 3;
const EXPERIENCE_STORE = 'experiences';
const EXPERIENCE_ACTIVE_KEY = 'blend-active-experience-id';
const EXPERIENCE_EXPORT_SCHEMA = 'player.blend.experience.v2';
const DEFAULT_EXPERIENCE_NAME = 'Untitled Session';
const INSTALL_BANNER_KEY = 'blend-install-banner-hidden-v4';
const WELCOME_KEY = 'blend-welcome-v4';
const THEME_COLOR_DARK = '#0a0a0a';
const THEME_COLOR_LIGHT = '#f8fafc';
const DEFAULT_SETTINGS = {
  defaultImageDuration: 4.0,
  effectIntensity: 'subtle',
  playlistVolume: 1.0,
  slideshowVolume: 0.65,
  masterVolume: 1.0,
  playbackModePlaylist: 'sequential',
  playbackModeSlideshow: 'sequential',
  opacity: 0.5,
  importBehavior: 'append',
  librarySortKey: 'date',
  librarySortDir: 'asc',
  resumeOnLoad: true,
  autoVerifyOnStartup: true,
  themeMode: 'auto',
   analyticsConsent: null // null = not asked, true = granted, false = denied
  };

// Supported media types
const MEDIA_TYPES = {
  video: ['mp4','m4v','mov','mkv','webm','ogv','avi'],
  audio: ['mp3','m4a','wav','ogg','flac','aac'],
  image: ['jpg','jpeg','png','webp','gif','svg','avif']
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
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif'
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
  settings: { ...DEFAULT_SETTINGS },
  experiences: [],
  activeExperienceId: null,
  ui: {
    activeList: 'playlist',
    selectedLibrary: new Set(),
    lastSelectedLibraryId: null,
    visibleLibraryIds: [],
    currentFilter: 'all',
    currentSourceFilter: 'all',
    search: ''
  },
  runtime: {
    playlistIndex: 0,
    slideshowIndex: 0,
    isPlaying: false,
    historyPlaylist: [],
    historySlideshow: []
  }
};

let playlistVideoA = null, playlistVideoB = null;
let slideshowMedia = null; // current img or video in top layer
let kenBurnsRAF = null;
let crossfadeTimer = null;
let slideshowTimer = null;
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
let libraryProjectionWorker = null;
let libraryProjectionWorkerUrl = null;
let activeLibraryProjectionJob = 0;
const libraryProjectionResolvers = new Map();
let lastTrackedMedia = null; // For deduplicating media event tracking
let lastTrackedExperienceId = null; // For deduplicating experience view tracking

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

function getFileExt(name) { return (name.split('.').pop() || '').toLowerCase(); }

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

function normalizePathForExport(path) {
  let value = String(path || '').trim().replace(/^["'`]|["'`]$/g, '');
  if (!value) return '';
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

function sanitizeImportPath(path) {
  const raw = String(path || '').trim().replace(/^["'`]|["'`]$/g, '');
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
  if (isRemoteUrl(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.replace(/\\/g, '/'))) return '';
  const normalized = normalizePathForExport(raw);
  const withoutDrive = normalized.replace(/^[a-zA-Z]:\//, '');
  const segments = withoutDrive.split('/').filter(Boolean);
  if (segments.some(segment => segment === '..')) return '';
  return normalized;
}

function bestPathForItem(item) {
  return normalizePathForExport(item?.sourceUrl || item?.pathHint || fallbackRelativePath(item?.name));
}

function pathKind(path) {
  const normalized = normalizePathForExport(path);
  if (!normalized) return 'unknown';
  if (isRemoteUrl(normalized)) return 'remote';
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/') || normalized.startsWith('//')) return 'absolute';
  return 'relative';
}

function libraryItemSourceKind(item) {
  const sourceUrl = sanitizeImportPath(item?.sourceUrl || '');
  if (isRemoteUrl(sourceUrl)) return 'url';
  const path = bestPathForItem(item);
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
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(snapshot && typeof snapshot.settings === 'object' ? snapshot.settings : {})
  };
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
  $('#resume-on-load').checked = !!state.settings.resumeOnLoad;
  $('#auto-verify').checked = !!state.settings.autoVerifyOnStartup;
  document.title = `${state.projectName} • Blend`;
  syncMasterVolumeUI();
  updateVolumeLabels();
  applyThemeMode(themeMode);
   // Analytics consent toggle visibility
   const analyticsWrapper = $('#analytics-consent-wrapper');
   const analyticsCheckbox = $('#analytics-consent');
   if (analyticsWrapper && analyticsCheckbox) {
     const consent = getAnalyticsConsent();
     analyticsWrapper.style.display = consent === 'unknown' ? 'flex' : 'none';
     analyticsCheckbox.checked = consent === 'granted';
   }
   // Update social meta for current experience
   const currentExp = currentExperienceRecord();
   if (currentExp) {
     updateExperienceMeta(currentExp);
   }
  }


function syncMasterVolumeUI() {
  try {
    const val = Math.max(0, Math.min(1, Number(state.settings?.masterVolume ?? 0)));
    const percent = Math.round(val * 100) + '%';
    const label = document.querySelector('#vol-master-val');
    if (label) label.textContent = percent;
    const control = document.querySelector('#master-volume-control');
    const muted = !!(typeof isMuted !== 'undefined' ? isMuted : false) || val === 0;
    if (control) control.setAttribute('data-muted', String(muted));
    const btn = document.querySelector('#btn-mute');
    if (btn) {
      btn.textContent = muted ? '🔇' : '🔊';
      btn.setAttribute('aria-label', muted ? 'Unmute master volume' : 'Mute master volume');
      btn.title = muted ? 'Unmute master volume (M)' : 'Mute master volume (M)';
    }
  } catch (_) {}
}function renderExperiencePicker() {
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
  state.settings = { ...DEFAULT_SETTINGS, ...normalized.settings };
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

  log.info('[experience] snapshot applied', experienceDebugContext({
    sourcePlaylistCount: normalized.playlist.length,
    sourceSlideshowCount: normalized.slideshow.length,
    sourceActiveList: normalized.ui.activeList,
    runtimePlaylistIndex: state.runtime.playlistIndex,
    runtimeSlideshowIndex: state.runtime.slideshowIndex
  }));


  // Track experience view and update meta tags
  const currentExp = currentExperienceRecord();
  if (currentExp) {
    // Track virtual page view (deduplicate by experience ID)
    if (lastTrackedExperienceId !== currentExp.id) {
      trackExperienceView(currentExp);
      lastTrackedExperienceId = currentExp.id;
    }
    // Update social meta tags
    updateExperienceMeta(currentExp);
  }


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
        const sourceUrl = isRemoteUrl(rec.sourceUrl || '') ? sanitizeImportPath(rec.sourceUrl) : null;
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
      settings: {
        ...DEFAULT_SETTINGS,
        ...(legacySettings || {})
      },
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
  document.title = `${state.projectName} • Blend`;
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
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/svg+xml') return 'svg';
  if (normalized === 'image/avif') return 'avif';
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

async function addRemoteMediaUrl(url, meta = {}) {
  const normalized = sanitizeImportPath(url);
  if (!isRemoteUrl(normalized)) throw new Error('Please enter an http(s) URL');

  const existing = Array.from(state.library.values()).find(item => sanitizeImportPath(item.sourceUrl || '') === normalized);
  if (existing && existing.handle && !existing.stale) return { id: existing.id, status: 'existing', item: existing };

  const progress = showToast(`Fetching ${basenameFromPath(normalized) || 'media'}...`, { timeout: 0 });
  try {
    const fetched = await fetchRemoteMedia(normalized);
    const result = await ensureHandleInLibrary(fetched.handle, {
      ...meta,
      sourceUrl: normalized,
      pathHint: normalized,
      size: fetched.size,
      metadata: {
        ...(meta.metadata && typeof meta.metadata === 'object' ? meta.metadata : {}),
        sourceUrl: normalized,
        contentType: fetched.contentType || undefined
      }
    });
    const item = result.id ? state.library.get(result.id) : null;
    if (item) {
      item.sourceUrl = normalized;
      item.pathHint = item.pathHint || normalized;
      item.stale = false;
      item.lastVerified = Date.now();
      item.metadata = {
        ...(item.metadata || {}),
        sourceUrl: normalized,
        contentType: fetched.contentType || undefined
      };
    }
    return { ...result, item, sourceUrl: normalized };
  } finally {
    progress.close();
  }
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
    if ((sameSource || sameName) && sameSize) {
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
  if (!item || item.stale || !item.handle || typeof item.handle.getFile !== 'function') return false;
  if (!isAllowedListType(which, item.type)) return false;
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
  clearTimeout(slideshowTimer);
  slideshowTimer = null;
  if (kenBurnsRAF) cancelAnimationFrame(kenBurnsRAF);
  kenBurnsRAF = null;
}

async function playPlaylistAtIndex(startIndex, opts = {}) {
  if (!state.playlist.length) {
    clearPlaylistPlayback();
    updateHUD();
    return false;
  }
  const direction = opts.direction ?? 1;
  const idx = findPlayableListIndex('playlist', startIndex, direction);
  if (idx < 0) {
    clearPlaylistPlayback();
    updateHUD();
    return false;
  }
  state.runtime.playlistIndex = idx;
  const success = await loadPlaylistItem(state.playlist[idx], idx % 2 === 1);
  if (success) {
    if (opts.save !== false) saveStateDebounced();
    return true;
  }
  return playPlaylistAtIndex(idx + direction, opts);
}

async function playSlideshowAtIndex(startIndex, opts = {}) {
  if (!state.slideshow.length) {
    clearSlideshowPlayback();
    updateHUD();
    return false;
  }
  const direction = opts.direction ?? 1;
  const idx = findPlayableListIndex('slideshow', startIndex, direction);
  if (idx < 0) {
    clearSlideshowPlayback();
    updateHUD();
    return false;
  }
  state.runtime.slideshowIndex = idx;
  const success = await loadSlideshowItem(state.slideshow[idx], opts.withCrossfade !== false);
  if (success) {
    if (opts.save !== false) saveStateDebounced();
    return true;
  }
  return playSlideshowAtIndex(idx + direction, opts);
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

function moveListItem(which, from, to) {
  const list = listFor(which);
  if (!Array.isArray(list) || !Number.isInteger(from) || !Number.isInteger(to) || !list.length) return false;

  const originalCount = list.length;
  if (from < 0 || from >= originalCount) return false;
  const sourceIndex = from;
  const insertionIndex = Math.max(0, Math.min(Math.floor(to), originalCount));
  if (sourceIndex === insertionIndex || (sourceIndex === originalCount - 1 && insertionIndex === originalCount)) return false;

  const [moved] = list.splice(sourceIndex, 1);
  if (!moved) return false;

  const targetIndex = Math.max(0, Math.min(insertionIndex, list.length));
  list.splice(targetIndex, 0, moved);

  const runtimeKey = runtimeIndexKey(which);
  const historyKey = which === 'playlist' ? 'historyPlaylist' : 'historySlideshow';
  state.runtime[runtimeKey] = remapIndexAfterMove(state.runtime[runtimeKey], sourceIndex, insertionIndex, originalCount);
  if (Array.isArray(state.runtime[historyKey])) {
    state.runtime[historyKey] = state.runtime[historyKey]
      .map(idx => remapIndexAfterMove(idx, sourceIndex, insertionIndex, originalCount))
      .filter(Number.isInteger);
  }

  renderListEditor();
  void saveStateNow();
  return true;
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
    row.draggable = true;
    row.innerHTML = '<div class="info"><div class="name">Missing item</div></div><span class="del" title="Remove">✕</span>';
    return row;
  }

  const available = isPlayableListRef(which, ref);
  const entryType = item?.type || ref.type || '';
  const path = item ? bestPathForItem(item) : (ref.path || ref.sourceUrl || ref.id || '');
  const name = item?.name || ref.name || basenameFromPath(path) || 'Not Available';
  const size = item ? formatBytes(item.size) : '';
  const isCurrent = which === 'playlist' ? idx === state.runtime.playlistIndex : idx === state.runtime.slideshowIndex;
  const signature = `${which}|${idx}|${ref.id}|${name}|${path}|${size}|${entryType}|${ref.displayDuration || ''}|${ref.includeAudio ? 1 : 0}|${available ? 1 : 0}|${ref.available === false ? 1 : 0}|${item?.stale ? 1 : 0}`;

  row.className = `list-item virtual-row ${available ? '' : 'not-available'} ${isCurrent ? 'current' : ''}`.trim();
  row.dataset.id = ref.id;
  row.dataset.idx = idx;
  row.tabIndex = 0;
  row.draggable = true;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
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
      onReorder: ({ fromIndex, toIndex }) => reorderList(state.ui.activeList, fromIndex, toIndex)
    });
  }

  container.addEventListener('dragstart', event => {
    const row = event.target.closest('.list-item');
    if (!row) return;
    if (event.target.closest('input,button,select,textarea,label,a,[contenteditable="true"],[role="button"]') && !event.target.closest('.drag')) {
      event.preventDefault();
      return;
    }
    const idx = Number.parseInt(row.dataset.idx, 10);
    if (!Number.isInteger(idx)) return;
    event.dataTransfer.setData('text/plain', JSON.stringify({ reorder: true, from: idx, list: state.ui.activeList }));
    event.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('click', event => {
    const row = event.target.closest('.list-item');
    if (!row) return;
    const idx = parseInt(row.dataset.idx, 10);
    const which = state.ui.activeList;
    if (event.target.closest('.del')) {
      event.stopPropagation();
      removeFromList(which, idx);
      return;
    }
    if (event.target.closest('input,label,button')) return;
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
  if (!normalized || isRemoteUrl(normalized)) return null;

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
  if (item.sourceUrl || extras.sourceUrl || isRemoteUrl(ref.sourceUrl || '')) {
    ref.sourceUrl = sanitizeImportPath(item.sourceUrl || extras.sourceUrl || ref.sourceUrl || '') || ref.sourceUrl;
  } else if (ref.sourceUrl && !isRemoteUrl(ref.sourceUrl)) {
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

      if (isRemoteUrl(candidate)) {
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
  if (isAnalyticsActive() && currentPlaylistItem) {
    const exp = currentExperienceRecord();
    if (exp) {
      trackMediaEvent({ action: 'complete', mediaType: currentPlaylistItem.type, mediaName: currentPlaylistItem.name, experienceId: exp.id, experienceName: exp.name || exp.projectName });
    }
  }
  advancePlaylist();
};
playlistVideoB.onended = () => {
  if (!state.runtime.isPlaying) return;
  if (isAnalyticsActive() && currentPlaylistItem) {
    const exp = currentExperienceRecord();
    if (exp) {
      trackMediaEvent({ action: 'complete', mediaType: currentPlaylistItem.type, mediaName: currentPlaylistItem.name, experienceId: exp.id, experienceName: exp.name || exp.projectName });
    }
  }
  advancePlaylist();
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

async function loadPlaylistItem(itemRef, useB = false) {
  const item = state.library.get(itemRef.id);
  if (!item || item.stale || !item.handle || typeof item.handle.getFile !== 'function') return false;

  const target = useB ? playlistVideoB : playlistVideoA;
  const other = useB ? playlistVideoA : playlistVideoB;

  try {
    const preloaded = await getPreloadedPlaylistUrl(itemRef);
    if (!preloaded?.url) throw new Error('Could not load media');
    const url = preloaded.url;

    // crossfade
    cleanupVideoUrl(target);
    target.style.transition = 'opacity 420ms';
    target.style.opacity = '0';
    target.dataset.objectUrl = url;
    target.src = url;
    target.volume = (state.settings.playlistVolume || 1) * (state.settings.masterVolume || 1);
    await target.play().catch(() => {});

    // fade
    requestAnimationFrame(() => {
      target.style.opacity = '1';
      other.style.opacity = '0';
      setTimeout(() => {
        cleanupVideoUrl(other);
      }, 500);
    });

    currentPlaylistItem = item;
    // Track media play event
    if (isAnalyticsActive()) {
      const exp = currentExperienceRecord();
      if (exp) {
        trackMediaEvent({ action: 'play', mediaType: item.type, mediaName: item.name, experienceId: exp.id, experienceName: exp.name || exp.projectName });
      }
    }
    // Update social meta for current media item
    const expMeta = currentExperienceRecord();
    if (expMeta) updateMediaItemMeta(item, expMeta);
    updateHUD();
    preloadUpcomingPlaylistItems();
    return true;
  } catch (e) {
    log.warn('playlist load failed', e);
    item.stale = true;
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
  if (!item || item.stale || !item.handle || typeof item.handle.getFile !== 'function') return null;
  const file = await item.handle.getFile().catch(() => null);
  if (!file) return null;
  const url = createMediaObjectUrl(file, item);
  return { url };
}

function cleanupPreloadedUrl(preloaded) {
  if (!preloaded?.url) return;
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
  if (!item || item.stale || !item.handle || typeof item.handle.getFile !== 'function') return false;

  clearTimeout(slideshowTimer);
  slideshowTimer = null;
  if (kenBurnsRAF) cancelAnimationFrame(kenBurnsRAF);
  kenBurnsRAF = null;
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

  const { el, url } = preloaded;
  el.dataset.objectUrl = url;
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.margin = 'auto';
  el.style.maxWidth = '100%';
  el.style.maxHeight = '100%';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.objectFit = 'contain';
  el.style.opacity = withCrossfade ? '0' : '1';
  el.style.transition = 'opacity 720ms cubic-bezier(0.2,0,0,1)';
  wrapper.appendChild(el);

  if (item.type === 'image') {
  startKenBurns(el, itemRef.displayDuration || state.settings.defaultImageDuration);
} else {
  el.volume = (itemRef.includeAudio ? state.settings.slideshowVolume : 0) * state.settings.masterVolume;
  el.currentTime = Math.max(0, el.currentTime || 0);
  el.play().catch(()=>{});
  el.onended = () => {
    if (!state.runtime.isPlaying) return;
    if (isAnalyticsActive() && currentSlideshowItem) {
      const exp = currentExperienceRecord();
      if (exp) {
        trackMediaEvent({ action: 'complete', mediaType: currentSlideshowItem.type, mediaName: currentSlideshowItem.name, experienceId: exp.id, experienceName: exp.name || exp.projectName });
      }
    }
    advanceSlideshow();
  };
}

requestAnimationFrame(() => {
    el.style.opacity = '1';
    if (previous && previous !== el) {
      previous.style.transition = 'opacity 720ms cubic-bezier(0.2,0,0,1)';
      previous.style.opacity = '0';
      setTimeout(() => cleanupMediaElement(previous), 820);
    } else if (!withCrossfade) {
      Array.from(wrapper.children).forEach(child => { if (child !== el) cleanupMediaElement(child); });
    }
  });

  slideshowMedia = el;
  currentSlideshowItem = item;

  if (item.type === 'image') {
    if (state.runtime.isPlaying) {
      const dur = (itemRef.displayDuration || state.settings.defaultImageDuration) * 1000;
      slideshowTimer = setTimeout(() => advanceSlideshow(), dur);
    }
  }

  updateHUD();
  preloadUpcomingSlideshowItems();
  return true;
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
    message: 'Paste an http(s) image, video, or audio URL.',
    labelText: 'Media URL',
    placeholder: 'https://example.com/media.mp4',
    okText: 'Add',
    normalizeInput: false
  });
  if (value == null || value === true) return [];
  return String(value)
    .split(/[\s,]+/)
    .map(part => sanitizeImportPath(part.trim()))
    .filter(part => isRemoteUrl(part));
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

async function importExperienceFromFile(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const payload = parseExperienceImportPayload(parsed);
    const importedLibraryRecords = new Map((payload.libraryItems || []).map(record => [String(record.id), record]));
    const playlist = await materializeImportedEntries(payload.playlistEntries, {
      which: 'playlist',
      libraryRecordsById: importedLibraryRecords,
      preserveMissing: true,
      preserveDuplicates: true
    });
    const slideshow = await materializeImportedEntries(payload.slideshowEntries, {
      which: 'slideshow',
      libraryRecordsById: importedLibraryRecords,
      preserveMissing: true,
      preserveDuplicates: true
    });
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
    await switchExperienceById(record.id, { saveCurrent: false, silent: true });
    await saveStateNow();

    const unavailable = (playlist.unavailable || 0) + (slideshow.unavailable || 0);
    const detail = `${playlist.items.length} playlist item${playlist.items.length === 1 ? '' : 's'}, ${slideshow.items.length} slideshow item${slideshow.items.length === 1 ? '' : 's'}${unavailable ? `, ${unavailable} marked Not Available` : ''}`;
    showToast(`Imported experience "${record.name}" (${detail})`);
    return record;
  } catch (e) {
        log.error('experience import failed', e);
    showToast(`Import failed for ${file.name}: ${e.message || 'Invalid file'}`);
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
    if (e.altKey && k === 's') {
      e.preventDefault();
      openConfig();
      showLibrarySortMenu($('#library-sort'));
    }
    else if (k === ' ' || k === 'k') { e.preventDefault(); togglePlay(); }
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
  document.title = state.projectName + ' • Blend';

  await openDB();
  await hydrateState();

  setupMediaLayers();
  wireTransport();
  wireConfig();
  wireKeyboard();
  await setupPWA();
  try { initGA4({ log }); } catch (_) {}
  try { mountDiagnosticsUI(log); } catch (_) {}
  window.addEventListener('pagehide', cleanupRuntimeResources, { once: true });

  // initial renders
  renderLibrary();
  renderListEditor();
  setBlend(state.settings.opacity || 0.5);

  // verify handles (non-blocking)
  setTimeout(() => verifyLibraryHandles(), 1200);

  // restore last indices visually
  updateHUD();

  // first run
  setTimeout(maybeShowWelcome, 900);

  // keyboard hint
  log.info('Press ? for keyboard shortcuts. C to open editor.');

  // expose a little for debugging
  window.Blend = {
    state,
    saveStateNow,
    renderLibrary,
    renderListEditor,
    switchExperienceById,
    createExperience,
    renameCurrentExperience,
    deleteCurrentExperience,
    importExperience,
    exportExperience,
    clearBrowserStorage,
    log
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}









