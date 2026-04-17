/**
 * Tado Dispatcher (PROJ-5 Datenabruf, PROJ-6 Aktionen)
 *
 * Entscheidet anhand des konfigurierten Typs (V3 oder X), welcher Client
 * verwendet wird, und normalisiert das Ergebnis zu einer einheitlichen Shape.
 *
 * Fuer Schreib-Aktionen (PROJ-6):
 *   1. Rate-Limit-Guard pruefen (echte Tado-Header-Werte)
 *   2. Action-Lock setzen (dedup gegen Doppelaufrufe)
 *   3. Client-Call ausfuehren
 *   4. Cache invalidieren
 *   5. Action-Lock loesen
 */

const v3Client = require('./v3Client');
const xClient = require('./xClient');
const dataCache = require('./dataCache');
const rateLimitGuard = require('./rateLimitGuard');
const actionLock = require('./actionLock');
const normalizer = require('../../normalizers/tado');

function pickClient(kind) {
  if (kind === 'V3') return v3Client;
  if (kind === 'X')  return xClient;
  throw new Error(`Unbekannter Tado-Typ: ${kind}`);
}

function requireAuthorized(apartment) {
  if (!apartment || !apartment.id) throw new Error('Wohnungs-ID fehlt.');
  const tado = apartment.integrations && apartment.integrations.tado;
  if (!tado || !tado.enabled) {
    throw new Error('Tado-Integration ist fuer diese Wohnung nicht aktiv.');
  }
  const kind = tado.kind || 'V3';
  const client = pickClient(kind);
  if (!client.isAuthorized(apartment.id)) {
    throw Object.assign(
      new Error('Tado noch nicht autorisiert. Bitte in Setup auf "Tado verbinden" klicken.'),
      { status: 401, code: 'NOT_AUTHORIZED' }
    );
  }
  return { tado, kind, client };
}

/**
 * Liefert die einheitlich normalisierten Wohnungsdaten fuer eine Apartment-Konfig.
 */
async function getApartmentData(apartment) {
  const { tado, kind, client } = requireAuthorized(apartment);

  return dataCache.getOrFetch(apartment.id, async () => {
    const { raw, rateLimit, homeId } = await client.fetchHomeData({
      apartmentId: apartment.id,
      homeId:      tado.homeId
    });
    return normalizer.normalize(kind, raw, rateLimit, homeId);
  });
}

/**
 * Liefert die aktuelle HomeId – entweder aus der Config oder aus dem Cache
 * (falls sie dort nach einem fetchHomeData-Call schon bekannt ist).
 * Falls keine da ist: einen Fetch anstossen damit sie ermittelt wird.
 */
async function ensureHomeId(apartment) {
  const tado = apartment.integrations && apartment.integrations.tado;
  if (tado && Number(tado.homeId) >= 100) return Number(tado.homeId);

  const cached = dataCache.getEntry(apartment.id);
  if (cached && cached.data && cached.data.homeId) return cached.data.homeId;

  // Kein HomeId bekannt → Fetch anstossen
  const data = await getApartmentData(apartment);
  if (data.homeId) return data.homeId;
  throw new Error('HomeId konnte nicht ermittelt werden.');
}

/**
 * Holt den aktuellen Rate-Limit-Stand ohne neuen Tado-Call (wenn Cache warm).
 */
function getRateLimit(apartment) {
  const cached = dataCache.getEntry(apartment.id);
  if (cached && cached.data && cached.data.rateLimit) return cached.data.rateLimit;
  return null;
}

// ── Action-Wrapper: Guard + Lock + Invalidate ───────────────────────────────

async function runAction(apartment, actionKey, lockKey, fn) {
  const { client } = requireAuthorized(apartment);

  // Rate-Limit-Check auf Basis des letzten bekannten Cache-Stands
  const rl = getRateLimit(apartment);
  const credKey = `tado:${apartment.id}`;
  const check = rateLimitGuard.checkAction(rl, credKey);
  if (!check.allowed) {
    throw Object.assign(new Error(check.reason), { status: 429, code: 'RATE_LIMIT' });
  }

  // Action-Lock
  if (!actionLock.acquire(lockKey)) {
    throw Object.assign(new Error('Aktion laeuft bereits. Bitte kurz warten.'), { status: 409, code: 'LOCKED' });
  }

  try {
    const result = await fn();
    // Cache invalidieren, damit der naechste Read frische Daten bringt
    dataCache.invalidate(apartment.id);
    return {
      success: true,
      message: actionKey,
      updatedAt: new Date().toISOString(),
      warning: check.warning || null,
      result
    };
  } catch (err) {
    if (err.status === 429) {
      rateLimitGuard.handleTado429(credKey);
      throw Object.assign(new Error('Tado hat 429 zurueckgegeben. Limit erschoepft.'), { status: 429, code: 'RATE_LIMIT' });
    }
    throw err;
  } finally {
    actionLock.release(lockKey);
  }
}

/**
 * Einzelraum-Aktion: 'off' oder 'resume'.
 */
async function setRoomAction(apartment, roomId, action) {
  const { client } = requireAuthorized(apartment);
  const homeId = await ensureHomeId(apartment);

  const lockKey = `${apartment.id}:room:${roomId}:${action}`;
  return runAction(apartment, `room:${roomId}:${action}`, lockKey, async () => {
    if (action === 'off') return client.setZoneOff(apartment.id, homeId, roomId);
    if (action === 'resume') return client.resumeZone(apartment.id, homeId, roomId);
    throw new Error(`Unbekannte Aktion: ${action}`);
  });
}

/**
 * Bulk-Action auf alle Raeume einer Wohnung. Sequenziell, nicht parallel:
 * - Tado V3 hat keinen Bulk-Endpoint
 * - parallele PUTs rennen in Rate-Limit- und Token-Refresh-Rennen
 * - sequenziell ist auch Tado-freundlicher
 */
async function runBulkRoomAction(apartment, action, label) {
  requireAuthorized(apartment);
  const data = await getApartmentData(apartment);
  const rooms = data.rooms || [];

  const successRooms = [];
  const failedRooms = [];
  for (const r of rooms) {
    try {
      await setRoomAction(apartment, r.id, action);
      successRooms.push({ id: r.id, name: r.name });
    } catch (err) {
      failedRooms.push({ id: r.id, name: r.name, error: err.message });
      // Bei 429 sofort abbrechen — weitere Requests wuerden nur das Limit
      // noch tiefer in den Keller ziehen.
      if (err.status === 429 || err.code === 'RATE_LIMIT') break;
    }
  }

  dataCache.invalidate(apartment.id);

  const success = failedRooms.length === 0;
  return {
    success,
    // Bei Total-Fehlschlag eine sprechende Fehlermeldung liefern, damit das
    // Frontend sie direkt anzeigen kann (sonst `data.error === undefined`).
    error: success
      ? null
      : `${label}: ${successRooms.length}/${rooms.length} Raeume — ${failedRooms.map(f => `${f.name}: ${f.error}`).join(' · ')}`,
    message: `${label}: ${successRooms.length}/${rooms.length} Raeume`,
    updatedAt: new Date().toISOString(),
    totalRooms: rooms.length,
    successCount: successRooms.length,
    failedRooms
  };
}

async function allOff(apartment) {
  return runBulkRoomAction(apartment, 'off', 'Alles aus');
}

async function resumeAll(apartment) {
  return runBulkRoomAction(apartment, 'resume', 'Plan fortgesetzt');
}

async function setPresence(apartment, presence) {
  const { client } = requireAuthorized(apartment);
  const homeId = await ensureHomeId(apartment);
  const lockKey = `${apartment.id}:presence`;
  return runAction(apartment, `presence:${presence}`, lockKey, async () => {
    return client.setPresence(apartment.id, homeId, presence);
  });
}

module.exports = {
  getApartmentData,
  getRateLimit,
  ensureHomeId,
  setRoomAction,
  allOff,
  resumeAll,
  setPresence,
  pickClient
};
