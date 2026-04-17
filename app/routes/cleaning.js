/**
 * Reinigungsplan-API
 *
 * Liest aus den persistenten Cleaning-Events (synchronisiert durch
 * services/cleaningSync.js alle 5 Minuten mit den iCal-Feeds).
 */

const express = require('express');
const fs = require('fs');
const cleaningSync = require('../services/cleaningSync');
const integrationsStore = require('../services/integrationsStore');
const { APARTMENTS } = require('../config-path');

const router = express.Router();

function readApartments() {
  if (!fs.existsSync(APARTMENTS)) return [];
  try {
    const cfg = JSON.parse(fs.readFileSync(APARTMENTS, 'utf-8'));
    return Array.isArray(cfg.apartments) ? cfg.apartments : [];
  } catch { return []; }
}

// GET /api/cleaning/timeline?from=&to=
router.get('/timeline', (req, res) => {
  try {
    const { cleaningDaysAhead } = integrationsStore.getDashboard();
    const fromDate = req.query.from ? new Date(req.query.from) : new Date();
    const toDate = req.query.to
      ? new Date(req.query.to)
      : new Date(fromDate.getTime() + cleaningDaysAhead * 24 * 60 * 60 * 1000);

    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    const apartments = readApartments().filter(a => a.visible);
    const allEvents = cleaningSync.getEvents({
      from: fromDate.toISOString(),
      to: toDate.toISOString()
    });

    const result = apartments.map(apt => {
      const aptEvents = allEvents.filter(e => e.apartmentId === apt.id);

      // Buchungen aus den Events rekonstruieren (fuer die Timeline-Darstellung)
      const bookings = aptEvents.map(e => ({
        id: e.bookingUid,
        guest: e.guest,
        checkIn: e.checkIn,
        checkOut: e.checkoutDate
      }));

      // Cleaning-Events fuer die Badges (inkl. Mitarbeiter-Name fuer Tooltip)
      const intStore = require('../services/integrationsStore');
      const uStore = require('../services/userStore');
      const allCleaners = intStore.getCleaners();
      const cleanerMap = new Map(allCleaners.map(c => [c.id, c.name]));

      const cleaningWindows = aptEvents.map(e => {
        let assignedName = null;
        let isAdmin = false;
        if (e.assignedTo) {
          assignedName = cleanerMap.get(e.assignedTo) || null;
          if (!assignedName) {
            const user = uStore.getUser(e.assignedTo);
            if (user) {
              assignedName = user.displayName || user.username;
              isAdmin = user.role === 'admin';
            }
          }
        }
        return {
          id: e.id,
          after: e.guest,
          date: e.checkoutDate,
          checkoutTime: e.checkoutTime || '10:00',
          checkinTime: e.checkinTime || '16:00',
          state: e.state,
          assignedTo: e.assignedTo || null,
          assignedName,
          isAdmin
        };
      });

      return {
        id: apt.id,
        name: apt.name,
        location: apt.location,
        bookings,
        cleaningWindows
      };
    });

    res.json({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      apartments: result
    });
  } catch (err) {
    console.error('Cleaning timeline Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cleaning/events — Events als flache Liste
// ?assignedTo=me  → nur dem eingeloggten User zugewiesene
// ?limit=days     → nur Events innerhalb der naechsten N Tage (default: cleaningDaysAhead)
router.get('/events', (req, res) => {
  const { cleaningDaysAhead } = integrationsStore.getDashboard();

  // Zeitfenster: von heute-7d bis heute+daysAhead
  const now = new Date();
  const from = req.query.from || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const limitDays = Number(req.query.limit) || cleaningDaysAhead;
  const to = req.query.to || new Date(now.getTime() + limitDays * 24 * 60 * 60 * 1000).toISOString();

  let events = cleaningSync.getEvents({
    apartmentId: req.query.apartment,
    state: req.query.state,
    from,
    to
  });

  // assignedTo=me → filtere auf den eingeloggten User
  if (req.query.assignedTo === 'me' && req.user) {
    const userId = req.user.id;
    // User kann direkt zugewiesen sein (user.id) oder ueber cleanerId
    const userStore = require('../services/userStore');
    const fullUser = userStore.getUser(userId);
    const cleanerId = fullUser ? fullUser.cleanerId : null;
    events = events.filter(e => e.assignedTo === userId || (cleanerId && e.assignedTo === cleanerId));
  }

  const apartments = readApartments();
  const aptMap = new Map(apartments.map(a => [a.id, a]));

  const enriched = events.map(e => {
    const autoTasks = cleaningSync.getAutoTasks(e.apartmentId);
    return {
      ...e,
      tasks: e.tasks || [],
      autoTasks,
      apartmentName: (aptMap.get(e.apartmentId) || {}).name || e.apartmentId,
      apartmentLocation: (aptMap.get(e.apartmentId) || {}).location || ''
    };
  });

  res.json(enriched);
});

// GET /api/cleaning/event/:eventId — einzelnes Event mit Details + Tasks
router.get('/event/:eventId', (req, res) => {
  const ev = cleaningSync.getEvent(decodeURIComponent(req.params.eventId));
  if (!ev) return res.status(404).json({ error: 'Event nicht gefunden.' });
  const apartments = readApartments();
  const apt = apartments.find(a => a.id === ev.apartmentId) || {};
  const autoTasks = cleaningSync.getAutoTasks(ev.apartmentId);
  res.json({
    ...ev,
    tasks: ev.tasks || [],
    autoTasks,
    apartmentName: apt.name || ev.apartmentId,
    apartmentLocation: apt.location || ''
  });
});

// POST /api/cleaning/event/:eventId/tasks — manuelle Aufgabe hinzufuegen
router.post('/event/:eventId/tasks', (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text erforderlich.' });
  const task = cleaningSync.addTask(decodeURIComponent(req.params.eventId), text);
  if (!task) return res.status(404).json({ error: 'Event nicht gefunden.' });
  res.status(201).json(task);
});

// PUT /api/cleaning/event/:eventId/tasks/:taskId — Task abhaken/aufhaken
router.put('/event/:eventId/tasks/:taskId', (req, res) => {
  const task = cleaningSync.toggleTask(
    decodeURIComponent(req.params.eventId),
    req.params.taskId
  );
  if (!task) return res.status(404).json({ error: 'Task nicht gefunden.' });
  res.json(task);
});

// DELETE /api/cleaning/event/:eventId/tasks/:taskId — Task loeschen
router.delete('/event/:eventId/tasks/:taskId', (req, res) => {
  const ok = cleaningSync.removeTask(
    decodeURIComponent(req.params.eventId),
    req.params.taskId
  );
  if (!ok) return res.status(404).json({ error: 'Task nicht gefunden.' });
  res.json({ success: true });
});

// PUT /api/cleaning/event/:eventId — Event aktualisieren (Status + Zuweisung)
router.put('/event/:eventId', (req, res) => {
  const { state, assignedTo } = req.body || {};
  if (state && !['open', 'assigned', 'done', 'cancelled'].includes(state)) {
    return res.status(400).json({ error: 'Ungueltiger Status.' });
  }
  // Nicht als erledigt markierbar VOR dem Checkout-Tag 10:00 Uhr
  if (state === 'done') {
    const ev = cleaningSync.getEvent(decodeURIComponent(req.params.eventId));
    if (ev) {
      const coDate = new Date(ev.checkoutDate);
      coDate.setHours(10, 0, 0, 0); // Reinigung beginnt um 10:00
      const now = new Date();
      if (now.getTime() < coDate.getTime()) {
        const dateStr = coDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
        return res.status(400).json({ error: `Kann erst am ${dateStr} ab 10:00 Uhr als erledigt markiert werden.` });
      }
    }
  }
  const updated = cleaningSync.updateEvent(decodeURIComponent(req.params.eventId), { state, assignedTo });
  if (!updated) return res.status(404).json({ error: 'Event nicht gefunden.' });
  res.json({ success: true, event: updated });
});

// PUT /api/cleaning/state/:eventId — Abwaertskompatibel
router.put('/state/:eventId', (req, res) => {
  const { state } = req.body || {};
  if (!['open', 'assigned', 'done'].includes(state)) {
    return res.status(400).json({ error: 'Ungueltiger Status.' });
  }
  const ok = cleaningSync.setEventState(decodeURIComponent(req.params.eventId), state);
  if (!ok) return res.status(404).json({ error: 'Event nicht gefunden.' });
  res.json({ success: true });
});

// POST /api/cleaning/sync — manueller Sync (fuer Debug / Force-Refresh)
router.post('/sync', async (req, res) => {
  try {
    const result = await cleaningSync.syncAll();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
