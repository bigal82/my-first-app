/**
 * Tado Data Cache
 *
 * 30-Minuten-TTL pro Apartment-ID, Stale-Fallback bei Fehler,
 * In-Flight-Deduplication fuer parallele Requests.
 *
 * Format des Cache-Eintrags:
 *   { data: { kind, presence, averageTemperature, rooms, rateLimit, fetchedAt }, fetchedAt }
 */

const CACHE_TTL_MS = 30 * 60 * 1000;

const cache = new Map();    // apartmentId -> { data, fetchedAt }
const inFlight = new Map(); // apartmentId -> Promise<data>

function isFresh(entry) {
  return entry && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
}

function getEntry(apartmentId) {
  return cache.get(apartmentId) || null;
}

function setEntry(apartmentId, data) {
  cache.set(apartmentId, { data, fetchedAt: Date.now() });
}

/**
 * Haupt-Einstieg: fetch-funktion wird nur aufgerufen wenn Cache veraltet ist.
 * Liefert immer ein Objekt mit cached/stale-Markern.
 *
 * @param {string} apartmentId
 * @param {() => Promise<object>} fetchFn  liefert die Rohdaten (bereits normalisiert)
 * @returns {Promise<object>}
 */
async function getOrFetch(apartmentId, fetchFn) {
  const entry = getEntry(apartmentId);

  if (isFresh(entry)) {
    return { ...entry.data, cached: true, stale: false };
  }

  // In-Flight-Deduplication
  if (inFlight.has(apartmentId)) {
    try {
      const data = await inFlight.get(apartmentId);
      return { ...data, cached: false, stale: false };
    } catch (err) {
      // Faellt unten zum Stale-Fallback durch
    }
  }

  const p = (async () => {
    const data = await fetchFn();
    setEntry(apartmentId, data);
    return data;
  })();

  inFlight.set(apartmentId, p);

  try {
    const data = await p;
    return { ...data, cached: false, stale: false };
  } catch (err) {
    if (entry) {
      return {
        ...entry.data,
        cached: true,
        stale: true,
        error: err.message
      };
    }
    throw err;
  } finally {
    inFlight.delete(apartmentId);
  }
}

/**
 * Invalidiert den Cache-Eintrag einer einzelnen Wohnung.
 * Wird nach erfolgreichen Schreib-Aktionen (PROJ-6) aufgerufen,
 * damit der naechste GET frische Daten liefert.
 */
function invalidate(apartmentId) {
  cache.delete(apartmentId);
}

function _clearAll() {
  cache.clear();
  inFlight.clear();
}

module.exports = {
  getEntry,
  setEntry,
  getOrFetch,
  invalidate,
  isFresh,
  _clearAll
};
