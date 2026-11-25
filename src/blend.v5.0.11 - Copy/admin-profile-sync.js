const API_BASE = 'https://api.mytech.today/api/profile-sync';
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveAdminApiUrl() {
  const raw = String(window.BLEND_PROFILE_SYNC_ADMIN_API_URL || API_BASE).trim();
  let url;
  try { url = new URL(raw); } catch (_) { return ''; }
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.replace(/^\[|\]$/g, ''))
    && ['localhost', '127.0.0.1', '::1'].includes(location.hostname.replace(/^\[|\]$/g, ''));
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/api/profile-sync'
      || (url.protocol !== 'https:' && !localHost)
      || (!localHost && url.hostname.toLowerCase() !== 'api.mytech.today')) return '';
  return url.toString().replace(/\/$/, '');
}

const apiBase = resolveAdminApiUrl();
const nodes = Object.fromEntries([
  'admin-sync-key', 'admin-sync-connect', 'admin-sync-disconnect', 'admin-sync-health-refresh',
  'admin-sync-health', 'admin-sync-guid', 'admin-sync-inspect', 'admin-sync-profile',
  'admin-sync-retry', 'admin-sync-delete', 'admin-sync-status', 'admin-sync-error'
].map(id => [id, document.getElementById(id)]));
let adminKey = '';
let inspectedGuid = '';
let retryEligible = false;
let deletionEligible = false;
let busy = false;

function updateControls() {
  if (nodes['admin-sync-connect']) nodes['admin-sync-connect'].disabled = busy || !apiBase;
  for (const id of ['admin-sync-health-refresh', 'admin-sync-inspect']) {
    if (nodes[id]) nodes[id].disabled = busy || !adminKey;
  }
  if (nodes['admin-sync-retry']) nodes['admin-sync-retry'].disabled = busy || !adminKey || !retryEligible;
  if (nodes['admin-sync-delete']) nodes['admin-sync-delete'].disabled = busy || !adminKey || !deletionEligible;
  if (nodes['admin-sync-disconnect']) nodes['admin-sync-disconnect'].disabled = busy;
}

function setBusy(value) {
  busy = !!value;
  updateControls();
}

function clearError() {
  if (nodes['admin-sync-error']) {
    nodes['admin-sync-error'].textContent = '';
    nodes['admin-sync-error'].hidden = true;
  }
}

function showError(error) {
  if (error?.status === 401) {
    adminKey = '';
    inspectedGuid = '';
    retryEligible = false;
    deletionEligible = false;
    if (nodes['admin-sync-key']) nodes['admin-sync-key'].value = '';
    setConnected(false);
  }
  if (nodes['admin-sync-error']) {
    nodes['admin-sync-error'].textContent = error?.message || 'The admin request could not be completed.';
    nodes['admin-sync-error'].hidden = false;
  }
}

function setConnected(connected) {
  if (nodes['admin-sync-key']) nodes['admin-sync-key'].disabled = connected;
  if (nodes['admin-sync-connect']) nodes['admin-sync-connect'].hidden = connected;
  if (nodes['admin-sync-disconnect']) nodes['admin-sync-disconnect'].hidden = !connected;
  if (!connected) {
    adminKey = '';
    inspectedGuid = '';
    retryEligible = false;
    deletionEligible = false;
    renderPairs(nodes['admin-sync-health'], null);
    renderPairs(nodes['admin-sync-profile'], null);
  }
  updateControls();
}

async function request(path, { method = 'GET', body } = {}) {
  if (!apiBase || !adminKey) throw new Error('Enter a valid admin key and HTTPS API address.');
  const headers = new Headers({ Authorization: `Bearer ${adminKey}` });
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('Content-Type', 'application/json');
    headers.set('X-Blend-CSRF', '1');
  }
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(20_000)
  });
  if (response.status === 204) return { ok: true };
  let result = null;
  try { result = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error(result?.error?.message || `The profile sync API returned HTTP ${response.status}.`);
    error.status = response.status;
    error.code = result?.error?.code || 'admin_request_failed';
    throw error;
  }
  return result || {};
}

function renderPairs(target, source) {
  if (!target) return;
  target.replaceChildren();
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = key;
    description.textContent = value == null || value === '' ? 'None' : String(value);
    target.append(term, description);
  }
}

async function run(action) {
  if (busy) return;
  setBusy(true);
  clearError();
  try { await action(); }
  catch (error) { showError(error); }
  finally { setBusy(false); }
}

async function refreshHealth() {
  const result = await request('/admin/health');
  renderPairs(nodes['admin-sync-health'], result);
}

async function inspectProfile() {
  const guid = String(nodes['admin-sync-guid']?.value || '').trim().toLowerCase();
  if (!GUID_PATTERN.test(guid)) throw new Error('Enter a valid profile GUID.');
  const result = await request(`/admin/profiles/${encodeURIComponent(guid)}`);
  inspectedGuid = guid;
  const outbox = result.outbox || {};
  retryEligible = !!result.outbox && (!outbox.blockedByConflict || (result.deleted && outbox.operation === 'delete'));
  deletionEligible = !result.deleted;
  renderPairs(nodes['admin-sync-profile'], {
    profileGuid: result.profileGuid,
    revision: result.revision,
    GitHubStatus: result.github?.status,
    GitHubSha: result.github?.sha,
    GitHubSyncedRevision: result.github?.syncedRevision,
    GitHubErrorCode: result.github?.errorCode,
    recoveryGeneration: result.recoveryGeneration,
    deleted: result.deleted,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    outboxOperation: outbox.operation,
    outboxRevision: outbox.desiredRevision,
    outboxAttempts: outbox.attempts,
    nextAttemptAt: outbox.nextAttemptAt,
    blockedByConflict: outbox.blockedByConflict,
    outboxErrorCode: outbox.lastErrorCode
  });
  updateControls();
  if (nodes['admin-sync-status']) nodes['admin-sync-status'].textContent = 'Profile metadata loaded.';
}

async function connect() {
  const key = String(nodes['admin-sync-key']?.value || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('The admin key format is invalid.');
  adminKey = key;
  await refreshHealth();
  if (nodes['admin-sync-key']) nodes['admin-sync-key'].value = '';
  setConnected(true);
  if (nodes['admin-sync-status']) nodes['admin-sync-status'].textContent = 'Connected. The key is held in this tab’s memory only.';
}

async function retrySync() {
  if (!inspectedGuid) throw new Error('Inspect a profile before requesting a retry.');
  if (!confirm('Retry this eligible synchronization with the current server state?')) return;
  const result = await request(`/admin/profiles/${encodeURIComponent(inspectedGuid)}/retry`, { method: 'POST', body: {} });
  await inspectProfile();
  if (nodes['admin-sync-status']) nodes['admin-sync-status'].textContent = `Retry accepted at revision ${result.revision}. Current status: ${result.status}.`;
}

async function deleteExperience() {
  if (!inspectedGuid) throw new Error('Inspect a profile before requesting deletion.');
  if (!confirm('Prepare deletion of this profile’s current public Experience artifact? A new GitHub commit will preserve its history. The server copy, recovery keys, share links, and device sessions will also be removed.')) return;
  const prepared = await request(`/admin/profiles/${encodeURIComponent(inspectedGuid)}/delete/prepare`, { method: 'POST', body: {} });
  const confirmed = confirm('Confirm deletion now. This removes the current file by GUID, clears its server Experience and recovery records, and preserves public GitHub history.');
  if (!confirmed) return;
  const result = await request(`/admin/profiles/${encodeURIComponent(inspectedGuid)}/delete`, {
    method: 'POST',
    body: { challengeId: prepared.challengeId, challenge: prepared.challenge }
  });
  await inspectProfile();
  if (nodes['admin-sync-status']) nodes['admin-sync-status'].textContent = `Deletion accepted at revision ${result.revision}. GitHub processing status: ${result.status}.`;
}

nodes['admin-sync-connect']?.addEventListener('click', () => { void run(connect); });
nodes['admin-sync-disconnect']?.addEventListener('click', () => {
  setConnected(false);
  clearError();
  if (nodes['admin-sync-status']) nodes['admin-sync-status'].textContent = 'Disconnected. The admin key was removed from this tab’s memory.';
});
nodes['admin-sync-health-refresh']?.addEventListener('click', () => { void run(refreshHealth); });
nodes['admin-sync-inspect']?.addEventListener('click', () => { void run(inspectProfile); });
nodes['admin-sync-retry']?.addEventListener('click', () => { void run(retrySync); });
nodes['admin-sync-delete']?.addEventListener('click', () => { void run(deleteExperience); });
nodes['admin-sync-key']?.addEventListener('keydown', event => {
  if (event.key === 'Enter') void run(connect);
});
nodes['admin-sync-guid']?.addEventListener('input', () => {
  inspectedGuid = '';
  retryEligible = false;
  deletionEligible = false;
  renderPairs(nodes['admin-sync-profile'], null);
  updateControls();
});

if (!apiBase) {
  showError(new Error('This admin page is configured for api.mytech.today. Use HTTPS in the configured deployment.'));
} else {
  setConnected(false);
  setBusy(false);
}
