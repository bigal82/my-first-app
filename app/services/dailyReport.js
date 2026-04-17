/**
 * Daily-Health-Report-Scheduler.
 *
 * Feuert jeden Tag um 07:00 Uhr Serverzeit einen Report, WENN die
 * Notifications-Config dailyHealthReport=true hat UND mindestens eine
 * Warnung/Offline/Batterie vorliegt.
 *
 * Arbeitsweise:
 *   - Interval alle 60 s
 *   - tick() prueft: Ist jetzt 07:00 und haben wir heute noch nicht gefeuert?
 *   - Vor dem Aggregieren werden alle Integrations proaktiv refreshed,
 *     damit der Report auch frische Daten liefert (caches wuerden sonst
 *     stale oder leer sein, wenn niemand das Dashboard offen hat).
 *   - Letztes Fire-Datum wird in daily-report-state.json im CONFIG_DIR
 *     gespeichert, damit ein Restart nicht zu Doppel-Fires fuehrt.
 */

const fs = require('fs');
const tadoService = require('./tado');
const minutService = require('./minut');
const nukiService = require('./nuki');
const statusService = require('./status');
const notifications = require('./notifications');
const integrationsStore = require('./integrationsStore');
const { APARTMENTS, configFile } = require('../config-path');

const STATE_PATH = configFile('daily-report-state.json');
const POLL_INTERVAL_MS = 60 * 1000;
const FIRE_HOUR = 7;   // 07:00 Lokalzeit

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
  if (!fs.existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) || {};
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[dailyReport] state schreiben fehlgeschlagen:', err.message);
  }
}

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Integrations proaktiv refreshen, damit der Report frische Daten sieht.
// Fehler pro Integration werden geschluckt — wenn z.B. Tado gerade Rate-Limit
// hat, nutzt der Aggregator den letzten Cache-Stand.
async function refreshAllIntegrations() {
  const apartments = readApartments();
  for (const apt of apartments) {
    if (!apt.visible) continue;
    const ints = apt.integrations || {};
    if (ints.tado && ints.tado.enabled) {
      try { await tadoService.getApartmentData(apt); }
      catch (err) { console.warn(`[dailyReport] ${apt.id} Tado refresh fehler:`, err.message); }
    }
    if (ints.minut && ints.minut.enabled && ints.minut.deviceId) {
      try { await minutService.getDeviceStatus(ints.minut.deviceId); }
      catch (err) { console.warn(`[dailyReport] ${apt.id} Minut refresh fehler:`, err.message); }
    }
    if (ints.nuki && ints.nuki.enabled && Array.isArray(ints.nuki.deviceIds) && ints.nuki.deviceIds.length > 0) {
      try { await nukiService.getDevicesForApartment(ints.nuki.deviceIds); }
      catch (err) { console.warn(`[dailyReport] ${apt.id} Nuki refresh fehler:`, err.message); }
    }
  }
}

async function runReport() {
  await refreshAllIntegrations();
  const issues = statusService.aggregate();
  try {
    const result = await notifications.sendHealthReport(issues);
    if (result.sent) {
      console.log(`[dailyReport] Report verschickt an ${result.recipients.length} Empfaenger, ${result.totalIssues} Warnungen`);
    } else {
      console.log(`[dailyReport] Report NICHT verschickt (${result.reason})`);
    }
    return result;
  } catch (err) {
    console.error('[dailyReport] sendHealthReport fehlgeschlagen:', err.message);
    return { sent: false, reason: 'error', error: err.message };
  }
}

async function tick() {
  const cfg = integrationsStore.getNotifications();
  if (!cfg.dailyHealthReport || !cfg.emailTo) return;

  const tz = require('./timezone');
  if (tz.localHour() !== FIRE_HOUR) return;

  const todayKey = tz.localDateStr();
  const state = readState();
  if (state.lastSentDate === todayKey) return; // heute schon gefeuert

  // Vor dem Fire State markieren, damit parallele Ticks nicht doppelt senden
  writeState({ lastSentDate: todayKey, lastSentAt: new Date().toISOString() });
  await runReport();
}

let intervalHandle = null;

function start() {
  if (intervalHandle) return;
  console.log(`[dailyReport] Scheduler gestartet (prueft minuetlich ob ${FIRE_HOUR}:00 erreicht ist)`);
  intervalHandle = setInterval(() => {
    tick().catch(err => console.error('[dailyReport] tick fehler:', err.message));
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
  tick,
  runReport, // fuer manuelle Trigger / Setup-Button "Jetzt senden"
  _clearState: () => { try { fs.unlinkSync(STATE_PATH); } catch {} }
};
