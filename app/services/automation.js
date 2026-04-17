/**
 * Heizungs-Automation via iCal.
 *
 * Alle 60 Sekunden werden die iCal-Feeds aller Wohnungen mit aktivem
 * Automation-Toggle geprueft. Fuer jedes gefundene VEVENT mit Gastname
 * werden zwei Aktionen ausgefuehrt, wenn die jeweilige Zeit in den letzten
 * 5 Minuten lag und wir die Aktion noch nicht ausgefuehrt haben:
 *   - Check-in-Zeit  → tadoService.resumeAll    (Plan fortsetzen)
 *   - Check-out-Zeit → tadoService.allOff       (alle Raeume aus)
 *
 * Blocker (leerer Titel oder typische "blocked"-Patterns) werden komplett
 * uebersprungen.
 *
 * Persistenz:
 *   automation-log.json   – Chronologie der ausgefuehrten Aktionen (max 500)
 *   automation-state.json – Executed-Keys, damit nach Restart keine
 *                           Doppel-Ausfuehrungen passieren
 *
 * Log-Rotation schneidet auf die neuesten 500 Eintraege, damit die Datei
 * nicht unbegrenzt waechst.
 */

const fs = require('fs');
const path = require('path');
const occupancyService = require('./occupancy');
const tadoService = require('./tado');
const actionLog = require('./actionLog');
const { CONFIG_DIR, APARTMENTS, configFile } = require('../config-path');
const tz = require('./timezone');

const STATE_PATH = configFile('automation-state.json');

const POLL_INTERVAL_MS = 60 * 1000;        // alle 60 s pollen
const CATCH_UP_WINDOW_MS = 5 * 60 * 1000;  // Aktionen der letzten 5 min
const MAX_EVENTS_PER_APT = 20;             // Schutz gegen kaputte Feeds

// Typische Blocker-Summaries (case-insensitive exact match nach trim)
const BLOCKER_PATTERNS = [
  '',
  'blocked',
  'blockierung',
  'closed',
  'closed - not available',
  'nicht verfuegbar',
  'nicht verfügbar',
  'not available',
  'unavailable'
];

function isBlocker(summary) {
  const s = (summary || '').toString().trim().toLowerCase();
  return BLOCKER_PATTERNS.includes(s);
}

function readApartments() {
  if (!fs.existsSync(APARTMENTS)) return [];
  try {
    const cfg = JSON.parse(fs.readFileSync(APARTMENTS, 'utf-8'));
    return Array.isArray(cfg.apartments) ? cfg.apartments : [];
  } catch {
    return [];
  }
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) return { executed: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    return { executed: Array.isArray(raw.executed) ? raw.executed : [] };
  } catch {
    return { executed: [] };
  }
}

function writeState(state) {
  try {
    // State-Set auf max 2000 Keys begrenzen (ca. 1-2 Jahre Betrieb)
    const executed = state.executed.slice(-2000);
    fs.writeFileSync(STATE_PATH, JSON.stringify({ executed }, null, 2), 'utf-8');
  } catch (err) {
    console.error('[automation] state schreiben fehlgeschlagen:', err.message);
  }
}

// Log-Funktionen laufen jetzt ueber services/actionLog.js (gemeinsames Log
// fuer Automation und manuelle Klicks).
function readLog() { return actionLog.read(); }

// Stable event key fuer State-Tracking: UID + action-Typ
function eventKey(apartmentId, eventId, actionType) {
  return `${apartmentId}:${eventId}:${actionType}`;
}

// ── Core: Tick ──────────────────────────────────────────────────────────────

async function tick() {
  const now = Date.now();
  const windowStart = now - CATCH_UP_WINDOW_MS;

  const apartments = readApartments();
  const state = readState();
  const executedSet = new Set(state.executed);
  let stateChanged = false;

  for (const apt of apartments) {
    const automation = apt.automation || {};
    if (!automation.enabled) continue;
    const occ = apt.occupancy || {};
    const hasSmoobu = occ.source === 'smoobu' && occ.smoobuApartmentId;
    if (!occ.enabled && !hasSmoobu) continue;

    // Smoobu: echte Uhrzeiten, kein Default-Mapping noetig
    if (occ.source === 'smoobu' && occ.smoobuApartmentId) {
      try {
        const smoobu = require('./smoobu');
        const today = tz.localDateStr();
        const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const { bookings } = await smoobu.getBookings(occ.smoobuApartmentId, today, future);

        for (const bk of bookings) {
          if (bk.isBlocked || bk.isCancelled) continue;
          if (isBlocker(bk.guest)) continue;
          const ciMs = new Date(bk.checkIn).getTime();
          const coMs = new Date(bk.checkOut).getTime();

          if (ciMs >= windowStart && ciMs <= now) {
            const key = eventKey(apt.id, bk.id, 'checkin');
            if (!executedSet.has(key)) {
              const logEntry = await runAction(apt, 'checkin', { summary: bk.guest, start: new Date(bk.checkIn), end: new Date(bk.checkOut) });
              actionLog.append(logEntry);
              executedSet.add(key); state.executed.push(key); stateChanged = true;
            }
          }
          if (coMs >= windowStart && coMs <= now) {
            const key = eventKey(apt.id, bk.id, 'checkout');
            if (!executedSet.has(key)) {
              const logEntry = await runAction(apt, 'checkout', { summary: bk.guest, start: new Date(bk.checkIn), end: new Date(bk.checkOut) });
              actionLog.append(logEntry);
              executedSet.add(key); state.executed.push(key); stateChanged = true;
            }
          }
        }
      } catch (err) {
        console.warn(`[automation] ${apt.id}: Smoobu fehlgeschlagen:`, err.message);
      }
      continue; // naechste Wohnung
    }

    // Fallback: iCal
    if (!occ.icalUrl) continue;
    let parsed;
    try {
      parsed = await occupancyService.fetchIcal(occ.icalUrl);
    } catch (err) {
      console.warn(`[automation] ${apt.id}: iCal-Fetch fehlgeschlagen:`, err.message);
      continue;
    }

    // VEVENTs extrahieren
    const events = [];
    for (const key of Object.keys(parsed)) {
      const ev = parsed[key];
      if (!ev || ev.type !== 'VEVENT') continue;
      if (!ev.start || !ev.end) continue;
      const evStart = new Date(ev.start);
      const evEnd = new Date(ev.end);

      // Wenn date-only (Mitternacht UTC) → Checkout/Checkin-Stunden anwenden.
      // Stunden sind in der konfigurierten lokalen Zeitzone gemeint.
      const occ = apt.occupancy || {};
      const checkoutHour = occ.checkoutHour ?? 10;
      const checkinHour = occ.checkinHour ?? 16;
      const dashboard = require('./integrationsStore').getDashboard();
      const tzName = dashboard.timezone || 'Europe/Berlin';

      function applyLocalHour(d, hour) {
        if (d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0) return d; // hat schon eine Uhrzeit
        // Berechne UTC-Offset fuer die konfigurierte Zeitzone
        const utcNow = new Date();
        const localStr = new Intl.DateTimeFormat('en-US', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false, timeZone: tzName
        }).format(utcNow);
        const [dp, tp] = localStr.split(', ');
        const [mo, da, yr] = dp.split('/');
        const [hh, mm, ss] = tp.split(':');
        const localAsUtc = new Date(`${yr}-${mo}-${da}T${hh}:${mm}:${ss}Z`);
        const offsetMs = utcNow.getTime() - localAsUtc.getTime();
        // Setze die gewuenschte lokale Stunde und konvertiere nach UTC
        const result = new Date(d);
        result.setUTCHours(hour, 0, 0, 0);
        result.setTime(result.getTime() + offsetMs);
        return result;
      }

      events.push({
        id: ev.uid || `${evStart}-${evEnd}`,
        summary: (ev.summary || '').toString(),
        start: applyLocalHour(evStart, checkinHour),
        end: applyLocalHour(evEnd, checkoutHour)
      });
      if (events.length >= MAX_EVENTS_PER_APT) break;
    }

    // Nur Events mit Check-in/Check-out im Catch-up-Window betrachten
    for (const ev of events) {
      if (isBlocker(ev.summary)) continue;

      const checkInMs  = ev.start.getTime();
      const checkOutMs = ev.end.getTime();

      // Check-in
      if (checkInMs >= windowStart && checkInMs <= now) {
        const key = eventKey(apt.id, ev.id, 'checkin');
        if (!executedSet.has(key)) {
          const logEntry = await runAction(apt, 'checkin', ev);
          actionLog.append(logEntry);
          executedSet.add(key);
          state.executed.push(key);
          stateChanged = true;
        }
      }

      // Check-out
      if (checkOutMs >= windowStart && checkOutMs <= now) {
        const key = eventKey(apt.id, ev.id, 'checkout');
        if (!executedSet.has(key)) {
          const logEntry = await runAction(apt, 'checkout', ev);
          actionLog.append(logEntry);
          executedSet.add(key);
          state.executed.push(key);
          stateChanged = true;
        }
      }
    }
  }

  if (stateChanged) writeState(state);
}

async function runAction(apt, actionType, event) {
  const actionName = actionType === 'checkin' ? 'resumeAll' : 'allOff';
  const entry = {
    timestamp: new Date().toISOString(),
    source: 'automation',
    apartmentId: apt.id,
    apartmentName: apt.name,
    action: actionType,
    actionLabel: actionType === 'checkin' ? 'Plan fortsetzen' : 'Alles aus',
    eventTitle: event.summary,
    eventStart: event.start.toISOString(),
    eventEnd: event.end.toISOString(),
    triggerTime: (actionType === 'checkin' ? event.start : event.end).toISOString()
  };

  try {
    const tado = apt.integrations && apt.integrations.tado;
    if (!tado || !tado.enabled) {
      throw new Error('Tado-Integration nicht aktiv');
    }
    const result = actionType === 'checkin'
      ? await tadoService.resumeAll(apt)
      : await tadoService.allOff(apt);

    entry.result = result.success ? 'success' : 'partial';
    entry.message = result.message || null;
    if (result.failedRooms && result.failedRooms.length > 0) {
      entry.failedRooms = result.failedRooms;
    }
    console.log(`[automation] ${apt.name}: ${actionType} ausgefuehrt (${entry.result})`);
  } catch (err) {
    entry.result = 'error';
    entry.message = err.message;
    console.error(`[automation] ${apt.name}: ${actionType} fehlgeschlagen:`, err.message);
  }

  return entry;
}

// ── Scheduler-Steuerung ─────────────────────────────────────────────────────

let intervalHandle = null;

function start() {
  if (intervalHandle) return;
  console.log(`[automation] Scheduler gestartet (alle ${POLL_INTERVAL_MS / 1000}s, CONFIG_DIR=${CONFIG_DIR})`);
  // Nicht sofort feuern — erst nach dem ersten Intervall, damit Boot-Zeit
  // sich normalisiert und keine stale Events aus der Zeit vor dem letzten
  // Shutdown fliegen.
  intervalHandle = setInterval(() => {
    tick().catch(err => console.error('[automation] tick fehler:', err.message));
  }, POLL_INTERVAL_MS);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  start,
  stop,
  tick,        // fuer manuelle Trigger / Tests
  readLog,
  readState,
  isBlocker,   // fuer Tests
  _clearState: () => { try { fs.unlinkSync(STATE_PATH); } catch {} },
  _clearLog:   () => actionLog._clear()
};
