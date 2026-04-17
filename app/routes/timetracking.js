const express = require('express');
const timeTracking = require('../services/timeTracking');
const integrationsStore = require('../services/integrationsStore');
const userStore = require('../services/userStore');
const sessionAuth = require('../middleware/sessionAuth');

const router = express.Router();

function getCleanerIdForUser(user) {
  const full = userStore.getUser(user.id);
  return full ? full.cleanerId : null;
}

// ── Cleaner-Endpoints (eigene Zeiterfassung) ────────────────────────────────

router.post('/clock-in', (req, res) => {
  const cleanerId = getCleanerIdForUser(req.user);
  if (!cleanerId) return res.status(400).json({ error: 'Kein Mitarbeiter-Profil verknuepft.' });
  try {
    const entry = timeTracking.clockIn(cleanerId);
    res.json({ success: true, entry });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/clock-out', (req, res) => {
  const cleanerId = getCleanerIdForUser(req.user);
  if (!cleanerId) return res.status(400).json({ error: 'Kein Mitarbeiter-Profil verknuepft.' });
  try {
    const entry = timeTracking.clockOut(cleanerId);
    res.json({ success: true, entry });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/pause', (req, res) => {
  const cleanerId = getCleanerIdForUser(req.user);
  if (!cleanerId) return res.status(400).json({ error: 'Kein Mitarbeiter-Profil verknuepft.' });
  try {
    const entry = timeTracking.pauseStart(cleanerId);
    res.json({ success: true, entry });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/resume', (req, res) => {
  const cleanerId = getCleanerIdForUser(req.user);
  if (!cleanerId) return res.status(400).json({ error: 'Kein Mitarbeiter-Profil verknuepft.' });
  try {
    const entry = timeTracking.pauseEnd(cleanerId);
    res.json({ success: true, entry });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/timetracking/me — aktueller Status + Monatsübersicht + Kalender-Token
router.get('/me', (req, res) => {
  const cleanerId = getCleanerIdForUser(req.user);
  if (!cleanerId) return res.json({ active: null, month: null });

  const active = timeTracking.getActiveEntry(cleanerId);
  const now = new Date();
  const month = timeTracking.getMonthlySummary(cleanerId, now.getFullYear(), now.getMonth() + 1);
  const lastMonth = timeTracking.getMonthlySummary(cleanerId, now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(), now.getMonth() === 0 ? 12 : now.getMonth());

  // Monatsstunden + Kalender-Token aus Cleaner-Profil
  const cleaners = integrationsStore.getCleaners();
  const cleaner = cleaners.find(c => c.id === cleanerId);
  const contractHours = cleaner ? cleaner.monthlyHours || 0 : 0;
  const hourlyRate = cleaner ? cleaner.hourlyRate ?? 15 : 15;
  const calToken = cleaner ? integrationsStore.ensureCalToken(cleanerId) : null;

  // Laufende Minuten berechnen falls eingestempelt
  if (active) {
    active.currentMinutes = timeTracking.computeMinutes(active);
  }

  res.json({
    active,
    month: { ...month, contractHours, hourlyRate },
    lastMonth: { ...lastMonth, contractHours, hourlyRate },
    calToken
  });
});

// POST /api/timetracking/submit — Mitarbeiter traegt Zeit nach (pending)
router.post('/submit', (req, res) => {
  const cleanerId = getCleanerIdForUser(req.user);
  if (!cleanerId) return res.status(400).json({ error: 'Kein Mitarbeiter-Profil verknuepft.' });
  try {
    const entry = timeTracking.submitManualEntry(cleanerId, req.body);
    res.status(201).json(entry);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Admin-Endpoints ─────────────────────────────────────────────────────────

// GET /api/timetracking/admin/live — wer ist gerade eingestempelt?
router.get('/admin/live', sessionAuth.requireRole('admin'), (req, res) => {
  const cleaners = integrationsStore.getCleaners();
  const allEntries = timeTracking.readEntries();
  const live = [];

  for (const c of cleaners) {
    const active = allEntries.find(e => e.cleanerId === c.id && e.status !== 'completed');
    if (!active) continue;
    const currentMinutes = timeTracking.computeMinutes(active);
    const breakCount = (active.breaks || []).length;
    const currentBreakStart = active.status === 'paused' && active.breaks.length > 0
      ? active.breaks[active.breaks.length - 1].start : null;
    live.push({
      cleanerId: c.id,
      name: c.name,
      status: active.status, // active | paused
      clockIn: active.clockIn,
      currentMinutes,
      breakCount,
      currentBreakStart
    });
  }

  res.json(live);
});

// GET /api/timetracking/admin/overview?month=2026-04
router.get('/admin/overview', sessionAuth.requireRole('admin'), (req, res) => {
  const monthStr = req.query.month || new Date().toISOString().slice(0, 7);
  const [year, month] = monthStr.split('-').map(Number);

  const cleaners = integrationsStore.getCleaners();
  const overview = cleaners.map(c => {
    const summary = timeTracking.getMonthlySummary(c.id, year, month);
    const rate = c.hourlyRate ?? 15;
    return {
      cleanerId: c.id,
      name: c.name,
      contractHours: c.monthlyHours || 0,
      hourlyRate: rate,
      totalHours: summary.totalHours,
      totalMinutes: summary.totalMinutes,
      workDays: summary.workDays,
      percentUsed: c.monthlyHours > 0 ? Math.round(summary.totalHours / c.monthlyHours * 100) : 0,
      earnings: Math.round(summary.totalHours * rate * 100) / 100
    };
  });

  res.json({ year, month, overview });
});

// GET /api/timetracking/admin/detail/:cleanerId?month=2026-04
router.get('/admin/detail/:cleanerId', sessionAuth.requireRole('admin'), (req, res) => {
  const monthStr = req.query.month || new Date().toISOString().slice(0, 7);
  const [year, month] = monthStr.split('-').map(Number);
  const summary = timeTracking.getMonthlySummary(req.params.cleanerId, year, month);

  const cleaners = integrationsStore.getCleaners();
  const cleaner = cleaners.find(c => c.id === req.params.cleanerId);

  res.json({
    ...summary,
    cleanerName: cleaner ? cleaner.name : req.params.cleanerId,
    contractHours: cleaner ? cleaner.monthlyHours || 0 : 0
  });
});

// GET /api/timetracking/admin/pending — ausstehende Nachtraege
router.get('/admin/pending', sessionAuth.requireRole('admin'), (req, res) => {
  const pending = timeTracking.getPendingEntries();
  const cleaners = integrationsStore.getCleaners();
  const cMap = new Map(cleaners.map(c => [c.id, c.name]));
  res.json(pending.map(e => ({ ...e, cleanerName: cMap.get(e.cleanerId) || e.cleanerId })));
});

// POST /api/timetracking/admin/review/:id — genehmigen/ablehnen
router.post('/admin/review/:id', sessionAuth.requireRole('admin'), (req, res) => {
  const { decision } = req.body || {};
  try {
    const entry = timeTracking.reviewEntry(req.user.id, req.params.id, decision);
    if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    res.json(entry);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/timetracking/admin/entry — manuell erstellen
router.post('/admin/entry', sessionAuth.requireRole('admin'), (req, res) => {
  try {
    const entry = timeTracking.adminCreateEntry(
      req.user.id,
      req.body
    );
    res.status(201).json(entry);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT /api/timetracking/admin/entry/:id — bearbeiten
router.put('/admin/entry/:id', sessionAuth.requireRole('admin'), (req, res) => {
  const entry = timeTracking.adminUpdateEntry(req.user.id, req.params.id, req.body);
  if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  res.json(entry);
});

// DELETE /api/timetracking/admin/entry/:id — loeschen
router.delete('/admin/entry/:id', sessionAuth.requireRole('admin'), (req, res) => {
  const ok = timeTracking.adminDeleteEntry(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  res.json({ success: true });
});

// GET /api/timetracking/admin/audit — Audit-Log
router.get('/admin/audit', sessionAuth.requireRole('admin'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  res.json(timeTracking.getAuditLog(limit));
});

module.exports = router;
