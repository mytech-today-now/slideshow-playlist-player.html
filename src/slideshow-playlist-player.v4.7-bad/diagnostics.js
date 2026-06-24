// diagnostics.js — simple diagnostics/log viewer UI
export function mountDiagnosticsUI(logger) {
  try {
    if (document.getElementById('diag-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'diag-toggle';
    btn.title = 'Diagnostics (Alt+D)';
    btn.setAttribute('aria-label', 'Open diagnostics');
    btn.textContent = '🧪';
    Object.assign(btn.style, { position: 'fixed', right: '10px', bottom: '10px', zIndex: 999, width: '38px', height: '38px', borderRadius: '999px', background: 'var(--bg-elev)', color: 'var(--text)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', display: 'grid', placeItems: 'center', cursor: 'pointer' });
    btn.addEventListener('click', () => openDiag());
    document.body.appendChild(btn);

    function openDiag() {
      let dlg = document.getElementById('diag-modal');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'diag-modal';
        dlg.innerHTML = `
          <div class="modal-header">Diagnostics</div>
          <div class="modal-body">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
              <button class="btn" id="diag-refresh">Refresh</button>
              <button class="btn" id="diag-clear">Clear</button>
              <button class="btn" id="diag-download">Download JSON</button>
            </div>
            <pre id="diag-output" style="max-height:52vh;overflow:auto;background:var(--bg-elev2);border:1px solid var(--border);padding:10px;border-radius:8px"></pre>
          </div>
          <div class="modal-footer"><button class="btn" id="diag-close">Close</button></div>`;
        document.body.appendChild(dlg);
        dlg.querySelector('#diag-close').addEventListener('click', () => dlg.close());
        dlg.querySelector('#diag-clear').addEventListener('click', () => { try { logger.clear(); } catch(_){} render(); });
        dlg.querySelector('#diag-download').addEventListener('click', () => {
          const blob = new Blob([logger.exportJson?.() || '[]'], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'blend-diagnostics.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
        });
        dlg.querySelector('#diag-refresh').addEventListener('click', render);
      }
      function render() {
        try { dlg.querySelector('#diag-output').textContent = (logger.entries?.() || []).map(e => `${e.ts} [${(e.level||'').toUpperCase()}]${e.namespace?` [${e.namespace}]`:''} ${e.message}`).join('\n'); } catch(_){}
      }
      render();
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open','');
    }

    window.addEventListener('keydown', (e) => { if (e.altKey && (e.key==='d'||e.key==='D')) { e.preventDefault(); btn.click(); } }, { passive: false });
  } catch (_) {}
}
