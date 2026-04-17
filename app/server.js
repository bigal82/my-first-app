require('dotenv').config();
const express = require('express');
const path = require('path');
const registerRoutes = require('./routes/index');
const sessionAuth = require('./middleware/sessionAuth');
const userStore = require('./services/userStore');
const automationService = require('./services/automation');
const dailyReportService = require('./services/dailyReport');
const cleaningSyncService = require('./services/cleaningSync');
const cleaningMailer = require('./services/cleaningMailer');

// Migration: Admin-User aus ENV erstellen falls users.json noch leer ist
// + calTokens fuer bestehende User/Cleaner nachrüsten
userStore.migrateFromEnv();
require('./services/integrationsStore').migrateCleanerTokens();

// Migration: occupancy.enabled nachziehen wenn Smoobu/iCal konfiguriert ist
(function normalizeApartments() {
  const fs = require('fs');
  const { APARTMENTS } = require('./config-path');
  if (!fs.existsSync(APARTMENTS)) return;
  try {
    const config = JSON.parse(fs.readFileSync(APARTMENTS, 'utf-8'));
    let changed = false;
    for (const apt of (config.apartments || [])) {
      if (!apt.occupancy) continue;
      const occ = apt.occupancy;
      const hasSource = (occ.source === 'smoobu' && occ.smoobuApartmentId) || occ.icalUrl;
      if (hasSource && occ.enabled === undefined) {
        occ.enabled = true;
        changed = true;
        console.log(`[migration] ${apt.name}: occupancy.enabled auf true gesetzt`);
      }
    }
    if (changed) {
      fs.writeFileSync(APARTMENTS, JSON.stringify(config, null, 2), 'utf-8');
      console.log('[migration] apartments.json normalisiert');
    }
  } catch (err) {
    console.error('[migration] Fehler beim Normalisieren:', err.message);
  }
})();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// JSON body parsing (5 MB — Backup/Restore kann groesser werden)
app.use(express.json({ limit: '5mb' }));

// ── Pre-Auth-Endpoints ─────────────────────────────────────────────────────
app.post('/api/auth/login', sessionAuth.login);
app.post('/api/auth/logout', sessionAuth.logout);
app.get('/login', sessionAuth.loginPage);

// iCal-Feed fuer Cleaner-Kalender (KEIN Auth — Token in URL reicht)
app.get('/api/cleaning/calendar/:token.ics', require('./routes/cleaningCalendar'));

// ── Auth-Middleware (alle folgenden Routes sind geschuetzt) ─────────────────
app.use(sessionAuth.middleware);

// ── Server-Zeit (fuer Zeitzonen-Check im Setup) ─────────────────────────────
app.get('/api/server-time', (req, res) => {
  const tz = require('./services/timezone');
  res.json({
    utc: new Date().toISOString(),
    localTime: tz.localTimeStr(),
    localDate: tz.localDateStr(),
    localHour: tz.localHour(),
    timezone: require('./services/integrationsStore').getDashboard().timezone || 'Europe/Berlin'
  });
});

// ── Gemeinsame API: wer bin ich? ────────────────────────────────────────────
app.get('/api/auth/me', (req, res) => {
  // Cookie hat nur id+role. Vollen User nachschlagen fuer displayName etc.
  const full = userStore.getUser(req.user.id);
  if (full) {
    const { passwordHash, ...safe } = full;
    return res.json(safe);
  }
  res.json(req.user);
});

// Static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Vendor
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));
app.use('/vendor/chartjs-adapter-date-fns', express.static(path.join(__dirname, 'node_modules', 'chartjs-adapter-date-fns', 'dist')));
app.use('/vendor/chartjs-plugin-annotation', express.static(path.join(__dirname, 'node_modules', 'chartjs-plugin-annotation', 'dist')));

// ── Admin-only API-Routes ──────────────────────────────────────────────────
// Alle bestehenden API-Routes (apartments, tado, minut, nuki, etc.) sind
// nur fuer Admins. Cleaning-Events sind eine Ausnahme (Cleaner lesen eigene).
app.use('/api/apartments', sessionAuth.requireRole('admin'), require('./routes/apartments'));
app.use('/api/minut',      sessionAuth.requireRole('admin'), require('./routes/minut'));
app.use('/api/nuki',        sessionAuth.requireRole('admin'), require('./routes/nuki'));
app.use('/api/occupancy',   sessionAuth.requireRole('admin'), require('./routes/occupancy'));
app.use('/api/tado',        sessionAuth.requireRole('admin'), require('./routes/tado'));
app.use('/api/integrations', sessionAuth.requireRole('admin'), require('./routes/integrations'));
app.use('/api/status',      sessionAuth.requireRole('admin'), require('./routes/status'));
app.use('/api/automation',  sessionAuth.requireRole('admin'), require('./routes/automation'));
app.use('/api/admin',       sessionAuth.requireRole('admin'), require('./routes/admin'));

// ── User-Verwaltung (admin-only) ────────────────────────────────────────────
app.use('/api/users', sessionAuth.requireRole('admin'), require('./routes/users'));

// ── Cleaning-API (beide Rollen, aber Cleaner sieht nur eigene) ──────────────
app.use('/api/cleaning', require('./routes/cleaning'));

// ── Zeiterfassung (Cleaner: eigene, Admin: alle) ────────────────────────────
app.use('/api/timetracking', require('./routes/timetracking'));

// ── Abwesenheiten (Cleaner: eigene, Admin: alle) ────────────────────────────
app.use('/api/absences', require('./routes/absences'));

// ── Admin-only Seiten ──────────────────────────────────────────────────────
app.get('/setup', sessionAuth.requireRole('admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});
app.get('/apartment/:id', sessionAuth.requireRole('admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'detail.html'));
});
app.get('/cleaning', sessionAuth.requireRole('admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cleaning.html'));
});
app.get('/timetracking', sessionAuth.requireRole('admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'timetracking.html'));
});
app.get('/cleaning/event/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cleaning-event.html'));
});

// ── Cleaner-Dashboard ──────────────────────────────────────────────────────
app.get('/my', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'my.html'));
});

// ── Catch-all: basierend auf Rolle ─────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.user && req.user.role === 'cleaner') {
    return res.redirect(302, '/my');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`FaecherLofts Manager laeuft auf http://localhost:${PORT}`);
  automationService.start();
  dailyReportService.start();
  cleaningSyncService.start();
  cleaningMailer.start();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nFehler: Port ${PORT} ist bereits belegt.`);
    console.error(`Tipp: Setze einen anderen Port mit PORT=XXXX in deiner .env Datei.\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
