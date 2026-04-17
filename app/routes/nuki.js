const express = require('express');
const fs = require('fs');
const nukiService = require('../services/nuki');
const integrationsStore = require('../services/integrationsStore');
const { APARTMENTS: CONFIG_PATH } = require('../config-path');

const router = express.Router();

function findApartment(id) {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return (cfg.apartments || []).find(a => a.id === id) || null;
  } catch {
    return null;
  }
}

function credsAvailable() {
  return !!integrationsStore.getNuki().apiToken;
}

// GET /api/nuki/devices – Setup-Dropdown
router.get('/devices', async (req, res) => {
  if (!credsAvailable()) {
    return res.status(503).json({
      error: 'Nuki nicht konfiguriert. Bitte in Setup → Integration-Zugangsdaten API-Token hinterlegen.',
      devices: []
    });
  }
  try {
    const devices = await nukiService.listDevices();
    res.json(devices);
  } catch (err) {
    console.error('Nuki listDevices Fehler:', err.message);
    res.status(502).json({ error: err.message, devices: [] });
  }
});

// GET /api/nuki/:apartmentId – Geraete-Status fuer Dashboard
router.get('/:apartmentId', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });

  const nuki = apt.integrations && apt.integrations.nuki;
  if (!nuki || !nuki.enabled) {
    return res.status(400).json({ error: 'Nuki-Integration nicht aktiv.' });
  }
  if (!Array.isArray(nuki.deviceIds) || nuki.deviceIds.length === 0) {
    return res.status(400).json({ error: 'Keine Nuki-Geraete zugeordnet.' });
  }
  if (!credsAvailable()) {
    return res.status(503).json({
      error: 'Nuki-API-Token fehlt. Bitte in Setup hinterlegen.',
      code: 'NO_CREDENTIALS'
    });
  }

  try {
    const data = await nukiService.getDevicesForApartment(nuki.deviceIds);
    res.json(data);
  } catch (err) {
    console.error('Nuki getDevicesForApartment Fehler:', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
