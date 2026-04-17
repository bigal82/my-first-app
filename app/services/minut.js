/**
 * Minut Service (PROJ-7 Dashboard-Widget, PROJ-8 Detailseite)
 *
 * Auth: OAuth 2.0 Client Credentials Flow
 * Endpoints: https://api.minut.com/v8
 *
 * Credentials kommen aus integrationsStore (config/integrations.json oder ENV-Fallback).
 * Token wird im RAM gecacht und bei Bedarf erneuert.
 * Gerätedaten werden 30 Minuten pro deviceId gecacht (Stale-Fallback bei Fehlern).
 */

const integrationsStore = require('./integrationsStore');
const minutNormalizer = require('../normalizers/minut');
const downsample = require('./downsample');

const AUTH_URL = 'https://api.minut.com/v8/oauth/token';
const API_BASE = 'https://api.minut.com/v8';
const FETCH_TIMEOUT_MS = 10 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000;

// In-Memory Token (single slot – geteilter Account fuer alle Wohnungen)
let cachedToken = null; // { accessToken, expiresAt }

// Daten-Cache: deviceId -> { data, fetchedAt }
const dataCache = new Map();
const inFlight = new Map();

// History-Cache: `${deviceId}:${range}` -> { data, fetchedAt }
const historyCache = new Map();
const historyInFlight = new Map();
const HISTORY_TTL_MS = 10 * 60 * 1000; // 10 min

// Noise-Profile-Cache: deviceId -> { data, fetchedAt }
const noiseProfileCache = new Map();
const NOISE_PROFILE_TTL_MS = 60 * 60 * 1000; // 60 min

async function withTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function requireCredentials() {
  const cfg = integrationsStore.getMinut();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw Object.assign(
      new Error('Minut-Zugangsdaten fehlen. Bitte in Setup hinterlegen.'),
      { status: 503, code: 'NO_CREDENTIALS' }
    );
  }
  return cfg;
}

async function fetchAccessToken(cfg) {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret
  });

  const res = await withTimeout(signal => fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal
  }));

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Minut Auth fehlgeschlagen (${res.status}): ${JSON.stringify(body).slice(0, 200)}`
    );
  }

  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in || 3600) * 1000) - 60 * 1000
  };
}

let tokenFetchInFlight = null;

async function ensureToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  // In-Flight-Dedup: wenn bereits ein Token-Fetch laeuft, darauf warten
  // statt einen zweiten zu starten. Verhindert Race-Conditions beim
  // Cold-Start wenn das Dashboard parallel mehrere Minut-Requests feuert.
  if (tokenFetchInFlight) {
    await tokenFetchInFlight;
    return cachedToken.accessToken;
  }
  const cfg = requireCredentials();
  tokenFetchInFlight = fetchAccessToken(cfg);
  try {
    cachedToken = await tokenFetchInFlight;
    return cachedToken.accessToken;
  } finally {
    tokenFetchInFlight = null;
  }
}

async function apiGet(path) {
  const token = await ensureToken();
  const res = await withTimeout(signal => fetch(`${API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal
  }));

  if (res.status === 401) {
    // Token ungueltig → einmal neu holen
    cachedToken = null;
    const retryToken = await ensureToken();
    const retry = await withTimeout(signal => fetch(`${API_BASE}${path}`, {
      headers: { 'Authorization': `Bearer ${retryToken}` },
      signal
    }));
    if (!retry.ok) {
      throw new Error(`Minut API-Fehler ${retry.status} bei ${path}`);
    }
    return retry.json();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Minut API-Fehler ${res.status} bei ${path}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

/**
 * Listet alle Minut-Geraete des Accounts.
 * Ruft parallel /homes und /devices auf und baut „Home - Device" Labels.
 * Wird fuer das Setup-Dropdown benoetigt.
 */
async function listDevices() {
  const [homesBody, devicesBody] = await Promise.all([
    apiGet('/homes').catch(() => null),
    apiGet('/devices')
  ]);

  // Home-ID → Home-Name Map
  const homeMap = {};
  if (homesBody) {
    const homes = homesBody.homes || homesBody || [];
    for (const h of homes) {
      const id = h.home_id || h.id;
      if (id) homeMap[id] = h.name || h.home_name || '';
    }
  }

  const devices = devicesBody.devices || devicesBody || [];
  return devices.map(d => {
    const deviceId = d.device_id || d.id;
    const rawName = d.description || d.device_name || d.name || '(unbenannt)';
    const homeId = d.home_id || d.home || (d.home && d.home.id);
    const homeName = homeId ? homeMap[homeId] : '';
    const label = homeName ? `${homeName} · ${rawName}` : rawName;

    return {
      id: deviceId,
      name: label,
      homeName: homeName || null,
      deviceName: rawName,
      type: d.device_type || d.type || 'Sensor'
    };
  });
}

/**
 * Liefert den Status eines einzelnen Geraets (fuer Dashboard-Widget).
 * Cached 30 Minuten pro deviceId, Stale-Fallback bei Fehler.
 */
async function getDeviceStatus(deviceId) {
  if (!deviceId) throw new Error('deviceId fehlt');

  // Cache frisch?
  const cached = dataCache.get(deviceId);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return { ...cached.data, cached: true, stale: false };
  }

  // In-Flight-Dedup
  if (inFlight.has(deviceId)) {
    try {
      const data = await inFlight.get(deviceId);
      return { ...data, cached: false, stale: false };
    } catch (err) {
      // faellt unten zum Stale-Fallback durch
    }
  }

  const p = (async () => {
    const raw = await apiGet(`/devices/${encodeURIComponent(deviceId)}`);
    const normalized = minutNormalizer.normalizeDevice(raw);
    dataCache.set(deviceId, { data: normalized, fetchedAt: Date.now() });
    return normalized;
  })();

  inFlight.set(deviceId, p);
  try {
    const data = await p;
    return { ...data, cached: false, stale: false };
  } catch (err) {
    if (cached) {
      return { ...cached.data, cached: true, stale: true, error: err.message };
    }
    throw err;
  } finally {
    inFlight.delete(deviceId);
  }
}

/**
 * Testet die Credentials – laedt einfach einen Token und die Device-Liste.
 * Gibt Anzahl der Geraete zurueck oder wirft Fehler.
 */
async function testConnection() {
  cachedToken = null; // erzwinge frischen Token-Fetch
  await ensureToken();
  const devices = await listDevices();
  return { ok: true, deviceCount: devices.length, devices };
}

function _clearCaches() {
  cachedToken = null;
  dataCache.clear();
  inFlight.clear();
  historyCache.clear();
  historyInFlight.clear();
  noiseProfileCache.clear();
}

// Fuer PROJ-10 Status-Aggregation: Lesezugriff auf den Device-Cache
function _getDeviceCacheEntry(deviceId) {
  return dataCache.get(deviceId) || null;
}

// ── PROJ-8: History + Noise-Profile ─────────────────────────────────────────

function rangeToWindow(range) {
  const now = Date.now();
  if (range === '30d') return { startMs: now - 30 * 86400000, endMs: now };
  if (range === '7d')  return { startMs: now - 7  * 86400000, endMs: now };
  return                      { startMs: now - 24 * 3600000,  endMs: now }; // 24h default
}

async function fetchMotion(deviceId, startIso, endIso, range) {
  // Minut /motion_events erwartet time_resolution als Zahl in SEKUNDEN.
  // 24h → 15 min  · 7d → 1 h · 30d → 6 h
  const resolutionSec = range === '30d' ? 21600 : range === '7d' ? 3600 : 900;
  const path = `/devices/${encodeURIComponent(deviceId)}/motion_events?start_at=${encodeURIComponent(startIso)}&end_at=${encodeURIComponent(endIso)}&time_resolution=${resolutionSec}`;
  try {
    const body = await apiGet(path);
    const arr = body.values || body.data || (Array.isArray(body) ? body : []);
    if (arr.length > 0) {
      console.log(`[Minut motion_events] ${arr.length} Punkte (resolution=${resolutionSec}s), sample:`, JSON.stringify(arr[0]).slice(0, 200));
    }
    return arr;
  } catch (err) {
    console.log('[Minut motion_events] Fehler:', err.message);
    return [];
  }
}

async function fetchSeries(deviceId, fieldPath, startIso, endIso) {
  try {
    const path = `/devices/${encodeURIComponent(deviceId)}/${fieldPath}?start_at=${encodeURIComponent(startIso)}&end_at=${encodeURIComponent(endIso)}`;
    const body = await apiGet(path);
    const arr = body.values || body.data || (Array.isArray(body) ? body : []);
    // Debug-Log: erste 2 Punkte zeigen, damit wir die Response-Shape sehen
    if (arr.length > 0) {
      console.log(`[Minut ${fieldPath}] ${arr.length} Punkte, sample:`, JSON.stringify(arr[0]).slice(0, 200));
    } else {
      console.log(`[Minut ${fieldPath}] leer, raw body keys:`, Object.keys(body || {}).join(','));
    }
    return arr;
  } catch (err) {
    console.log(`[Minut] ${fieldPath} nicht verfuegbar:`, err.message);
    return [];
  }
}

/**
 * Holt historische Messwerte fuer Temperatur, Feuchte, Laerm, Bewegung.
 * @param {string} deviceId
 * @param {'24h'|'7d'|'30d'} range
 */
async function getHistory(deviceId, range = '24h') {
  if (!deviceId) throw new Error('deviceId fehlt');
  const key = `${deviceId}:${range}`;

  const cached = historyCache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < HISTORY_TTL_MS) {
    return { ...cached.data, cached: true, stale: false };
  }

  if (historyInFlight.has(key)) {
    try {
      return { ...(await historyInFlight.get(key)), cached: false, stale: false };
    } catch {}
  }

  const p = (async () => {
    const { startMs, endMs } = rangeToWindow(range);
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();

    const [temperature, humidity, noise, motion] = await Promise.all([
      fetchSeries(deviceId, 'temperature', startIso, endIso),
      fetchSeries(deviceId, 'humidity',    startIso, endIso),
      fetchSeries(deviceId, 'sound_level', startIso, endIso),
      fetchMotion(deviceId, startIso, endIso, range)
    ]);

    const targetPoints = downsample.targetPointsForRange(range);

    const data = {
      range,
      temperature: downsample.bucketAverage(minutNormalizer.normalizeTimeSeries(temperature), targetPoints),
      humidity:    downsample.bucketAverage(minutNormalizer.normalizeTimeSeries(humidity),    targetPoints),
      noise:       downsample.bucketAverage(minutNormalizer.normalizeTimeSeries(noise),       targetPoints),
      motion:      minutNormalizer.normalizeTimeSeries(motion), // Events nicht downsamplen
      fetchedAt: new Date().toISOString()
    };
    historyCache.set(key, { data, fetchedAt: Date.now() });
    return data;
  })();

  historyInFlight.set(key, p);
  try {
    const data = await p;
    return { ...data, cached: false, stale: false };
  } catch (err) {
    if (cached) return { ...cached.data, cached: true, stale: true, error: err.message };
    throw err;
  } finally {
    historyInFlight.delete(key);
  }
}

/**
 * Holt das Noise-Profile (Noise-Limit in dB + Quiet-Hours) fuer ein Geraet.
 */
async function getNoiseProfile(deviceId) {
  if (!deviceId) throw new Error('deviceId fehlt');

  const cached = noiseProfileCache.get(deviceId);
  if (cached && (Date.now() - cached.fetchedAt) < NOISE_PROFILE_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  try {
    const device = await apiGet(`/devices/${encodeURIComponent(deviceId)}`);
    const d = device.device || device;

    // Minut speichert Noise-Schwellwerte als Reactions in device.configuration
    const reactions = (d.configuration && d.configuration.reactions) || [];
    const normalReaction = reactions.find(r => r.type === 'sound_level_high');
    const quietReaction  = reactions.find(r => r.type === 'sound_level_high_quiet_hours');

    const noiseLimit = normalReaction && typeof normalReaction.value === 'number' ? normalReaction.value : null;
    const quietHoursLimit = quietReaction && typeof quietReaction.value === 'number' ? quietReaction.value : null;

    // Quiet-Hours-Zeitfenster wird von Minut nicht ueber die API exponiert.
    // Default auf 22:00–08:00 (lokale Zeit). Kann ueber integrationsStore
    // spaeter pro Wohnung ueberschrieben werden.
    const quietHours = [{ startHour: 22, endHour: 8 }];

    const data = {
      noiseLimit,
      quietHoursLimit,
      quietHours: Array.isArray(quietHours) ? quietHours : [],
      fetchedAt: new Date().toISOString()
    };
    noiseProfileCache.set(deviceId, { data, fetchedAt: Date.now() });
    return { ...data, cached: false };
  } catch (err) {
    if (cached) return { ...cached.data, cached: true, stale: true, error: err.message };
    // Kein Noise-Profile → leere Struktur statt Fehler
    return { noiseLimit: null, quietHours: [], error: err.message, fetchedAt: new Date().toISOString() };
  }
}

module.exports = {
  listDevices,
  getDeviceStatus,
  testConnection,
  getHistory,
  getNoiseProfile,
  _clearCaches,
  _getDeviceCacheEntry
};
