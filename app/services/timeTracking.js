/**
 * Zeiterfassung fuer Reinigungsmitarbeiter.
 *
 * Jeder Eintrag ist ein Arbeitstag mit Clock-In, Pausen und Clock-Out.
 * Gespeichert in CONFIG_DIR/timetracking.json.
 *
 * Status-Flow: clockIn → pause/resume (beliebig oft) → clockOut
 */

const fs = require('fs');
const { configFile } = require('../config-path');

const DATA_PATH = configFile('timetracking.json');

function readEntries() {
  if (!fs.existsSync(DATA_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function writeEntries(entries) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(entries, null, 2), 'utf-8');
}

/**
 * Berechnet die Netto-Arbeitsminuten eines Eintrags.
 */
function computeMinutes(entry) {
  if (!entry.clockIn) return 0;
  const end = entry.clockOut ? new Date(entry.clockOut) : new Date();
  const start = new Date(entry.clockIn);
  let totalMs = end.getTime() - start.getTime();

  // Pausen abziehen
  for (const b of (entry.breaks || [])) {
    const bStart = new Date(b.start);
    const bEnd = b.end ? new Date(b.end) : new Date(); // laufende Pause
    totalMs -= (bEnd.getTime() - bStart.getTime());
  }

  return Math.max(0, Math.round(totalMs / 60000));
}

/**
 * Gibt den aktuell laufenden Eintrag eines Cleaners zurueck (oder null).
 */
function getActiveEntry(cleanerId) {
  return readEntries().find(e => e.cleanerId === cleanerId && e.status !== 'completed') || null;
}

/**
 * Einstempeln.
 */
function clockIn(cleanerId) {
  const entries = readEntries();
  const active = entries.find(e => e.cleanerId === cleanerId && e.status !== 'completed');
  if (active) throw new Error('Bereits eingestempelt.');

  const entry = {
    id: 'tt-' + Date.now(),
    cleanerId,
    date: new Date().toISOString().slice(0, 10),
    clockIn: new Date().toISOString(),
    clockOut: null,
    breaks: [],
    totalMinutes: 0,
    status: 'active' // active | paused | completed
  };
  entries.push(entry);
  writeEntries(entries);
  return entry;
}

/**
 * Pause starten.
 */
function pauseStart(cleanerId) {
  const entries = readEntries();
  const entry = entries.find(e => e.cleanerId === cleanerId && e.status === 'active');
  if (!entry) throw new Error('Nicht eingestempelt oder bereits in Pause.');
  entry.breaks.push({ start: new Date().toISOString(), end: null });
  entry.status = 'paused';
  writeEntries(entries);
  return entry;
}

/**
 * Pause beenden.
 */
function pauseEnd(cleanerId) {
  const entries = readEntries();
  const entry = entries.find(e => e.cleanerId === cleanerId && e.status === 'paused');
  if (!entry) throw new Error('Nicht in Pause.');
  const openBreak = entry.breaks.find(b => !b.end);
  if (openBreak) openBreak.end = new Date().toISOString();
  entry.status = 'active';
  writeEntries(entries);
  return entry;
}

/**
 * Ausstempeln.
 */
function clockOut(cleanerId) {
  const entries = readEntries();
  const entry = entries.find(e => e.cleanerId === cleanerId && e.status !== 'completed');
  if (!entry) throw new Error('Nicht eingestempelt.');

  // Offene Pause automatisch beenden
  const openBreak = entry.breaks.find(b => !b.end);
  if (openBreak) openBreak.end = new Date().toISOString();

  entry.clockOut = new Date().toISOString();
  entry.status = 'completed';
  entry.totalMinutes = computeMinutes(entry);
  writeEntries(entries);
  return entry;
}

/**
 * Monatliche Zusammenfassung fuer einen Cleaner.
 */
function getMonthlySummary(cleanerId, year, month) {
  const entries = readEntries().filter(e => {
    if (e.cleanerId !== cleanerId) return false;
    const d = new Date(e.date);
    return d.getFullYear() === year && (d.getMonth() + 1) === month;
  });

  // Nur completed + active/paused zaehlen. Pending (noch nicht genehmigt)
  // und rejected werden NICHT mitgezaehlt.
  const countable = entries.filter(e => e.status === 'completed' || e.status === 'active' || e.status === 'paused');
  const totalMinutes = countable.reduce((sum, e) => sum + (e.totalMinutes || computeMinutes(e)), 0);
  const days = entries.filter(e => e.status === 'completed').length;

  return {
    year,
    month,
    cleanerId,
    entries,
    totalMinutes,
    totalHours: Math.round(totalMinutes / 6) / 10, // 1 Dezimalstelle
    workDays: days
  };
}

/**
 * Alle Monate mit Eintraegen fuer einen Cleaner.
 */
function getMonthsList(cleanerId) {
  const entries = readEntries().filter(e => e.cleanerId === cleanerId);
  const months = new Set();
  for (const e of entries) {
    months.add(e.date.slice(0, 7)); // "2026-04"
  }
  return Array.from(months).sort().reverse();
}

/**
 * Alle Eintraege eines Cleaners (fuer Admin-Auswertung).
 */
function getEntriesForCleaner(cleanerId, { from, to } = {}) {
  let entries = readEntries().filter(e => e.cleanerId === cleanerId);
  if (from) entries = entries.filter(e => e.date >= from);
  if (to) entries = entries.filter(e => e.date <= to);
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

// ── Admin: Eintraege bearbeiten/loeschen/hinzufuegen ────────────────────────

const AUDIT_PATH = configFile('timetracking-audit.json');

function readAudit() {
  if (!fs.existsSync(AUDIT_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function writeAudit(entries) {
  // Max 500 Eintraege
  fs.writeFileSync(AUDIT_PATH, JSON.stringify(entries.slice(-500), null, 2), 'utf-8');
}

function audit(action, adminUser, entryId, details) {
  const log = readAudit();
  log.push({
    timestamp: new Date().toISOString(),
    action,
    adminUser,
    entryId,
    details
  });
  writeAudit(log);
}

/**
 * Admin erstellt einen manuellen Eintrag.
 */
function adminCreateEntry(adminUser, { cleanerId, date, clockIn: ci, clockOut: co, breaks }) {
  const entries = readEntries();
  const entry = {
    id: 'tt-' + Date.now(),
    cleanerId,
    date: date || new Date(ci).toISOString().slice(0, 10),
    clockIn: ci,
    clockOut: co || null,
    breaks: Array.isArray(breaks) ? breaks : [],
    totalMinutes: 0,
    status: co ? 'completed' : 'active'
  };
  if (co) entry.totalMinutes = computeMinutes(entry);
  entries.push(entry);
  writeEntries(entries);
  audit('create', adminUser, entry.id, { cleanerId, date: entry.date, clockIn: ci, clockOut: co });
  return entry;
}

/**
 * Admin bearbeitet einen Eintrag.
 */
function adminUpdateEntry(adminUser, entryId, patch) {
  const entries = readEntries();
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return null;

  const before = { clockIn: entry.clockIn, clockOut: entry.clockOut, breaks: JSON.stringify(entry.breaks) };

  if (patch.clockIn !== undefined) entry.clockIn = patch.clockIn;
  if (patch.clockOut !== undefined) {
    entry.clockOut = patch.clockOut;
    entry.status = patch.clockOut ? 'completed' : entry.status;
  }
  if (patch.date !== undefined) entry.date = patch.date;
  if (patch.breaks !== undefined) entry.breaks = patch.breaks;

  entry.totalMinutes = computeMinutes(entry);
  writeEntries(entries);

  audit('update', adminUser, entryId, {
    before,
    after: { clockIn: entry.clockIn, clockOut: entry.clockOut, breaks: JSON.stringify(entry.breaks) }
  });
  return entry;
}

/**
 * Admin loescht einen Eintrag.
 */
function adminDeleteEntry(adminUser, entryId) {
  const entries = readEntries();
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return false;

  audit('delete', adminUser, entryId, {
    cleanerId: entry.cleanerId,
    date: entry.date,
    clockIn: entry.clockIn,
    clockOut: entry.clockOut,
    totalMinutes: entry.totalMinutes
  });

  const filtered = entries.filter(e => e.id !== entryId);
  writeEntries(filtered);
  return true;
}

function getAuditLog(limit = 50) {
  return readAudit().slice(-limit).reverse();
}

/**
 * Mitarbeiter traegt Zeit nach. Wird als 'pending' gespeichert
 * und muss vom Admin genehmigt werden bevor sie zaehlt.
 */
function submitManualEntry(cleanerId, { date, clockIn: ci, clockOut: co, note }) {
  if (!cleanerId || !date || !ci || !co) throw new Error('Alle Felder erforderlich.');
  const entries = readEntries();
  const entry = {
    id: 'tt-' + Date.now(),
    cleanerId,
    date,
    clockIn: ci,
    clockOut: co,
    breaks: [],
    totalMinutes: 0,
    status: 'pending', // pending → approved | rejected
    note: (note || '').trim(),
    submittedAt: new Date().toISOString()
  };
  entry.totalMinutes = computeMinutes(entry);
  entries.push(entry);
  writeEntries(entries);
  return entry;
}

/**
 * Admin genehmigt oder lehnt einen nachgetragenen Eintrag ab.
 */
function reviewEntry(adminUser, entryId, decision) {
  const entries = readEntries();
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return null;
  if (entry.status !== 'pending') throw new Error('Nur ausstehende Eintraege koennen reviewed werden.');

  if (decision === 'approve') {
    entry.status = 'completed';
    entry.reviewedBy = adminUser;
    entry.reviewedAt = new Date().toISOString();
    audit('approve', adminUser, entryId, { date: entry.date, cleanerId: entry.cleanerId });
  } else if (decision === 'reject') {
    entry.status = 'rejected';
    entry.reviewedBy = adminUser;
    entry.reviewedAt = new Date().toISOString();
    audit('reject', adminUser, entryId, { date: entry.date, cleanerId: entry.cleanerId });
  } else {
    throw new Error('decision muss approve oder reject sein.');
  }

  writeEntries(entries);
  return entry;
}

/**
 * Alle ausstehenden Nachtraege (fuer Admin-Dashboard).
 */
function getPendingEntries() {
  return readEntries().filter(e => e.status === 'pending');
}

module.exports = {
  clockIn,
  clockOut,
  pauseStart,
  pauseEnd,
  getActiveEntry,
  getMonthlySummary,
  getMonthsList,
  getEntriesForCleaner,
  computeMinutes,
  readEntries,
  adminCreateEntry,
  adminUpdateEntry,
  adminDeleteEntry,
  getAuditLog,
  submitManualEntry,
  reviewEntry,
  getPendingEntries
};
