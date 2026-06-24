const QUALITY_TIERS = ['low', 'medium', 'high'];
const EFFECT_FALLBACK_ID = 'crossfade';

export const TRANSITION_EFFECTS = [
  { id: 'hard-cut', label: 'Hard Cut', cost: 0, heavy: false, defaultWeight: 1 },
  { id: 'fade-in-out', label: 'Fade In/Out', cost: 1, heavy: false, defaultWeight: 1.25 },
  { id: 'crossfade', label: 'Crossfade', cost: 1, heavy: false, defaultWeight: 1.25 },
  { id: 'dip', label: 'Dip to Black / White', cost: 1, heavy: false, defaultWeight: 1 },
  { id: 'slide-horizontal', label: 'Slide Left / Right', cost: 1, heavy: false, defaultWeight: 1 },
  { id: 'slide-vertical', label: 'Slide Up / Down', cost: 1, heavy: false, defaultWeight: 1 },
  { id: 'push', label: 'Push', cost: 1, heavy: false, defaultWeight: 1 },
  { id: 'simple-wipe', label: 'Simple Wipe', cost: 2, heavy: false, defaultWeight: 1 },
  { id: 'diagonal-wipe', label: 'Diagonal Wipe', cost: 2, heavy: false, defaultWeight: 1 },
  { id: 'iris-wipe', label: 'Circular / Iris Wipe', cost: 2, heavy: false, defaultWeight: 1 },
  { id: 'zoom-in-out', label: 'Zoom In / Out', cost: 2, heavy: false, defaultWeight: 1 },
  { id: 'ken-burns-blend', label: 'Ken Burns Blend', cost: 2, heavy: false, defaultWeight: 1 },
  { id: 'rotate-fade', label: 'Rotate + Fade', cost: 2, heavy: false, defaultWeight: 1 },
  { id: 'blur-fade', label: 'Blur Fade', cost: 3, heavy: false, defaultWeight: 0.9 },
  { id: 'parallax-swap', label: 'Parallax Swap', cost: 3, heavy: true, defaultWeight: 0.8 },
  { id: 'luma-wipe', label: 'Luma Wipe', cost: 4, heavy: true, defaultWeight: 0.65 },
  { id: 'displacement-ripple', label: 'Displacement / Ripple Warp', cost: 5, heavy: true, defaultWeight: 0.45 }
];

const EFFECT_BY_ID = new Map(TRANSITION_EFFECTS.map(effect => [effect.id, effect]));
const DEFAULT_ENABLED_IDS = TRANSITION_EFFECTS
  .filter(effect => effect.id !== 'hard-cut')
  .map(effect => effect.id);
const DEFAULT_WEIGHTS = Object.fromEntries(
  TRANSITION_EFFECTS.map(effect => [effect.id, effect.defaultWeight])
);

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function supportsCss(property, value) {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  try {
    return CSS.supports(property, value);
  } catch (_) {
    return false;
  }
}

function matchesReducedMotion() {
  if (typeof matchMedia !== 'function') return false;
  try {
    return !!matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {
    return false;
  }
}

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function raf(callback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(() => callback(nowMs()), 16);
}

function caf(handle) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function styleForTransition(el) {
  if (!el) return;
  el.style.willChange = 'transform,opacity,filter,clip-path,mask-position';
  el.style.backfaceVisibility = 'hidden';
}

function cleanupTransitionStyle(el) {
  if (!el) return;
  el.style.willChange = '';
  el.style.backfaceVisibility = '';
  el.style.transform = '';
  el.style.opacity = '';
  el.style.filter = '';
  el.style.clipPath = '';
  el.style.maskImage = '';
  el.style.webkitMaskImage = '';
  el.style.maskSize = '';
  el.style.webkitMaskSize = '';
  el.style.maskPosition = '';
  el.style.webkitMaskPosition = '';
  el.style.transformOrigin = '';
}

async function animate(el, keyframes, options = {}) {
  if (!el || typeof el.animate !== 'function') {
    const duration = clampNumber(options.duration, 0, 60000, 0);
    return wait(duration);
  }
  const animation = el.animate(keyframes, {
    duration: clampNumber(options.duration, 0, 60000, 0),
    easing: options.easing || 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: options.fill || 'forwards',
    delay: clampNumber(options.delay, 0, 60000, 0)
  });
  try {
    await animation.finished;
  } catch (_) {
    // Ignore cancellation and interrupted animations.
  }
}

function createOverlay(container, opts = {}) {
  if (!container || !container.appendChild) return null;
  const overlay = document.createElement('div');
  overlay.className = 'transition-overlay';
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = String(opts.zIndex || 50);
  overlay.style.opacity = '0';
  overlay.style.background = opts.background || 'black';
  overlay.style.mixBlendMode = opts.blend || 'normal';
  overlay.style.willChange = 'opacity,transform,background-position';
  container.appendChild(overlay);
  return overlay;
}

function pickWeightedEffect(ids, weightById) {
  const weighted = ids
    .map(id => ({ id, weight: clampNumber(weightById[id], 0, 100, 1) }))
    .filter(entry => entry.weight > 0);
  if (!weighted.length) return ids[0] || EFFECT_FALLBACK_ID;
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) return entry.id;
  }
  return weighted[weighted.length - 1].id;
}

function effectById(id) {
  return EFFECT_BY_ID.get(id) || EFFECT_BY_ID.get(EFFECT_FALLBACK_ID);
}

function normalizeQualityTier(value) {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'high';
}

function nextLowerTier(current) {
  const idx = QUALITY_TIERS.indexOf(normalizeQualityTier(current));
  return QUALITY_TIERS[Math.max(0, idx - 1)] || 'low';
}

function nextHigherTier(current) {
  const idx = QUALITY_TIERS.indexOf(normalizeQualityTier(current));
  return QUALITY_TIERS[Math.min(QUALITY_TIERS.length - 1, idx + 1)] || 'high';
}

function detectInitialTier() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav) return 'high';
  const cores = clampNumber(nav.hardwareConcurrency, 1, 64, 8);
  const memory = clampNumber(nav.deviceMemory, 1, 64, 8);
  if (cores <= 2 || memory <= 2) return 'low';
  if (cores <= 4 || memory <= 4) return 'medium';
  return 'high';
}

export function normalizeTransitionSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const hasExplicitEnabledIds = Array.isArray(source.enabledTransitionIds);
  const enabledRaw = hasExplicitEnabledIds ? source.enabledTransitionIds : DEFAULT_ENABLED_IDS;
  const enabled = enabledRaw
    .map(id => String(id || '').trim())
    .filter(id => EFFECT_BY_ID.has(id) && id !== 'hard-cut');
  const uniqueEnabled = Array.from(new Set(enabled));
  const enabledTransitionIds = hasExplicitEnabledIds
    ? uniqueEnabled
    : (uniqueEnabled.length ? uniqueEnabled : DEFAULT_ENABLED_IDS.slice());
  const weights = { ...DEFAULT_WEIGHTS };
  const sourceWeights = source.transitionWeights && typeof source.transitionWeights === 'object'
    ? source.transitionWeights
    : {};
  for (const effect of TRANSITION_EFFECTS) {
    weights[effect.id] = clampNumber(sourceWeights[effect.id], 0, 100, effect.defaultWeight);
  }
  return {
    transitionDurationMs: clampNumber(source.transitionDurationMs, 200, 10000, 900),
    transitionOverlapMs: clampNumber(source.transitionOverlapMs, 0, 10000, 0),
    enabledTransitionIds,
    transitionWeights: weights,
    transitionRandomizeOrder: source.transitionRandomizeOrder !== false,
    transitionMaxHeavyInRow: clampNumber(source.transitionMaxHeavyInRow, 0, 8, 1),
    qualityAutoAdjust: source.qualityAutoAdjust !== false,
    showFps: !!source.showFps
  };
}

export function resolveEffectLabel(effectId) {
  return effectById(effectId)?.label || effectById(EFFECT_FALLBACK_ID).label;
}

export class TransitionManager {
  constructor(opts = {}) {
    this.settings = normalizeTransitionSettings(opts.settings || {});
    this.qualityTier = normalizeQualityTier(opts.qualityTier || detectInitialTier());
    this.lastEffectIndex = -1;
    this.heavyStreak = 0;
    this.lastAppliedEffectId = 'hard-cut';
    this.fps = 60;
    this.frameCount = 0;
    this.lastFpsTick = nowMs();
    this.lowFpsStreak = 0;
    this.highFpsStreak = 0;
    this.fpsRaf = 0;
    this.metricsSubscribers = new Set();
    this.disposeReducedMotionListener = null;
    this.reducedMotion = matchesReducedMotion();
    this.bindReducedMotion();
  }

  bindReducedMotion() {
    if (typeof matchMedia !== 'function') return;
    let query;
    try {
      query = matchMedia('(prefers-reduced-motion: reduce)');
    } catch (_) {
      return;
    }
    if (!query) return;
    const handler = event => {
      this.reducedMotion = !!event.matches;
      this.emitMetrics();
    };
    if (typeof query.addEventListener === 'function') query.addEventListener('change', handler);
    else if (typeof query.addListener === 'function') query.addListener(handler);
    this.disposeReducedMotionListener = () => {
      if (typeof query.removeEventListener === 'function') query.removeEventListener('change', handler);
      else if (typeof query.removeListener === 'function') query.removeListener(handler);
    };
  }

  destroy() {
    this.stopFpsMonitoring();
    if (this.disposeReducedMotionListener) {
      this.disposeReducedMotionListener();
      this.disposeReducedMotionListener = null;
    }
    this.metricsSubscribers.clear();
  }

  onMetrics(callback) {
    if (typeof callback !== 'function') return () => {};
    this.metricsSubscribers.add(callback);
    callback(this.snapshot());
    return () => this.metricsSubscribers.delete(callback);
  }

  snapshot() {
    return {
      fps: this.fps,
      qualityTier: this.qualityTier,
      reducedMotion: this.reducedMotion,
      lastAppliedEffectId: this.lastAppliedEffectId
    };
  }

  emitMetrics() {
    const next = this.snapshot();
    for (const subscriber of this.metricsSubscribers) {
      try {
        subscriber(next);
      } catch (_) {}
    }
  }

  startFpsMonitoring() {
    if (this.fpsRaf) return;
    this.lastFpsTick = nowMs();
    this.frameCount = 0;
    const tick = (timestamp) => {
      this.fpsRaf = raf(tick);
      this.frameCount += 1;
      const elapsed = Math.max(1, timestamp - this.lastFpsTick);
      if (elapsed < 1000) return;
      const sample = (this.frameCount * 1000) / elapsed;
      this.fps = (this.fps * 0.7) + (sample * 0.3);
      this.frameCount = 0;
      this.lastFpsTick = timestamp;
      this.adjustQualityFromFps();
      this.emitMetrics();
    };
    this.fpsRaf = raf(tick);
  }

  stopFpsMonitoring() {
    if (!this.fpsRaf) return;
    caf(this.fpsRaf);
    this.fpsRaf = 0;
  }

  adjustQualityFromFps() {
    if (!this.settings.qualityAutoAdjust || this.reducedMotion) return;
    if (this.fps < 44) {
      this.lowFpsStreak += 1;
      this.highFpsStreak = 0;
    } else if (this.fps > 56) {
      this.highFpsStreak += 1;
      this.lowFpsStreak = 0;
    } else {
      this.lowFpsStreak = 0;
      this.highFpsStreak = 0;
    }

    if (this.lowFpsStreak >= 2) {
      this.qualityTier = nextLowerTier(this.qualityTier);
      this.lowFpsStreak = 0;
      this.highFpsStreak = 0;
    } else if (this.highFpsStreak >= 4) {
      this.qualityTier = nextHigherTier(this.qualityTier);
      this.lowFpsStreak = 0;
      this.highFpsStreak = 0;
    }
  }

  updateSettings(nextSettings = {}) {
    this.settings = normalizeTransitionSettings({ ...this.settings, ...nextSettings });
    this.emitMetrics();
  }

  preferredEffectPool() {
    const ids = this.settings.enabledTransitionIds.filter(id => EFFECT_BY_ID.has(id));
    if (!ids.length) return ['hard-cut'];

    if (this.qualityTier === 'high') return ids;
    if (this.qualityTier === 'medium') {
      const filtered = ids.filter(id => effectById(id).cost <= 4);
      return filtered.length ? filtered : ids;
    }
    const lowTier = ids.filter(id => effectById(id).cost <= 2);
    return lowTier.length ? lowTier : ids;
  }

  pickEffectId(forceId = '') {
    if (forceId && EFFECT_BY_ID.has(forceId)) return forceId;
    if (this.reducedMotion) return 'hard-cut';

    const pool = this.preferredEffectPool();
    if (!pool.length) return EFFECT_FALLBACK_ID;

    let choice = pool[0];
    if (this.settings.transitionRandomizeOrder) {
      choice = pickWeightedEffect(pool, this.settings.transitionWeights);
    } else {
      this.lastEffectIndex = (this.lastEffectIndex + 1) % pool.length;
      choice = pool[this.lastEffectIndex];
    }

    const maxHeavyInRow = clampNumber(this.settings.transitionMaxHeavyInRow, 0, 8, 1);
    const chosenEffect = effectById(choice);
    if (chosenEffect.heavy && maxHeavyInRow >= 0 && this.heavyStreak >= maxHeavyInRow) {
      const fallbackPool = pool.filter(id => !effectById(id).heavy);
      choice = fallbackPool[0] || EFFECT_FALLBACK_ID;
    }

    const finalEffect = effectById(choice);
    if (finalEffect.heavy) this.heavyStreak += 1;
    else this.heavyStreak = 0;
    return finalEffect.id;
  }

  async applyTransition({ container, incoming, outgoing, durationMs, effectId = '' } = {}) {
    if (!incoming) return { effectId: 'hard-cut', applied: false };
    const duration = clampNumber(durationMs, 120, 10000, this.settings.transitionDurationMs);
    const pickedId = this.pickEffectId(effectId);
    const appliedId = this.resolveEffectByCapability(pickedId);
    this.lastAppliedEffectId = appliedId;
    this.emitMetrics();

    styleForTransition(incoming);
    styleForTransition(outgoing);

    if (!outgoing || appliedId === 'hard-cut' || this.reducedMotion) {
      incoming.style.opacity = '1';
      if (outgoing) outgoing.style.opacity = '0';
      cleanupTransitionStyle(incoming);
      cleanupTransitionStyle(outgoing);
      return { effectId: 'hard-cut', applied: true, duration };
    }

    const result = { effectId: appliedId, applied: true, duration };
    const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
    const half = Math.max(80, duration * 0.5);
    const dipBg = Math.random() > 0.5 ? '#ffffff' : '#000000';

    try {
      switch (appliedId) {
        case 'fade-in-out':
          incoming.style.opacity = '0';
          await Promise.all([
            animate(outgoing, [{ opacity: 1 }, { opacity: 0 }], { duration: half, easing }),
            animate(incoming, [{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], { duration, easing })
          ]);
          break;
        case 'crossfade':
          incoming.style.opacity = '0';
          await Promise.all([
            animate(outgoing, [{ opacity: 1 }, { opacity: 0 }], { duration, easing }),
            animate(incoming, [{ opacity: 0 }, { opacity: 1 }], { duration, easing })
          ]);
          break;
        case 'dip': {
          incoming.style.opacity = '0';
          const overlay = createOverlay(container, { background: dipBg, zIndex: 55 });
          await Promise.all([
            animate(outgoing, [{ opacity: 1 }, { opacity: 0 }], { duration: half, easing }),
            animate(incoming, [{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], { duration, easing }),
            animate(overlay, [{ opacity: 0 }, { opacity: 0.72 }, { opacity: 0 }], { duration, easing: 'ease-in-out' })
          ]);
          overlay?.remove();
          break;
        }
        case 'slide-horizontal': {
          const fromRight = Math.random() >= 0.5;
          const startX = fromRight ? '100%' : '-100%';
          const endX = fromRight ? '-26%' : '26%';
          incoming.style.opacity = '1';
          await Promise.all([
            animate(outgoing, [{ transform: 'translateX(0%)', opacity: 1 }, { transform: `translateX(${endX})`, opacity: 0.5 }], { duration, easing }),
            animate(incoming, [{ transform: `translateX(${startX})`, opacity: 0.6 }, { transform: 'translateX(0%)', opacity: 1 }], { duration, easing })
          ]);
          break;
        }
        case 'slide-vertical': {
          const fromBottom = Math.random() >= 0.5;
          const startY = fromBottom ? '100%' : '-100%';
          const endY = fromBottom ? '-24%' : '24%';
          await Promise.all([
            animate(outgoing, [{ transform: 'translateY(0%)', opacity: 1 }, { transform: `translateY(${endY})`, opacity: 0.5 }], { duration, easing }),
            animate(incoming, [{ transform: `translateY(${startY})`, opacity: 0.6 }, { transform: 'translateY(0%)', opacity: 1 }], { duration, easing })
          ]);
          break;
        }
        case 'push': {
          const pushLeft = Math.random() >= 0.5;
          const enterX = pushLeft ? '100%' : '-100%';
          const leaveX = pushLeft ? '-100%' : '100%';
          await Promise.all([
            animate(outgoing, [{ transform: 'translateX(0%)', opacity: 1 }, { transform: `translateX(${leaveX})`, opacity: 1 }], { duration, easing }),
            animate(incoming, [{ transform: `translateX(${enterX})`, opacity: 1 }, { transform: 'translateX(0%)', opacity: 1 }], { duration, easing })
          ]);
          break;
        }
        case 'simple-wipe': {
          incoming.style.opacity = '1';
          incoming.style.clipPath = 'inset(0 100% 0 0)';
          await Promise.all([
            animate(outgoing, [{ opacity: 1 }, { opacity: 0.3 }], { duration, easing }),
            animate(incoming, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration, easing })
          ]);
          break;
        }
        case 'diagonal-wipe': {
          incoming.style.opacity = '1';
          incoming.style.clipPath = 'polygon(0 0, 0 0, 0 100%, 0 100%)';
          await Promise.all([
            animate(outgoing, [{ opacity: 1 }, { opacity: 0.25 }], { duration, easing }),
            animate(incoming, [
              { clipPath: 'polygon(0 0, 0 0, 0 100%, 0 100%)' },
              { clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }
            ], { duration, easing })
          ]);
          break;
        }
        case 'iris-wipe': {
          incoming.style.opacity = '1';
          incoming.style.clipPath = 'circle(0% at 50% 50%)';
          await Promise.all([
            animate(outgoing, [{ opacity: 1 }, { opacity: 0.25 }], { duration, easing }),
            animate(incoming, [{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(150% at 50% 50%)' }], { duration, easing })
          ]);
          break;
        }
        case 'zoom-in-out':
          await Promise.all([
            animate(outgoing, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.92)', opacity: 0 }], { duration, easing }),
            animate(incoming, [{ transform: 'scale(1.08)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration, easing })
          ]);
          break;
        case 'ken-burns-blend': {
          const panX = (Math.random() * 8 - 4).toFixed(2);
          const panY = (Math.random() * 6 - 3).toFixed(2);
          await Promise.all([
            animate(outgoing, [{ transform: 'scale(1) translate(0%,0%)', opacity: 1 }, { transform: `scale(1.08) translate(${panX}%,${panY}%)`, opacity: 0 }], { duration, easing }),
            animate(incoming, [{ transform: `scale(1.14) translate(${-panX}%,${-panY}%)`, opacity: 0 }, { transform: 'scale(1) translate(0%,0%)', opacity: 1 }], { duration, easing })
          ]);
          break;
        }
        case 'rotate-fade': {
          const rotateDeg = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 2);
          await Promise.all([
            animate(outgoing, [{ transform: 'rotate(0deg) scale(1)', opacity: 1 }, { transform: `rotate(${rotateDeg}deg) scale(0.98)`, opacity: 0 }], { duration, easing }),
            animate(incoming, [{ transform: `rotate(${-rotateDeg}deg) scale(1.02)`, opacity: 0 }, { transform: 'rotate(0deg) scale(1)', opacity: 1 }], { duration, easing })
          ]);
          break;
        }
        case 'blur-fade':
          await Promise.all([
            animate(outgoing, [{ filter: 'blur(0px)', opacity: 1 }, { filter: 'blur(5px)', opacity: 0 }], { duration, easing }),
            animate(incoming, [{ filter: 'blur(5px)', opacity: 0 }, { filter: 'blur(0px)', opacity: 1 }], { duration, easing })
          ]);
          break;
        case 'parallax-swap': {
          const fromRight = Math.random() >= 0.5;
          const incomingOffset = fromRight ? '18%' : '-18%';
          const outgoingOffset = fromRight ? '-12%' : '12%';
          await Promise.all([
            animate(outgoing, [{ transform: 'translateX(0%) scale(1)', opacity: 1 }, { transform: `translateX(${outgoingOffset}) scale(0.97)`, opacity: 0 }], { duration, easing }),
            animate(incoming, [{ transform: `translateX(${incomingOffset}) scale(1.03)`, opacity: 0.2 }, { transform: 'translateX(0%) scale(1)', opacity: 1 }], { duration, easing })
          ]);
          break;
        }
        case 'luma-wipe': {
          const canMask = supportsCss('mask-image', 'linear-gradient(90deg, #000, transparent)') || supportsCss('-webkit-mask-image', 'linear-gradient(90deg, #000, transparent)');
          if (!canMask) {
            result.effectId = 'simple-wipe';
            incoming.style.clipPath = 'inset(0 100% 0 0)';
            await Promise.all([
              animate(outgoing, [{ opacity: 1 }, { opacity: 0.25 }], { duration, easing }),
              animate(incoming, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration, easing })
            ]);
            break;
          }
          incoming.style.opacity = '1';
          incoming.style.maskImage = 'linear-gradient(100deg, transparent 15%, black 40%, black 100%)';
          incoming.style.webkitMaskImage = incoming.style.maskImage;
          incoming.style.maskSize = '250% 100%';
          incoming.style.webkitMaskSize = incoming.style.maskSize;
          incoming.style.maskPosition = '100% 0%';
          incoming.style.webkitMaskPosition = incoming.style.maskPosition;
          await Promise.all([
            animate(outgoing, [{ filter: 'brightness(1)', opacity: 1 }, { filter: 'brightness(0.6)', opacity: 0.1 }], { duration, easing }),
            animate(incoming, [{ maskPosition: '100% 0%', opacity: 0.1 }, { maskPosition: '0% 0%', opacity: 1 }], { duration, easing })
          ]);
          break;
        }
        case 'displacement-ripple': {
          const overlay = createOverlay(container, {
            background: 'radial-gradient(circle at center, rgba(255,255,255,0.28), rgba(255,255,255,0.06) 42%, rgba(0,0,0,0) 70%)',
            blend: 'screen',
            zIndex: 60
          });
          await Promise.all([
            animate(outgoing, [{ transform: 'scale(1) skew(0deg, 0deg)', filter: 'blur(0px)', opacity: 1 }, { transform: 'scale(1.06) skew(2deg, -1deg)', filter: 'blur(2px)', opacity: 0.05 }], { duration, easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)' }),
            animate(incoming, [{ transform: 'scale(0.95) skew(-2deg, 1deg)', filter: 'blur(2px)', opacity: 0.06 }, { transform: 'scale(1) skew(0deg, 0deg)', filter: 'blur(0px)', opacity: 1 }], { duration, easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)' }),
            animate(overlay, [{ opacity: 0, transform: 'scale(0.75)' }, { opacity: 0.7, transform: 'scale(1.12)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration, easing: 'ease-in-out' })
          ]);
          overlay?.remove();
          break;
        }
        default:
          incoming.style.opacity = '0';
          await Promise.all([
            animate(outgoing, [{ opacity: 1 }, { opacity: 0 }], { duration, easing }),
            animate(incoming, [{ opacity: 0 }, { opacity: 1 }], { duration, easing })
          ]);
      }
    } finally {
      incoming.style.opacity = '1';
      outgoing.style.opacity = '0';
      cleanupTransitionStyle(incoming);
      cleanupTransitionStyle(outgoing);
    }

    return result;
  }

  resolveEffectByCapability(effectId) {
    const effect = effectById(effectId);
    if (!effect) return EFFECT_FALLBACK_ID;
    if (effect.id === 'hard-cut') return 'hard-cut';
    if (this.qualityTier === 'low' && effect.cost > 2) return EFFECT_FALLBACK_ID;
    if ((effect.id === 'simple-wipe' || effect.id === 'diagonal-wipe' || effect.id === 'iris-wipe') && !supportsCss('clip-path', 'inset(0 0 0 0)')) {
      return EFFECT_FALLBACK_ID;
    }
    if (effect.id === 'blur-fade' && !supportsCss('filter', 'blur(2px)')) return EFFECT_FALLBACK_ID;
    return effect.id;
  }
}

export function createTransitionManager(opts = {}) {
  return new TransitionManager(opts);
}

export function defaultTransitionSettings() {
  return normalizeTransitionSettings({
    enabledTransitionIds: DEFAULT_ENABLED_IDS,
    transitionWeights: { ...DEFAULT_WEIGHTS },
    transitionDurationMs: 900,
    transitionOverlapMs: 0,
    transitionRandomizeOrder: true,
    transitionMaxHeavyInRow: 1,
    qualityAutoAdjust: true,
    showFps: false
  });
}

export function listTransitionEffects() {
  return TRANSITION_EFFECTS.map(effect => ({ ...effect }));
}

export function isHeavyTransition(effectId) {
  return !!effectById(effectId)?.heavy;
}

export function fallbackEffectIdForSettings(settings = {}) {
  const normalized = normalizeTransitionSettings(settings);
  const pool = normalized.enabledTransitionIds.filter(id => !isHeavyTransition(id));
  return pool[0] || EFFECT_FALLBACK_ID;
}

export function transitionSelectionPreview(settings = {}) {
  const normalized = normalizeTransitionSettings(settings);
  const manager = new TransitionManager({ settings: normalized });
  const sequence = [];
  for (let i = 0; i < Math.max(3, normalized.enabledTransitionIds.length); i++) {
    sequence.push(manager.pickEffectId());
  }
  manager.destroy();
  return sequence;
}
