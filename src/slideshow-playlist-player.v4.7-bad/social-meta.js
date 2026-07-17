// social-meta.js — dynamic Open Graph, Twitter, Schema.org
function upsertMetaByName(name, content = '') {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
  el.setAttribute('content', content);
  return el;
}

function upsertMetaByProp(prop, content = '') {
  let el = document.head.querySelector(`meta[property="${prop}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
  el.setAttribute('content', content);
  return el;
}

function upsertLink(rel, href = '') {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement('link'); el.setAttribute('rel', rel); document.head.appendChild(el); }
  el.setAttribute('href', href);
  return el;
}

function currentCanonicalUrl() {
  try { return new URL(location.href).toString(); } catch (_) { return location.href; }
}

function asAbsoluteUrl(maybeUrl) {
  try {
    const u = new URL(String(maybeUrl), location.href);
    return u.toString();
  } catch (_) { return String(maybeUrl || ''); }
}

function jsonLd(app) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: app?.name || 'Blend • player.html',
    applicationCategory: 'Multimedia',
    operatingSystem: 'Web',
    url: currentCanonicalUrl(),
    description: app?.description || document.querySelector('meta[name="description"]')?.content || '',
    inLanguage: document.documentElement.lang || 'en',
  };
}

function setJsonLd(obj) {
  let el = document.head.querySelector('script[type="application/ld+json"]#schema-app');
  const text = JSON.stringify(obj || {}, null, 2);
  if (!el) { el = document.createElement('script'); el.type = 'application/ld+json'; el.id = 'schema-app'; document.head.appendChild(el); }
  el.textContent = text;
}

export function setSiteDefaults() {
  const title = document.title || 'Blend • player.html';
  const desc = document.querySelector('meta[name="description"]')?.content || 'Dual-layer local media playback studio.';
  const url = currentCanonicalUrl();
  const img = asAbsoluteUrl('./assets/icon-maskable.svg');
  upsertMetaByProp('og:type', 'website');
  upsertMetaByProp('og:title', title);
  upsertMetaByProp('og:description', desc);
  upsertMetaByProp('og:url', url);
  upsertMetaByProp('og:image', img);
  upsertMetaByName('twitter:card', 'summary_large_image');
  upsertMetaByName('twitter:title', title);
  upsertMetaByName('twitter:description', desc);
  upsertMetaByName('twitter:image', img);
  upsertLink('canonical', url);
  setJsonLd(jsonLd({ name: title, description: desc }));
}

export function updateExperienceMeta(exp) {
  if (!exp) return setSiteDefaults();
  const name = exp.name || exp.projectName || 'Experience';
  const title = `${name} • Blend`;
  const url = (()=>{ try { const u = new URL(location.href); const id = exp.id || name.toLowerCase().replace(/[^a-z0-9]+/g,'-'); u.searchParams.set('expId', id); return u.toString(); } catch(_) { return location.href; } })();
  const desc = `Blend experience: ${name}`;
  const img = asAbsoluteUrl(exp.thumbnail || exp.poster || './assets/icon-maskable.svg');
  document.title = title;
  upsertMetaByProp('og:title', title);
  upsertMetaByProp('og:description', desc);
  upsertMetaByProp('og:url', url);
  upsertMetaByProp('og:image', img);
  upsertMetaByName('twitter:title', title);
  upsertMetaByName('twitter:description', desc);
  upsertMetaByName('twitter:image', img);
  upsertLink('canonical', url);
  setJsonLd(jsonLd({ name: title, description: desc }));
}

export function updateMediaItemMeta(item, expMeta) {
  if (!item) return;
  const img = asAbsoluteUrl(item.thumbnail || item.poster || expMeta?.thumbnail || './assets/icon-maskable.svg');
  upsertMetaByProp('og:image', img);
  upsertMetaByName('twitter:image', img);
}

export function resetToDefaults() { setSiteDefaults(); }
