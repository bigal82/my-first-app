/**
 * Smoobu API Service — NUR LESEN.
 *
 * Liest Buchungsdaten ueber die Smoobu REST API als Alternative zu iCal.
 * Vorteile: exakte Check-in/out Uhrzeiten, Gastname sauber, Personenzahl,
 * Buchungskanal, Stornierungen, Blocker-Flag.
 *
 * Authentifizierung: Api-Key Header.
 * Rate-Limit: 1000 Requests/Minute.
 */

const integrationsStore = require('./integrationsStore');

const API_BASE = 'https://login.smoobu.com/api';
const FETCH_TIMEOUT_MS = 15 * 1000;

// Caches
const apartmentsCache = { data: null, fetchedAt: 0 };
const APARTMENTS_TTL_MS = 60 * 60 * 1000; // 1 Stunde

const bookingsCache = new Map(); // aptId → { data, fetchedAt }
const BOOKINGS_TTL_MS = 5 * 60 * 1000; // 5 Minuten

function requireApiKey() {
  const cfg = integrationsStore.getSmoobu();
  if (!cfg.apiKey) throw new Error('Smoobu API-Key nicht konfiguriert.');
  return cfg.apiKey;
}

async function apiGet(path, params = {}) {
  const apiKey = requireApiKey();
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      headers: { 'Api-Key': apiKey, 'Accept': 'application/json' },
      signal: controller.signal
    });
    if (res.status === 401) throw new Error('Smoobu API-Key ungueltig (401).');
    if (res.status === 429) throw new Error('Smoobu Rate-Limit erreicht (429). Bitte spaeter versuchen.');
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Smoobu API-Fehler ${res.status}: ${txt.slice(0, 160)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verbindungstest — prueft ob der API-Key gueltig ist.
 */
async function testConnection() {
  const data = await apiGet('/me');
  return { ok: true, user: data };
}

/**
 * Smoobu-Wohnungen laden (cached 1h).
 */
async function listApartments() {
  if (apartmentsCache.data && (Date.now() - apartmentsCache.fetchedAt) < APARTMENTS_TTL_MS) {
    return apartmentsCache.data;
  }
  const data = await apiGet('/apartments');
  const apts = (data.apartments || []).map(a => ({
    id: a.id,
    name: a.name
  }));
  apartmentsCache.data = apts;
  apartmentsCache.fetchedAt = Date.now();
  return apts;
}

/**
 * Buchungen fuer eine Wohnung laden (cached 5 min).
 * Gibt normalisierte Booking-Objekte zurueck.
 *
 * @param {number} smoobuApartmentId
 * @param {string} from — YYYY-MM-DD
 * @param {string} to — YYYY-MM-DD
 */
async function getBookings(smoobuApartmentId, from, to) {
  const cacheKey = `${smoobuApartmentId}:${from}:${to}`;
  const cached = bookingsCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < BOOKINGS_TTL_MS) {
    return { bookings: cached.data, cached: true, stale: false };
  }

  try {
    const allBookings = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const data = await apiGet('/reservations', {
        apartmentId: smoobuApartmentId,
        from,
        to,
        excludeBlocked: false,
        showCancellation: true,
        page,
        pageSize: 100
      });

      totalPages = data.page_count || 1;
      const raw = data.bookings || [];
      for (const b of raw) {
        allBookings.push(normalizeBooking(b));
      }
      page++;
    }

    bookingsCache.set(cacheKey, { data: allBookings, fetchedAt: Date.now() });
    return { bookings: allBookings, cached: false, stale: false };
  } catch (err) {
    // Stale-Fallback
    if (cached) {
      return { bookings: cached.data, cached: true, stale: true, error: err.message };
    }
    throw err;
  }
}

/**
 * Normalisiert ein Smoobu-Booking in unser einheitliches Format.
 */
function normalizeBooking(raw) {
  const arrival = raw.arrival || '';
  const departure = raw.departure || '';
  const checkInTime = raw['check-in'] || '16:00';
  const checkOutTime = raw['check-out'] || '10:00';

  return {
    id: `smoobu-${raw.id}`,
    guest: raw['guest-name'] || 'Gast',
    adults: raw.adults || 0,
    children: raw.children || 0,
    channel: raw.channel ? raw.channel.name : null,
    checkIn: `${arrival}T${checkInTime}:00`,
    checkOut: `${departure}T${checkOutTime}:00`,
    arrival,
    departure,
    checkInTime,
    checkOutTime,
    isBlocked: !!raw['is-blocked-booking'],
    isCancelled: raw.type === 'cancellation',
    source: 'smoobu',
    rawId: raw.id
  };
}

function _clearCaches() {
  apartmentsCache.data = null;
  apartmentsCache.fetchedAt = 0;
  bookingsCache.clear();
}

module.exports = {
  testConnection,
  listApartments,
  getBookings,
  normalizeBooking,
  _clearCaches
};
