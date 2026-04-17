/**
 * Nuki Service (PROJ-9)
 *
 * Nuki Web API v3: Bearer-Token-Auth (kein OAuth-Flow).
 * API-Token kommt aus integrationsStore oder ENV-Fallback.
 *
 * Ein einziger Call `/smartlock` liefert alle Geraete des Accounts.
 * Wir cachen die gesamte Liste 30 min und filtern clientseitig pro Wohnung.
 */

const integrationsStore = require('./integrationsStore');
const nukiNormalizer = require('../normalizers/nuki');

const API_BASE = 'https://api.nuki.io';
const FETCH_TIMEOUT_MS = 10 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000;

// Single-Account-Cache: die komplette Device-Liste
let cachedList = null;  // { data: [], fetchedAt: number }
let inFlight = null;    // Promise<data>

async function withTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function getToken() {
  const cfg = integrationsStore.getNuki();
  return cfg.apiToken || null;
}

function requireToken() {
  const token = getToken();
  if (!token) {
    throw Object.assign(
      new Error('Nuki-API-Token fehlt. Bitte in Setup hinterlegen.'),
      { status: 503, code: 'NO_CREDENTIALS' }
    );
  }
  return token;
}

async function apiGet(path) {
  const token = requireToken();
  const res = await withTimeout(signal => fetch(`${API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    signal
  }));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Nuki API-Fehler ${res.status} bei ${path}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

/**
 * Holt die komplette Smartlock-Liste des Accounts (cached 30 min).
 */
async function getAllSmartlocks() {
  if (cachedList && (Date.now() - cachedList.fetchedAt) < CACHE_TTL_MS) {
    return { data: cachedList.data, cached: true, stale: false };
  }

  if (inFlight) {
    try {
      return { data: await inFlight, cached: false, stale: false };
    } catch {}
  }

  const p = (async () => {
    const raw = await apiGet('/smartlock');
    const normalized = nukiNormalizer.normalizeDeviceList(raw);
    cachedList = { data: normalized, fetchedAt: Date.now() };
    return normalized;
  })();

  inFlight = p;
  try {
    const data = await p;
    return { data, cached: false, stale: false };
  } catch (err) {
    if (cachedList) {
      return { data: cachedList.data, cached: true, stale: true, error: err.message };
    }
    throw err;
  } finally {
    inFlight = null;
  }
}

/**
 * Setup-Dropdown: liefert die Device-Liste mit { id, name, type }.
 */
async function listDevices() {
  const { data } = await getAllSmartlocks();
  return data.map(d => ({ id: d.id, name: d.name, type: d.type }));
}

// Alias fuer Backwards-Compat mit dem alten Stub
async function listAllDevices() { return listDevices(); }

/**
 * Dashboard-Widget: liefert die fuer eine Wohnung zugeordneten Geraete.
 */
async function getDevicesForApartment(deviceIds) {
  const { data, cached, stale, error } = await getAllSmartlocks();
  const filtered = nukiNormalizer.filterByIds(data, deviceIds);
  return {
    devices: filtered,
    cached,
    stale: !!stale,
    ...(error ? { error } : {}),
    fetchedAt: cachedList ? new Date(cachedList.fetchedAt).toISOString() : new Date().toISOString()
  };
}

/**
 * Test-Endpoint fuer den Integration-Setup.
 */
async function testConnection() {
  cachedList = null;
  const { data } = await getAllSmartlocks();
  return { ok: true, deviceCount: data.length };
}

function _clearCaches() {
  cachedList = null;
  inFlight = null;
}

// Fuer PROJ-10 Status-Aggregation: Lesezugriff auf die gecachte Device-Liste
function _getCachedListRaw() {
  return cachedList ? cachedList.data : null;
}

module.exports = {
  listDevices,
  listAllDevices,
  getDevicesForApartment,
  testConnection,
  _clearCaches,
  _getCachedListRaw
};
