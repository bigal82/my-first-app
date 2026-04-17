/**
 * Abwesenheitsverwaltung fuer Reinigungsmitarbeiter.
 *
 * Mitarbeiter tragen selbst ein, wann sie nicht verfuegbar sind.
 * Admins sehen die Uebersicht in Zeiterfassung + Gantt.
 * Bei der Reinigungszuweisung werden abwesende Mitarbeiter ausgeblendet.
 *
 * Typen:
 *   vacation  — Urlaub
 *   sick      — Krank
 *   unavailable — Nicht verfuegbar (sonstige Gruende)
 *
 * Gespeichert in CONFIG_DIR/absences.json
 */

const fs = require('fs');
const { configFile } = require('../config-path');

const DATA_PATH = configFile('absences.json');

function readAll() {
  if (!fs.existsSync(DATA_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function writeAll(entries) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(entries, null, 2), 'utf-8');
}

function addAbsence({ cleanerId, fromDate, toDate, type, note }) {
  if (!cleanerId || !fromDate || !toDate) throw new Error('cleanerId, fromDate und toDate erforderlich.');
  if (!['vacation', 'sick', 'unavailable'].includes(type)) type = 'unavailable';
  const entries = readAll();
  const entry = {
    id: 'abs-' + Date.now(),
    cleanerId,
    fromDate, // "2026-04-20"
    toDate,   // "2026-04-25"
    type,
    note: (note || '').trim(),
    createdAt: new Date().toISOString()
  };
  entries.push(entry);
  writeAll(entries);
  return entry;
}

function removeAbsence(id) {
  const entries = readAll();
  const filtered = entries.filter(e => e.id !== id);
  if (filtered.length === entries.length) return false;
  writeAll(filtered);
  return true;
}

/**
 * Alle Abwesenheiten eines Mitarbeiters, optional gefiltert nach Zeitraum.
 */
function getForCleaner(cleanerId, { from, to } = {}) {
  let entries = readAll().filter(e => e.cleanerId === cleanerId);
  if (from) entries = entries.filter(e => e.toDate >= from);
  if (to) entries = entries.filter(e => e.fromDate <= to);
  return entries.sort((a, b) => a.fromDate.localeCompare(b.fromDate));
}

/**
 * Alle Abwesenheiten aller Mitarbeiter in einem Zeitraum.
 */
function getAll({ from, to } = {}) {
  let entries = readAll();
  if (from) entries = entries.filter(e => e.toDate >= from);
  if (to) entries = entries.filter(e => e.fromDate <= to);
  return entries.sort((a, b) => a.fromDate.localeCompare(b.fromDate));
}

/**
 * Prueft ob ein Mitarbeiter an einem bestimmten Tag abwesend ist.
 */
function isAbsent(cleanerId, dateStr) {
  return readAll().some(e =>
    e.cleanerId === cleanerId &&
    e.fromDate <= dateStr &&
    e.toDate >= dateStr
  );
}

/**
 * Gibt alle Mitarbeiter-IDs zurueck die an einem bestimmten Tag abwesend sind.
 */
function absentOnDate(dateStr) {
  return [...new Set(
    readAll()
      .filter(e => e.fromDate <= dateStr && e.toDate >= dateStr)
      .map(e => e.cleanerId)
  )];
}

module.exports = {
  addAbsence,
  removeAbsence,
  getForCleaner,
  getAll,
  isAbsent,
  absentOnDate,
  readAll
};
