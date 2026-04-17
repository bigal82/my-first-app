/**
 * Occupancy Service (iCal) – PROJ-4
 *
 * Laedt iCal-Feeds, parst sie mit node-ical und normalisiert das Ergebnis
 * auf einen einfachen Belegungsstatus.
 *
 * Verhalten:
 *  - 30 Minuten Cache pro Apartment-ID
 *  - In-Flight-Deduplication: parallele Aufrufe auf denselben Key teilen sich einen Fetch
 *  - Stale-Fallback: bei Fetch-Fehler wird letzter erfolgreicher Stand mit stale=true geliefert
 *  - Datum in ISO-Format (YYYY-MM-DD), keine Uhrzeit
 */

const ical = require('node-ical');

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 Minuten
const FETCH_TIMEOUT_MS = 10 * 1000;  // 10 s Abbruch pro iCal-URL

// cacheEntry: { data, fetchedAt }
const cache = new Map();
// inFlight: Map<cacheKey, Promise<data>>
const inFlight = new Map();

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function extractEvents(parsed) {
  const events = [];
  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== 'VEVENT') continue;
    if (!ev.start || !ev.end) continue;
    const summary = (ev.summary || '').toString().trim();
    // Smoobu Marker-Events + Blocker rausfiltern
    const s = summary.toLowerCase();
    if (s.startsWith('check-in ') || s.startsWith('check-out ') ||
        s.startsWith('check in ') || s.startsWith('check out ') ||
        ['blocked', 'blockierung', 'closed', 'closed - not available',
         'nicht verfuegbar', 'nicht verfügbar', 'not available', 'unavailable'].includes(s)) {
      continue;
    }
    events.push({
      title: summary || 'Gast',
      start: new Date(ev.start),
      end: new Date(ev.end)
    });
  }
  return events;
}

/**
 * Normalisiert iCal-Events zu { occupied, currentBooking, nextBooking }.
 *
 * Beruecksichtigt die Uhrzeit: am Checkout-Tag gilt der Gast nach der
 * Checkout-Stunde als ausgecheckt. Am Check-in-Tag gilt der neue Gast
 * erst ab der Check-in-Stunde als eingecheckt. Dazwischen: "frei".
 */
function computeStatus(events, now = today()) {
  const result = { occupied: false, currentBooking: null, nextBooking: null };
  if (!events || events.length === 0) return result;

  // Aktuelle Stunde in der konfigurierten Zeitzone
  let localHour = new Date().getHours(); // Fallback: Server-TZ
  try {
    const tz = require('./integrationsStore').getDashboard().timezone || 'Europe/Berlin';
    localHour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()), 10);
  } catch {}

  // Sortierte Events nach Start
  const sorted = [...events].sort((a, b) => new Date(a.start) - new Date(b.start));

  for (const ev of sorted) {
    const s = new Date(ev.start); s.setHours(0, 0, 0, 0);
    const e = new Date(ev.end);   e.setHours(0, 0, 0, 0);

    const isCheckoutDay = e.getTime() === now.getTime();
    const isCheckinDay = s.getTime() === now.getTime();
    const spansToday = s.getTime() <= now.getTime() && now.getTime() < e.getTime();

    if (spansToday) {
      // Buchung umspannt heute, aber ist es der Checkout-Tag?
      // Checkout-Tag: nach Checkout-Stunde (default 10) → nicht mehr belegt
      // (Das e.getTime() > now.getTime() schliesst den Checkout-Tag schon aus,
      //  also spansToday trifft nur Tage VOR dem Checkout zu.)
      result.occupied = true;
      result.currentBooking = {
        title: ev.title,
        checkIn: isoDate(ev.start),
        checkOut: isoDate(ev.end)
      };
      break;
    }

    if (isCheckoutDay) {
      // Heute ist der Checkout-Tag. Vor 10 Uhr: noch belegt. Ab 10 Uhr: frei.
      if (localHour < 10) {
        result.occupied = true;
        result.currentBooking = {
          title: ev.title,
          checkIn: isoDate(ev.start),
          checkOut: isoDate(ev.end)
        };
        break;
      }
      // Ab 10 Uhr: nicht mehr belegt → weiter suchen nach dem naechsten Gast
      continue;
    }

    if (s.getTime() === e.getTime() && s.getTime() === now.getTime()) {
      // Eintaegiges Event
      result.occupied = true;
      result.currentBooking = {
        title: ev.title,
        checkIn: isoDate(ev.start),
        checkOut: isoDate(ev.end)
      };
      break;
    }
  }

  // Naechste Buchung: start >= heute, aber nicht die aktuelle
  for (const ev of sorted) {
    const s = new Date(ev.start); s.setHours(0, 0, 0, 0);
    const isToday = s.getTime() === now.getTime();
    const isFuture = s.getTime() > now.getTime();

    if (isFuture || (isToday && localHour >= 10)) {
      // Am Check-in-Tag: erst ab 16 Uhr als "aktuell" zeigen, vorher als "naechste"
      if (isToday && localHour >= 16 && !result.occupied) {
        result.occupied = true;
        result.currentBooking = {
          title: ev.title,
          checkIn: isoDate(ev.start),
          checkOut: isoDate(ev.end)
        };
      } else if (!result.nextBooking && !(result.currentBooking && result.currentBooking.checkIn === isoDate(ev.start))) {
        result.nextBooking = {
          title: ev.title,
          checkIn: isoDate(ev.start),
          checkOut: isoDate(ev.end)
        };
      }
      if (result.nextBooking) break;
    }
  }

  return result;
}

/**
 * Fetch + Parse einer iCal-URL mit Timeout.
 */
async function fetchIcal(icalUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(icalUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return ical.sync.parseICS(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Haupteinstieg: liefert den Belegungsstatus einer Wohnung.
 *
 * @param {string} apartmentId – Schluessel fuer Cache
 * @param {string} icalUrl     – URL des iCal-Feeds
 * @returns {Promise<object>} normalisierter Status
 */
/**
 * Laedt Buchungen aus Smoobu statt iCal (wenn source=smoobu).
 */
async function getOccupancyFromSmoobu(apartmentId, smoobuApartmentId) {
  const smoobu = require('./smoobu');
  const tz = require('./timezone');
  const today = tz.localDateStr();
  const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { bookings } = await smoobu.getBookings(smoobuApartmentId, today, future);

  // In das gleiche Event-Format konvertieren wie extractEvents
  const events = bookings
    .filter(b => !b.isBlocked && !b.isCancelled)
    .map(b => ({
      title: b.guest,
      start: new Date(b.checkIn),
      end: new Date(b.checkOut),
      adults: b.adults,
      children: b.children,
      channel: b.channel,
      source: 'smoobu'
    }));

  const status = computeStatus(events);
  // Personenzahl + Kanal vom aktuellen Gast anfuegen
  if (status.currentBooking) {
    const ev = events.find(e => e.title === status.currentBooking.title);
    if (ev) {
      status.currentBooking.adults = ev.adults;
      status.currentBooking.children = ev.children;
      status.currentBooking.channel = ev.channel;
    }
  }
  return { ...status, source: 'smoobu', fetchedAt: new Date().toISOString() };
}

async function getOccupancy(apartmentId, icalUrl) {
  if (!icalUrl || typeof icalUrl !== 'string') {
    throw new Error('iCal-URL fehlt.');
  }

  const cached = cache.get(apartmentId);
  const now = Date.now();
  const fresh = cached && (now - cached.fetchedAt) < CACHE_TTL_MS;

  if (fresh) {
    return { ...cached.data, cached: true, stale: false };
  }

  // In-Flight-Deduplication: wenn bereits ein Fetch laeuft, warte darauf
  if (inFlight.has(apartmentId)) {
    try {
      const data = await inFlight.get(apartmentId);
      return { ...data, cached: false, stale: false };
    } catch (err) {
      // Fehler fallen durch zum Stale-Fallback unten
    }
  }

  const fetchPromise = (async () => {
    const parsed = await fetchIcal(icalUrl);
    const events = extractEvents(parsed);
    const status = computeStatus(events);
    const data = {
      occupied: status.occupied,
      statusLabel: status.occupied ? 'Gast da' : 'Frei',
      currentBooking: status.currentBooking,
      nextBooking: status.nextBooking,
      fetchedAt: new Date().toISOString()
    };
    cache.set(apartmentId, { data, fetchedAt: Date.now() });
    return data;
  })();

  inFlight.set(apartmentId, fetchPromise);

  try {
    const data = await fetchPromise;
    return { ...data, cached: false, stale: false };
  } catch (err) {
    // Stale-Fallback: wenn wir vorher mal erfolgreich waren, gib das zurueck
    if (cached) {
      return {
        ...cached.data,
        cached: true,
        stale: true,
        error: err.message
      };
    }
    // Kein Cache-Backup vorhanden → Fehler weiterreichen
    throw err;
  } finally {
    inFlight.delete(apartmentId);
  }
}

// Hilfsfunktionen fuer Tests
function _clearCache() {
  cache.clear();
  inFlight.clear();
}

module.exports = {
  getOccupancy,
  getOccupancyFromSmoobu,
  // fuer Wiederverwendung durch andere Services (z.B. automation.js)
  fetchIcal,
  // intern exportiert fuer Unit-Tests
  _clearCache,
  _extractEvents: extractEvents,
  _computeStatus: computeStatus,
  _isoDate: isoDate
};
