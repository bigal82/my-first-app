/**
 * Tado X HTTP Client (hops.tado.com)
 *
 * Auth: Geteilter Device Code Flow via deviceAuth.js
 * Data: hops.tado.com/homes/{id}/rooms (Tado X Endpoint)
 *       my.tado.com/api/v2/homes/{id} (Home + Presence)
 *
 * Rate-Limit-Tracking: gleitendes 24h-Fenster, 100/Tag.
 */

const fs = require('fs');
const deviceAuth = require('./deviceAuth');
const { TADO_LAST_RESPONSE: DUMP_PATH } = require('../../config-path');

const API_BASE = 'https://hops.tado.com/homes';
const FETCH_TIMEOUT_MS = 10 * 1000;

// Pro credKey: eigener Request-Log + zuletzt gesehene Header-Werte von Tado
const requestLog = new Map();
const lastHeaders = new Map(); // credKey -> { limit, remaining, resetAt, source }

// Parst RFC 9239 "ratelimit" Header im Structured-Field-Format
//   ratelimit: "perday";r=880
//   ratelimit-policy: "perday";q=1000;w=86400
function parseRateLimitHeaders(headers) {
  if (!headers || typeof headers.get !== 'function') return null;

  const rlVal = headers.get('ratelimit');
  const policyVal = headers.get('ratelimit-policy');

  let remaining = null, limit = null, windowSec = null;

  if (rlVal) {
    const m = /r=(\d+)/.exec(rlVal);
    if (m) remaining = Number(m[1]);
  }
  if (policyVal) {
    const q = /q=(\d+)/.exec(policyVal);
    if (q) limit = Number(q[1]);
    const w = /w=(\d+)/.exec(policyVal);
    if (w) windowSec = Number(w[1]);
  }

  if (limit === null) {
    const l = headers.get('x-ratelimit-limit') || headers.get('ratelimit-limit');
    if (l) limit = Number(l);
  }
  if (remaining === null) {
    const r = headers.get('x-ratelimit-remaining') || headers.get('ratelimit-remaining');
    if (r) remaining = Number(r);
  }

  if (limit === null && remaining === null) return null;

  return {
    limit,
    remaining,
    windowSec,
    used: (limit !== null && remaining !== null) ? limit - remaining : null
  };
}

function trackRequest(credKey, headers) {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const log = (requestLog.get(credKey) || []).filter(t => t > cutoff);
  log.push(now);
  requestLog.set(credKey, log);

  const parsed = parseRateLimitHeaders(headers);
  if (parsed) lastHeaders.set(credKey, { ...parsed, fetchedAt: new Date().toISOString() });
}

function getRateLimit(credKey) {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const log = (requestLog.get(credKey) || []).filter(t => t > cutoff);
  const header = lastHeaders.get(credKey);

  if (header) {
    return {
      used: header.used,
      remaining: header.remaining,
      limit: header.limit,
      windowSec: header.windowSec,
      fetchedAt: header.fetchedAt,
      source: 'header'
    };
  }
  return {
    used: log.length,
    remaining: null,
    limit: null,
    windowSec: 86400,
    fetchedAt: new Date().toISOString(),
    source: 'count'
  };
}

async function withTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function appendDump(entry) {
  try {
    let state = { responses: [] };
    if (fs.existsSync(DUMP_PATH)) {
      try { state = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf-8')); } catch {}
    }
    state.responses = state.responses || [];
    state.responses.push(entry);
    if (state.responses.length > 30) state.responses.shift();
    fs.writeFileSync(DUMP_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Tado X] Dump-Write fehlgeschlagen:', err.message);
  }
}

// Nur intern nuetzliche Header ausklammern – alles andere loggen, um Tado-spezifische
// Rate-Limit-Felder zu finden
const BORING_HEADERS = new Set([
  'content-type', 'content-length', 'connection', 'date', 'server',
  'strict-transport-security', 'cache-control', 'pragma', 'expires',
  'set-cookie', 'vary', 'content-encoding', 'etag', 'last-modified',
  'access-control-allow-origin', 'access-control-allow-credentials',
  'access-control-expose-headers', 'x-content-type-options',
  'x-frame-options', 'x-xss-protection'
]);

function collectInterestingHeaders(headers) {
  const obj = {};
  try {
    for (const [key, value] of headers) {
      if (!BORING_HEADERS.has(key.toLowerCase())) {
        obj[key] = value;
      }
    }
  } catch (err) {
    // headers.entries() failed – ignoriere
  }
  return obj;
}

async function rawGet(url, accessToken) {
  const res = await withTimeout(signal => fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
    signal
  }));
  const body = res.ok ? await res.json().catch(() => null) : null;
  const text = res.ok ? null : await res.text().catch(() => '');
  const preview = res.ok
    ? (body ? JSON.stringify(body).slice(0, 300) : '<empty>')
    : (text || '').slice(0, 200);

  const interesting = collectInterestingHeaders(res.headers);
  const headerList = Object.keys(interesting).length
    ? Object.entries(interesting).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';

  console.log(`[Tado X GET] ${url} → ${res.status}${headerList ? ' | ' + headerList : ''} | ${preview}`);

  appendDump({
    url,
    status: res.status,
    ok: res.ok,
    body: res.ok ? body : text,
    at: new Date().toISOString(),
    headers: interesting
  });
  return { ok: res.ok, status: res.status, body, text, headers: res.headers };
}

async function apiGet(p, accessToken, credKey) {
  const url = `${API_BASE}${p}`;
  const r = await rawGet(url, accessToken);
  if (r.status === 401) {
    throw Object.assign(new Error(`Tado X Unauthorized bei ${url}`), { status: 401 });
  }
  if (!r.ok) {
    throw new Error(`Tado X API-Fehler ${r.status} bei ${p}: ${(r.text || '').slice(0, 160)}`);
  }
  trackRequest(credKey, r.headers);
  return r.body;
}

async function apiWrite(method, url, body, accessToken, credKey) {
  const res = await withTimeout(signal => fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal
  }));

  const interesting = collectInterestingHeaders(res.headers);
  console.log(`[Tado X ${method}] ${url} → ${res.status} ${Object.entries(interesting).map(([k,v])=>k+'='+v).join(' ')}`);
  appendDump({ url, method, status: res.status, ok: res.ok, body: body || null, at: new Date().toISOString(), headers: interesting });

  if (res.status === 401) {
    throw Object.assign(new Error(`Tado X Unauthorized bei ${url}`), { status: 401 });
  }
  if (res.status === 429) {
    throw Object.assign(new Error(`Tado X Rate-Limit exhausted bei ${url}`), { status: 429 });
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Tado X ${method}-Fehler ${res.status}: ${txt.slice(0, 160)}`);
  }
  trackRequest(credKey, res.headers);
  return res.json().catch(() => ({}));
}

async function resolveHomeId(cfg, accessToken, credKey) {
  const configuredId = Number(cfg.homeId);
  if (configuredId && configuredId >= 100) return configuredId;

  const r = await rawGet('https://my.tado.com/api/v2/me', accessToken);
  if (r.status === 401) {
    throw Object.assign(new Error('Tado X Unauthorized bei /me'), { status: 401 });
  }
  if (!r.ok) {
    throw new Error(`Tado /me fehlgeschlagen (${r.status})`);
  }
  if (r.body && Array.isArray(r.body.homes) && r.body.homes.length > 0) {
    const id = r.body.homes[0].id;
    console.log(`[Tado X] /me liefert ${r.body.homes.length} Home(s), benutze id=${id}`);
    return id;
  }
  throw new Error('Tado /me liefert keine Homes');
}

async function fetchHomeData(cfg) {
  const apartmentId = cfg.apartmentId;
  if (!apartmentId) throw new Error('apartmentId fehlt in Tado-X-Aufruf');

  let { credKey, accessToken } = await deviceAuth.ensureAccessToken(apartmentId);

  async function fetchAll(accessToken) {
    const homeId = await resolveHomeId(cfg, accessToken, credKey);

    // Home-Level-Info kommt von my.tado.com/api/v2
    const homeRes = await rawGet(`https://my.tado.com/api/v2/homes/${homeId}`, accessToken);
    if (homeRes.status === 401) {
      throw Object.assign(new Error(`Tado X Unauthorized bei /homes/${homeId}`), { status: 401 });
    }
    if (!homeRes.ok) {
      throw new Error(`Home-Info fehlgeschlagen (${homeRes.status}): ${(homeRes.text || '').slice(0, 160)}`);
    }
    trackRequest(credKey, homeRes.headers);
    const home = homeRes.body || {};

    // Presence (HOME/AWAY) aus /homes/{id}/state. Nicht fatal wenn fehlt.
    try {
      const stateRes = await rawGet(`https://my.tado.com/api/v2/homes/${homeId}/state`, accessToken);
      if (stateRes.ok && stateRes.body) {
        home.state = stateRes.body;
        if (stateRes.body.presence) home.presence = stateRes.body.presence;
        trackRequest(credKey, stateRes.headers);
      }
    } catch (err) {
      console.log('[Tado X] presence-fetch uebersprungen:', err.message);
    }

    // Raumliste kommt von hops.tado.com/homes/{id}/rooms
    const rooms = await apiGet(`/${homeId}/rooms`, accessToken, credKey);

    return { raw: { home, rooms }, homeId };
  }

  try {
    const { raw, homeId } = await fetchAll(accessToken);
    return { raw, rateLimit: getRateLimit(credKey), homeId };
  } catch (err) {
    if (err.status === 401) {
      ({ credKey, accessToken } = await deviceAuth.ensureAccessToken(apartmentId));
      const { raw, homeId } = await fetchAll(accessToken);
      return { raw, rateLimit: getRateLimit(credKey), homeId };
    }
    throw err;
  }
}

// ── Schreib-Aktionen (PROJ-6) ───────────────────────────────────────────────

/**
 * Setzt einen Raum-Overlay auf OFF (hops.tado.com manualControl).
 *
 * Hinweis: Die hops-API ist nicht offiziell dokumentiert. Falls der Pfad
 * unterschiedlich ist, loggt rawGet die Fehlermeldung und wir koennen
 * schnell anpassen.
 */
async function setZoneOff(apartmentId, homeId, roomId) {
  const { credKey, accessToken } = await deviceAuth.ensureAccessToken(apartmentId);
  // Tado X erwartet POST auf manualControl (PUT liefert 405 method.not.allowed).
  // DELETE dagegen wird fuer "Plan fortsetzen" verwendet.
  const body = {
    setting: { type: 'HEATING', power: 'OFF' },
    termination: { type: 'MANUAL' }
  };
  return apiWrite('POST', `https://hops.tado.com/homes/${homeId}/rooms/${roomId}/manualControl`, body, accessToken, credKey);
}

/**
 * Beendet manuelle Kontrolle eines Raums → zurueck zum Zeitplan.
 */
async function resumeZone(apartmentId, homeId, roomId) {
  const { credKey, accessToken } = await deviceAuth.ensureAccessToken(apartmentId);
  return apiWrite('DELETE', `https://hops.tado.com/homes/${homeId}/rooms/${roomId}/manualControl`, null, accessToken, credKey);
}

/**
 * Setzt die Wohnungs-Presence auf HOME oder AWAY.
 * Nutzt my.tado.com/api/v2/homes/{id}/presenceLock, das fuer beide Varianten
 * funktioniert.
 */
async function setPresence(apartmentId, homeId, presence) {
  const { credKey, accessToken } = await deviceAuth.ensureAccessToken(apartmentId);
  const body = { homePresence: presence === 'AWAY' ? 'AWAY' : 'HOME' };
  return apiWrite('PUT', `https://my.tado.com/api/v2/homes/${homeId}/presenceLock`, body, accessToken, credKey);
}

// ── Auth-Wrappers via shared deviceAuth ─────────────────────────────────────
const startAuth = (id) => deviceAuth.startAuth(id);
const pollAuth = (id) => deviceAuth.pollAuth(id);
const isAuthorized = (id) => deviceAuth.isAuthorized(id);
const disconnect = (id) => deviceAuth.disconnect(id);

async function loginWithPassword() {
  throw new Error('Tado X Password-Grant ist deaktiviert. Bitte Device Code Flow nutzen.');
}

function _clearRateLimits() { requestLog.clear(); }

module.exports = {
  fetchHomeData,
  setZoneOff,
  resumeZone,
  setPresence,
  startAuth,
  pollAuth,
  isAuthorized,
  disconnect,
  loginWithPassword,
  _clearRateLimits,
  _getRateLimit: getRateLimit
};
