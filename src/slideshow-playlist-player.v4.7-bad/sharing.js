// sharing.js — Web Share API + platform links + deep links
function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }

export function generateExperienceUrl(exp) {
  try {
    const u = new URL(location.href);
    const id = exp?.id || slugify(exp?.name || exp?.projectName || 'experience');
    u.searchParams.set('expId', id);
    return u.toString();
  } catch (_) { return location.href; }
}

export function parseDeepLink(href = location.href) {
  try {
    const u = new URL(href);
    const expId = u.searchParams.get('expId') || '';
    return { expId };
  } catch (_) { return { expId: '' }; }
}

export function applyDeepLink() {
  const details = parseDeepLink();
  const ev = new CustomEvent('blend:deep-link', { detail: details });
  window.dispatchEvent(ev);
  return details;
}

function ensureShareDialog() {
  let dlg = document.getElementById('share-modal');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'share-modal';
  dlg.innerHTML = `
    <div class="modal-header">Share</div>
    <div class="modal-body">
      <p id="share-copy-msg" class="muted" style="margin-top:0"></p>
      <div style="display:flex;gap:8px;margin:8px 0">
        <input id="share-url" type="text" style="flex:1 1 auto;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text)" readonly>
        <button class="btn" id="btn-copy">Copy</button>
      </div>
      <div id="share-links" style="display:flex;flex-wrap:wrap;gap:8px"></div>
    </div>
    <div class="modal-footer"><button class="btn" id="btn-close">Close</button></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('#btn-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.returnValue = '');
  dlg.querySelector('#btn-copy').addEventListener('click', async () => {
    const val = dlg.querySelector('#share-url').value;
    try { await navigator.clipboard.writeText(val); dlg.querySelector('#share-copy-msg').textContent = 'Link copied to clipboard.'; } catch(_) { dlg.querySelector('#share-copy-msg').textContent = 'Copy failed. Select and copy manually.'; }
  });
  return dlg;
}

function platformLinks(url, text) {
  const encUrl = encodeURIComponent(url);
  const encText = encodeURIComponent(text || '');
  return [
    { name: 'Web Share', href: null },
    { name: 'X', href: `https://twitter.com/intent/tweet?url=${encUrl}&text=${encText}` },
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encUrl}` },
    { name: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encUrl}` },
    { name: 'Reddit', href: `https://www.reddit.com/submit?url=${encUrl}&title=${encText}` },
    { name: 'Bluesky', href: `https://bsky.app/intent/compose?text=${encText}%20${encUrl}` },
    { name: 'Email', href: `mailto:?subject=${encText}&body=${encText}%0A%0A${encUrl}` }
  ];
}

export async function shareExperience(exp, { text } = {}) {
  const url = generateExperienceUrl(exp);
  const title = exp?.name || exp?.projectName || 'Blend Experience';
  const shareData = { title, text: text || title, url };
  if (navigator.share && location.protocol !== 'file:') {
    try { await navigator.share(shareData); return true; } catch(_) {}
  }
  showShareModal(exp, { text });
  return false;
}

export function createShareButton(exp, { text } = {}) {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  btn.textContent = 'Share';
  btn.addEventListener('click', () => shareExperience(exp, { text }));
  return btn;
}

export function showShareModal(exp, { text } = {}) {
  const url = generateExperienceUrl(exp);
  const dlg = ensureShareDialog();
  dlg.querySelector('#share-url').value = url;
  const links = platformLinks(url, text || (exp?.name || 'Blend Experience'));
  const container = dlg.querySelector('#share-links');
  container.innerHTML = '';
  for (const { name, href } of links) {
    const el = document.createElement('a');
    el.textContent = name;
    el.className = 'btn';
    if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
    else { el.addEventListener('click', () => shareExperience(exp, { text })); }
    container.appendChild(el);
  }
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}

export function initShareShortcut(getExp) {
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      const exp = typeof getExp === 'function' ? getExp() : (window.Blend?.state ? { id: window.Blend.state.activeExperienceId, name: window.Blend.state.projectName } : null);
      showShareModal(exp);
      e.preventDefault();
    }
  }, { passive: false });
}
