const express = require('express');
const fs = require('fs');
const { APARTMENTS: CONFIG_PATH } = require('../config-path');

const router = express.Router();

/**
 * Stellt sicher, dass occupancy.enabled konsistent mit der Datenquelle ist.
 * Wenn Smoobu oder iCal konfiguriert ist, muss enabled=true sein.
 */
function normalizeOccupancy(apt) {
  if (!apt.occupancy) return apt;
  const occ = apt.occupancy;
  const hasSource = (occ.source === 'smoobu' && occ.smoobuApartmentId) || occ.icalUrl;
  if (hasSource && occ.enabled === undefined) {
    occ.enabled = true;
  }
  return apt;
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { apartments: [] };
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/apartments
router.get('/', (req, res) => {
  try {
    const config = readConfig();
    res.json(config.apartments);
  } catch (err) {
    console.error('Fehler beim Lesen der apartments.json:', err.message);
    res.status(500).json({ error: 'Konfiguration konnte nicht gelesen werden.' });
  }
});

// POST /api/apartments  – neue Wohnung anlegen
router.post('/', (req, res) => {
  try {
    const { name, location, visible = true } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Name ist erforderlich.' });
    }

    const config = readConfig();
    const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const unique = config.apartments.some(a => a.id === id)
      ? `${id}-${Date.now()}`
      : id;

    const newApartment = {
      id: unique,
      name: name.trim(),
      location: (location || '').trim(),
      visible: Boolean(visible),
      occupancy: { enabled: false, icalUrl: '', checkoutHour: 10, checkinHour: 16 },
      automation: { enabled: false },
      integrations: {
        tado: { enabled: false, kind: 'V3', email: '', password: '', homeId: null },
        minut: { enabled: false, deviceId: '' },
        nuki: { enabled: false, deviceIds: [] }
      }
    };

    config.apartments.push(newApartment);
    writeConfig(config);
    res.status(201).json(newApartment);
  } catch (err) {
    console.error('Fehler beim Anlegen einer Wohnung:', err.message);
    res.status(500).json({ error: 'Wohnung konnte nicht gespeichert werden.' });
  }
});

// PUT /api/apartments/:id  – Wohnung aktualisieren
router.put('/:id', (req, res) => {
  try {
    const config = readConfig();
    const idx = config.apartments.findIndex(a => a.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
    }

    // Deep-merge: bei verschachtelten Objekten (occupancy, integrations, automation)
    // einzelne Felder mergen statt komplett ueberschreiben.
    const existing = config.apartments[idx];
    const patch = req.body;

    if (patch.occupancy) {
      patch.occupancy = { ...(existing.occupancy || {}), ...patch.occupancy };
    }
    if (patch.integrations) {
      const ei = existing.integrations || {};
      patch.integrations = {
        tado: { ...(ei.tado || {}), ...(patch.integrations.tado || {}) },
        minut: { ...(ei.minut || {}), ...(patch.integrations.minut || {}) },
        nuki: { ...(ei.nuki || {}), ...(patch.integrations.nuki || {}) }
      };
    }
    if (patch.automation) {
      patch.automation = { ...(existing.automation || {}), ...patch.automation };
    }

    config.apartments[idx] = normalizeOccupancy({ ...existing, ...patch, id: existing.id });

    writeConfig(config);
    res.json(config.apartments[idx]);
  } catch (err) {
    console.error('Fehler beim Aktualisieren einer Wohnung:', err.message);
    res.status(500).json({ error: 'Wohnung konnte nicht aktualisiert werden.' });
  }
});

// DELETE /api/apartments/:id  – Wohnung löschen
router.delete('/:id', (req, res) => {
  try {
    const config = readConfig();
    const idx = config.apartments.findIndex(a => a.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
    }

    config.apartments.splice(idx, 1);
    writeConfig(config);
    res.json({ success: true });
  } catch (err) {
    console.error('Fehler beim Loeschen einer Wohnung:', err.message);
    res.status(500).json({ error: 'Wohnung konnte nicht geloescht werden.' });
  }
});

// POST /api/apartments/reorder — Reihenfolge aendern
router.post('/reorder', (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids Array erforderlich.' });
    const config = readConfig();
    const aptMap = new Map(config.apartments.map(a => [a.id, a]));
    // Neue Reihenfolge: erst die IDs aus dem Request, dann alle die nicht drin sind
    const ordered = [];
    for (const id of ids) {
      const apt = aptMap.get(id);
      if (apt) { ordered.push(apt); aptMap.delete(id); }
    }
    // Restliche (falls welche vergessen wurden)
    for (const apt of aptMap.values()) ordered.push(apt);
    config.apartments = ordered;
    writeConfig(config);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
