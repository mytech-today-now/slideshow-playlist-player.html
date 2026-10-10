import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function safeLocation(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.protocol === 'blob:') return `blob:${url.origin}/media`;
    return `${url.origin}${url.pathname}`;
  } catch (_) {
    return String(rawUrl || '').startsWith('data:') ? 'data:<redacted>' : 'unknown';
  }
}

function safeMessage(value) {
  return String(value || '')
    .split('\n')[0]
    .replace(/https?:\/\/[^\s"'<>]+/g, match => safeLocation(match))
    .slice(0, 400);
}

const MEDIA_PATH_PATTERN = /\.(?:mp3|mp4|m4a|wav|ogg|jpe?g|png|webp|gif)(?:$|\?)/i;

export function createExperienceShareFlowDiagnostics(context) {
  const startedAt = Date.now();
  const events = [];
  const pageLabels = new WeakMap();
  const observedPages = new WeakSet();
  const requestStartedAt = new WeakMap();
  const probeTimers = new Map();
  let outputPath = '';
  let writeTimer = null;
  let writeChain = Promise.resolve();

  function scheduleWrite() {
    if (!outputPath || writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      const content = JSON.stringify(events, null, 2);
      writeChain = writeChain.then(() => writeFile(outputPath, content, 'utf8')).catch(() => {});
    }, 150);
  }

  async function flushWrite() {
    if (!outputPath) return;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = null;
    const content = JSON.stringify(events, null, 2);
    writeChain = writeChain.then(() => writeFile(outputPath, content, 'utf8')).catch(() => {});
    await writeChain;
  }

  async function setOutputPath(filePath) {
    outputPath = filePath;
    await mkdir(path.dirname(outputPath), { recursive: true });
    await flushWrite();
  }

  function record(event, page = null, details = {}) {
    events.push({
      at: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      event,
      page: page ? (pageLabels.get(page) || 'unlabeled') : 'context',
      pages: context.pages().map((entry, index) => ({
        id: pageLabels.get(entry) || `page-${index + 1}`,
        location: safeLocation(entry.url()),
        closed: entry.isClosed()
      })),
      ...details
    });
    scheduleWrite();
  }

  function note(event, page = null, details = {}) {
    record(event, page, details);
  }

  async function observePage(page, label) {
    pageLabels.set(page, label);
    if (observedPages.has(page)) return;
    observedPages.add(page);

    await page.addInitScript(() => {
      const diagnostics = {
        heartbeatAt: performance.now(),
        playClickCount: 0,
        lastPlayClickAt: null,
        indexedDbAborts: []
      };
      Object.defineProperty(window, '__blendShareFlowDiagnostics', {
        value: diagnostics,
        configurable: false
      });
      try {
        const databasePrototype = window.IDBDatabase?.prototype;
        const nativeTransaction = databasePrototype?.transaction;
        if (typeof nativeTransaction === 'function') {
          Object.defineProperty(databasePrototype, 'transaction', {
            configurable: true,
            writable: true,
            value: function (...args) {
              const transaction = Reflect.apply(nativeTransaction, this, args);
              transaction.addEventListener('abort', () => {
                const stores = Array.from(transaction.objectStoreNames || []).slice(0, 8);
                diagnostics.indexedDbAborts.push({
                  at: Math.round(performance.now()),
                  mode: transaction.mode || '',
                  stores,
                  errorName: transaction.error?.name || 'UnknownError'
                });
                if (diagnostics.indexedDbAborts.length > 20) diagnostics.indexedDbAborts.shift();
              });
              return transaction;
            }
          });
        }
      } catch (_) {}
      window.setInterval(() => {
        diagnostics.heartbeatAt = performance.now();
      }, 250);
      document.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target.closest('#btn-play') : null;
        if (!target) return;
        diagnostics.playClickCount += 1;
        diagnostics.lastPlayClickAt = performance.now();
      }, true);
    });

    page.on('pageerror', error => record('page error', page, { message: safeMessage(error?.message) }));
    page.on('console', message => {
      if (message.type() !== 'error' && message.type() !== 'warning') return;
      record('console message', page, {
        level: message.type(),
        message: safeMessage(message.text()),
        source: safeLocation(message.location()?.url)
      });
    });
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return;
      record('main frame navigation', page, { location: safeLocation(frame.url()) });
    });
    page.on('request', request => {
      const url = request.url();
      if (request.resourceType() !== 'media' && request.resourceType() !== 'image' && !MEDIA_PATH_PATTERN.test(url)) return;
      requestStartedAt.set(request, Date.now());
      record('media request started', page, {
        method: request.method(),
        resourceType: request.resourceType(),
        location: safeLocation(url)
      });
    });
    page.on('response', response => {
      const request = response.request();
      const requestTime = requestStartedAt.get(request);
      if (requestTime === undefined) return;
      record('media response', page, {
        status: response.status(),
        resourceType: request.resourceType(),
        location: safeLocation(response.url()),
        requestDurationMs: Date.now() - requestTime
      });
    });
    page.on('requestfailed', request => {
      const requestTime = requestStartedAt.get(request);
      if (requestTime === undefined) return;
      const failureText = request.failure()?.errorText || '';
      const failureCode = /ERR_[A-Z_]+/.exec(failureText)?.[0] || 'request_failed';
      record('media request failed', page, {
        resourceType: request.resourceType(),
        location: safeLocation(request.url()),
        failureCode,
        requestDurationMs: Date.now() - requestTime
      });
    });
    record('page observed', page, { location: safeLocation(page.url()) });
  }

  async function capture(name, page) {
    const pageSnapshot = page.evaluate(() => {
      const state = window.Blend?.state;
      const visible = node => {
        if (!node) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
      };
      const controlIds = [
        'config-gear', 'config-panel', 'close-config', 'btn-play', 'btn-share',
        'experience-select', 'experience-load-overlay', 'import-summary-modal',
        'database-startup-recovery', 'ipfs-operation-modal', 'slideshow-loading'
      ];
      const controls = Object.fromEntries(controlIds.map(id => {
        const node = document.getElementById(id);
        return [id, node ? {
          visible: visible(node),
          disabled: 'disabled' in node ? Boolean(node.disabled) : null,
          ariaDisabled: node.getAttribute('aria-disabled'),
          ariaExpanded: node.getAttribute('aria-expanded'),
          ariaHidden: node.getAttribute('aria-hidden')
        } : null];
      }));
      const media = Array.from(document.querySelectorAll('#playlist-layer video, #slideshow-layer img, #slideshow-layer video'))
        .slice(0, 4)
        .map(node => ({
          tag: node.tagName,
          sourceKind: node.currentSrc?.startsWith('blob:') ? 'blob' : node.currentSrc ? 'url' : 'none',
          readyState: 'readyState' in node ? node.readyState : null,
          networkState: 'networkState' in node ? node.networkState : null,
          paused: 'paused' in node ? node.paused : null,
          errorCode: node.error?.code || null
        }));
      const diagnostics = window.__blendShareFlowDiagnostics;
      return {
        location: `${location.origin}${location.pathname}`,
        documentReadyState: document.readyState,
        visibilityState: document.visibilityState,
        blendReady: Boolean(window.Blend && state),
        experienceCount: state?.experiences?.length || 0,
        libraryCount: state?.library?.size || 0,
        playlistCount: state?.playlist?.length || 0,
        slideshowCount: state?.slideshow?.length || 0,
        activeExperiencePresent: Boolean(state?.activeExperienceId),
        activeList: state?.ui?.activeList || '',
        transport: {
          mode: state?.runtime?.transport || '',
          isPlaying: Boolean(state?.runtime?.isPlaying),
          playlistIndex: state?.runtime?.playlistIndex ?? null,
          slideshowIndex: state?.runtime?.slideshowIndex ?? null
        },
        controls,
        visibleAlertCount: Array.from(document.querySelectorAll('[role="alert"]')).filter(visible).length,
        visibleToast: visible(document.querySelector('#toast-container')),
        loadingOverlayVisible: visible(document.querySelector('#experience-load-overlay')) ||
          visible(document.querySelector('#slideshow-loading')),
        media,
        indexedDbAborts: diagnostics?.indexedDbAborts?.slice(-8) || [],
        playClickCount: diagnostics?.playClickCount ?? null,
        heartbeatAgeMs: diagnostics ? Math.max(0, performance.now() - diagnostics.heartbeatAt) : null
      };
    }).then(snapshot => ({ status: 'ok', snapshot })).catch(error => ({
      status: 'error',
      message: safeMessage(error?.message)
    }));

    let timeoutId;
    const result = await Promise.race([
      pageSnapshot,
      new Promise(resolve => {
        timeoutId = setTimeout(() => resolve({ status: 'pending_after_900ms' }), 900);
      })
    ]);
    clearTimeout(timeoutId);
    record(name, page, { snapshot: result });
    return result;
  }

  async function step(name, page, action) {
    await capture(`${name}:start`, page);
    try {
      const result = await action();
      await capture(`${name}:complete`, page);
      return result;
    } catch (error) {
      record(`${name}:failed`, page, { message: safeMessage(error?.message) });
      await capture(`${name}:failure state`, page);
      throw error;
    }
  }

  function beginPlayClickProbe(page) {
    const previous = probeTimers.get(page);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(async () => {
      probeTimers.delete(page);
      const probe = page.evaluate(() => ({
        visibilityState: document.visibilityState,
        blendReady: Boolean(window.Blend?.state),
        playClickCount: window.__blendShareFlowDiagnostics?.playClickCount ?? null,
        heartbeatAgeMs: window.__blendShareFlowDiagnostics
          ? Math.max(0, performance.now() - window.__blendShareFlowDiagnostics.heartbeatAt)
          : null
      })).then(snapshot => ({ status: 'responsive', snapshot })).catch(error => ({
        status: 'error',
        message: safeMessage(error?.message)
      }));
      let probeTimeoutId;
      const result = await Promise.race([
        probe,
        new Promise(resolve => {
          probeTimeoutId = setTimeout(() => resolve({ status: 'pending_after_1200ms' }), 1200);
        })
      ]);
      clearTimeout(probeTimeoutId);
      record('Play click responsiveness probe', page, { result });
    }, 900);
    probeTimers.set(page, timer);
  }

  function endPlayClickProbe(page) {
    const timer = probeTimers.get(page);
    if (timer) clearTimeout(timer);
    probeTimers.delete(page);
  }

  async function playbackPhase(name, page) {
    if (name === 'Play click:before') beginPlayClickProbe(page);
    if (name === 'Play click:after') endPlayClickProbe(page);
    await capture(`playback helper: ${name}`, page);
  }

  async function attach(testInfo) {
    for (const timer of probeTimers.values()) clearTimeout(timer);
    probeTimers.clear();
    await flushWrite();
    if (!outputPath) return;
    try {
      await testInfo.attach('experience-share-flow-diagnostics.json', {
        path: outputPath,
        contentType: 'application/json'
      });
    } catch (_) {}
  }

  return { setOutputPath, observePage, capture, step, note, playbackPhase, attach };
}
