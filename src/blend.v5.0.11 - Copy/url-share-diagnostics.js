// url-share-diagnostics.js — Experience size analysis for URL sharing (v5.0.9)
//
// Provides byte-level breakdown of what contributes to a share URL's length,
// and builds the HTML shown inside the "Size breakdown" section of the share
// modal when an experience is too large to fit in a 2 048-character URL.
//
// Public API:
//   analyzeExperienceSize(experience)          → ExperienceSizeReport
//   formatBytes(bytes)                         → string
//   buildSizeBreakdownHtml(report, urlLength)  → string  (safe HTML)

'use strict';

/**
 * @typedef {Object} ExperienceSizeReport
 * @property {number}   totalBytes               UTF-8 JSON byte count for the whole experience
 * @property {Object.<string,number>} sections   Per-top-level-key byte counts
 * @property {ItemSizeEntry[]} largeItems         Top-10 library items sorted by serialised size
 * @property {{ library: number, playlist: number, slideshow: number }} itemCount
 * @property {number}   estimatedCompressedBytes  Conservative gzip+Base64URL estimate
 */

/**
 * @typedef {Object} ItemSizeEntry
 * @property {string} id
 * @property {string} name
 * @property {string} type   'video' | 'image' | 'audio' | 'unknown'
 * @property {number} bytes  JSON-serialised UTF-8 byte count
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the UTF-8 byte length of a value when JSON-serialised.
 * Falls back to character count when TextEncoder is unavailable (older Node).
 */
function jsonBytes(value) {
  if (value === null || value === undefined) return 0;
  const json = JSON.stringify(value);
  if (!json) return 0;
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  return json.length; // ASCII approximation for environments without TextEncoder
}

/**
 * Escape a string for safe insertion into HTML text or attribute values.
 */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyse an experience export payload and return a detailed size breakdown.
 *
 * All sizes are UTF-8 byte counts of the JSON-serialised sub-sections, which
 * reflects the true cost before gzip compression.
 *
 * @param {object} experience  Full experience export object from buildExperienceExportPayload()
 * @returns {ExperienceSizeReport}
 */
export function analyzeExperienceSize(experience) {
  const empty = {
    totalBytes: 0,
    sections: {},
    largeItems: [],
    itemCount: { library: 0, playlist: 0, slideshow: 0 },
    estimatedCompressedBytes: 0
  };
  if (!experience || typeof experience !== 'object') return empty;

  const totalBytes = jsonBytes(experience);

  // Byte cost of each top-level section.
  const sections = {
    metadata: jsonBytes({
      version:    experience.version,
      schema:     experience.schema,
      type:       experience.type,
      id:         experience.id,
      name:       experience.name,
      project:    experience.project,
      exportedAt: experience.exportedAt
    }),
    settings:  jsonBytes(experience.settings),
    library:   jsonBytes(experience.library),
    playlist:  jsonBytes(experience.playlist),
    slideshow: jsonBytes(experience.slideshow)
  };

  // Identify the heaviest individual library items (the most actionable signal).
  const largeItems = [];
  if (Array.isArray(experience.library?.items)) {
    for (const item of experience.library.items) {
      largeItems.push({
        id:    String(item.id   ?? ''),
        name:  String(item.name ?? 'Unknown'),
        type:  String(item.type ?? 'unknown'),
        bytes: jsonBytes(item)
      });
    }
    largeItems.sort((a, b) => b.bytes - a.bytes);
  }

  const itemCount = {
    library:   experience.library?.items?.length  ?? 0,
    playlist:  experience.playlist?.order?.length ?? 0,
    slideshow: experience.slideshow?.order?.length ?? 0
  };

  // Compressed size estimate: gzip on structured JSON typically achieves
  // 60–75 % reduction; Base64URL re-adds ~33 % overhead over binary.
  // We bias slightly conservative (inflate) to avoid false "it'll fit" predictions.
  //   ratio ≈ (1 - 0.68) × 1.34 ≈ 0.43   →  rounded up to 0.54 for safety
  const estimatedCompressedBytes = Math.round(totalBytes * 0.54);

  return {
    totalBytes,
    sections,
    largeItems: largeItems.slice(0, 10), // cap at 10 to keep the UI compact
    itemCount,
    estimatedCompressedBytes
  };
}

/**
 * Format a byte count as a concise human-readable string (B / KB / MB).
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Build the inner HTML for the diagnostics section inside the share modal.
 *
 * All user-supplied strings (file names, paths, etc.) are HTML-escaped before
 * insertion, so there is no XSS risk even for adversarially crafted file names.
 *
 * @param {ExperienceSizeReport} report     Result of analyzeExperienceSize()
 * @param {number}               urlLength  Actual full URL character count
 * @param {number}              [urlLimit]  Character limit (default 2 048)
 * @returns {string}  Safe HTML markup
 */
export function buildSizeBreakdownHtml(report, urlLength, urlLimit = 2048) {
  const { totalBytes, sections, largeItems, itemCount } = report;

  function pct(sectionBytes) {
    return totalBytes > 0 ? Math.round((sectionBytes / totalBytes) * 100) : 0;
  }

  // Section rows: label, bytes, % of total
  const sectionRows = [
    { label: 'Metadata',                                  bytes: sections.metadata  },
    { label: 'Settings',                                  bytes: sections.settings  },
    { label: `Library (${itemCount.library} items)`,     bytes: sections.library   },
    { label: `Playlist (${itemCount.playlist} entries)`, bytes: sections.playlist  },
    { label: `Slideshow (${itemCount.slideshow} slides)`, bytes: sections.slideshow }
  ];

  let html = `<div class="url-diag-grid">`;
  html += `<div class="url-diag-row url-diag-row--header">`;
  html += `<span>Section</span><span>Size</span><span>Share</span>`;
  html += `</div>`;

  for (const row of sectionRows) {
    html += `<div class="url-diag-row">`;
    html += `<span class="url-diag-label">${esc(row.label)}</span>`;
    html += `<span class="url-diag-bytes">${formatBytes(row.bytes)}</span>`;
    html += `<span class="url-diag-pct">${pct(row.bytes)}%</span>`;
    html += `</div>`;
  }

  html += `<div class="url-diag-row url-diag-row--total">`;
  html += `<span>Total JSON</span>`;
  html += `<span>${formatBytes(totalBytes)}</span>`;
  html += `<span>—</span>`;
  html += `</div></div>`; // close grid

  // Top library contributors (most actionable for the user to trim)
  if (largeItems.length > 0) {
    const shown = Math.min(largeItems.length, 5);
    html += `<p class="url-diag-subtitle">Largest library items (top ${shown}):</p>`;
    html += `<ul class="url-diag-items">`;
    for (const item of largeItems.slice(0, shown)) {
      const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
      html += `<li class="url-diag-item">`;
      html += `<span class="url-diag-item__type url-diag-item__type--${esc(item.type)}">${esc(typeLabel)}</span>`;
      html += `<span class="url-diag-item__name" title="${esc(item.name)}">${esc(item.name)}</span>`;
      html += `<span class="url-diag-item__size">${formatBytes(item.bytes)}</span>`;
      html += `</li>`;
    }
    html += `</ul>`;
  }

  // Actionable tip only shown when the URL actually exceeds the limit
  const excess = Math.max(0, urlLength - urlLimit);
  if (excess > 0) {
    html += `<p class="url-diag-tip">`;
    html += `<strong>Tip:</strong> To shorten the URL, try removing large items from the library, `;
    html += `shortening long file paths, or reducing the number of playlist/slideshow entries. `;
    html += `<strong>Download JSON</strong> has no size limits and is always a reliable alternative.`;
    html += `</p>`;
  }

  return html;
}
