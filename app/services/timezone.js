/**
 * Zeitzonen-Helper.
 *
 * Server laeuft in UTC (Docker-Default). Alle Scheduler muessen die
 * konfigurierte lokale Zeitzone (z.B. Europe/Berlin) beruecksichtigen.
 */

const integrationsStore = require('./integrationsStore');

/**
 * Gibt die aktuelle Stunde in der konfigurierten Zeitzone zurueck (0-23).
 */
function localHour() {
  const tz = integrationsStore.getDashboard().timezone || 'Europe/Berlin';
  const str = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date());
  return parseInt(str, 10);
}

/**
 * Gibt das aktuelle Datum als YYYY-MM-DD in der konfigurierten Zeitzone zurueck.
 */
function localDateStr() {
  const tz = integrationsStore.getDashboard().timezone || 'Europe/Berlin';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); // en-CA = YYYY-MM-DD
  return parts;
}

/**
 * Gibt das morgige Datum als YYYY-MM-DD in der konfigurierten Zeitzone zurueck.
 */
function tomorrowDateStr() {
  const tz = integrationsStore.getDashboard().timezone || 'Europe/Berlin';
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(tomorrow);
}

/**
 * Gibt die aktuelle Uhrzeit als HH:MM in der konfigurierten Zeitzone zurueck.
 */
function localTimeStr() {
  const tz = integrationsStore.getDashboard().timezone || 'Europe/Berlin';
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date());
}

/**
 * Erstellt ein Date-Objekt fuer eine bestimmte Uhrzeit am heutigen Tag
 * in der konfigurierten Zeitzone. Fuer checkout/checkin-Vergleiche.
 */
function todayAt(hour, minute = 0) {
  const dateStr = localDateStr();
  // Erzeuge ISO-String und parse — nicht perfekt bei DST-Wechsel, aber
  // fuer 10:00/16:00 Vergleiche ausreichend genau.
  const tz = integrationsStore.getDashboard().timezone || 'Europe/Berlin';
  const d = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
  // Korrektur: das Date ist in lokaler Server-Zeit, wir brauchen es in der Ziel-TZ.
  // Einfacher Weg: Offset berechnen.
  const utcNow = new Date();
  const localNowStr = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: tz
  }).format(utcNow);
  // Parse "MM/DD/YYYY, HH:MM:SS"
  const [datePart, timePart] = localNowStr.split(', ');
  const [mo, da, yr] = datePart.split('/');
  const [hh, mm, ss] = timePart.split(':');
  const localAsUtc = new Date(`${yr}-${mo}-${da}T${hh}:${mm}:${ss}Z`);
  const offsetMs = utcNow.getTime() - localAsUtc.getTime();
  // Target: dateStr bei hour:minute in der Ziel-TZ
  return new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`).getTime() + offsetMs;
}

module.exports = { localHour, localDateStr, tomorrowDateStr, localTimeStr, todayAt };
