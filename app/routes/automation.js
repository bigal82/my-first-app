const express = require('express');
const automationService = require('../services/automation');

const router = express.Router();

// GET /api/automation/log – letzte N Eintraege, neueste zuerst
router.get('/log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  const log = automationService.readLog();
  res.json(log.slice(-limit).reverse());
});

// POST /api/automation/tick – manueller Trigger (fuer Tests + Debug)
router.post('/tick', async (req, res) => {
  try {
    await automationService.tick();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automation/force/:apartmentId/:action — sofort ausfuehren (all-off / resume-all)
router.post('/force/:apartmentId/:action', async (req, res) => {
  const fs = require('fs');
  const { APARTMENTS } = require('../config-path');
  const tadoService = require('../services/tado');
  const actionLog = require('../services/actionLog');

  try {
    const cfg = JSON.parse(fs.readFileSync(APARTMENTS, 'utf-8'));
    const apt = cfg.apartments.find(a => a.id === req.params.apartmentId);
    if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });

    const action = req.params.action;
    if (action !== 'all-off' && action !== 'resume-all') {
      return res.status(400).json({ error: 'action muss all-off oder resume-all sein.' });
    }

    const result = action === 'all-off'
      ? await tadoService.allOff(apt)
      : await tadoService.resumeAll(apt);

    actionLog.append({
      source: 'manual',
      apartmentId: apt.id,
      apartmentName: apt.name,
      action: action === 'all-off' ? 'checkout' : 'checkin',
      actionLabel: action === 'all-off' ? 'Alles aus (manuell)' : 'Plan fortsetzen (manuell)',
      result: result.success === false ? 'partial' : 'success',
      message: result.message || null
    });

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automation/test/:apartmentId – testet Automation fuer eine Wohnung
// Prueft was der naechste Check-in/Check-out waere und zeigt Debug-Info
router.post('/test/:apartmentId', async (req, res) => {
  const fs = require('fs');
  const { APARTMENTS } = require('../config-path');
  const tz = require('../services/timezone');
  const occupancyService = require('../services/occupancy');
  const intStore = require('../services/integrationsStore');

  try {
    const cfg = JSON.parse(fs.readFileSync(APARTMENTS, 'utf-8'));
    const apt = cfg.apartments.find(a => a.id === req.params.apartmentId);
    if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });

    const occ = apt.occupancy || {};
    const auto = apt.automation || {};
    const tado = apt.integrations?.tado;

    const debug = {
      apartmentId: apt.id,
      automationEnabled: !!auto.enabled,
      icalEnabled: !!occ.enabled,
      icalUrl: occ.icalUrl ? 'gesetzt' : 'fehlt',
      tadoEnabled: !!tado?.enabled,
      checkoutHour: occ.checkoutHour ?? 10,
      checkinHour: occ.checkinHour ?? 16,
      timezone: intStore.getDashboard().timezone || 'Europe/Berlin',
      localTime: tz.localTimeStr(),
      localHour: tz.localHour(),
      events: []
    };

    if (!occ.enabled || !occ.icalUrl) {
      return res.json({ ...debug, message: 'iCal nicht aktiviert oder URL fehlt.' });
    }

    const parsed = await occupancyService.fetchIcal(occ.icalUrl);
    const today = tz.localDateStr();
    const tzName = intStore.getDashboard().timezone || 'Europe/Berlin';

    // UTC-Offset berechnen
    const utcNow = new Date();
    const localStr = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZone: tzName
    }).format(utcNow);
    const [dp, tp] = localStr.split(', ');
    const [mo, da, yr] = dp.split('/');
    const [hh, mm, ss] = tp.split(':');
    const localAsUtc = new Date(`${yr}-${mo}-${da}T${hh}:${mm}:${ss}Z`);
    const offsetMs = utcNow.getTime() - localAsUtc.getTime();
    debug.utcOffset = Math.round(offsetMs / 3600000) + 'h';

    for (const key of Object.keys(parsed)) {
      const ev = parsed[key];
      if (!ev || ev.type !== 'VEVENT' || !ev.start || !ev.end) continue;
      const summary = (ev.summary || '').toString().trim();
      const s = summary.toLowerCase();
      if (!summary || s.startsWith('check-in') || s.startsWith('check-out') ||
          ['blocked','closed','not available','nicht verfügbar','nicht verfuegbar','blockierung','unavailable'].includes(s)) continue;

      const start = new Date(ev.start);
      const end = new Date(ev.end);
      const startDate = start.toISOString().slice(0, 10);
      const endDate = end.toISOString().slice(0, 10);

      // Nur Events um heute herum
      if (endDate < today && startDate < today) continue;

      const isStartDateOnly = start.getUTCHours() === 0 && start.getUTCMinutes() === 0;
      const isEndDateOnly = end.getUTCHours() === 0 && end.getUTCMinutes() === 0;

      let checkinTrigger = start;
      let checkoutTrigger = end;
      if (isStartDateOnly) {
        checkinTrigger = new Date(start);
        checkinTrigger.setUTCHours(debug.checkinHour, 0, 0, 0);
        checkinTrigger.setTime(checkinTrigger.getTime() + offsetMs);
      }
      if (isEndDateOnly) {
        checkoutTrigger = new Date(end);
        checkoutTrigger.setUTCHours(debug.checkoutHour, 0, 0, 0);
        checkoutTrigger.setTime(checkoutTrigger.getTime() + offsetMs);
      }

      const now = Date.now();
      const checkinInWindow = checkinTrigger.getTime() >= (now - 5 * 60000) && checkinTrigger.getTime() <= now;
      const checkoutInWindow = checkoutTrigger.getTime() >= (now - 5 * 60000) && checkoutTrigger.getTime() <= now;
      const checkinFuture = checkinTrigger.getTime() > now;
      const checkoutFuture = checkoutTrigger.getTime() > now;

      // Nur Events mit mindestens einem Trigger in der Zukunft oder im Fenster
      if (!checkinInWindow && !checkoutInWindow && !checkinFuture && !checkoutFuture) continue;

      debug.events.push({
        summary: summary.slice(0, 40),
        rawStart: start.toISOString(),
        rawEnd: end.toISOString(),
        startDateOnly: isStartDateOnly,
        endDateOnly: isEndDateOnly,
        checkinTriggerUTC: checkinTrigger.toISOString(),
        checkoutTriggerUTC: checkoutTrigger.toISOString(),
        checkinInWindow,
        checkoutInWindow
      });
    }

    res.json(debug);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
