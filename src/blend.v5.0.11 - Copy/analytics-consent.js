const ANALYTICS_SCRIPT_ATTEMPT_LIMIT = 2;

export function getAnalyticsConsentDecision({
  consent = false,
  doNotTrack = false,
  globalPrivacyControl = false,
  localFileContext = false,
  scriptStatus = 'idle',
  loadAttempts = 0,
  retryRequested = false
} = {}) {
  const blockedBySignal = !!doNotTrack || !!globalPrivacyControl || !!localFileContext;
  const allowed = consent === true && !blockedBySignal;
  const attempts = Number.isFinite(Number(loadAttempts))
    ? Math.max(0, Math.floor(Number(loadAttempts)))
    : 0;
  const canAttempt = attempts === 0 || retryRequested === true;
  const shouldLoadScript = allowed
    && scriptStatus !== 'loading'
    && scriptStatus !== 'loaded'
    && attempts < ANALYTICS_SCRIPT_ATTEMPT_LIMIT
    && canAttempt;

  return {
    consent: consent === true,
    allowed,
    blockedBySignal,
    shouldLoadScript
  };
}
