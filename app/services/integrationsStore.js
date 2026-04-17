/**
 * Integrations Store (PROJ-7)
 *
 * Globale Integration-Credentials (Minut, Nuki, ...) aus
 * config/integrations.json. Wird ueber die Setup-Seite gepflegt.
 *
 * Fallback: wenn die Datei leer/fehlt, werden ENV-Variablen
 * (MINUT_CLIENT_ID/SECRET, NUKI_API_TOKEN) als Backwards-Compat gelesen.
 */

const fs = require('fs');
const { INTEGRATIONS: STORE_PATH } = require('../config-path');

function read() {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
  } catch (err) {
    console.error('integrationsStore: JSON-Parse-Fehler:', err.message);
    return {};
  }
}

function write(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Liefert die effektive Konfiguration fuer Minut.
 * Config-Datei hat Prioritaet, sonst Fallback auf ENV.
 */
function getMinut() {
  const store = read();
  const fromFile = (store.minut || {});
  return {
    clientId: fromFile.clientId || process.env.MINUT_CLIENT_ID || null,
    clientSecret: fromFile.clientSecret || process.env.MINUT_CLIENT_SECRET || null
  };
}

function setMinut({ clientId, clientSecret }) {
  const store = read();
  store.minut = { clientId: clientId || '', clientSecret: clientSecret || '' };
  write(store);
}

function getSmoobu() {
  const store = read();
  const fromFile = (store.smoobu || {});
  return {
    apiKey: fromFile.apiKey || process.env.SMOOBU_API_KEY || null
  };
}

function setSmoobu({ apiKey }) {
  const store = read();
  store.smoobu = { apiKey: apiKey || '' };
  write(store);
}

function getNuki() {
  const store = read();
  const fromFile = (store.nuki || {});
  return {
    apiToken: fromFile.apiToken || process.env.NUKI_API_TOKEN || null
  };
}

function setNuki({ apiToken }) {
  const store = read();
  store.nuki = { apiToken: apiToken || '' };
  write(store);
}

/**
 * Notifications-Config (E-Mail-Versand bei Tado-Aktionen).
 * Secrets (SMTP-Password) werden nie ans Frontend zurueckgegeben.
 */
function getNotifications() {
  const store = read();
  const fromFile = (store.notifications || {});
  return {
    emailTo:         fromFile.emailTo || '',
    notifyAutomation: !!fromFile.notifyAutomation,
    notifyManual:     !!fromFile.notifyManual,
    dailyHealthReport: !!fromFile.dailyHealthReport,
    smtpHost: fromFile.smtpHost || process.env.SMTP_HOST || '',
    smtpPort: Number(fromFile.smtpPort || process.env.SMTP_PORT || 587),
    smtpUser: fromFile.smtpUser || process.env.SMTP_USER || '',
    smtpPass: fromFile.smtpPass || process.env.SMTP_PASS || '',
    smtpFrom: fromFile.smtpFrom || process.env.SMTP_FROM || ''
  };
}

function setNotifications(patch) {
  const store = read();
  const current = store.notifications || {};
  // Leere Strings im Patch ueberschreiben bestehende Werte (wenn User ein
  // Feld absichtlich leert). Nicht-gesetzte Keys bleiben erhalten.
  const next = { ...current };
  for (const key of ['emailTo', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpFrom']) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (patch.notifyAutomation !== undefined)  next.notifyAutomation  = !!patch.notifyAutomation;
  if (patch.notifyManual !== undefined)      next.notifyManual      = !!patch.notifyManual;
  if (patch.dailyHealthReport !== undefined) next.dailyHealthReport = !!patch.dailyHealthReport;
  store.notifications = next;
  write(store);
}

/**
 * Dashboard-Einstellungen (z.B. Auto-Refresh-Intervall).
 * Wird per /api/integrations mitausgeliefert.
 */
function getDashboard() {
  const store = read();
  const fromFile = (store.dashboard || {});
  const raw = Number(fromFile.refreshIntervalMinutes);
  let minutes = isFinite(raw) && raw > 0 ? Math.round(raw) : 15;
  if (minutes < 1) minutes = 1;
  if (minutes > 120) minutes = 120;
  // Tages-Mail an Mitarbeiter
  const cleaningMailEnabled = !!fromFile.cleaningMailEnabled;
  const rawMailHour = Number(fromFile.cleaningMailHour);
  const cleaningMailHour = isFinite(rawMailHour) && rawMailHour >= 0 && rawMailHour <= 23 ? rawMailHour : 7;
  const rawEveningHour = Number(fromFile.cleaningMailEveningHour);
  const cleaningMailEveningHour = isFinite(rawEveningHour) && rawEveningHour >= 0 && rawEveningHour <= 23 ? rawEveningHour : 20;
  const cleaningMailAdminCopy = !!fromFile.cleaningMailAdminCopy;
  // Tage im Voraus fuer Reinigungsplanung + Cleaner-Ansicht
  const rawDays = Number(fromFile.cleaningDaysAhead);
  let daysAhead = isFinite(rawDays) && rawDays > 0 ? Math.round(rawDays) : 21;
  if (daysAhead < 3) daysAhead = 3;
  if (daysAhead > 90) daysAhead = 90;
  const timezone = fromFile.timezone || 'Europe/Berlin';
  return { refreshIntervalMinutes: minutes, cleaningDaysAhead: daysAhead, cleaningMailEnabled, cleaningMailHour, cleaningMailEveningHour, cleaningMailAdminCopy, timezone };
}

function setDashboard(patch) {
  const store = read();
  const current = store.dashboard || {};
  const next = { ...current };
  if (patch.refreshIntervalMinutes !== undefined) {
    const n = Math.round(Number(patch.refreshIntervalMinutes));
    if (isFinite(n) && n >= 1 && n <= 120) next.refreshIntervalMinutes = n;
  }
  if (patch.cleaningDaysAhead !== undefined) {
    const n = Math.round(Number(patch.cleaningDaysAhead));
    if (isFinite(n) && n >= 3 && n <= 90) next.cleaningDaysAhead = n;
  }
  if (patch.cleaningMailEnabled !== undefined) next.cleaningMailEnabled = !!patch.cleaningMailEnabled;
  if (patch.cleaningMailHour !== undefined) {
    const h = Math.round(Number(patch.cleaningMailHour));
    if (isFinite(h) && h >= 0 && h <= 23) next.cleaningMailHour = h;
  }
  if (patch.cleaningMailEveningHour !== undefined) {
    const h = Math.round(Number(patch.cleaningMailEveningHour));
    if (isFinite(h) && h >= 0 && h <= 23) next.cleaningMailEveningHour = h;
  }
  if (patch.cleaningMailAdminCopy !== undefined) next.cleaningMailAdminCopy = !!patch.cleaningMailAdminCopy;
  if (patch.timezone !== undefined && typeof patch.timezone === 'string') next.timezone = patch.timezone.trim();
  store.dashboard = next;
  write(store);
}

/**
 * Status-Info fuer das Frontend. Secrets werden NIE zurueckgegeben,
 * nur ein boolean-Flag „ist gesetzt?".
 */
function getPublicStatus() {
  const minut = getMinut();
  const nuki = getNuki();
  const smoobu = getSmoobu();
  const notif = getNotifications();
  return {
    minut: {
      clientIdSet: !!minut.clientId,
      clientSecretSet: !!minut.clientSecret
    },
    nuki: {
      apiTokenSet: !!nuki.apiToken
    },
    smoobu: {
      apiKeySet: !!smoobu.apiKey
    },
    notifications: {
      emailTo: notif.emailTo,
      notifyAutomation: notif.notifyAutomation,
      notifyManual: notif.notifyManual,
      dailyHealthReport: notif.dailyHealthReport,
      smtpHost: notif.smtpHost,
      smtpPort: notif.smtpPort,
      smtpUser: notif.smtpUser,
      smtpFrom: notif.smtpFrom,
      smtpPassSet: !!notif.smtpPass  // Boolean, nie das Klartext-Passwort
    },
    dashboard: getDashboard()
  };
}

function _clearAll() {
  if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
}

// ── Reinigungsmitarbeiter ──────────────────────────────────────────────────

function getCleaners() {
  const store = read();
  return Array.isArray(store.cleaners) ? store.cleaners : [];
}

function setCleaners(cleaners) {
  const store = read();
  store.cleaners = Array.isArray(cleaners) ? cleaners : [];
  write(store);
}

function generateCalToken() {
  return require('crypto').randomBytes(24).toString('base64url');
}

function addCleaner({ name, phone, email, apartments, monthlyHours, hourlyRate }) {
  const store = read();
  if (!Array.isArray(store.cleaners)) store.cleaners = [];
  const id = 'c-' + Date.now();
  store.cleaners.push({
    id,
    name: (name || '').trim(),
    phone: (phone || '').trim(),
    email: (email || '').trim(),
    apartments: Array.isArray(apartments) ? apartments : [],
    monthlyHours: Number(monthlyHours) || 0,
    hourlyRate: Number(hourlyRate) || 15,
    calToken: generateCalToken()
  });
  write(store);
  return id;
}

function updateCleaner(id, patch) {
  const store = read();
  if (!Array.isArray(store.cleaners)) return null;
  const cleaner = store.cleaners.find(c => c.id === id);
  if (!cleaner) return null;
  if (patch.name !== undefined) cleaner.name = patch.name.trim();
  if (patch.phone !== undefined) cleaner.phone = patch.phone.trim();
  if (patch.email !== undefined) cleaner.email = patch.email.trim();
  if (patch.apartments !== undefined) cleaner.apartments = Array.isArray(patch.apartments) ? patch.apartments : [];
  if (patch.monthlyHours !== undefined) cleaner.monthlyHours = Number(patch.monthlyHours) || 0;
  if (patch.hourlyRate !== undefined) cleaner.hourlyRate = Number(patch.hourlyRate) || 15;
  write(store);
  return cleaner;
}

function getCleanerByCalToken(token) {
  if (!token) return null;
  const cleaners = getCleaners();
  return cleaners.find(c => c.calToken === token) || null;
}

function ensureCalToken(id) {
  const store = read();
  const cleaner = (store.cleaners || []).find(c => c.id === id);
  if (!cleaner) return null;
  if (!cleaner.calToken) {
    cleaner.calToken = generateCalToken();
    write(store);
  }
  return cleaner.calToken;
}

/**
 * Alle Cleaner ohne calToken nachrüsten. Einmal beim Server-Start aufrufen.
 */
function migrateCleanerTokens() {
  const store = read();
  if (!Array.isArray(store.cleaners)) return;
  let patched = false;
  for (const c of store.cleaners) {
    if (!c.calToken) {
      c.calToken = generateCalToken();
      patched = true;
    }
  }
  if (patched) write(store);
}

function removeCleaner(id) {
  const store = read();
  if (!Array.isArray(store.cleaners)) return false;
  const before = store.cleaners.length;
  store.cleaners = store.cleaners.filter(c => c.id !== id);
  write(store);
  return store.cleaners.length < before;
}

module.exports = {
  getMinut, setMinut,
  getNuki, setNuki,
  getSmoobu, setSmoobu,
  getNotifications, setNotifications,
  getDashboard, setDashboard,
  getCleaners, setCleaners, addCleaner, updateCleaner, removeCleaner,
  getCleanerByCalToken, ensureCalToken, migrateCleanerTokens,
  getPublicStatus,
  _clearAll,
  STORE_PATH
};
