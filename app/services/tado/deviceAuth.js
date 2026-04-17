/**
 * Tado Device Code Flow (OAuth 2.0)
 *
 * Tado hat den Password-Grant fuer Tado X und neuere V3-Installationen abgeschaltet.
 * Stattdessen wird der Device Code Flow verwendet:
 *
 *   1. POST /oauth2/device_authorize -> device_code + verification_uri
 *   2. User oeffnet verification_uri im Browser und bestaetigt
 *   3. Poll POST /oauth2/token mit device_code bis Authorisierung abgeschlossen
 *   4. Refresh-Token wird danach persistiert (tokenPersist.js)
 *
 * Client-ID / Secret kommen aus ENV, mit Community-Default.
 */

const DEVICE_URL = process.env.TADO_DEVICE_URL || 'https://login.tado.com/oauth2/device_authorize';
const TOKEN_URL  = process.env.TADO_TOKEN_URL  || 'https://login.tado.com/oauth2/token';

// Community-bekannte Client-ID der Tado-App. Kann per ENV ueberschrieben werden,
// falls der User einen eigenen registrierten Tado-Developer-Account hat.
const CLIENT_ID     = process.env.TADO_CLIENT_ID     || '1bb50063-6b0c-4d11-bd99-387f4a91cc46';
const CLIENT_SECRET = process.env.TADO_CLIENT_SECRET || null;

const SCOPE = 'offline_access';
const FETCH_TIMEOUT_MS = 10 * 1000;

async function withTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function buildParams(extra = {}) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    ...extra
  });
  if (CLIENT_SECRET) params.set('client_secret', CLIENT_SECRET);
  return params;
}

/**
 * Startet den Device Code Flow.
 * @returns {Promise<{ deviceCode, userCode, verificationUri, verificationUriComplete, expiresIn, interval }>}
 */
async function startDeviceAuthorization() {
  const params = buildParams({ scope: SCOPE });

  const res = await withTimeout(signal => fetch(DEVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal
  }));

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Device-Authorize fehlgeschlagen (${res.status}): ${JSON.stringify(body).slice(0, 200)}`
    );
  }

  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    verificationUriComplete: body.verification_uri_complete || body.verification_uri,
    expiresIn: body.expires_in,
    interval: body.interval || 5
  };
}

/**
 * Poll einmalig den Token-Endpoint fuer einen laufenden Device Flow.
 *
 * @returns {Promise<{ status: 'pending'|'success'|'expired'|'error', token?, error? }>}
 */
async function pollDeviceToken(deviceCode) {
  const params = buildParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: deviceCode
  });

  const res = await withTimeout(signal => fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal
  }));

  const body = await res.json().catch(() => ({}));

  // Debug-Log: zeigt uns die Roh-Antwort von Tado fuer jede Poll-Runde
  console.log(`[Tado Device Poll] HTTP ${res.status} | body:`,
    JSON.stringify(body).slice(0, 300));

  if (res.ok && body.access_token) {
    return {
      status: 'success',
      token: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token || null,
        expiresIn: body.expires_in
      }
    };
  }

  const err = body.error || 'unknown_error';
  if (err === 'authorization_pending' || err === 'slow_down') {
    return { status: 'pending' };
  }
  if (err === 'expired_token') {
    return { status: 'expired', error: 'Device Code abgelaufen' };
  }
  return {
    status: 'error',
    error: body.error_description || err,
    httpStatus: res.status,
    rawError: body.error,
    details: body
  };
}

/**
 * Tauscht einen Refresh-Token gegen einen neuen Access-Token.
 */
async function refreshAccessToken(refreshToken) {
  const params = buildParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  const res = await withTimeout(signal => fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal
  }));

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Refresh fehlgeschlagen (${res.status}): ${JSON.stringify(body).slice(0, 200)}`
    );
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || refreshToken, // Tado rotiert den Refresh-Token
    expiresIn: body.expires_in
  };
}

// ── Geteilte Apartment-Level-Orchestrierung ────────────────────────────────
// Wird von v3Client und xClient genutzt. Tado V3 und X teilen sich Auth,
// nur die Data-Endpoints unterscheiden sich.

const tokenStore = require('./tokenStore');
const tokenPersist = require('./tokenPersist');

// pendingDeviceAuth: apartmentId -> { deviceCode, verificationUri, expiresAt }
const pendingDeviceAuth = new Map();

function credKeyFor(apartmentId) {
  return `tado:${apartmentId}`;
}

async function ensureAccessToken(apartmentId) {
  const credKey = credKeyFor(apartmentId);
  const cached = tokenStore.get(credKey);
  if (tokenStore.isFresh(cached)) {
    return { credKey, accessToken: cached.accessToken };
  }

  const refreshToken = tokenPersist.getRefreshToken(apartmentId);
  if (!refreshToken) {
    throw Object.assign(
      new Error('Tado ist nicht autorisiert. Bitte zuerst /auth/start aufrufen.'),
      { status: 401, code: 'NOT_AUTHORIZED' }
    );
  }

  try {
    const newToken = await refreshAccessToken(refreshToken);
    tokenStore.set(credKey, newToken);
    if (newToken.refreshToken && newToken.refreshToken !== refreshToken) {
      tokenPersist.setRefreshToken(apartmentId, newToken.refreshToken);
    }
    return { credKey, accessToken: newToken.accessToken };
  } catch (err) {
    tokenPersist.remove(apartmentId);
    tokenStore.remove(credKey);
    throw Object.assign(
      new Error('Tado Refresh-Token abgelaufen. Bitte erneut autorisieren.'),
      { status: 401, code: 'REAUTH_REQUIRED' }
    );
  }
}

async function startAuth(apartmentId) {
  const result = await startDeviceAuthorization();
  pendingDeviceAuth.set(apartmentId, {
    deviceCode: result.deviceCode,
    verificationUri: result.verificationUri,
    verificationUriComplete: result.verificationUriComplete,
    userCode: result.userCode,
    expiresAt: Date.now() + (result.expiresIn || 300) * 1000,
    interval: result.interval
  });
  return {
    verificationUri: result.verificationUri,
    verificationUriComplete: result.verificationUriComplete,
    userCode: result.userCode,
    expiresIn: result.expiresIn
  };
}

async function pollAuth(apartmentId) {
  const pending = pendingDeviceAuth.get(apartmentId);
  if (!pending) {
    return { status: 'not_started' };
  }
  if (Date.now() > pending.expiresAt) {
    pendingDeviceAuth.delete(apartmentId);
    return { status: 'expired' };
  }

  const result = await pollDeviceToken(pending.deviceCode);
  if (result.status === 'success') {
    pendingDeviceAuth.delete(apartmentId);
    const credKey = credKeyFor(apartmentId);
    tokenStore.set(credKey, result.token);
    if (result.token.refreshToken) {
      tokenPersist.setRefreshToken(apartmentId, result.token.refreshToken);
    }
    return { status: 'success' };
  }
  if (result.status === 'error') {
    pendingDeviceAuth.delete(apartmentId);
    return { status: 'error', error: result.error, httpStatus: result.httpStatus, rawError: result.rawError, details: result.details };
  }
  return { status: result.status };
}

function isAuthorized(apartmentId) {
  return tokenPersist.hasToken(apartmentId);
}

function disconnect(apartmentId) {
  tokenPersist.remove(apartmentId);
  tokenStore.remove(credKeyFor(apartmentId));
  pendingDeviceAuth.delete(apartmentId);
}

module.exports = {
  // OAuth-Primitives
  startDeviceAuthorization,
  pollDeviceToken,
  refreshAccessToken,
  // Shared Apartment-Orchestrierung
  ensureAccessToken,
  startAuth,
  pollAuth,
  isAuthorized,
  disconnect,
  credKeyFor,
  // Intern fuer Tests / Debug
  _config: () => ({ CLIENT_ID, CLIENT_SECRET: CLIENT_SECRET ? '(set)' : '(not set)', DEVICE_URL, TOKEN_URL })
};
