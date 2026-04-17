const express = require('express');
const absences = require('../services/absences');
const userStore = require('../services/userStore');
const sessionAuth = require('../middleware/sessionAuth');
const integrationsStore = require('../services/integrationsStore');

const router = express.Router();

function getCleanerIdForUser(user) {
  const full = userStore.getUser(user.id);
  return full ? full.cleanerId : null;
}

// GET /api/absences — alle (Admin) oder eigene (Cleaner)
router.get('/', (req, res) => {
  const from = req.query.from;
  const to = req.query.to;

  if (req.user.role === 'admin') {
    const all = absences.getAll({ from, to });
    const cleaners = integrationsStore.getCleaners();
    const cMap = new Map(cleaners.map(c => [c.id, c.name]));
    const enriched = all.map(a => ({ ...a, cleanerName: cMap.get(a.cleanerId) || a.cleanerId }));
    return res.json(enriched);
  }

  // Cleaner: nur eigene
  const cleanerId = getCleanerIdForUser(req.user);
  if (!cleanerId) return res.json([]);
  res.json(absences.getForCleaner(cleanerId, { from, to }));
});

// POST /api/absences — neue Abwesenheit eintragen (Cleaner: eigene, Admin: beliebige)
router.post('/', (req, res) => {
  const { fromDate, toDate, type, note, cleanerId: bodyCleanerId } = req.body || {};
  let cleanerId;

  if (req.user.role === 'admin' && bodyCleanerId) {
    cleanerId = bodyCleanerId; // Admin kann fuer jeden eintragen
  } else {
    cleanerId = getCleanerIdForUser(req.user);
  }

  if (!cleanerId) return res.status(400).json({ error: 'Kein Mitarbeiter-Profil.' });
  if (!fromDate || !toDate) return res.status(400).json({ error: 'Von/Bis Datum erforderlich.' });

  try {
    const entry = absences.addAbsence({ cleanerId, fromDate, toDate, type: type || 'unavailable', note });
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/absences/:id — Abwesenheit loeschen
router.delete('/:id', (req, res) => {
  // Cleaner darf nur eigene loeschen, Admin alles
  if (req.user.role !== 'admin') {
    const cleanerId = getCleanerIdForUser(req.user);
    const all = absences.readAll();
    const entry = all.find(a => a.id === req.params.id);
    if (!entry || entry.cleanerId !== cleanerId) {
      return res.status(403).json({ error: 'Keine Berechtigung.' });
    }
  }
  const ok = absences.removeAbsence(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Nicht gefunden.' });
  res.json({ success: true });
});

// GET /api/absences/absent-on/:date — wer ist an dem Tag abwesend?
router.get('/absent-on/:date', (req, res) => {
  const ids = absences.absentOnDate(req.params.date);
  res.json(ids);
});

module.exports = router;
