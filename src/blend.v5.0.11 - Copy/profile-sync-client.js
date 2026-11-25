export const PROFILE_SYNC_ID_KEY = 'blend-profile-sync-guid-v1';
export const PROFILE_SYNC_STATE_KEY = 'blend-profile-sync-state-v1';
export const PROFILE_SYNC_DEFAULT_API = 'https://api.mytech.today/api/profile-sync';

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

async function readTextLimited(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('The profile ID file is too large.');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('The profile ID file is too large.');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('The profile ID file is too large.');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}

async function experienceFingerprint(value, cryptoObject) {
  const stableValue = input => {
    if (Array.isArray(input)) return input.map(stableValue);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.keys(input)
      .filter(key => key !== 'exportedAt')
      .sort()
      .map(key => [key, stableValue(input[key])]));
  };
  // Export timestamps are regenerated on every export and do not change the logical Experience.
  const text = JSON.stringify(stableValue(value));
  if (!cryptoObject?.subtle || typeof TextEncoder !== 'function') return null;
  const digest = await cryptoObject.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function localDeviceUrl(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(hostname || '').replace(/^\[|\]$/g, ''));
}

function resolveApiUrl(globalObject, location) {
  const raw = String(globalObject.BLEND_PROFILE_SYNC_API_URL || PROFILE_SYNC_DEFAULT_API).trim();
  let url;
  try { url = new URL(raw); } catch (_) { return null; }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/api/profile-sync') return null;
  const loopback = localDeviceUrl(url.hostname) && localDeviceUrl(location.hostname);
  if (url.protocol !== 'https:' && !loopback) return null;
  if (!loopback && url.hostname.toLowerCase() !== 'api.mytech.today') return null;
  return url.toString().replace(/\/$/, '');
}

function asIdentity(value) {
  const candidate = String(value || '').trim();
  return GUID_PATTERN.test(candidate) ? candidate.toLowerCase() : '';
}

function noStoreFetchOptions() {
  return {
    cache: 'no-store',
    credentials: 'include',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(20_000)
  };
}

export function createProfileSyncClient({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  fetchImpl = globalThis.fetch,
  getExperience = () => windowObject?.Blend?.getExperienceExportPayload?.(),
  applyExperience = (experience, options) => windowObject?.Blend?.importExperiencePayload?.(experience, options),
  onStatus = () => {},
  confirm = message => windowObject.confirm(message),
  clipboard = windowObject.navigator?.clipboard
} = {}) {
  if (!windowObject || !documentObject || typeof fetchImpl !== 'function') return null;
  let localStorage;
  try { localStorage = windowObject.localStorage; } catch (_) { return null; }
  if (!localStorage) return null;
  const apiUrl = resolveApiUrl(windowObject, windowObject.location);
  const elements = Object.fromEntries([
    'profile-sync-local-status', 'profile-sync-remote-status', 'profile-sync-error',
    'profile-sync-guid', 'profile-sync-reveal', 'profile-sync-initialize',
    'profile-sync-export-id', 'profile-sync-copy-id', 'profile-sync-delete-id',
    'profile-sync-start-over', 'profile-sync-import-id-file', 'profile-sync-id-file',
    'profile-sync-import-id-url', 'profile-sync-import-url', 'profile-sync-recovery-key',
    'profile-sync-enroll', 'profile-sync-share', 'profile-sync-share-copy',
    'profile-sync-rotate', 'profile-sync-recovery-save', 'profile-sync-recovery-message', 'profile-sync-recovery-download',
    'profile-sync-recovery-confirm', 'profile-sync-recovery-cancel',
    'profile-sync-conflict', 'profile-sync-resubmit', 'profile-sync-cancel-conflict', 'profile-sync-now'
  ].map(id => [id, documentObject.getElementById(id)]));
  let profileGuid = '';
  let localState = {};
  let recoveryKeys = [];
  let pendingRotationId = '';
  let pendingKeysDownloaded = false;
  let syncTimer = null;
  let busy = false;
  let applyingRemote = 0;

  function storageRead(key, fallback = null) {
    try { return parseJson(localStorage.getItem(key), fallback); } catch (_) { return fallback; }
  }

  function storageWrite(key, value) {
    try {
      const persisted = value && typeof value === 'object' ? { ...value } : value;
      if (persisted?.conflict?.remoteExperience) {
        persisted.conflict = { ...persisted.conflict };
        delete persisted.conflict.remoteExperience;
      }
      localStorage.setItem(key, JSON.stringify(persisted));
      return true;
    } catch (_) { return false; }
  }

  function writeStatus({ localSave, remoteSync, error = '' } = {}) {
    if (elements['profile-sync-local-status'] && localSave) elements['profile-sync-local-status'].textContent = localSave;
    if (elements['profile-sync-remote-status'] && remoteSync) elements['profile-sync-remote-status'].textContent = remoteSync;
    if (elements['profile-sync-error']) {
      elements['profile-sync-error'].textContent = error;
      elements['profile-sync-error'].hidden = !error;
    }
    onStatus({ localSave, remoteSync, error });
  }

  function setLocalState(next) {
    localState = { ...localState, ...next, profileGuid };
    storageWrite(PROFILE_SYNC_STATE_KEY, localState);
  }

  function renderIdentity() {
    if (elements['profile-sync-guid']) {
      elements['profile-sync-guid'].textContent = elements['profile-sync-reveal']?.dataset.revealed === 'true'
        ? profileGuid
        : 'Hidden. Use Reveal to view this public identifier.';
    }
  }

  function setBusy(value) {
    busy = !!value;
    for (const element of documentObject.querySelectorAll('[data-profile-sync-action]')) {
      element.disabled = busy;
    }
  }

  async function withBusy(action) {
    if (busy) return null;
    setBusy(true);
    try { return await action(); }
    catch (error) {
      writeStatus({ error: error?.message || 'Profile synchronization could not complete this action.' });
      return null;
    } finally { setBusy(false); }
  }

  async function request(path, { method = 'GET', body, headers = {}, adminKey = '' } = {}) {
    if (!apiUrl) throw new Error('Profile sync needs a valid HTTPS API address.');
    const requestHeaders = new Headers(headers);
    if (method !== 'GET' && method !== 'HEAD') {
      requestHeaders.set('Content-Type', 'application/json');
      requestHeaders.set('X-Blend-CSRF', '1');
    }
    if (adminKey) requestHeaders.set('Authorization', `Bearer ${adminKey}`);
    const response = await fetchImpl(`${apiUrl}${path}`, {
      ...noStoreFetchOptions(),
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (response.status === 204) return { ok: true };
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `Profile sync returned HTTP ${response.status}.`);
      error.status = response.status;
      error.code = payload?.error?.code || 'profile_sync_error';
      error.payload = payload;
      throw error;
    }
    const result = payload || {};
    Object.defineProperty(result, 'headers', { value: response.headers, configurable: true });
    return result;
  }

  function makeRecoveryText(keys, generation) {
    return [
      'Blend Player recovery keys',
      `Profile GUID: ${profileGuid}`,
      `Recovery key generation: ${generation}`,
      'Each key can be used once to enroll a browser.',
      'Anyone who has this file can access and change the public profile.',
      '',
      ...keys,
      ''
    ].join('\r\n');
  }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = documentObject.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noreferrer';
    link.click();
    windowObject.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }

  function revealRecoverySave(visible, cancellable = true) {
    if (elements['profile-sync-recovery-save']) elements['profile-sync-recovery-save'].hidden = !visible;
    if (elements['profile-sync-recovery-confirm']) elements['profile-sync-recovery-confirm'].hidden = !visible;
    if (elements['profile-sync-recovery-cancel']) elements['profile-sync-recovery-cancel'].hidden = !visible || !cancellable;
    if (elements['profile-sync-recovery-download']) elements['profile-sync-recovery-download'].hidden = !visible;
  }

  function beginRecoveryDownload() {
    if (!recoveryKeys.length || pendingKeysDownloaded) return;
    const generation = localState.recoveryGeneration || 1;
    downloadText(makeRecoveryText(recoveryKeys, generation), `blend-recovery-${profileGuid}-g${generation}.txt`);
    recoveryKeys = [];
    pendingKeysDownloaded = true;
    if (elements['profile-sync-recovery-message']) {
      elements['profile-sync-recovery-message'].textContent = 'A recovery file download was requested. Confirm only after you can open the file and see all ten keys.';
    }
  }

  function rememberProfile(payload, { pending = false } = {}) {
    const revision = String(payload.revision ?? 0);
    const github = payload.github || {};
    setLocalState({
      revision,
      sha: github.sha || null,
      pending,
      lastStatus: github.status || 'local_only',
      recoveryGeneration: payload.recoveryGeneration || localState.recoveryGeneration || 1,
      conflict: null
    });
    if (elements['profile-sync-conflict']) elements['profile-sync-conflict'].hidden = true;
    writeStatus({
      localSave: 'Local Experience saves remain available offline.',
      remoteSync: github.status === 'synced'
        ? 'Remote GitHub sync is current.'
        : (pending ? 'Remote GitHub sync is pending.' : 'Profile enrolled. Remote sync status is being checked.')
    });
  }

  function setConflict(conflict) {
    localState = { ...localState, enrolled: true, pending: true, conflict, profileGuid };
    storageWrite(PROFILE_SYNC_STATE_KEY, localState);
    if (elements['profile-sync-conflict']) elements['profile-sync-conflict'].hidden = false;
    writeStatus({
      localSave: 'Local Experience is saved in this browser.',
      remoteSync: 'Remote sync has a conflict. Choose Resubmit or Cancel to load the current saved Experience.'
    });
  }

  function setProfileId(value, { replace = false } = {}) {
    const next = asIdentity(value);
    if (!next) throw new Error('The imported profile identifier is not a valid GUID.');
    if (profileGuid && profileGuid !== next && !replace) {
      throw new Error('Confirm before replacing the profile identifier saved in this browser.');
    }
    try { localStorage.setItem(PROFILE_SYNC_ID_KEY, next); } catch (_) {
      throw new Error('Browser storage is unavailable. The profile identifier could not be saved.');
    }
    if (profileGuid && profileGuid !== next) clearProfileTransientState();
    profileGuid = next;
    localState = storageRead(PROFILE_SYNC_STATE_KEY, {}) || {};
    if (localState.profileGuid !== profileGuid) localState = {};
    renderIdentity();
    return profileGuid;
  }

  function ensureProfileId({ create = true } = {}) {
    let current = '';
    try { current = asIdentity(localStorage.getItem(PROFILE_SYNC_ID_KEY)); } catch (_) {}
    if (current) profileGuid = current;
    else {
      if (!create) return '';
      const generated = windowObject.crypto?.randomUUID?.();
      if (!generated || !asIdentity(generated)) return '';
      try { localStorage.setItem(PROFILE_SYNC_ID_KEY, generated.toLowerCase()); } catch (_) { return ''; }
      profileGuid = generated.toLowerCase();
    }
    localState = storageRead(PROFILE_SYNC_STATE_KEY, {}) || {};
    if (localState.profileGuid !== profileGuid) localState = {};
    renderIdentity();
    return profileGuid;
  }

  function remoteStateFromError(error) {
    const data = error?.payload?.conflict ? error.payload : error?.payload?.error?.details;
    if (!data) return null;
    return {
      source: 'profile',
      revision: String(data.revision || 0),
      sha: data.sha || null,
      remoteSha: data.remoteSha || null,
      remoteExperience: data.remoteExperience || null,
      remoteUnavailable: !!data.remoteUnavailable
    };
  }

  async function readProfile() {
    return request(`/profiles/${encodeURIComponent(profileGuid)}`);
  }

  async function acceptRemoteProfile(remote, { fromGithub = false } = {}) {
    if (!remote?.experience) throw new Error('There is no saved remote Experience to load. Keep the local draft and choose Resubmit if you want to restore it.');
    let accepted = remote;
    if (fromGithub) {
      accepted = await request(`/profiles/${encodeURIComponent(profileGuid)}/accept-remote`, {
        method: 'POST',
        body: { baseRevision: String(remote.revision), remoteSha: remote.remoteSha }
      });
    }
    applyingRemote += 1;
    let imported;
    try { imported = await applyExperience(accepted.experience || remote.experience, { replaceActive: true, suppressToast: true }); }
    catch (error) {
      if (fromGithub) setConflict({
        source: 'github',
        revision: String(accepted.revision),
        sha: accepted.github?.sha || null,
        remoteSha: accepted.github?.sha || null,
        remoteExperience: accepted.experience || remote.experience
      });
      throw error;
    } finally { applyingRemote -= 1; }
    if (!imported) {
      if (fromGithub) setConflict({
        source: 'github',
        revision: String(accepted.revision),
        sha: accepted.github?.sha || null,
        remoteSha: accepted.github?.sha || null,
        remoteExperience: accepted.experience || remote.experience
      });
      throw new Error('The saved remote Experience could not be written to local browser storage. The local draft remains available.');
    }
    rememberProfile(accepted, { pending: accepted.github?.status !== 'synced' });
    if (!fromGithub) void pollSyncState().catch(() => {});
    return accepted;
  }

  async function handleProfileConflict(error = null) {
    const errorConflict = remoteStateFromError(error);
    let profile;
    try { profile = await readProfile(); } catch (_) {}
    const isGithubConflict = profile?.github?.status === 'conflict';
    const conflict = profile ? {
      source: isGithubConflict ? 'github' : 'profile',
      revision: String(profile.revision || 0),
      sha: profile.github?.sha || null,
      remoteSha: profile.remoteSha || null,
      remoteExperience: isGithubConflict ? profile.remoteExperience : profile.experience,
      remoteUnavailable: !!profile.remoteUnavailable,
      githubStatus: profile.github?.status || 'unknown'
    } : errorConflict;
    if (!conflict) throw error || new Error('The current saved Experience could not be read. Your local draft remains available.');
    if (!conflict.source) conflict.source = isGithubConflict ? 'github' : 'profile';
    setConflict(conflict);
  }

  async function pollSyncState() {
    if (!profileGuid || localState.enrolled !== true) return null;
    const profile = await readProfile();
    if (profile.github?.status === 'conflict') {
      setConflict({
        source: 'github',
        revision: String(profile.revision),
        sha: profile.github.sha || null,
        remoteSha: profile.remoteSha || null,
        remoteExperience: profile.remoteExperience || null,
        remoteUnavailable: !!profile.remoteUnavailable
      });
      return profile;
    }
    setLocalState({
      revision: String(profile.revision),
      sha: profile.github?.sha || null,
      pending: profile.github?.status !== 'synced' || String(profile.github?.syncedRevision) !== String(profile.revision),
      lastStatus: profile.github?.status || 'unknown'
    });
    writeStatus({
      localSave: 'Local Experience saves remain available offline.',
      remoteSync: profile.github?.status === 'synced' && String(profile.github?.syncedRevision) === String(profile.revision)
        ? 'Remote GitHub sync is current.'
        : `Remote sync is ${profile.github?.status || 'pending'}. Local changes remain saved in this browser.`
    });
    return profile;
  }

  async function syncLocal({ decision = '', remoteSha = null } = {}) {
    if (!profileGuid || localState.enrolled !== true) return false;
    let profile = await readProfile();
    if (profile.github?.status === 'conflict' && decision !== 'resubmit') {
      await handleProfileConflict();
      return false;
    }
    const experience = getExperience();
    if (!experience) throw new Error('The active Experience could not be read from local browser storage.');
    const fingerprint = await experienceFingerprint(experience, windowObject.crypto);
    const expectedRevision = decision === 'resubmit'
      ? String(localState.conflict?.revision ?? profile.revision)
      : String(localState.revision ?? profile.revision);
    const expectedSha = decision === 'resubmit'
      ? (localState.conflict?.sha ?? profile.github?.sha ?? null)
      : (localState.sha ?? profile.github?.sha ?? null);
    if (String(profile.revision) !== expectedRevision) {
      if (localState.idempotencyKey && fingerprint
          && localState.idempotencyFingerprint === fingerprint
          && profile.github?.status !== 'conflict' && profile.experience) {
        const remoteFingerprint = await experienceFingerprint(profile.experience, windowObject.crypto);
        if (remoteFingerprint === fingerprint) {
          rememberProfile(profile, { pending: profile.github?.status !== 'synced' });
          setLocalState({
            lastPayloadFingerprint: fingerprint,
            idempotencyKey: null,
            idempotencyFingerprint: null
          });
          await pollSyncState();
          return true;
        }
      }
      await handleProfileConflict();
      return false;
    }
    if (fingerprint && localState.lastPayloadFingerprint === fingerprint
        && String(localState.revision ?? '') === String(profile.revision)
        && profile.github?.status !== 'conflict') {
      await pollSyncState();
      return true;
    }
    if (!localState.pending && profile.github?.status === 'synced'
        && String(profile.github?.syncedRevision) === String(profile.revision)) {
      return true;
    }
    setLocalState({ pending: true });
    writeStatus({ localSave: 'Local Experience is saved in this browser.', remoteSync: 'Remote sync is pending.' });
    const idempotencyKey = fingerprint && localState.idempotencyKey
        && localState.idempotencyFingerprint === fingerprint
      ? localState.idempotencyKey
      : windowObject.crypto?.randomUUID?.();
    if (!idempotencyKey) throw new Error('This browser cannot create a safe profile write identifier.');
    if (fingerprint && localState.idempotencyKey !== idempotencyKey) {
      setLocalState({ idempotencyKey, idempotencyFingerprint: fingerprint });
    }
    const lock = await request(`/profiles/${encodeURIComponent(profileGuid)}/experience`, {
      method: 'LOCK',
      body: { baseRevision: expectedRevision, baseSha: expectedSha }
    });
    const lockToken = lock?.lockToken || '';
    const responseLockToken = lock?.['Lock-Token'] || '';
    const webDavLockToken = responseLockToken || lockToken;
    const headers = {};
    headers['Idempotency-Key'] = idempotencyKey;
    if (webDavLockToken) headers['Lock-Token'] = webDavLockToken;
    else if (lock?.headers?.get) headers['Lock-Token'] = lock.headers.get('Lock-Token') || '';
    const token = headers['Lock-Token'];
    if (!token) throw new Error('The profile server did not return a WebDAV lock token.');
    try {
      const saved = await request(`/profiles/${encodeURIComponent(profileGuid)}/experience`, {
        method: 'PUT',
        headers,
        body: {
          baseRevision: expectedRevision,
          baseSha: expectedSha,
          experience,
      ...(decision === 'resubmit' && localState.conflict?.source === 'github'
            ? { conflictDecision: 'resubmit', remoteSha }
            : {})
        }
      });
      setLocalState({
        revision: String(saved.revision),
        sha: saved.github?.sha || expectedSha,
        pending: true,
        lastPayloadFingerprint: fingerprint,
        idempotencyKey: null,
        idempotencyFingerprint: null,
        conflict: null,
        lastStatus: saved.github?.status || 'pending'
      });
      if (elements['profile-sync-conflict']) elements['profile-sync-conflict'].hidden = true;
      writeStatus({ localSave: 'Local Experience is saved in this browser.', remoteSync: 'Remote GitHub sync is pending.' });
      windowObject.setTimeout(() => { void pollSyncState().catch(() => {}); }, 1200);
      return true;
    } catch (error) {
      if (error.status === 409 || error.code === 'explicit_conflict_choice_required') {
        await handleProfileConflict(error);
        return false;
      }
      throw error;
    } finally {
      await request(`/profiles/${encodeURIComponent(profileGuid)}/experience`, {
        method: 'UNLOCK',
        headers: { 'Lock-Token': token }
      }).catch(() => {});
    }
  }

  function scheduleSync() {
    if (!localState.enrolled || !profileGuid) return;
    setLocalState({ pending: true });
    if (syncTimer != null) windowObject.clearTimeout(syncTimer);
    syncTimer = windowObject.setTimeout(() => {
      syncTimer = null;
      void withBusy(() => syncLocal()).catch(() => {});
    }, 1200);
  }

  function clearProfileTransientState() {
    if (syncTimer != null) windowObject.clearTimeout(syncTimer);
    syncTimer = null;
    recoveryKeys = [];
    pendingRotationId = '';
    pendingKeysDownloaded = false;
    revealRecoverySave(false);
    if (elements['profile-sync-conflict']) elements['profile-sync-conflict'].hidden = true;
    if (elements['profile-sync-recovery-key']) elements['profile-sync-recovery-key'].value = '';
    if (elements['profile-sync-share-copy']) {
      elements['profile-sync-share-copy'].value = '';
      elements['profile-sync-share-copy'].hidden = true;
    }
  }

  async function initializeProfile() {
    if (!profileGuid) ensureProfileId();
    if (!profileGuid) throw new Error('Browser storage is unavailable. A profile identifier could not be saved.');
    const payload = await request(`/profiles/${encodeURIComponent(profileGuid)}/initialize`, { method: 'POST', body: {} });
    recoveryKeys = payload.recoveryKeys || [];
    localState = {
      profileGuid,
      revision: String(payload.revision || 0),
      sha: null,
      enrolled: false,
      deviceSessionIssued: true,
      pending: false,
      recoveryPending: true,
      recoveryGeneration: payload.recoveryGeneration || 1
    };
    storageWrite(PROFILE_SYNC_STATE_KEY, localState);
    if (elements['profile-sync-recovery-message']) {
      elements['profile-sync-recovery-message'].textContent = 'Download and open the file, then confirm that all ten keys are readable. Keys are not stored in this browser.';
    }
    revealRecoverySave(true, false);
    writeStatus({ localSave: 'Local Experience saves remain available offline.', remoteSync: 'Profile created. Save its recovery keys before continuing.' });
  }

  async function enrollWithRecovery() {
    if (!profileGuid) ensureProfileId();
    if (!profileGuid) throw new Error('Browser storage is unavailable.');
    const key = String(elements['profile-sync-recovery-key']?.value || '').trim();
    if (!key) throw new Error('Enter one unused recovery key.');
    const profile = await request(`/profiles/${encodeURIComponent(profileGuid)}/enroll`, {
      method: 'POST', body: { recoveryKey: key }
    });
    if (elements['profile-sync-recovery-key']) elements['profile-sync-recovery-key'].value = '';
    localState = { ...localState, profileGuid, enrolled: true, deviceSessionIssued: true, pending: false };
    storageWrite(PROFILE_SYNC_STATE_KEY, localState);
    if (profile.experience) {
      setConflict({
        source: 'profile', revision: String(profile.revision), sha: profile.github?.sha || null,
        remoteSha: profile.github?.sha || null, remoteExperience: profile.experience
      });
    } else {
      rememberProfile(profile);
      scheduleSync();
    }
  }

  async function switchProfileId(identity) {
    if (profileGuid && profileGuid !== identity && localState.recoveryPending) {
      throw new Error('Save the initial recovery key file before switching this browser to another profile.');
    }
    if (profileGuid && profileGuid !== identity
        && (localState.enrolled === true || localState.deviceSessionIssued === true)) {
      const disconnected = await disconnectCurrentBrowser();
      if (!disconnected) throw new Error('This browser could not revoke its previous profile session. Its current profile ID was kept. Retry while online, then open the share link again.');
    }
    setProfileId(identity, { replace: true });
    return true;
  }

  async function redeemShareToken(token, sharedGuid) {
    const id = asIdentity(sharedGuid);
    if (!id || !TOKEN_PATTERN.test(token)) return;
    if (profileGuid && profileGuid !== id
        && !confirm('This share link belongs to a different public profile. Replace the profile ID saved in this browser? This does not delete either profile.')) return;
    if (!confirm('This link enrolls this browser and replaces the active local Experience with the saved public Experience. The GitHub file and its history are public. Continue?')) return;
    if (profileGuid !== id) await switchProfileId(id);
    const profile = await request(`/profiles/${encodeURIComponent(id)}/enroll`, {
      method: 'POST', body: { shareToken: token }
    });
    localState = { ...localState, profileGuid: id, enrolled: true, deviceSessionIssued: true, pending: false };
    storageWrite(PROFILE_SYNC_STATE_KEY, localState);
    if (profile.experience) {
      applyingRemote += 1;
      let imported;
      try { imported = await applyExperience(profile.experience, { replaceActive: true, suppressToast: true }); }
      finally { applyingRemote -= 1; }
      if (!imported) {
        setConflict({ source: 'profile', revision: String(profile.revision), sha: profile.github?.sha || null, remoteSha: profile.github?.sha || null, remoteExperience: profile.experience });
        throw new Error('The shared Experience could not be saved locally. The remote copy remains available in this conflict panel.');
      }
    }
    rememberProfile(profile);
  }

  async function cancelConflict() {
    const conflict = localState.conflict;
    if (!conflict) return;
    let remote = await readProfile();
    if (remote.github?.status === 'conflict') {
      remote = {
        ...remote,
        experience: remote.remoteExperience,
        remoteSha: remote.remoteSha
      };
    }
    const fromGithub = remote.github?.status === 'conflict';
    if (fromGithub && !remote.experience) throw new Error('The public GitHub file was removed. There is no saved Experience to load. Keep the local draft and choose Resubmit if you want to restore it.');
    await acceptRemoteProfile(remote, { fromGithub });
  }

  async function resubmitConflict() {
    const conflict = localState.conflict;
    if (!conflict) return;
    if (!confirm('Resubmitting replaces the current saved Experience and creates a later public GitHub commit. Anyone can read that file and its history. Continue?')) return;
    await syncLocal({ decision: 'resubmit', remoteSha: conflict.remoteSha });
  }

  async function prepareRecoveryRotation() {
    const payload = await request(`/profiles/${encodeURIComponent(profileGuid)}/recovery/rotate`, { method: 'POST', body: {} });
    recoveryKeys = payload.recoveryKeys || [];
    pendingRotationId = payload.rotationId || '';
    pendingKeysDownloaded = false;
    setLocalState({ recoveryGeneration: payload.recoveryGeneration });
    if (elements['profile-sync-recovery-message']) {
      elements['profile-sync-recovery-message'].textContent = 'The previous recovery keys and device sessions remain active until you save this new key file and confirm it here.';
    }
    revealRecoverySave(true);
  }

  async function confirmRecoveryRotation() {
    if (!pendingRotationId || !pendingKeysDownloaded) {
      throw new Error('Download and open the new recovery key file before confirming rotation.');
    }
    const result = await request(`/profiles/${encodeURIComponent(profileGuid)}/recovery/rotate/commit`, {
      method: 'POST', body: { rotationId: pendingRotationId }
    });
    recoveryKeys = [];
    pendingRotationId = '';
    pendingKeysDownloaded = false;
    revealRecoverySave(false);
    setLocalState({ enrolled: true, deviceSessionIssued: true, recoveryPending: false, recoveryGeneration: result.recoveryGeneration });
    writeStatus({ localSave: 'Local Experience saves remain available offline.', remoteSync: 'New recovery keys saved. Other browsers must enroll again.' });
  }

  async function createShare() {
    const result = await request(`/profiles/${encodeURIComponent(profileGuid)}/share`, { method: 'POST', body: {} });
    if (elements['profile-sync-share-copy']) {
      elements['profile-sync-share-copy'].value = result.shareUrl;
      elements['profile-sync-share-copy'].hidden = false;
      elements['profile-sync-share-copy'].dataset.expiresIn = String(result.expiresInSeconds || 600);
      elements['profile-sync-share-copy'].focus();
      elements['profile-sync-share-copy'].select();
    }
    await clipboard?.writeText?.(result.shareUrl).catch(() => {});
    writeStatus({ localSave: 'Local Experience saves remain available offline.', remoteSync: 'A single-use share link was created. It expires in ten minutes.' });
  }

  async function disconnectCurrentBrowser() {
    if (!profileGuid || !(localState.enrolled || localState.deviceSessionIssued)) return true;
    try {
      await request(`/profiles/${encodeURIComponent(profileGuid)}/disconnect`, { method: 'POST', body: {} });
      return true;
    } catch (error) {
      return error.status === 401 || error.status === 404;
    }
  }

  async function deleteLocalIdentity({ startOver = false } = {}) {
    if (localState.recoveryPending) {
      throw new Error('Save the initial recovery key file before resetting this profile.');
    }
    if (!confirm('This clears this browser’s saved profile identifier and attempts to revoke its server session. It does not delete the remote profile or public GitHub artifact. Continue?')) return;
    const disconnected = await disconnectCurrentBrowser();
    clearProfileTransientState();
    let storageCleared = false;
    try {
      localStorage.removeItem(PROFILE_SYNC_ID_KEY);
      localStorage.removeItem(PROFILE_SYNC_STATE_KEY);
      storageCleared = true;
    } catch (_) {}
    localState = {};
    recoveryKeys = [];
    profileGuid = '';
    if (elements['profile-sync-share-copy']) {
      elements['profile-sync-share-copy'].value = '';
      elements['profile-sync-share-copy'].hidden = true;
    }
    if (startOver && storageCleared) ensureProfileId();
    renderIdentity();
    writeStatus({
      localSave: 'Local Experience saves remain available offline.',
      remoteSync: !storageCleared
        ? 'Browser storage blocked the profile ID reset. The saved ID may return after reloading this page.'
        : (disconnected
          ? 'This browser’s profile identity was reset. Remote data was not deleted.'
          : 'The local profile ID was cleared, but the server could not revoke this browser session. The HttpOnly cookie may remain active until it expires or keys are rotated.')
    });
  }

  function parseImportedIdentity(text) {
    const trimmed = String(text || '').trim();
    if (asIdentity(trimmed)) return asIdentity(trimmed);
    const parsed = parseJson(trimmed, null);
    return asIdentity(parsed?.profileGuid || parsed?.guid);
  }

  async function importIdentityText(text) {
    const identity = parseImportedIdentity(text);
    if (!identity) throw new Error('The selected file does not contain a valid Blend profile GUID.');
    if (profileGuid && profileGuid !== identity
        && !confirm('Replace the profile identifier saved in this browser? This does not delete either remote profile.')) return;
    if (profileGuid !== identity && !await switchProfileId(identity)) return;
    writeStatus({ localSave: 'Local Experience saves remain available offline.', remoteSync: 'Profile identity imported. Enroll with a recovery key or share link to connect.' });
  }

  function bind(id, handler) {
    const element = elements[id];
    if (element) element.addEventListener('click', event => {
      event.preventDefault();
      void withBusy(handler);
    });
  }

  bind('profile-sync-initialize', initializeProfile);
  bind('profile-sync-now', () => syncLocal());
  bind('profile-sync-enroll', enrollWithRecovery);
  bind('profile-sync-export-id', () => downloadText(profileGuid, `blend-profile-${profileGuid}.txt`));
  bind('profile-sync-copy-id', async () => { await clipboard?.writeText?.(profileGuid); writeStatus({ remoteSync: 'Public profile identifier copied.' }); });
  bind('profile-sync-reveal', () => {
    const button = elements['profile-sync-reveal'];
    const reveal = button?.dataset.revealed !== 'true';
    if (button) { button.dataset.revealed = String(reveal); button.textContent = reveal ? 'Hide' : 'Reveal'; }
    renderIdentity();
  });
  bind('profile-sync-import-id-file', () => elements['profile-sync-id-file']?.click());
  bind('profile-sync-import-url', async () => {
    const raw = String(elements['profile-sync-import-id-url']?.value || '').trim();
    let url;
    try { url = new URL(raw); } catch (_) { throw new Error('Enter a valid HTTPS URL for a profile ID file.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Profile ID URLs must use HTTPS and cannot include credentials or fragments.');
    const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`The profile ID URL returned HTTP ${response.status}.`);
    const text = await readTextLimited(response, 16_384);
    await importIdentityText(text);
  });
  bind('profile-sync-delete-id', () => deleteLocalIdentity());
  bind('profile-sync-start-over', () => deleteLocalIdentity({ startOver: true }));
  bind('profile-sync-rotate', prepareRecoveryRotation);
  bind('profile-sync-recovery-download', beginRecoveryDownload);
  bind('profile-sync-recovery-confirm', async () => {
    if (pendingRotationId) await confirmRecoveryRotation();
    else {
      if (!localState.recoveryPending || !pendingKeysDownloaded) {
        throw new Error('Download and open the new recovery key file before confirming key setup.');
      }
      recoveryKeys = [];
      revealRecoverySave(false);
      setLocalState({ enrolled: true, deviceSessionIssued: true, recoveryPending: false, pending: true });
      scheduleSync();
      writeStatus({ remoteSync: 'Recovery keys saved. Keep the file in a safe place.' });
    }
  });
  bind('profile-sync-recovery-cancel', async () => {
    if (localState.recoveryPending) throw new Error('Save the initial recovery key file before leaving this profile setup.');
    recoveryKeys = [];
    pendingRotationId = '';
    pendingKeysDownloaded = false;
    revealRecoverySave(false);
    writeStatus({ remoteSync: 'Key update canceled. Current recovery keys and enrolled browsers remain active.' });
  });
  bind('profile-sync-share', createShare);
  bind('profile-sync-resubmit', resubmitConflict);
  bind('profile-sync-cancel-conflict', cancelConflict);

  if (elements['profile-sync-id-file']) {
    elements['profile-sync-id-file'].addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      await withBusy(async () => {
        if (file.size > 16_384) throw new Error('The profile ID file is too large.');
        await importIdentityText(await readTextLimited(file, 16_384));
      });
      event.target.value = '';
    });
  }

  const details = documentObject.getElementById('profile-sync-details');
  if (details) details.addEventListener('toggle', () => {
    if (details.open && profileGuid) renderIdentity();
  });

  function onLocalSaved() {
    if (!profileGuid || localState.enrolled !== true || applyingRemote > 0) return;
    writeStatus({ localSave: 'Local Experience saved in this browser.', remoteSync: localState.pending ? 'Remote sync is pending.' : 'Checking remote sync status.' });
    scheduleSync();
  }

  windowObject.addEventListener?.('online', () => {
    if (localState.enrolled === true && localState.pending) void withBusy(() => syncLocal());
  });

  function initialize() {
    const token = String(windowObject.__BLEND_PROFILE_SHARE_TOKEN__ || '');
    if (token) {
      delete windowObject.__BLEND_PROFILE_SHARE_TOKEN__;
      const sharedGuid = asIdentity(windowObject.__BLEND_PROFILE_SHARE_GUID__);
      delete windowObject.__BLEND_PROFILE_SHARE_GUID__;
      if (!sharedGuid) {
        writeStatus({ error: 'The share link does not contain a valid public profile identifier.' });
        return;
      }
      ensureProfileId({ create: false });
      if (!profileGuid) setProfileId(sharedGuid, { replace: true });
      void withBusy(() => redeemShareToken(token, sharedGuid)).catch(error => writeStatus({ error: error.message }));
      return;
    }
    ensureProfileId();
    if (localState.enrolled && localState.pending) {
      void withBusy(() => syncLocal()).catch(error => writeStatus({ error: error.message }));
    } else if (localState.enrolled) {
      void pollSyncState().catch(error => writeStatus({ error: error.message }));
    } else {
      writeStatus({
        localSave: 'Local Experience saves remain available offline.',
        remoteSync: apiUrl ? 'Remote sync is not connected.' : 'Remote sync needs its HTTPS API to be configured.'
      });
    }
  }

  return Object.freeze({
    initialize,
    onLocalSaved,
    syncNow: () => withBusy(() => syncLocal()),
    get profileGuid() { return profileGuid; },
    get status() { return { ...localState }; }
  });
}
