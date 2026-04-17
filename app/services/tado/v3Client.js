/**
 * Tado V3 HTTP Client
 *
 * Auth: Geteilter Device Code Flow via deviceAuth.js (gleiche Mechanik wie X)
 * Data: my.tado.com/api/v2 (Zonen-basiert, klassisches V3-Schema)
 *
 * Rate-Limit-Tracking: gleitendes 24h-Fenster, 100/Tag.
 */

const fs = require('fs');
const deviceAuth = require('./deviceAuth');
const { TADO_LAST_RESPONSE: DUMP_PATH } = require('../../config-path');

const API_BASE = 'https://my.tado.com/api/v2';
const FETCH_TIMEOUT_MS = 10 * 1000;

const requestLog = new Map();
const lastHeaders = new Map();

// Parst RFC 9239 "ratelimit" Header im Structured-Field-Format
//   ratelimit: "perday";r=880
//   ratelimit-policy: "perday";q=1000;w=86400
// Fallback auch auf aeltere x-ratelimit-* Header.
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

  // Fallback: ältere Header
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
    // "used" ergibt sich aus limit - remaining
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
      used: header.used,             // limit - remaining, von Tado berechnet
      remaining: header.remaining,   // direkt von Tado
      limit: header.limit,           // direkt von Tado
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
    console.error('[Tado V3] Dump-Write fehlgeschlagen:', err.message);
  }
}

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
      if (!BORING_HEADERS.has(key.toLowerCase())) obj[key] = value;
    }
  } catch (err) {}
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

  console.log(`[Tado V3 GET] ${url} → ${res.status}${headerList ? ' | ' + headerList : ''} | ${preview}`);

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

async function apiGet(path, accessToken, credKey) {
  const url = `${API_BASE}${path}`;
  const r = await rawGet(url, accessToken);
  if (r.status === 401) {
    throw Object.assign(new Error(`Tado V3 Unauthorized bei ${url}`), { status: 401 });
  }
  if (!r.ok) {
    throw new Error(`Tado V3 API-Fehler ${r.status} bei ${path}: ${(r.text || '').slice(0, 160)}`);
  }
  trackRequest(credKey, r.headers);
  return r.body;
}

async function apiWrite(method, path, body, accessToken, credKey) {
  const url = `${API_BASE}${path}`;
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
  console.log(`[Tado V3 ${method}] ${url} → ${res.status} ${Object.entries(interesting).map(([k,v])=>k+'='+v).join(' ')}`);
  appendDump({ url, method, status: res.status, ok: res.ok, body: body || null, at: new Date().toISOString(), headers: interesting });

  if (res.status === 401) {
    throw Object.assign(new Error(`Tado V3 Unauthorized bei ${url}`), { status: 401 });
  }
  if (res.status === 429) {
    throw Object.assign(new Error(`Tado V3 Rate-Limit exhausted bei ${url}`), { status: 429 });
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Tado V3 ${method}-Fehler ${res.status} bei ${path}: ${txt.slice(0, 160)}`);
  }
  trackRequest(credKey, res.headers);
  // PUT/DELETE koennen leeren Body zurueckliefern
  return res.json().catch(() => ({}));
}

/**
 * HomeId via /me ermitteln. Werte < 100 in der Config werden ignoriert (Testwerte).
 */
async function resolveHomeId(cfg, accessToken, credKey) {
  const configuredId = Number(cfg.homeId);
  if (configuredId && configuredId >= 100) {
    return configuredId;
  }

  const r = await rawGet(`${API_BASE}/me`, accessToken);
  if (r.status === 401) {
    throw Object.assign(new Error('Tado V3 Unauthorized bei /me'), { status: 401 });
  }
  if (!r.ok) {
    throw new Error(`Tado V3 /me fehlgeschlagen (${r.status}): ${(r.text || '').slice(0, 160)}`);
  }
  if (r.body && Array.isArray(r.body.homes) && r.body.homes.length > 0) {
    const id = r.body.homes[0].id;
    console.log(`[Tado V3] /me liefert ${r.body.homes.length} Home(s), benutze id=${id}`);
    return id;
  }
  throw new Error('Tado V3 /me liefert keine Homes');
}

/**
 * Haupt-Einstieg: holt alle Wohnungsdaten via Device-Auth.
 *
 * @param {object} cfg  { apartmentId, homeId? }
 * @returns {Promise<{ raw: { home, zones }, rateLimit, homeId }>}
 */
async function fetchHomeData(cfg) {
  const apartmentId = cfg.apartmentId;
  if (!apartmentId) throw new Error('apartmentId fehlt in Tado-V3-Aufruf');

  let { credKey, accessToken } = await deviceAuth.ensureAccessToken(apartmentId);

  async function fetchAll(accessToken) {
    const homeId = await resolveHomeId(cfg, accessToken, credKey);

    // Optimiert: 3 Calls statt 4+N.
    //   1) /state        – presence (ersetzt den separaten /homes/{id}-Call)
    //   2) /zones        – Raumliste inkl. Device-Metadaten
    //   3) /zoneStates   – ALLE Raum-States in einem einzigen Call
    //
    // Vorher: /me (bei unbekanntem homeId) + /homes/{id} + /state + /zones + N*/state
    // Jetzt:  /me (opt.)                   + /state       + /zones + /zoneStates
    //
    // Fuer eine Wohnung mit z.B. 5 Zonen sparen wir 6 Calls pro Refresh — bei
    // 15-min Auto-Refresh macht das ~575/Tag -> ~285/Tag pro V3-Wohnung.
    let presence = null;
    try {
      const state = await apiGet(`/homes/${homeId}/state`, accessToken, credKey);
      if (state && state.presence) presence = state.presence;
    } catch (err) {
      console.log('[Tado V3] state-fetch uebersprungen:', err.message);
    }

    const zones = await apiGet(`/homes/${homeId}/zones`, accessToken, credKey);

    // Bulk zone states
    let zoneStatesById = {};
    try {
      const bulk = await apiGet(`/homes/${homeId}/zoneStates`, accessToken, credKey);
      if (bulk && bulk.zoneStates && typeof bulk.zoneStates === 'object') {
        zoneStatesById = bulk.zoneStates;
      }
    } catch (err) {
      // Fallback: einige Tado-Accounts liefern zoneStates nicht aus →
      // zurueck zum klassischen N-Call-Pfad. Kein Crash.
      console.warn('[Tado V3] /zoneStates nicht verfuegbar, fallback auf per-zone:', err.message);
      const perZone = await Promise.all(
        zones.map(z => apiGet(`/homes/${homeId}/zones/${z.id}/state`, accessToken, credKey))
      );
      zoneStatesById = {};
      zones.forEach((z, i) => { zoneStatesById[z.id] = perZone[i]; });
    }

    return {
      raw: {
        home: { presence }, // minimaler Stub — Normalizer liest nur presence
        zones: zones.map(z => ({ ...z, state: zoneStatesById[z.id] || null }))
      },
      homeId
    };
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
 * Setzt einen Raum-Overlay auf OFF (manuelle Kontrolle bis zum naechsten
 * Plan-Wechsel oder bis "Plan fortsetzen").
 */
async function setZoneOff(apartmentId, homeId, zoneId) {
  const deviceAuth = require('./deviceAuth');
  const { credKey, accessToken } = await deviceAuth.ensureAccessToken(apartmentId);
  const body = {
    setting: { type: 'HEATING', power: 'OFF' },
    termination: { type: 'MANUAL' }
  };
  return apiWrite('PUT', `/homes/${homeId}/zones/${zoneId}/overlay`, body, accessToken, credKey);
}

/**
 * Loescht den Overlay eines Raums → Raum folgt wieder dem Zeitplan.
 */
async function resumeZone(apartmentId, homeId, zoneId) {
  const deviceAuth = require('./deviceAuth');
  const { credKey, accessToken } = await deviceAuth.ensureAccessToken(apartmentId);
  return apiWrite('DELETE', `/homes/${homeId}/zones/${zoneId}/overlay`, null, accessToken, credKey);
}

/**
 * Setzt die Wohnungs-Presence auf HOME oder AWAY.
 */
async function setPresence(apartmentId, homeId, presence) {
  const deviceAuth = require('./deviceAuth');
  const { credKey, accessToken } = await deviceAuth.ensureAccessToken(apartmentId);
  const body = { homePresence: presence === 'AWAY' ? 'AWAY' : 'HOME' };
  return apiWrite('PUT', `/homes/${homeId}/presenceLock`, body, accessToken, credKey);
}

// ── Auth-Wrappers fuer Backwards-Kompatibilitaet ────────────────────────────
const startAuth = (id) => deviceAuth.startAuth(id);
const pollAuth = (id) => deviceAuth.pollAuth(id);
const isAuthorized = (id) => deviceAuth.isAuthorized(id);
const disconnect = (id) => deviceAuth.disconnect(id);

// Password-Grant ist deprecated und liefert sofort einen sprechenden Fehler
async function loginWithPassword() {
  throw new Error('Tado V3 Password-Grant ist deaktiviert. Bitte Device Code Flow nutzen: POST /api/tado/:id/auth/start');
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
  _getRateLimit: getRateLimit,
  _trackRequest: trackRequest
};
