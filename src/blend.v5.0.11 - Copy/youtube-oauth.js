const CLIENT_ID_STORAGE_KEY = 'blend-youtube-oauth-client-id-v1';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const YOUTUBE_READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

export const YOUTUBE_OAUTH_CLIENT_ID_STORAGE_KEY = CLIENT_ID_STORAGE_KEY;

let identityServicesPromise = null;
let identityServicesReady = false;
let accessToken = '';
let accessTokenExpiresAt = 0;
let accessTokenClientId = '';

export class YouTubeOAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'YouTubeOAuthError';
    this.code = code;
  }
}

function normalizeClientId(value) {
  const clientId = String(value || '').trim();
  if (!/^[A-Za-z0-9._-]{10,240}\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new YouTubeOAuthError('youtube_oauth_client_id_invalid', 'Enter a valid Google OAuth web client ID in Configuration.');
  }
  return clientId;
}

export function readYouTubeOAuthClientId() {
  try {
    return normalizeClientId(window.localStorage.getItem(CLIENT_ID_STORAGE_KEY) || '');
  } catch (_) {
    return '';
  }
}

export function saveYouTubeOAuthClientId(value) {
  const clientId = normalizeClientId(value);
  try {
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    return true;
  } catch (_) {
    throw new YouTubeOAuthError('youtube_oauth_storage_unavailable', 'The Google OAuth client ID could not be saved in this browser.');
  }
}

export function removeYouTubeOAuthClientId() {
  try {
    window.localStorage.removeItem(CLIENT_ID_STORAGE_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

export function clearYouTubeOAuthSession() {
  accessToken = '';
  accessTokenExpiresAt = 0;
  accessTokenClientId = '';
  return true;
}

export function getYouTubeOAuthSessionStatus() {
  if (!accessToken) return 'disconnected';
  if (accessTokenClientId !== readYouTubeOAuthClientId()) return 'disconnected';
  return accessTokenExpiresAt > Date.now() ? 'connected' : 'expired';
}

export function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) {
    identityServicesReady = true;
    return Promise.resolve(true);
  }
  if (identityServicesPromise) return identityServicesPromise;

  identityServicesPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`);
    const script = existing || document.createElement('script');
    const finish = () => {
      if (window.google?.accounts?.oauth2) {
        identityServicesReady = true;
        resolve(true);
      } else {
        reject(new YouTubeOAuthError('google_identity_services_unavailable', 'Google sign-in could not be loaded in this browser.'));
      }
    };
    const fail = () => reject(new YouTubeOAuthError('google_identity_services_unavailable', 'Could not load Google Identity Services. Check the browser connection and try again.'));

    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (window.google?.accounts?.oauth2) {
      finish();
    }
  }).catch(error => {
    identityServicesPromise = null;
    throw error;
  });
  return identityServicesPromise;
}

export function isGoogleIdentityServicesReady() {
  return identityServicesReady && !!window.google?.accounts?.oauth2;
}

export async function requestYouTubeAccessToken(clientId) {
  const validClientId = normalizeClientId(clientId);
  if (!isGoogleIdentityServicesReady()) {
    throw new YouTubeOAuthError('google_identity_services_not_ready', 'Save the Google client ID and wait for Google sign-in to load, then connect again.');
  }
  if (accessToken && accessTokenClientId === validClientId && accessTokenExpiresAt > Date.now() + 30_000) return accessToken;
  clearYouTubeOAuthSession();

  return new Promise((resolve, reject) => {
    let tokenClient;
    try {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: validClientId,
        scope: YOUTUBE_READ_SCOPE,
        callback: response => {
          if (response?.error || !response?.access_token) {
            accessToken = '';
            accessTokenExpiresAt = 0;
            reject(new YouTubeOAuthError(
              `youtube_oauth_${String(response?.error || 'failed').replace(/[^a-z0-9_-]/gi, '_')}`,
              response?.error === 'access_denied'
                ? 'Google sign-in was cancelled.'
                : 'Google could not provide YouTube read access. Check the OAuth client and consent-screen setup.'
            ));
            return;
          }
          const expiresIn = Number(response.expires_in);
          if (!Number.isFinite(expiresIn) || expiresIn < 30 || expiresIn > 86_400) {
            reject(new YouTubeOAuthError('youtube_oauth_token_invalid', 'Google returned an invalid YouTube access token.'));
            return;
          }
          accessToken = String(response.access_token);
          accessTokenExpiresAt = Date.now() + expiresIn * 1000;
          accessTokenClientId = validClientId;
          resolve(accessToken);
        },
        error_callback: error => {
          reject(new YouTubeOAuthError(
            `youtube_oauth_${String(error?.type || 'popup_failed').replace(/[^a-z0-9_-]/gi, '_')}`,
            'Google sign-in could not open. Allow the sign-in popup and try again.'
          ));
        }
      });
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (_) {
      reject(new YouTubeOAuthError('youtube_oauth_start_failed', 'Google sign-in could not be started. Try again.'));
    }
  });
}

export function getYouTubeAccessToken(clientId = readYouTubeOAuthClientId()) {
  if (accessTokenClientId !== clientId) {
    clearYouTubeOAuthSession();
    return '';
  }
  if (accessToken && accessTokenExpiresAt > Date.now() + 30_000) return accessToken;
  if (accessTokenExpiresAt <= Date.now()) clearYouTubeOAuthSession();
  return '';
}
