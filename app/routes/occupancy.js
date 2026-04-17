const express = require('express');
const fs = require('fs');
const occupancyService = require('../services/occupancy');
const { APARTMENTS: CONFIG_PATH } = require('../config-path');

const router = express.Router();

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { apartments: [] };
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

// GET /api/occupancy/:apartmentId
// Liefert Belegungsstatus einer Wohnung basierend auf deren iCal-URL.
router.get('/:apartmentId', async (req, res) => {
  try {
    const config = readConfig();
    const apt = config.apartments.find(a => a.id === req.params.apartmentId);
    if (!apt) {
      return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
    }
    const hasSmoobu = apt.occupancy && apt.occupancy.source === 'smoobu' && apt.occupancy.smoobuApartmentId;
    if (!apt.occupancy || (!apt.occupancy.enabled && !hasSmoobu)) {
      return res.status(400).json({ error: 'Belegung ist fuer diese Wohnung nicht aktiv.' });
    }

    let status;
    if (apt.occupancy.source === 'smoobu' && apt.occupancy.smoobuApartmentId) {
      status = await occupancyService.getOccupancyFromSmoobu(apt.id, apt.occupancy.smoobuApartmentId);
    } else if (apt.occupancy.icalUrl) {
      status = await occupancyService.getOccupancy(apt.id, apt.occupancy.icalUrl);
    } else {
      return res.status(400).json({ error: 'Keine Datenquelle konfiguriert (iCal-URL oder Smoobu).' });
    }
    res.json(status);
  } catch (err) {
    console.error('Fehler beim Abrufen der Belegung:', err.message);
    res.status(502).json({
      error: 'iCal konnte nicht abgerufen werden.',
      details: err.message
    });
  }
});

module.exports = router;
