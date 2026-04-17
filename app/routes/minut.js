const express = require('express');
const fs = require('fs');
const minutService = require('../services/minut');
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
  const c = integrationsStore.getMinut();
  return !!(c.clientId && c.clientSecret);
}

// GET /api/minut/devices – fuer Setup-Dropdown
router.get('/devices', async (req, res) => {
  if (!credsAvailable()) {
    return res.status(503).json({
      error: 'Minut nicht konfiguriert. Bitte in Setup → Integration-Zugangsdaten hinterlegen.',
      devices: []
    });
  }
  try {
    const devices = await minutService.listDevices();
    res.json(devices);
  } catch (err) {
    console.error('Minut listDevices Fehler:', err.message);
    res.status(502).json({ error: err.message, devices: [] });
  }
});

function requireMinut(req, res) {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) { res.status(404).json({ error: 'Wohnung nicht gefunden.' }); return null; }
  const minut = apt.integrations && apt.integrations.minut;
  if (!minut || !minut.enabled) { res.status(400).json({ error: 'Minut-Integration nicht aktiv.' }); return null; }
  if (!minut.deviceId) { res.status(400).json({ error: 'Kein Minut-Geraet zugeordnet.' }); return null; }
  if (!credsAvailable()) { res.status(503).json({ error: 'Minut-Zugangsdaten fehlen.', code: 'NO_CREDENTIALS' }); return null; }
  return { apt, minut };
}

// GET /api/minut/:apartmentId – Device-Status fuer Dashboard-Widget
router.get('/:apartmentId', async (req, res) => {
  const ctx = requireMinut(req, res);
  if (!ctx) return;
  try {
    const data = await minutService.getDeviceStatus(ctx.minut.deviceId);
    res.json(data);
  } catch (err) {
    console.error('Minut getDeviceStatus Fehler:', err.message);
    res.status(502).json({ error: err.message, details: err.message });
  }
});

// GET /api/minut/:apartmentId/history?range=24h|7d|30d
router.get('/:apartmentId/history', async (req, res) => {
  const ctx = requireMinut(req, res);
  if (!ctx) return;
  const range = ['24h', '7d', '30d'].includes(req.query.range) ? req.query.range : '24h';
  try {
    const data = await minutService.getHistory(ctx.minut.deviceId, range);
    res.json(data);
  } catch (err) {
    console.error('Minut getHistory Fehler:', err.message);
    res.status(502).json({ error: err.message, details: err.message });
  }
});

// GET /api/minut/:apartmentId/noise-profile
router.get('/:apartmentId/noise-profile', async (req, res) => {
  const ctx = requireMinut(req, res);
  if (!ctx) return;
  try {
    const data = await minutService.getNoiseProfile(ctx.minut.deviceId);
    res.json(data);
  } catch (err) {
    console.error('Minut getNoiseProfile Fehler:', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
