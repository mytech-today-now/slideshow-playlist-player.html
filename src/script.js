
    'use strict';

    // =====================================================
    // Blend • player.html v2.5.0  (Responsive Mobile/PWA Pass, June 2026)
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
    //   • PWA-ready dynamic manifest
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
    // v2.5.0 — Responsive Mobile/PWA Pass:
    //   • Mobile-first panel layout with touch-sized controls, safe-area handling, and Library/List tabs
    //   • Swipe gestures for next/previous and blend tuning, plus touch fallback for list reordering
    //   • Persisted system/dark/light theme mode with responsive orientation refresh
    //   • Dynamic manifest, install prompt, app-shell cache fallback, and explicit local-media PWA limits
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

    const VERSION = '2.5.0';
    const DB_NAME = 'player-blend-v1';
    const DB_VERSION = 2;

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
      projectName: 'Untitled Session',
      library: new Map(),          // id -> {id, handle, name, size, type, duration?, ...}
      directoryHandles: new Map(), // id -> {id, handle, name, addedAt}
      playlist: [],                // [{id, addedAt}]
      slideshow: [],               // [{id, displayDuration?, includeAudio?}]
      listMeta: {
        playlist: defaultListMeta('playlist'),
        slideshow: defaultListMeta('slideshow')
      },
      settings: {
        defaultImageDuration: 4.0,
        effectIntensity: 'subtle',
        playlistVolume: 1.0,
        slideshowVolume: 0.65,
        masterVolume: 1.0,
        playbackModePlaylist: 'sequential',
        playbackModeSlideshow: 'sequential',
        opacity: 0.5,
        importBehavior: 'append',
        themeMode: 'auto',
        librarySortKey: 'date',
        librarySortDir: 'asc',
        resumeOnLoad: true,
        autoVerifyOnStartup: true
      },
      ui: {
        activeList: 'playlist',
        selectedLibrary: new Set(),
        lastSelectedLibraryId: null,
        visibleLibraryIds: [],
        currentFilter: 'all',
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
    let isMuted = false;
    let originalVolumes = {};
    const objectUrls = new Set();
    const slideshowPreload = new Map();
    const playlistPreload = new Map();
    const thumbUrlCache = new Map();
    const thumbRequests = new Map();
    const thumbElementState = new WeakMap();
    let thumbObserver = null;
    let libraryVirtualList = null;
    let listVirtualList = null;
    let libraryProjectionWorker = null;
    let libraryProjectionWorkerUrl = null;
    let activeLibraryProjectionJob = 0;
    const libraryProjectionResolvers = new Map();
    let installPromptEvent = null;
    const reduceMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const themePreferenceQuery = window.matchMedia?.('(prefers-color-scheme: light)');

    // ====================== UTILITIES ======================
    function $(sel, root = document) { return root.querySelector(sel); }
    function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

    function debounce(fn, ms = 600) {
      let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
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

    function readCssPx(name, fallback) {
      const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    }

    function isCompactLayout() {
      return window.matchMedia?.('(max-width: 860px)')?.matches || false;
    }

    function syncResponsiveMetrics() {
      // Keep virtual-list math aligned with CSS row heights after breakpoint/orientation changes.
      PERF.LIBRARY_ROW_HEIGHT = Math.round(readCssPx('--lib-row-h', PERF.LIBRARY_ROW_HEIGHT));
      PERF.LIST_ROW_HEIGHT = Math.round(readCssPx('--list-row-h', PERF.LIST_ROW_HEIGHT));
      PERF.VIRTUAL_OVERSCAN = window.matchMedia?.('(max-width: 860px), (pointer: coarse)')?.matches ? 6 : 10;

      if (libraryVirtualList) {
        libraryVirtualList.setOptions({ itemHeight: PERF.LIBRARY_ROW_HEIGHT, overscan: PERF.VIRTUAL_OVERSCAN });
        libraryVirtualList.setCount(state.ui.visibleLibraryIds.length);
      }
      if (listVirtualList) {
        listVirtualList.setOptions({ itemHeight: PERF.LIST_ROW_HEIGHT, overscan: PERF.VIRTUAL_OVERSCAN });
        listVirtualList.setCount(activeEditorItems().length);
      }
    }

    function resolvedTheme(mode = state.settings.themeMode || 'auto') {
      if (mode === 'light' || mode === 'dark') return mode;
      return themePreferenceQuery?.matches ? 'light' : 'dark';
    }

    function applyThemeMode(mode = state.settings.themeMode || 'auto', { persist = false } = {}) {
      state.settings.themeMode = mode;
      const resolved = resolvedTheme(mode);
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', resolved === 'light' ? 'light dark' : 'dark light');
      $('#theme-mode') && ($('#theme-mode').value = mode);
      $('#theme-color-meta')?.setAttribute('content', resolved === 'light' ? '#f5f7fb' : '#ff1493');
      if (persist) saveStateDebounced();
    }

    function setMobilePanel(panel = 'library') {
      const next = panel === 'list' ? 'list' : 'library';
      document.body.dataset.mobilePanel = next;
      $all('#mobile-panel-tabs button').forEach(btn => {
        const active = btn.dataset.panel === next;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      requestAnimationFrame(() => {
        syncResponsiveMetrics();
        if (next === 'library') renderLibrary();
        else renderListEditor();
      });
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
      let value = String(path || '').trim().replace(/^["'`]|["'`]$/g, '').replace(/\\/g, '/');
      if (!value) return '';
      const isUnc = value.startsWith('//');
      value = isUnc ? value.slice(2) : value;
      value = value.replace(/\/+/g, '/');
      return (isUnc ? '//' : '') + value;
    }

    function sanitizeImportPath(path) {
      const raw = String(path || '').trim().replace(/^["'`]|["'`]$/g, '');
      if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.replace(/\\/g, '/'))) return '';
      const normalized = normalizePathForExport(raw);
      const withoutDrive = normalized.replace(/^[a-zA-Z]:\//, '');
      const segments = withoutDrive.split('/').filter(Boolean);
      if (segments.some(segment => segment === '..')) return '';
      return normalized;
    }

    function bestPathForItem(item) {
      return normalizePathForExport(item?.pathHint || fallbackRelativePath(item?.name));
    }

    function pathKind(path) {
      const normalized = normalizePathForExport(path);
      if (!normalized) return 'unknown';
      if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/') || normalized.startsWith('//')) return 'absolute';
      return 'relative';
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
        if (existing !== url) URL.revokeObjectURL(existing);
      }
      thumbUrlCache.set(key, url);
      while (thumbUrlCache.size > PERF.THUMB_CACHE_LIMIT) {
        const [oldKey, oldUrl] = thumbUrlCache.entries().next().value;
        thumbUrlCache.delete(oldKey);
        URL.revokeObjectURL(oldUrl);
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
            console.warn('thumb load failed', e);
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
      } catch (e) { console.warn('thumb gen failed', e); }

      URL.revokeObjectURL(url);
      objectUrls.delete(url);

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

    async function saveStateNow() {
      if (!db) return;
      try {
        // library (store handles + meta)
        for (const [id, item] of state.library.entries()) {
          const isTransient = !!item.handle?.transient;
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

        await idbPut('playlist', { key: 'default', items: state.playlist, mode: state.settings.playbackModePlaylist, index: state.runtime.playlistIndex, meta: state.listMeta.playlist });
        await idbPut('slideshow', { key: 'default', items: state.slideshow, mode: state.settings.playbackModeSlideshow, index: state.runtime.slideshowIndex, meta: state.listMeta.slideshow });
        await idbPut('settings', { key: 'global', ...state.settings, projectName: state.projectName, opacity: state.settings.opacity });

        // prune removed library items (optional, keep simple)
      } catch (e) { console.warn('save failed', e); }
    }

    async function hydrateState() {
      if (!db) await openDB();

      // settings
      const s = await idbGet('settings', 'global');
      if (s) {
        state.projectName = s.projectName || 'Untitled Session';
        Object.assign(state.settings, s);
      }
      applyThemeMode(state.settings.themeMode || 'auto');

      // library
      const libItems = await idbGetAll('library');
      state.library.clear();
      for (const rec of libItems) {
        const handle = rec.handle || (rec.file ? transientHandleFromFile(rec.file) : null);
        if (handle) {
          state.library.set(rec.id, {
            id: rec.id,
            handle,
            name: rec.name,
            size: rec.size,
            type: rec.type,
            duration: rec.duration,
            pathHint: sanitizeImportPath(rec.pathHint) || fallbackRelativePath(rec.name),
            directoryId: rec.directoryId,
            metadata: rec.metadata,
            addedAt: rec.addedAt || rec.lastVerified || Date.now(),
            lastVerified: rec.lastVerified,
            stale: rec.stale || false
          });
        }
      }

      state.directoryHandles.clear();
      for (const rec of await idbGetAll('dirHandles')) {
        if (rec.handle) state.directoryHandles.set(rec.id, rec);
      }

      // playlist / slideshow
      const pl = await idbGet('playlist', 'default');
      if (pl) {
        state.playlist = pl.items || [];
        state.settings.playbackModePlaylist = pl.mode || 'sequential';
        state.runtime.playlistIndex = pl.index || 0;
        state.listMeta.playlist = normalizeListMeta('playlist', pl.meta);
      }
      const ss = await idbGet('slideshow', 'default');
      if (ss) {
        state.slideshow = ss.items || [];
        state.settings.playbackModeSlideshow = ss.mode || 'sequential';
        state.runtime.slideshowIndex = ss.index || 0;
        state.listMeta.slideshow = normalizeListMeta('slideshow', ss.meta);
      }

      $('#project-name').value = state.projectName;
      $('#app-version').textContent = `v${VERSION}`;
      $('#blend-slider').value = Math.round((state.settings.opacity || 0.5) * 100);
      $('#blend-value').textContent = Math.round((state.settings.opacity || 0.5) * 100) + '%';

      // volumes
      $('#vol-playlist').value = state.settings.playlistVolume;
      $('#vol-slideshow').value = state.settings.slideshowVolume;
      $('#vol-master').value = state.settings.masterVolume;
      updateVolumeLabels();

      $('#default-duration').value = state.settings.defaultImageDuration;
      $('#effect-intensity').value = state.settings.effectIntensity;
      $('#import-behavior').value = state.settings.importBehavior || 'append';
      $('#theme-mode').value = state.settings.themeMode || 'auto';
      $('#resume-on-load').checked = state.settings.resumeOnLoad;
      $('#auto-verify').checked = state.settings.autoVerifyOnStartup;
    }

    async function verifyLibraryHandles() {
      if (!state.settings.autoVerifyOnStartup) return;
      let changed = false;
      for (const [id, item] of state.library) {
        try {
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
    function transientHandleFromFile(file) {
      return {
        kind: 'file',
        name: file.name,
        transient: true,
        file,
        getFile: async () => file,
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted'
      };
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
          showToast('Opening the browser file picker. On mobile, choose from Photos, Files, or another media source.', { timeout: 3200 });
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
          showToast('Folder access is limited in this browser. Choose multiple files or a supported folder from the picker.', { timeout: 4200 });
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
          console.warn('Directory scan skipped a branch', e);
        }
      }
      opts.onProgress?.(handles.length);
      return handles;
    }

    async function ensureHandleInLibrary(handle, meta = {}) {
      const name = handle.name;
      const type = getMediaType(name);
      if (!type) return { id: null, status: 'skipped' };

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
        if (sameName && sameSize) {
          const existingPathHint = sanitizeImportPath(meta.pathHint || handle.pathHint || '');
          if (existingPathHint && !it.pathHint) it.pathHint = existingPathHint;
          if (meta.metadata && typeof meta.metadata === 'object') it.metadata = { ...(it.metadata || {}), ...meta.metadata };
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
      const jobId = ++activeLibraryProjectionJob;
      const grid = $('#library-grid');
      grid.setAttribute('aria-busy', 'true');

      if (state.library.size >= PERF.WORKER_THRESHOLD && typeof Worker !== 'undefined') {
        projectLibraryInWorker(q, filter, jobId)
          .then(ids => {
            if (jobId === activeLibraryProjectionJob) applyLibraryProjection(ids);
          })
          .catch(() => {
            if (jobId === activeLibraryProjectionJob) {
              applyLibraryProjection(getVisibleLibraryEntries(q, filter).map(([id]) => id));
            }
          });
        return;
      }

      applyLibraryProjection(getVisibleLibraryEntries(q, filter).map(([id]) => id));
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
              const { jobId, rows, search, filter, sortKey, sortDir } = event.data;
              const q = String(search || '').toLowerCase();
              const mult = sortDir === 'desc' ? -1 : 1;
              const filtered = rows.filter(row => {
                if (filter !== 'all' && row.type !== filter) return false;
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
        console.warn('Projection worker unavailable', e);
        libraryProjectionWorker = null;
      }
      return libraryProjectionWorker;
    }

    function projectLibraryInWorker(search, filter, jobId) {
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
          sortKey: state.settings.librarySortKey || 'date',
          sortDir: state.settings.librarySortDir || 'asc'
        });
      });
    }

    function getVisibleLibraryEntries(q = state.ui.search.toLowerCase(), filter = state.ui.currentFilter) {
      const entries = Array.from(state.library.entries()).filter(([, item]) => {
        if (filter !== 'all' && item.type !== filter) return false;
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
      if (pl) {
        pl.textContent = n ? `Add Selected (${n}) → Playlist` : 'Add Selected → Playlist';
        pl.disabled = n === 0;
      }
      if (ss) {
        ss.textContent = n ? `Add Selected (${n}) → Slideshow` : 'Add Selected → Slideshow';
        ss.disabled = n === 0;
      }
    }

    function clearLibraryView() {
      // keep items referenced by lists
      const used = new Set([...state.playlist, ...state.slideshow].map(x => x.id));
      for (const id of state.library.keys()) {
        if (!used.has(id)) state.library.delete(id);
      }
      state.ui.selectedLibrary.clear();
      renderLibrary();
      saveStateDebounced();
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
      renderLibrary();
    }

    // ====================== LISTS (PLAYLIST / SLIDESHOW) ======================
    function setActiveList(which) {
      state.ui.activeList = which;
      $all('.segmented button').forEach(b => b.classList.toggle('active', b.dataset.tab === which));
      $all('.segmented button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === which ? 'true' : 'false'));
      if (isCompactLayout()) setMobilePanel('list');
      renderListEditor();
    }

    function parseInternalDrag(ev) {
      try { return JSON.parse(ev.dataTransfer.getData('text/plain') || '{}'); }
      catch (_) { return {}; }
    }

    function wireListDropZone(container, which) {
      container.ondragenter = e => {
        e.preventDefault();
        container.classList.add('list-drop-active');
      };
      container.ondragover = e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
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
          reorderList(which, data.from, atIndex);
        } else if (row && data.ids) {
          insertIntoListAt(which, data.ids, atIndex);
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

    function listEmptyMessage(which) {
      return `<div class="empty" aria-label="Drop media here">Drop media here or use Library actions<br><strong>${which === 'playlist' ? 'Playlist accepts video & audio' : 'Slideshow accepts images & video'}</strong></div>`;
    }

    function renderListEditor() {
      const container = $('#list-editor');
      const which = state.ui.activeList;
      const items = activeEditorItems();
      wireListDropZone(container, which);
      container.setAttribute('aria-label', `${which === 'playlist' ? 'Playlist' : 'Slideshow'} editor`);
      $('#pl-count').textContent = `(${state.playlist.length})`;
      $('#ss-count').textContent = `(${state.slideshow.length})`;

      if (!items.length) {
        ensureListVirtualList().clear(listEmptyMessage(which));
        return;
      }

      const virtualList = ensureListVirtualList();
      virtualList.setCount(items.length);
      virtualList.refresh();
    }

    function renderListRow(idx, row) {
      const which = state.ui.activeList;
      const items = activeEditorItems();
      const ref = items[idx];
      const item = ref ? state.library.get(ref.id) : null;
      row = row || document.createElement('div');

      if (!ref || !item) {
        row.className = 'list-item virtual-row';
        row.dataset.idx = idx;
        row.innerHTML = '<div class="info"><div class="name">Missing item</div></div><span class="del" title="Remove">✕</span>';
        return row;
      }

      const path = bestPathForItem(item);
      const isCurrent = which === 'playlist' ? idx === state.runtime.playlistIndex : idx === state.runtime.slideshowIndex;
      const signature = `${which}|${idx}|${ref.id}|${item.name}|${path}|${item.size}|${item.type}|${ref.displayDuration || ''}|${ref.includeAudio ? 1 : 0}|${item.stale ? 1 : 0}`;

      row.className = `list-item virtual-row ${isCurrent ? 'current' : ''}`;
      row.dataset.id = ref.id;
      row.dataset.idx = idx;
      row.tabIndex = 0;
      row.draggable = true;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      row.setAttribute('aria-posinset', String(idx + 1));
      row.setAttribute('aria-setsize', String(items.length));
      row.setAttribute('aria-label', `${idx + 1}. ${item.name}, ${item.type}`);

      if (row.dataset.signature !== signature) {
        releaseThumbnailElement(row);
        let extra = '';
        if (which === 'slideshow') {
          const dur = ref.displayDuration || state.settings.defaultImageDuration;
          if (item.type === 'image') {
            extra = `<input type="number" step="0.5" min="0.5" value="${dur}" title="Display seconds" aria-label="Display seconds">s`;
          } else if (item.type === 'video') {
            const checked = ref.includeAudio ? 'checked' : '';
            extra = `<label class="audio-flag"><input type="checkbox" ${checked} aria-label="Include audio"> Include audio</label>`;
          }
        }

        row.innerHTML = `
          <span class="drag" aria-hidden="true">≡</span>
          <div class="thumb-sm"></div>
          <div class="info">
            <div class="name" title="${escapeHtml(path)}">${escapeHtml(item.name)}</div>
            <div class="path">${escapeHtml(path)} • ${formatBytes(item.size)}</div>
          </div>
          ${extra}
          <span class="del" title="Remove" role="button" aria-label="Remove">✕</span>
        `;
        row.dataset.signature = signature;
      }

      requestThumbnailForElement(row.querySelector('.thumb-sm'), item);
      return row;
    }

    function wireListEditorEvents() {
      const container = $('#list-editor');
      if (container.dataset.eventsWired === 'true') return;
      container.dataset.eventsWired = 'true';

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

      container.addEventListener('dragstart', event => {
        const row = event.target.closest('.list-item');
        if (!row) return;
        const idx = parseInt(row.dataset.idx, 10);
        event.dataTransfer.setData('text/plain', JSON.stringify({ reorder: true, from: idx, list: state.ui.activeList }));
        event.dataTransfer.effectAllowed = 'move';
      });

      let touchReorder = null;
      const clearTouchTarget = () => container.querySelector('.list-item.drop-target')?.classList.remove('drop-target');
      const finishTouchReorder = event => {
        if (!touchReorder || event.pointerId !== touchReorder.pointerId) return;
        event.preventDefault();
        clearTouchTarget();
        touchReorder.row.classList.remove('drop-target');
        try { touchReorder.row.releasePointerCapture(event.pointerId); } catch (_) {}
        const to = Math.max(0, Math.min(activeEditorItems().length - 1, touchReorder.toIndex));
        reorderList(touchReorder.which, touchReorder.fromIndex, to);
        touchReorder = null;
      };

      container.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse') return;
        const handle = event.target.closest('.drag');
        const row = event.target.closest('.list-item');
        if (!handle || !row) return;
        touchReorder = {
          pointerId: event.pointerId,
          row,
          which: state.ui.activeList,
          fromIndex: parseInt(row.dataset.idx, 10),
          toIndex: parseInt(row.dataset.idx, 10)
        };
        row.classList.add('drop-target');
        try { row.setPointerCapture(event.pointerId); } catch (_) {}
        event.preventDefault();
      }, { passive: false });

      container.addEventListener('pointermove', event => {
        if (!touchReorder || event.pointerId !== touchReorder.pointerId) return;
        event.preventDefault();
        const rect = container.getBoundingClientRect();
        const y = event.clientY - rect.top + container.scrollTop;
        touchReorder.toIndex = Math.max(0, Math.min(activeEditorItems().length - 1, Math.floor(y / PERF.LIST_ROW_HEIGHT)));
        clearTouchTarget();
        container.querySelector(`.list-item[data-idx="${touchReorder.toIndex}"]`)?.classList.add('drop-target');
        if (event.clientY < rect.top + 44) container.scrollBy({ top: -PERF.LIST_ROW_HEIGHT / 2, behavior: 'auto' });
        else if (event.clientY > rect.bottom - 44) container.scrollBy({ top: PERF.LIST_ROW_HEIGHT / 2, behavior: 'auto' });
      }, { passive: false });

      container.addEventListener('pointerup', finishTouchReorder, { passive: false });
      container.addEventListener('pointercancel', event => {
        if (!touchReorder || event.pointerId !== touchReorder.pointerId) return;
        clearTouchTarget();
        touchReorder.row.classList.remove('drop-target');
        touchReorder = null;
      });
    }

    function createListRef(which, item) {
      const ref = { id: item.id, addedAt: Date.now() };
      if (which === 'slideshow') {
        if (item.type === 'image') ref.displayDuration = state.settings.defaultImageDuration;
        if (item.type === 'video') ref.includeAudio = false;
      }
      return ref;
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
      const list = which === 'playlist' ? state.playlist : state.slideshow;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= list.length) return;
      to = Math.max(0, Math.min(list.length - 1, to));
      if (from === to) return;
      const [m] = list.splice(from, 1);
      list.splice(to, 0, m);
      renderListEditor();
      saveStateDebounced();
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
      playlistVideoA.onended = () => advancePlaylist();
      playlistVideoB.onended = () => advancePlaylist();

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
      $('#hud-blend').textContent = Math.round(v * 100) + '%';
    }

    function updatePlayButton() {
      const btn = $('#btn-play');
      if (!btn) return;
      btn.textContent = state.runtime.isPlaying ? '⏸' : '▶';
      btn.setAttribute('aria-pressed', state.runtime.isPlaying ? 'true' : 'false');
      btn.setAttribute('aria-label', state.runtime.isPlaying ? 'Pause playback' : 'Play playback');
    }

    async function loadPlaylistItem(itemRef, useB = false) {
      const item = state.library.get(itemRef.id);
      if (!item || item.stale) { advancePlaylist(); return; }

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
        updateHUD();
        preloadUpcomingPlaylistItems();
      } catch (e) {
        console.warn('playlist load failed', e);
        showToast('Failed to load playlist item');
        advancePlaylist();
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
      if (!item || item.stale) return null;
      const file = await item.handle.getFile().catch(() => null);
      if (!file) return null;
      const url = createMediaObjectUrl(file, item);
      return { url };
    }

    function cleanupPreloadedUrl(preloaded) {
      if (!preloaded?.url) return;
      URL.revokeObjectURL(preloaded.url);
      objectUrls.delete(preloaded.url);
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
          URL.revokeObjectURL(url);
          objectUrls.delete(url);
        }
        delete video.dataset.objectUrl;
        video.removeAttribute('src');
        video.load();
      } catch (_) {}
    }

    async function loadSlideshowItem(itemRef, withCrossfade = true) {
      const item = state.library.get(itemRef.id);
      if (!item || item.stale) { advanceSlideshow(); return; }

      const layer = $('#slideshow-layer');
      const wrapper = layer.querySelector('.kenburns-wrapper') || layer;
      const previous = slideshowMedia;
      const loading = $('#slideshow-loading');

      loading?.classList.add('visible');
      let preloaded = await getPreloadedSlideshowElement(itemRef);
      loading?.classList.remove('visible');
      if (!preloaded) { advanceSlideshow(); return; }

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
        el.onended = () => advanceSlideshow();
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

      // schedule next for images
      if (item.type === 'image') {
        clearTimeout(slideshowTimer);
        const dur = (itemRef.displayDuration || state.settings.defaultImageDuration) * 1000;
        slideshowTimer = setTimeout(() => advanceSlideshow(), dur);
      }

      updateHUD();
      preloadUpcomingSlideshowItems();
    }

    function cleanupMediaElement(el) {
      if (!el) return;
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
          URL.revokeObjectURL(el.dataset.objectUrl);
          objectUrls.delete(el.dataset.objectUrl);
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
      if (!item || item.stale) return null;
      const file = await item.handle.getFile().catch(() => null);
      if (!file) return null;
      const url = createMediaObjectUrl(file, item);
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
      return { el, url };
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
          else if (preloaded?.url) {
            URL.revokeObjectURL(preloaded.url);
            objectUrls.delete(preloaded.url);
          }
        }).catch(() => {});
        slideshowPreload.delete(id);
      }
    }

    function startKenBurns(mediaEl, durationSec) {
      if (kenBurnsRAF) cancelAnimationFrame(kenBurnsRAF);
      if (reduceMotionQuery?.matches) {
        mediaEl.style.transform = '';
        kenBurnsRAF = null;
        return;
      }
      const intensity = getIntensityMultiplier();
      if (intensity <= 0.05) return; // off

      const start = performance.now();
      const dur = durationSec * 1000;
      const maxZoom = 1 + (0.07 * intensity);
      const dirX = (Math.random() - 0.5) * 2 * (4 * intensity);
      const dirY = (Math.random() - 0.5) * 2 * (3 * intensity);

      function frame(now) {
        const p = Math.min(1, (now - start) / dur);
        const z = 1 + (maxZoom - 1) * p;
        const tx = dirX * p;
        const ty = dirY * p;
        mediaEl.style.transform = `scale(${z}) translate(${tx}%, ${ty}%)`;
        if (p < 1) kenBurnsRAF = requestAnimationFrame(frame);
      }
      kenBurnsRAF = requestAnimationFrame(frame);
    }

    function getIntensityMultiplier() {
      const i = state.settings.effectIntensity;
      if (i === 'off') return 0;
      if (i === 'subtle') return 1;
      if (i === 'medium') return 1.7;
      if (i === 'strong') return 2.6;
      return 1;
    }

    function advancePlaylist() {
      if (!state.playlist.length) return;
      const mode = state.settings.playbackModePlaylist || 'sequential';
      let next = state.runtime.playlistIndex + 1;

      if (mode === 'random') {
        state.runtime.historyPlaylist.push(state.runtime.playlistIndex);
        let candidate = Math.floor(Math.random() * state.playlist.length);
        if (candidate === state.runtime.playlistIndex && state.playlist.length > 1) candidate = (candidate + 1) % state.playlist.length;
        next = candidate;
      } else if (mode === 'shuffle') {
        // simple linear for now; could precompute perm
        next = (state.runtime.playlistIndex + 1) % state.playlist.length;
      } else {
        // sequential + loop handled on end
        if (next >= state.playlist.length) next = 0;
      }

      state.runtime.playlistIndex = next;
      const useB = (state.runtime.playlistIndex % 2 === 1);
      loadPlaylistItem(state.playlist[next], useB);
      saveStateDebounced();
    }

    function advanceSlideshow() {
      clearTimeout(slideshowTimer);
      if (kenBurnsRAF) cancelAnimationFrame(kenBurnsRAF);

      if (!state.slideshow.length) return;
      let next = (state.runtime.slideshowIndex + 1) % state.slideshow.length;
      state.runtime.slideshowIndex = next;
      loadSlideshowItem(state.slideshow[next], true);
      saveStateDebounced();
    }

    async function playFromHere(which, idx) {
      if (which === 'playlist') {
        state.runtime.playlistIndex = idx;
        await loadPlaylistItem(state.playlist[idx], false);
      } else {
        state.runtime.slideshowIndex = idx;
        await loadSlideshowItem(state.slideshow[idx], false);
      }
      if (!state.runtime.isPlaying) togglePlay();
    }

    async function togglePlay() {
      const playing = state.runtime.isPlaying;
      state.runtime.isPlaying = !playing;

      updatePlayButton();

      if (state.runtime.isPlaying) {
        // start both layers from current positions
        if (state.playlist.length) {
          const it = state.playlist[state.runtime.playlistIndex] || state.playlist[0];
          if (it) await loadPlaylistItem(it, false);
        }
        if (state.slideshow.length) {
          const it = state.slideshow[state.runtime.slideshowIndex] || state.slideshow[0];
          if (it) await loadSlideshowItem(it, false);
        }
      } else {
        // pause both
        if (playlistVideoA) playlistVideoA.pause();
        if (playlistVideoB) playlistVideoB.pause();
        if (slideshowMedia && slideshowMedia.tagName === 'VIDEO') slideshowMedia.pause();
        clearTimeout(slideshowTimer);
      }
    }

    function stopPlayback() {
      state.runtime.isPlaying = false;
      updatePlayButton();
      cleanupVideoUrl(playlistVideoA);
      cleanupVideoUrl(playlistVideoB);
      const ssLayer = $('#slideshow-layer');
      $all('#slideshow-layer .kenburns-wrapper > *').forEach(cleanupMediaElement);
      clearPlaylistPreloads();
      clearSlideshowPreloads();
      ssLayer.innerHTML = '<div class="kenburns-wrapper" style="width:100%;height:100%"></div>';
      slideshowMedia = null;
      clearTimeout(slideshowTimer);
      if (kenBurnsRAF) cancelAnimationFrame(kenBurnsRAF);
      state.runtime.playlistIndex = 0;
      state.runtime.slideshowIndex = 0;
      updateHUD();
    }

    function clearSlideshowPreloads() {
      for (const [, promise] of slideshowPreload) {
        promise.then(preloaded => {
          if (preloaded?.el) cleanupMediaElement(preloaded.el);
          else if (preloaded?.url) {
            URL.revokeObjectURL(preloaded.url);
            objectUrls.delete(preloaded.url);
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
      clearTimeout(slideshowTimer);
      if (kenBurnsRAF) cancelAnimationFrame(kenBurnsRAF);
      cleanupVideoUrl(playlistVideoA);
      cleanupVideoUrl(playlistVideoB);
      clearPlaylistPreloads();
      clearSlideshowPreloads();
      if (slideshowMedia) cleanupMediaElement(slideshowMedia);
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
      for (const url of thumbUrlCache.values()) URL.revokeObjectURL(url);
      thumbUrlCache.clear();
      thumbRequests.clear();
      thumbQueue.length = 0;
      if (thumbObserver) thumbObserver.disconnect();
      if (libraryProjectionWorker) libraryProjectionWorker.terminate();
      if (libraryProjectionWorkerUrl) URL.revokeObjectURL(libraryProjectionWorkerUrl);
      libraryProjectionResolvers.clear();
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
      $('#vol-master-val').textContent = Math.round($('#vol-master').value * 100) + '%';
    }

    function wireTransport() {
      $('#btn-play').onclick = togglePlay;
      $('#btn-prev').onclick = () => previousBoth();
      $('#btn-next').onclick = () => nextBoth();
      $('#btn-stop').onclick = stopPlayback;

      const blend = $('#blend-slider');
      blend.oninput = () => {
        setBlend(parseInt(blend.value, 10) / 100);
      };

      $('#btn-fullscreen').onclick = () => {
        const v = $('#viewport');
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else if (v.requestFullscreen) {
          v.requestFullscreen({ navigationUI: 'hide' }).catch(() => showToast('Fullscreen was blocked by the browser', { timeout: 2200 }));
        } else {
          showToast('Fullscreen is not available in this browser', { timeout: 2200 });
        }
      };

      $('#btn-mute').onclick = toggleMute;

      // volume wiring
      ['vol-playlist','vol-slideshow','vol-master'].forEach(id => {
        const el = $('#' + id);
        el.oninput = () => {
          state.settings[id.replace('vol-','') + 'Volume'] = parseFloat(el.value);
          updateVolumeLabels();
          applyVolumes();
          saveStateDebounced();
        };
      });

      $('#effect-intensity').onchange = (e) => {
        state.settings.effectIntensity = e.target.value;
        saveStateDebounced();
      };
      $('#default-duration').onchange = (e) => {
        state.settings.defaultImageDuration = parseFloat(e.target.value) || 4;
        saveStateDebounced();
      };
      $('#resume-on-load').onchange = (e) => { state.settings.resumeOnLoad = e.target.checked; saveStateDebounced(); };
      $('#auto-verify').onchange = (e) => { state.settings.autoVerifyOnStartup = e.target.checked; saveStateDebounced(); };
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
      isMuted = !isMuted;
      const btn = $('#btn-mute');
      if (isMuted) {
        originalVolumes = {
          p: state.settings.playlistVolume,
          s: state.settings.slideshowVolume,
          m: state.settings.masterVolume
        };
        state.settings.playlistVolume = 0;
        state.settings.slideshowVolume = 0;
        state.settings.masterVolume = 0;
        btn.textContent = '🔇';
        btn.setAttribute('aria-pressed', 'true');
        btn.setAttribute('aria-label', 'Unmute');
      } else {
        state.settings.playlistVolume = originalVolumes.p ?? 1;
        state.settings.slideshowVolume = originalVolumes.s ?? 0.65;
        state.settings.masterVolume = originalVolumes.m ?? 1;
        btn.textContent = '🔊';
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', 'Mute');
      }
      updateVolumeLabels();
      $('#vol-playlist').value = state.settings.playlistVolume;
      $('#vol-slideshow').value = state.settings.slideshowVolume;
      $('#vol-master').value = state.settings.masterVolume;
      applyVolumes();
    }

    function nextBoth() {
      if (state.playlist.length) advancePlaylist();
      if (state.slideshow.length) advanceSlideshow();
    }

    function previousBoth() {
      // use history when available
      const plH = state.runtime.historyPlaylist;
      if (plH.length) {
        state.runtime.playlistIndex = plH.pop();
      } else {
        state.runtime.playlistIndex = Math.max(0, state.runtime.playlistIndex - 1);
      }
      if (state.playlist[state.runtime.playlistIndex]) loadPlaylistItem(state.playlist[state.runtime.playlistIndex], false);

      // simple for slideshow
      state.runtime.slideshowIndex = Math.max(0, state.runtime.slideshowIndex - 1);
      if (state.slideshow[state.runtime.slideshowIndex]) loadSlideshowItem(state.slideshow[state.runtime.slideshowIndex], false);
    }

    // ====================== CONFIG PANEL ======================
    function openConfig() {
      $('#config-panel').classList.add('open');
      $('#config-backdrop').classList.add('open');
      if (isCompactLayout()) setMobilePanel(document.body.dataset.mobilePanel || 'library');
      renderLibrary();
      renderListEditor();
      requestAnimationFrame(syncResponsiveMetrics);
    }
    function closeConfig() {
      $('#config-panel').classList.remove('open');
      $('#config-backdrop').classList.remove('open');
    }

    function wireConfig() {
      $('#config-gear').onclick = () => {
        if ($('#config-panel').classList.contains('open')) closeConfig();
        else openConfig();
      };
      $('#close-config').onclick = closeConfig;
      $('#close-config').onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          closeConfig();
        }
      };
      $('#config-backdrop').onclick = closeConfig;
      $all('#mobile-panel-tabs button').forEach(btn => {
        btn.onclick = () => setMobilePanel(btn.dataset.panel);
      });

      $('#project-name').oninput = (e) => {
        state.projectName = e.target.value || 'Untitled Session';
        document.title = state.projectName + ' • Blend';
        saveStateDebounced();
      };

      // add buttons
      $('#add-files').onclick = addFilesFromPicker;
      $('#add-folder').onclick = addFolderFromPicker;
      $('#add-all-playlist').onclick = () => addAllVisible('playlist');
      $('#add-all-slideshow').onclick = () => addAllVisible('slideshow');
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

      // search
      const search = $('#library-search');
      search.oninput = debounce(() => {
        state.ui.search = search.value;
        renderLibrary();
      }, 120);

      // pills
      $all('.type-pill').forEach(p => {
        p.onclick = () => filterLibrary(p.dataset.filter);
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
      $('#list-export').onclick = (e) => showExportMenu(e.currentTarget);
      $('#list-import').onclick = importList;
      $('#theme-mode').onchange = e => applyThemeMode(e.target.value, { persist: true });

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
      $('#vol-playlist').oninput = () => { state.settings.playlistVolume = parseFloat($('#vol-playlist').value); updateVolumeLabels(); applyVolumes(); saveStateDebounced(); };
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
      const visible = getVisibleLibraryEntries(q, f).map(([id]) => id);
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
      const record = {
        order: index,
        id: ref.id,
        path,
        fullPath: path,
        pathKind: pathKind(path),
        name: item?.name || basenameFromPath(path) || ref.id,
        type: item?.type || ref.type,
        size: item?.size || 0,
        duration: item?.duration || null,
        addedAt: ref.addedAt || item?.addedAt || null,
        displayDuration: ref.displayDuration,
        includeAudio: ref.includeAudio
      };
      const metadata = ref.metadata || item?.metadata;
      if (metadata && typeof metadata === 'object') record.metadata = metadata;
      return record;
    }

    function exportLibraryRecord(item, index) {
      const path = normalizePathForExport(bestPathForItem(item));
      return {
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
        metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : undefined
      };
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
      const libraryItems = sortLibraryEntries(Array.from(state.library.entries())).map(([, item], index) => exportLibraryRecord(item, index));
      const payload = {
        version: VERSION,
        schema: 'player.blend.experience.v1',
        type: 'experience',
        project: state.projectName,
        exportedAt: new Date().toISOString(),
        settings: {
          ...state.settings,
          // Runtime permissions and handles stay local; exports keep portable metadata only.
          resumeOnLoad: false
        },
        library: {
          order: libraryItems.map(item => item.id),
          items: libraryItems
        },
        playlist: makeListExportPayload('playlist'),
        slideshow: makeListExportPayload('slideshow')
      };
      downloadJson(payload, `blend-experience-${new Date().toISOString().slice(0,10)}.json`);
      showToast('Exported Full Experience JSON');
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
      URL.revokeObjectURL(a.href);
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
        console.warn('import failed', e);
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

    function normalizeImportItems(items) {
      return (items || []).map(item => {
        if (typeof item === 'string') {
          const path = sanitizeImportPath(item);
          return path ? { path } : null;
        }
        if (!item || typeof item !== 'object') return null;
        const path = sanitizeImportPath(item.fullPath || item.path || item.file || item.relativePath || item.name || item.title);
        if (!path) return null;
        return {
          path,
          displayDuration: item.displayDuration,
          includeAudio: item.includeAudio,
          order: item.order,
          type: item.type,
          metadata: item.metadata || item.customMetadata
        };
      }).filter(Boolean);
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
      const base = basenameFromPath(path);
      return !!(base && (getMediaType(base) || /[\\/]/.test(path) || /\.[a-z0-9]{2,5}$/i.test(base)));
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
      const allowed = which === 'playlist' ? ['video','audio'] : ['video','image'];
      const replaceCurrent = (state.settings.importBehavior || 'append') === 'replace';
      const previousItems = list.slice();
      if (replaceCurrent) list.length = 0;

      const firstIndex = list.length;
      let imported = 0, incompatible = 0, duplicate = 0;
      const missing = [];

      entries.forEach(entry => {
        const id = findLibraryMatch(entry.path);
        if (!id) {
          missing.push({ ...entry, basename: basenameFromPath(entry.path) });
          return;
        }
        const item = state.library.get(id);
        if (!allowed.includes(item.type)) { incompatible++; return; }
        if (list.some(ref => ref.id === id)) { duplicate++; return; }
        if (entry.path && /[\\/]/.test(entry.path)) item.pathHint = entry.path;
        if (entry.metadata && typeof entry.metadata === 'object') item.metadata = { ...(item.metadata || {}), ...entry.metadata };
        const ref = createListRef(which, item);
        if (entry.displayDuration) ref.displayDuration = entry.displayDuration;
        if (typeof entry.includeAudio === 'boolean') ref.includeAudio = entry.includeAudio;
        list.push(ref);
        imported++;
      });

      let restored = false;
      if (replaceCurrent && imported === 0 && previousItems.length) {
        list.splice(0, list.length, ...previousItems);
        restored = true;
      }

      setActiveList(which);
      if (opts.meta && imported) state.listMeta[which] = normalizeListMeta(which, opts.meta);
      saveStateDebounced();
      if (imported) scrollListItemIntoView(firstIndex);
      const result = { which, imported, total: entries.length, missing, incompatible, duplicate, restored, sourceName: opts.sourceName };
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

    // ====================== RESPONSIVE / TOUCH ======================
    function setupResponsiveRuntime() {
      document.body.dataset.mobilePanel = document.body.dataset.mobilePanel || 'library';
      syncResponsiveMetrics();
      setMobilePanel(document.body.dataset.mobilePanel);

      const refreshLayout = rafThrottle(() => {
        syncResponsiveMetrics();
        if (!isCompactLayout()) {
          renderLibrary();
          renderListEditor();
        }
      });

      window.addEventListener('resize', refreshLayout, { passive: true });
      window.visualViewport?.addEventListener('resize', refreshLayout, { passive: true });
      window.addEventListener('orientationchange', () => {
        // Responsive QA targets: phone portrait/landscape, tablet split view, laptop, desktop, 4K/8K.
        setTimeout(() => {
          syncResponsiveMetrics();
          renderLibrary();
          renderListEditor();
          updateHUD();
        }, 240);
      }, { passive: true });

      document.addEventListener('fullscreenchange', () => {
        document.body.classList.toggle('is-immersive', !!document.fullscreenElement);
        syncResponsiveMetrics();
      });

      themePreferenceQuery?.addEventListener?.('change', () => {
        if ((state.settings.themeMode || 'auto') === 'auto') applyThemeMode('auto');
      });
      reduceMotionQuery?.addEventListener?.('change', () => {
        if (reduceMotionQuery.matches && kenBurnsRAF) {
          cancelAnimationFrame(kenBurnsRAF);
          kenBurnsRAF = null;
          if (slideshowMedia) slideshowMedia.style.transform = '';
        }
      });
    }

    function setupViewportGestures() {
      const viewport = $('#viewport');
      let start = null;

      viewport.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse') return;
        if (event.target.closest('#transport,#config-gear,button,input,select,dialog')) return;
        start = { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now() };
      }, { passive: true });

      viewport.addEventListener('pointerup', event => {
        if (!start || event.pointerId !== start.id) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        const elapsed = performance.now() - start.t;
        start = null;
        if (elapsed > 900) return;

        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        if (Math.max(ax, ay) < 48) return;

        if (ax > ay * 1.25) {
          if (dx < 0) nextBoth();
          else previousBoth();
          showToast(dx < 0 ? 'Next media' : 'Previous media', { timeout: 900 });
        } else if (ay > ax * 1.25) {
          const delta = dy < 0 ? 0.05 : -0.05;
          setBlend((state.settings.opacity || 0.5) + delta);
          saveStateDebounced();
          showToast(`Blend ${Math.round((state.settings.opacity || 0.5) * 100)}%`, { timeout: 900 });
        }
      }, { passive: true });

      viewport.addEventListener('pointercancel', () => { start = null; }, { passive: true });
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
    function makePwaIcon(size) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#0a0a0a"/>
        <circle cx="${Math.round(size * 0.34)}" cy="${Math.round(size * 0.5)}" r="${Math.round(size * 0.2)}" fill="#ff1493" opacity=".9"/>
        <path d="M${Math.round(size * 0.44)} ${Math.round(size * 0.28)}v${Math.round(size * 0.44)}l${Math.round(size * 0.32)}-${Math.round(size * 0.22)}z" fill="#fff"/>
      </svg>`;
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    function setupInstallPrompt() {
      const btn = $('#install-app');
      if (!btn) return;
      const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone;
      if (standalone) btn.classList.add('hidden');

      window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        installPromptEvent = event;
        btn.classList.remove('hidden');
      });

      btn.onclick = async () => {
        if (!installPromptEvent) {
          showToast('Install from your browser menu if the install prompt is not available yet.', { timeout: 3600 });
          return;
        }
        installPromptEvent.prompt();
        const choice = await installPromptEvent.userChoice.catch(() => null);
        if (choice?.outcome === 'accepted') btn.classList.add('hidden');
        installPromptEvent = null;
      };

      window.addEventListener('appinstalled', () => {
        btn.classList.add('hidden');
        showToast('Blend Player installed. Local media remains private and browser-managed.', { timeout: 4200 });
      });
    }

    async function cacheAppShellForOffline() {
      if (!('caches' in window) || location.protocol === 'file:') return;
      try {
        const cache = await caches.open(`blend-app-shell-${VERSION}`);
        await cache.add(new Request(location.href, { cache: 'reload' }));
      } catch (e) {
        console.info('[Blend] App-shell cache skipped:', e.message || e);
      }
    }

    async function tryRegisterInlineServiceWorker() {
      if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
      const source = `
        const CACHE = 'blend-app-shell-${VERSION}';
        self.addEventListener('install', event => {
          event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./'])).catch(() => null));
          self.skipWaiting();
        });
        self.addEventListener('activate', event => {
          event.waitUntil(self.clients.claim());
        });
        self.addEventListener('fetch', event => {
          const req = event.request;
          if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
          event.respondWith(fetch(req).then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => null);
            return res;
          }).catch(() => caches.match(req)));
        });
      `;
      const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try {
        await navigator.serviceWorker.register(blobUrl, { scope: './' });
      } catch (e) {
        console.info('[Blend] Inline service worker unavailable in this browser; app-shell Cache API fallback remains active.', e.message || e);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }

    async function setupPWA() {
      setupInstallPrompt();
      try {
        const manifest = {
          name: 'Blend Player',
          short_name: 'Blend',
          description: 'Dual-layer local media playback studio for private playlists and slideshows.',
          start_url: location.pathname || './',
          scope: './',
          display: 'standalone',
          display_override: ['window-controls-overlay', 'standalone', 'browser'],
          orientation: 'any',
          background_color: resolvedTheme() === 'light' ? '#f5f7fb' : '#0a0a0a',
          theme_color: resolvedTheme() === 'light' ? '#f5f7fb' : '#ff1493',
          categories: ['music', 'photo', 'video', 'productivity'],
          icons: [
            { src: makePwaIcon(192), sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
            { src: makePwaIcon(512), sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
          ]
        };
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
        document.head.appendChild(link);
      } catch (e) {
        console.info('[Blend] Manifest generation skipped:', e.message || e);
      }

      await cacheAppShellForOffline();
      await tryRegisterInlineServiceWorker();
      if (location.protocol === 'file:') {
        console.info('[Blend] PWA install/offline features require serving this file over http://localhost or https://. Local media files are never cached by the app shell.');
      }
    }

    // ====================== FIRST RUN / WELCOME ======================
    function maybeShowWelcome() {
      const seen = localStorage.getItem('blend-welcome-v2');
      if (seen) return;
      const m = $('#welcome-modal');
      m.showModal();
      $('#welcome-dismiss').onclick = () => { localStorage.setItem('blend-welcome-v2', '1'); m.close(); };
      $('#welcome-example-list').onclick = () => downloadExampleList();
      $('#welcome-add-folder').onclick = async () => {
        m.close(); localStorage.setItem('blend-welcome-v2', '1');
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
      setupResponsiveRuntime();
      setupViewportGestures();
      await setupPWA();
      window.addEventListener('pagehide', cleanupRuntimeResources, { once: true });

      // initial renders
      renderLibrary();
      renderListEditor();
      setBlend(state.settings.opacity || 0.5);
      updatePlayButton();

      // verify handles (non-blocking)
      setTimeout(() => verifyLibraryHandles(), 1200);

      // restore last indices visually
      updateHUD();

      // first run
      setTimeout(maybeShowWelcome, 900);

      // keyboard hint
      console.log('%c[Blend] Press ? for keyboard shortcuts. C to open editor.', 'color:#666');

      // expose a little for debugging
      window.Blend = { state, saveStateNow, renderLibrary, renderListEditor };
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
      bootstrap();
    }
