const express = require('express');
const integrationsStore = require('../services/integrationsStore');
const minutService = require('../services/minut');
const nukiService = require('../services/nuki');
const smoobuService = require('../services/smoobu');
const notifications = require('../services/notifications');
const dailyReport = require('../services/dailyReport');

const router = express.Router();

// GET /api/integrations
// Status aller Integration-Credentials (Secrets werden NIE mitgeliefert).
router.get('/', (req, res) => {
  res.json(integrationsStore.getPublicStatus());
});

// PUT /api/integrations
// Speichert neue Credentials.
// Body: { minut?: { clientId, clientSecret }, nuki?: { apiToken } }
router.put('/', (req, res) => {
  const body = req.body || {};
  try {
    if (body.minut) {
      integrationsStore.setMinut({
        clientId: typeof body.minut.clientId === 'string' ? body.minut.clientId.trim() : '',
        clientSecret: typeof body.minut.clientSecret === 'string' ? body.minut.clientSecret.trim() : ''
      });
    }
    if (body.nuki) {
      integrationsStore.setNuki({
        apiToken: typeof body.nuki.apiToken === 'string' ? body.nuki.apiToken.trim() : ''
      });
    }
    if (body.smoobu) {
      integrationsStore.setSmoobu({
        apiKey: typeof body.smoobu.apiKey === 'string' ? body.smoobu.apiKey.trim() : ''
      });
      smoobuService._clearCaches();
    }
    if (body.notifications) {
      const n = body.notifications;
      integrationsStore.setNotifications({
        emailTo:           typeof n.emailTo === 'string' ? n.emailTo.trim() : undefined,
        notifyAutomation:  n.notifyAutomation,
        notifyManual:      n.notifyManual,
        dailyHealthReport: n.dailyHealthReport,
        smtpHost:          typeof n.smtpHost === 'string' ? n.smtpHost.trim() : undefined,
        smtpPort:          n.smtpPort !== undefined ? Number(n.smtpPort) || 587 : undefined,
        smtpUser:          typeof n.smtpUser === 'string' ? n.smtpUser.trim() : undefined,
        // smtpPass nur ueberschreiben wenn ein nicht-leerer Wert reinkommt —
        // leeres Passwort-Feld im UI bedeutet "nicht aendern", nicht "loeschen"
        smtpPass:          (typeof n.smtpPass === 'string' && n.smtpPass.length > 0) ? n.smtpPass : undefined,
        smtpFrom:          typeof n.smtpFrom === 'string' ? n.smtpFrom.trim() : undefined
      });
      notifications.resetTransporter(); // neue Config beim naechsten Versand neu bauen
    }
    if (body.dashboard) {
      integrationsStore.setDashboard(body.dashboard);
    }
    // Caches der Services leeren, damit der naechste Call die neuen Credentials benutzt
    minutService._clearCaches();
    nukiService._clearCaches();
    res.json({ success: true, status: integrationsStore.getPublicStatus() });
  } catch (err) {
    console.error('Integrations save Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/notifications/test – schickt eine Testmail
router.post('/notifications/test', async (req, res) => {
  try {
    await notifications.sendTestEmail();
    res.json({ success: true });
  } catch (err) {
    console.error('Notification-Test Fehler:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// POST /api/integrations/notifications/daily-report/run – Morgen-Report jetzt
router.post('/notifications/daily-report/run', async (req, res) => {
  try {
    const result = await dailyReport.runReport();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Daily-Report-Trigger Fehler:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// POST /api/integrations/minut/test
// Testet ob die Credentials funktionieren.
router.post('/minut/test', async (req, res) => {
  try {
    minutService._clearCaches();
    const result = await minutService.testConnection();
    res.json({ success: true, deviceCount: result.deviceCount });
  } catch (err) {
    console.error('Minut-Test Fehler:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// POST /api/integrations/nuki/test
router.post('/nuki/test', async (req, res) => {
  try {
    nukiService._clearCaches();
    const result = await nukiService.testConnection();
    res.json({ success: true, deviceCount: result.deviceCount });
  } catch (err) {
    console.error('Nuki-Test Fehler:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Smoobu ──────────────────────────────────────────────────────────────────

router.post('/smoobu/test', async (req, res) => {
  try {
    const result = await smoobuService.testConnection();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

router.get('/smoobu/apartments', async (req, res) => {
  try {
    const apts = await smoobuService.listApartments();
    res.json(apts);
  } catch (err) {
    res.status(502).json({ error: err.message, apartments: [] });
  }
});

// POST /api/integrations/cleaning-mail/test — Test-Mail fuer beliebiges Datum
router.post('/cleaning-mail/test', async (req, res) => {
  const { date, mailType, testEmail } = req.body || {};
  let dateStr = date || new Date().toISOString().slice(0, 10);
  const type = mailType === 'evening' ? 'evening' : 'morning';
  // Abend-Mail zeigt den FOLGETAG — wenn Test-Datum = heute, dann morgen zeigen
  if (type === 'evening') {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    dateStr = d.toISOString().slice(0, 10);
  }
  try {
    const cleaningMailer = require('../services/cleaningMailer');
    const results = await cleaningMailer.sendDailySummary(dateStr, type, testEmail || null);
    res.json({ success: true, date: dateStr, mailType: type, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reinigungsmitarbeiter ──────────────────────────────────────────────────

router.get('/cleaners', (req, res) => {
  res.json(integrationsStore.getCleaners());
});

router.post('/cleaners', (req, res) => {
  const { name, phone, email, apartments, monthlyHours } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name erforderlich.' });
  const id = integrationsStore.addCleaner({ name, phone, email, apartments, monthlyHours });
  res.status(201).json({ success: true, id });
});

router.put('/cleaners/:id', (req, res) => {
  const updated = integrationsStore.updateCleaner(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
  res.json({ success: true, cleaner: updated });
});

router.delete('/cleaners/:id', (req, res) => {
  const ok = integrationsStore.removeCleaner(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
  res.json({ success: true });
});

module.exports = router;
