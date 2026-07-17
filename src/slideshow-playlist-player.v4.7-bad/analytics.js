// analytics.js — GA4 with consent and virtual pages
const GA_ID = 'G-5NVWHE6T4V';
const CONSENT_KEY = 'blend-analytics-consent-v1';
let gtagLoaded = false;

function hasDoNotTrack() {
  try {
    const dnt = (navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack || '0');
    return String(dnt) === '1';
  } catch (_) { return false; }
}

function currentUrlWithParams(params = {}) {
  try {
    const url = new URL(location.href);
    for (const [k,v] of Object.entries(params)) {
      if (v == null || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, String(v));
    }
    return url.toString();
  } catch (_) { return location.href; }
}

function ensureGtag(log) {
  if (gtagLoaded) return true;
  if (location.protocol === 'file:') { log?.info?.('GA disabled on file:// origin'); return false; }
  const existing = document.getElementById('google_gtagjs');
  if (!existing) {
    const s = document.createElement('script');
    s.id = 'google_gtagjs';
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
  }
  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { send_page_view: false });
  gtagLoaded = true;
  return true;
}

export function getAnalyticsConsent() {
  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored === 'granted' || stored === 'denied') return stored;
  } catch (_) {}
  return 'unknown';
}

export function setAnalyticsConsent(granted) {
  const value = granted ? 'granted' : 'denied';
  try { localStorage.setItem(CONSENT_KEY, value); } catch (_) {}
  if (!granted) {
    // soft-disable GA if present
    try { window[`ga-disable-${GA_ID}`] = true; } catch (_) {}
  }
}

export function resetAnalyticsConsent() {
  try { localStorage.removeItem(CONSENT_KEY); } catch (_) {}
  try { window[`ga-disable-${GA_ID}`] = true; } catch (_) {}
}

export function isAnalyticsActive() {
  return getAnalyticsConsent() === 'granted' && typeof window.gtag === 'function';
}

export function initGA4(opts = {}) {
  const { log, respectDNT = true } = opts || {};
  if (respectDNT && hasDoNotTrack()) { log?.info?.('DNT active; analytics disabled'); return false; }
  if (getAnalyticsConsent() !== 'granted') { log?.info?.('Analytics consent not granted'); return false; }
  return ensureGtag(log);
}

export function trackExperienceView(exp) {
  if (!isAnalyticsActive()) return;
  const page_title = (exp?.name || exp?.projectName || 'Experience');
  const id = exp?.id || (page_title || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const page_path = `/experience/${id}`;
  const page_location = currentUrlWithParams({ expId: id });
  window.gtag('event', 'page_view', { page_title, page_path, page_location });
}

export function trackExperienceSwitch({ fromExperienceId, toExperienceId, toExperienceName }) {
  if (!isAnalyticsActive()) return;
  window.gtag('event', 'experience_switch', {
    from_experience_id: fromExperienceId || '',
    to_experience_id: toExperienceId || '',
    to_experience_name: toExperienceName || ''
  });
}

export function trackMediaEvent({ action, mediaType, mediaName, experienceId, experienceName }) {
  if (!isAnalyticsActive()) return;
  const eventName = `media_${String(action || 'event').toLowerCase()}`;
  window.gtag('event', eventName, {
    media_type: mediaType || '',
    media_name: mediaName || '',
    experience_id: experienceId || '',
    experience_name: experienceName || ''
  });
}

export function trackShareEvent({ platform, experienceId, experienceName }) {
  if (!isAnalyticsActive()) return;
  window.gtag('event', 'share', {
    method: platform || 'unknown',
    content_type: 'experience',
    item_id: experienceId || '',
    item_name: experienceName || ''
  });
}
