/**
 * Cleaning Event Sync
 *
 * Gleicht iCal-Buchungen mit gespeicherten Reinigungs-Events ab.
 * Laeuft alle 5 Minuten im Hintergrund + bei Timeline-Aufruf on-demand.
 *
 * Logik:
 *   - Neue Buchung (UID nicht in Events) → Event erstellen (state: open)
 *   - Buchung storniert (UID in Events aber nicht mehr im iCal) → Event loeschen
 *   - Buchung noch da → Event behalten, Gastname/Datum aktualisieren falls geaendert,
 *     Status (open/planned/done) NICHT anfassen
 */

const fs = require('fs');
const occupancyService = require('./occupancy');
const { APARTMENTS, configFile } = require('../config-path');

const EVENTS_PATH = configFile('cleaning-events.json');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 Minuten

const DEFAULT_CHECKOUT_HOUR = 10;
const DEFAULT_CHECKIN_HOUR = 16;

function applyDefaultTimes(start, end) {
  const checkIn = new Date(start);
  const checkOut = new Date(end);
  if (checkIn.getHours() === 0 && checkIn.getMinutes() === 0) {
    checkIn.setHours(DEFAULT_CHECKIN_HOUR, 0, 0, 0);
  }
  if (checkOut.getHours() === 0 && checkOut.getMinutes() === 0) {
    checkOut.setHours(DEFAULT_CHECKOUT_HOUR, 0, 0, 0);
  }
  return { checkIn, checkOut };
}

function isBlockerOrMarker(summary) {
  const s = (summary || '').toString().trim().toLowerCase();
  if (['', 'blocked', 'blockierung', 'closed', 'closed - not available',
    'nicht verfuegbar', 'nicht verfügbar', 'not available', 'unavailable'].includes(s)) {
    return true;
  }
  if (s.startsWith('check-in ') || s.startsWith('check-out ') ||
      s.startsWith('check in ') || s.startsWith('check out ')) {
    return true;
  }
  return false;
}

function readApartments() {
  if (!fs.existsSync(APARTMENTS)) return [];
  try {
    const cfg = JSON.parse(fs.readFileSync(APARTMENTS, 'utf-8'));
    return Array.isArray(cfg.apartments) ? cfg.apartments : [];
  } catch { return []; }
}

function readEvents() {
  if (!fs.existsSync(EVENTS_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function writeEvents(events) {
  fs.writeFileSync(EVENTS_PATH, JSON.stringify(events, null, 2), 'utf-8');
}

/**
 * Extrahiert echte Buchungen aus einem geparseten iCal-Feed.
 * Nur Buchungen mit Checkout in den letzten 7 Tagen oder in der Zukunft —
 * aeltere historische Buchungen sind fuer die Reinigungsplanung irrelevant.
 */
function extractBookings(parsed) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  cutoff.setHours(0, 0, 0, 0);

  const bookings = [];
  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== 'VEVENT' || !ev.start || !ev.end) continue;
    const summary = (ev.summary || '').toString().trim();
    if (isBlockerOrMarker(summary)) continue;
    const { checkIn, checkOut } = applyDefaultTimes(ev.start, ev.end);
    // Nur aktuelle + zukuenftige Buchungen
    if (checkOut.getTime() < cutoff.getTime()) continue;
    bookings.push({
      uid: ev.uid || `${checkIn.getTime()}-${checkOut.getTime()}`,
      guest: summary || 'Gast',
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString()
    });
  }
  return bookings;
}

/**
 * Extrahiert Buchungen aus der Smoobu API.
 */
async function extractBookingsFromSmoobu(smoobuApartmentId) {
  const smoobu = require('./smoobu');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const from = cutoff.toISOString().slice(0, 10);
  const to = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { bookings } = await smoobu.getBookings(smoobuApartmentId, from, to);
  return bookings
    .filter(b => !b.isBlocked && !b.isCancelled)
    .map(b => ({
      uid: b.id,
      guest: b.guest,
      checkIn: b.checkIn,
      checkOut: b.checkOut
    }));
}

/**
 * Sync fuer eine einzelne Wohnung. Gibt die aktualisierten Events zurueck.
 */
function syncApartment(apartmentId, icalBookings, existingEvents) {
  const aptEvents = existingEvents.filter(e => e.apartmentId === apartmentId);
  const otherEvents = existingEvents.filter(e => e.apartmentId !== apartmentId);

  const bookingByUid = new Map(icalBookings.map(b => [b.uid, b]));
  const eventByUid = new Map(aptEvents.map(e => [e.bookingUid, e]));

  const updatedAptEvents = [];
  let created = 0;
  let removed = 0;
  let updated = 0;

  // 1. Bestehende Events: behalten wenn Buchung noch da, sonst behandeln
  for (const ev of aptEvents) {
    const booking = bookingByUid.get(ev.bookingUid);
    if (!booking) {
      // Buchung storniert
      if (ev.state === 'done') {
        // Bereits erledigt → behalten (historisch relevant)
        updatedAptEvents.push(ev);
        continue;
      }
      if (ev.assignedTo) {
        // Mitarbeiter war zugewiesen → auf cancelled setzen (nicht loeschen!)
        if (ev.state !== 'cancelled') {
          ev.state = 'cancelled';
          ev.cancelledAt = new Date().toISOString();
          ev.updatedAt = new Date().toISOString();
        }
        updatedAptEvents.push(ev);
        continue;
      }
      // Kein Mitarbeiter, nicht erledigt → loeschen
      removed++;
      continue;
    }
    // Buchung noch da → Gastname/Datum/Zeiten aktualisieren, Status behalten
    const coTime = booking.checkOut?.includes('T') ? booking.checkOut.split('T')[1]?.slice(0, 5) : null;
    const ciTime = booking.checkIn?.includes('T') ? booking.checkIn.split('T')[1]?.slice(0, 5) : null;
    const changed = ev.guest !== booking.guest || ev.checkoutDate !== booking.checkOut || ev.checkIn !== booking.checkIn
      || (coTime && ev.checkoutTime !== coTime) || (ciTime && ev.checkinTime !== ciTime);
    if (changed) {
      ev.guest = booking.guest;
      ev.checkoutDate = booking.checkOut;
      ev.checkIn = booking.checkIn;
      if (coTime) ev.checkoutTime = coTime;
      if (ciTime) ev.checkinTime = ciTime;
      ev.updatedAt = new Date().toISOString();
      updated++;
    }
    updatedAptEvents.push(ev);
  }

  // 2. Neue Buchungen → Events erstellen
  for (const booking of icalBookings) {
    if (!eventByUid.has(booking.uid)) {
      // Checkout-/Checkin-Uhrzeit extrahieren (aus ISO oder Smoobu-Format)
      const coTime = booking.checkOut && booking.checkOut.includes('T')
        ? booking.checkOut.split('T')[1]?.slice(0, 5) : null;
      const ciTime = booking.checkIn && booking.checkIn.includes('T')
        ? booking.checkIn.split('T')[1]?.slice(0, 5) : null;

      updatedAptEvents.push({
        id: `${apartmentId}:${booking.uid}:cleaning`,
        apartmentId,
        bookingUid: booking.uid,
        guest: booking.guest,
        checkIn: booking.checkIn,
        checkoutDate: booking.checkOut,
        checkoutTime: coTime || '10:00',
        checkinTime: ciTime || '16:00',
        state: 'open',
        assignedTo: null,
        assignedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      created++;
    }
  }

  return {
    events: [...otherEvents, ...updatedAptEvents],
    created,
    removed,
    updated
  };
}

/**
 * Haupt-Sync: alle Wohnungen mit iCal abgleichen.
 */
async function syncAll() {
  const apartments = readApartments().filter(a => a.visible);
  let allEvents = readEvents();
  let totalCreated = 0;
  let totalRemoved = 0;
  let totalUpdated = 0;

  for (const apt of apartments) {
    const occ = apt.occupancy || {};
    const hasSmoobu = occ.source === 'smoobu' && occ.smoobuApartmentId;
    if (!occ.enabled && !hasSmoobu) continue;

    try {
      let bookings;
      if (hasSmoobu) {
        bookings = await extractBookingsFromSmoobu(occ.smoobuApartmentId);
      } else if (occ.icalUrl) {
        const parsed = await occupancyService.fetchIcal(occ.icalUrl);
        bookings = extractBookings(parsed);
      } else {
        continue; // keine Datenquelle
      }
      const result = syncApartment(apt.id, bookings, allEvents);
      allEvents = result.events;
      totalCreated += result.created;
      totalRemoved += result.removed;
      totalUpdated += result.updated;
    } catch (err) {
      console.warn(`[cleaningSync] ${apt.id}: iCal fehlgeschlagen:`, err.message);
    }
  }

  writeEvents(allEvents);

  if (totalCreated > 0 || totalRemoved > 0 || totalUpdated > 0) {
    console.log(`[cleaningSync] +${totalCreated} neu, -${totalRemoved} geloescht, ~${totalUpdated} aktualisiert`);
  }

  return { totalCreated, totalRemoved, totalUpdated, totalEvents: allEvents.length };
}

/**
 * Event aktualisieren (Status, Mitarbeiter-Zuweisung, Erledigung).
 */
function updateEvent(eventId, patch) {
  const events = readEvents();
  const ev = events.find(e => e.id === eventId);
  if (!ev) return null;

  if (patch.state !== undefined) {
    ev.state = patch.state;
    if (patch.state === 'done') ev.completedAt = new Date().toISOString();
    if (patch.state === 'open') { ev.completedAt = null; ev.cancelledAt = null; }
  }
  if (patch.assignedTo !== undefined) {
    ev.assignedTo = patch.assignedTo || null;
    ev.assignedAt = patch.assignedTo ? new Date().toISOString() : null;
    // Automatisch auf 'assigned' setzen wenn jemand zugewiesen wird
    if (patch.assignedTo && ev.state === 'open') ev.state = 'assigned';
    // Zurueck auf 'open' wenn Zuweisung entfernt wird
    if (!patch.assignedTo && ev.state === 'assigned') ev.state = 'open';
  }

  ev.updatedAt = new Date().toISOString();
  writeEvents(events);
  return ev;
}

// Abwaertskompatibel
function setEventState(eventId, state) {
  return !!updateEvent(eventId, { state });
}

function getEvent(eventId) {
  return readEvents().find(e => e.id === eventId) || null;
}

/**
 * Alle Events lesen, optional gefiltert.
 */
function getEvents({ apartmentId, from, to, state } = {}) {
  let events = readEvents();
  if (apartmentId) events = events.filter(e => e.apartmentId === apartmentId);
  if (state) events = events.filter(e => e.state === state);
  // Aufenthalt muss das Zeitfenster ueberlappen:
  // checkIn < to UND checkOut > from
  // So werden auch laufende Aufenthalte angezeigt deren Checkout
  // ausserhalb des sichtbaren Fensters liegt.
  if (from || to) {
    const fromMs = from ? new Date(from).getTime() : 0;
    const toMs = to ? new Date(to).getTime() : Infinity;
    events = events.filter(e => {
      const ciMs = e.checkIn ? new Date(e.checkIn).getTime() : 0;
      const coMs = e.checkoutDate ? new Date(e.checkoutDate).getTime() : Infinity;
      return ciMs < toMs && coMs > fromMs;
    });
  }
  events.sort((a, b) => new Date(a.checkoutDate) - new Date(b.checkoutDate));
  return events;
}

// ── Scheduler ──────────────────────────────────────────────────────────────

let intervalHandle = null;

function start() {
  if (intervalHandle) return;
  console.log(`[cleaningSync] Scheduler gestartet (alle ${SYNC_INTERVAL_MS / 1000}s)`);
  // Erster Sync nach 10 Sekunden (Server erst warm werden lassen)
  setTimeout(() => {
    syncAll().catch(err => console.error('[cleaningSync] initial sync fehler:', err.message));
  }, 10 * 1000);
  intervalHandle = setInterval(() => {
    syncAll().catch(err => console.error('[cleaningSync] sync fehler:', err.message));
  }, SYNC_INTERVAL_MS);
}

function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

// ── Tasks pro Event ────────────────────────────────────────────────────────

function addTask(eventId, text) {
  const events = readEvents();
  const ev = events.find(e => e.id === eventId);
  if (!ev) return null;
  if (!Array.isArray(ev.tasks)) ev.tasks = [];
  const task = {
    id: 't-' + Date.now(),
    text: text.trim(),
    type: 'manual',
    done: false,
    createdAt: new Date().toISOString()
  };
  ev.tasks.push(task);
  ev.updatedAt = new Date().toISOString();
  writeEvents(events);
  return task;
}

function toggleTask(eventId, taskId) {
  const events = readEvents();
  const ev = events.find(e => e.id === eventId);
  if (!ev || !Array.isArray(ev.tasks)) return null;
  const task = ev.tasks.find(t => t.id === taskId);
  if (!task) return null;
  task.done = !task.done;
  task.doneAt = task.done ? new Date().toISOString() : null;
  ev.updatedAt = new Date().toISOString();
  writeEvents(events);
  return task;
}

function removeTask(eventId, taskId) {
  const events = readEvents();
  const ev = events.find(e => e.id === eventId);
  if (!ev || !Array.isArray(ev.tasks)) return false;
  const before = ev.tasks.length;
  ev.tasks = ev.tasks.filter(t => t.id !== taskId);
  if (ev.tasks.length === before) return false;
  ev.updatedAt = new Date().toISOString();
  writeEvents(events);
  return true;
}

/**
 * Erzeugt automatische Aufgaben aus Geraete-Warnungen fuer eine Wohnung.
 * Liest aus dem Status-Aggregator (In-Memory-Caches, kein API-Call).
 * Auto-Tasks werden NICHT gespeichert — sie erscheinen/verschwinden
 * basierend auf dem aktuellen Geraete-Zustand.
 */
function getAutoTasks(apartmentId) {
  let statusService;
  try { statusService = require('./status'); } catch { return []; }
  const status = statusService.aggregate();
  const tasks = [];

  // Offline-Geraete
  if (Array.isArray(status.offlineRooms)) {
    for (const r of status.offlineRooms) {
      if (r.apartmentId !== apartmentId) continue;
      tasks.push({
        id: `auto:offline:${r.roomName}`,
        text: `⚠ ${r.roomName} ist offline (${r.integration}) — bitte pruefen`,
        type: 'auto',
        category: 'offline',
        done: false
      });
    }
  }

  // Batterie schwach
  if (Array.isArray(status.lowBatteries)) {
    for (const b of status.lowBatteries) {
      if (b.apartmentId !== apartmentId) continue;
      tasks.push({
        id: `auto:battery:${b.deviceName}`,
        text: `🔋 ${b.deviceName} Batterie schwach (${b.integration} · ${b.value}) — bitte pruefen/tauschen`,
        type: 'auto',
        category: 'battery',
        done: false
      });
    }
  }

  // Offene Fenster
  if (Array.isArray(status.openWindows)) {
    for (const w of status.openWindows) {
      if (w.apartmentId !== apartmentId) continue;
      tasks.push({
        id: `auto:window:${w.roomName}`,
        text: `🪟 Fenster offen: ${w.roomName} — bitte schliessen`,
        type: 'auto',
        category: 'window',
        done: false
      });
    }
  }

  return tasks;
}

module.exports = {
  start,
  stop,
  syncAll,
  getEvents,
  getEvent,
  setEventState,
  updateEvent,
  readEvents,
  addTask,
  toggleTask,
  removeTask,
  getAutoTasks,
  _clearEvents: () => { try { fs.unlinkSync(EVENTS_PATH); } catch {} }
};
