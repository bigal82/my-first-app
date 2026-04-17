const express = require('express');
const fs = require('fs');
const tadoService = require('../services/tado');
const v3Client = require('../services/tado/v3Client');
const xClient = require('../services/tado/xClient');
const tokenStore = require('../services/tado/tokenStore');
const deviceAuth = require('../services/tado/deviceAuth');
const tadoDataCache = require('../services/tado/dataCache');
const actionLog = require('../services/actionLog');
const { APARTMENTS: CONFIG_PATH } = require('../config-path');

const router = express.Router();

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { apartments: [] };
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function findApartment(id) {
  const config = readConfig();
  return config.apartments.find(a => a.id === id) || null;
}

// ── Tado X Device Code Flow ─────────────────────────────────────────────────

// POST /api/tado/:apartmentId/auth/start
// Startet den Device Code Flow (V3 + X identisch).
// Funktioniert auch wenn tado.enabled noch false ist – der User autorisiert
// ja gerade erst und klickt "Speichern" danach.
router.post('/:apartmentId/auth/start', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });

  try {
    const result = await deviceAuth.startAuth(apt.id);
    res.json({
      status: 'started',
      verificationUri: result.verificationUri,
      verificationUriComplete: result.verificationUriComplete,
      userCode: result.userCode,
      expiresIn: result.expiresIn,
      nextStep: `Oeffne ${result.verificationUriComplete} im Browser und bestaetige die Autorisierung, danach POST /api/tado/${apt.id}/auth/poll.`
    });
  } catch (err) {
    console.error('Device-Auth-Start fehlgeschlagen:', err.message);
    res.status(502).json({ error: 'Device-Auth konnte nicht gestartet werden.', details: err.message });
  }
});

// POST /api/tado/:apartmentId/auth/poll
router.post('/:apartmentId/auth/poll', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });

  try {
    const result = await deviceAuth.pollAuth(apt.id);
    res.json(result);
  } catch (err) {
    console.error('Device-Auth-Poll fehlgeschlagen:', err.message);
    res.status(502).json({ error: 'Device-Auth-Poll fehlgeschlagen.', details: err.message });
  }
});

// GET /api/tado/:apartmentId/auth/status
router.get('/:apartmentId/auth/status', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });

  res.json({
    authorized: deviceAuth.isAuthorized(apt.id),
    config: deviceAuth._config ? deviceAuth._config() : null
  });
});

// DELETE /api/tado/:apartmentId/auth
router.delete('/:apartmentId/auth', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });

  deviceAuth.disconnect(apt.id);
  res.json({ success: true });
});

// GET /api/tado/:apartmentId/debug
// Diagnose-Endpoint: gibt den Roh-Response von Tado zurueck (ohne Normalisierung).
// Beide Varianten (V3 + X) nutzen den geteilten Device Code Flow.
router.get('/:apartmentId/debug', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });

  const tado = apt.integrations && apt.integrations.tado;
  if (!tado || !tado.enabled) {
    return res.status(400).json({ error: 'Tado-Integration nicht aktiv.' });
  }

  const kind = tado.kind || 'V3';
  const client = kind === 'X' ? xClient : v3Client;
  const diagnostics = { kind, steps: [], errors: [] };

  if (!deviceAuth.isAuthorized(apt.id)) {
    diagnostics.errors.push({
      stage: 'auth',
      message: `Tado noch nicht autorisiert. Bitte POST /api/tado/${apt.id}/auth/start aufrufen.`
    });
    diagnostics.authConfig = deviceAuth._config();
    return res.status(400).json(diagnostics);
  }

  diagnostics.steps.push('1. Refresh-Token aus config/tado-tokens.json gefunden');
  try {
    diagnostics.steps.push('2. fetchHomeData aufrufen');
    const { raw, rateLimit, homeId } = await client.fetchHomeData({
      apartmentId: apt.id,
      homeId: tado.homeId || null
    });
    diagnostics.resolvedHomeId = homeId;
    diagnostics.rateLimit = rateLimit;
    diagnostics.raw = raw;
    diagnostics.steps.push('3. fetchHomeData erfolgreich');
    return res.json(diagnostics);
  } catch (err) {
    diagnostics.errors.push({
      stage: 'fetchHomeData',
      message: err.message,
      status: err.status || null
    });
    return res.status(502).json(diagnostics);
  }
});

// GET /api/tado/:apartmentId
// Liefert normalisierte Tado-Wohnungsdaten (Raeume, Presence, Rate-Limit).
router.get('/:apartmentId', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) {
    return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
  }

  const tado = apt.integrations && apt.integrations.tado;
  if (!tado || !tado.enabled) {
    return res.status(400).json({ error: 'Tado-Integration ist fuer diese Wohnung nicht aktiv.' });
  }

  // V3 + X nutzen beide Device Code Flow → einmalige Autorisierung erforderlich
  if (!deviceAuth.isAuthorized(apt.id)) {
    return res.status(400).json({
      error: 'Tado noch nicht autorisiert. Bitte in Setup auf "Tado verbinden" klicken.',
      code: 'NOT_AUTHORIZED'
    });
  }

  try {
    const data = await tadoService.getApartmentData(apt);
    res.json(data);
  } catch (err) {
    console.error('Tado-Fehler:', err.message);
    res.status(502).json({
      error: 'Tado-Daten konnten nicht geladen werden.',
      details: err.message
    });
  }
});

// ── Schreib-Aktionen (PROJ-6) ───────────────────────────────────────────────

/**
 * Liest den Raumnamen aus dem Tado-Daten-Cache. Fallback: "Raum {id}".
 * Der Cache ist nach dem ersten Dashboard-Laden immer gefuellt, manuelle
 * Aktionen passieren danach — daher reicht das ohne Extra-API-Call.
 */
function resolveRoomName(apartmentId, roomId) {
  const entry = tadoDataCache.getEntry(apartmentId);
  const rooms = entry && entry.data && Array.isArray(entry.data.rooms) ? entry.data.rooms : [];
  const room = rooms.find(r => r.id === roomId);
  return room && room.name ? room.name : `Raum ${roomId}`;
}

function handleActionError(res, err) {
  const status = err.status || 500;
  console.error('Tado-Aktion-Fehler:', err.message);
  res.status(status).json({
    success: false,
    error: err.message,
    code: err.code || null
  });
}

/**
 * Fuehrt eine Tado-Aktion aus und protokolliert sie im Aktions-Log mit
 * source='manual'. Ergebnis/Fehler werden an den Response-Handler
 * durchgereicht.
 */
async function runAndLog(res, apt, action, actionLabel, fn, extras = {}) {
  try {
    const result = await fn();
    actionLog.append({
      source: 'manual',
      apartmentId: apt.id,
      apartmentName: apt.name,
      action,
      actionLabel,
      result: result && result.success === false ? 'partial' : 'success',
      message: (result && (result.message || result.error)) || null,
      ...extras
    });
    res.json(result);
  } catch (err) {
    actionLog.append({
      source: 'manual',
      apartmentId: apt.id,
      apartmentName: apt.name,
      action,
      actionLabel,
      result: 'error',
      message: err.message,
      ...extras
    });
    handleActionError(res, err);
  }
}

// POST /api/tado/:apartmentId/rooms/:roomId/off
router.post('/:apartmentId/rooms/:roomId/off', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
  const roomId = Number(req.params.roomId);
  const roomName = resolveRoomName(apt.id, roomId);
  await runAndLog(
    res, apt, 'room-off', `${roomName} aus`,
    () => tadoService.setRoomAction(apt, roomId, 'off'),
    { roomId, roomName }
  );
});

// POST /api/tado/:apartmentId/rooms/:roomId/resume
router.post('/:apartmentId/rooms/:roomId/resume', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
  const roomId = Number(req.params.roomId);
  const roomName = resolveRoomName(apt.id, roomId);
  await runAndLog(
    res, apt, 'room-resume', `${roomName} Plan fortsetzen`,
    () => tadoService.setRoomAction(apt, roomId, 'resume'),
    { roomId, roomName }
  );
});

// POST /api/tado/:apartmentId/all-off
router.post('/:apartmentId/all-off', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
  await runAndLog(res, apt, 'all-off', 'Alles aus', () => tadoService.allOff(apt));
});

// POST /api/tado/:apartmentId/resume-all
router.post('/:apartmentId/resume-all', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
  await runAndLog(res, apt, 'resume-all', 'Plan fortsetzen', () => tadoService.resumeAll(apt));
});

// POST /api/tado/:apartmentId/home
router.post('/:apartmentId/home', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
  await runAndLog(res, apt, 'presence-home', 'Anwesend', () => tadoService.setPresence(apt, 'HOME'));
});

// POST /api/tado/:apartmentId/away
router.post('/:apartmentId/away', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
  await runAndLog(res, apt, 'presence-away', 'Abwesend', () => tadoService.setPresence(apt, 'AWAY'));
});

// GET /api/tado/:apartmentId/ratelimit
// Liefert den letzten bekannten Rate-Limit-Stand ohne neuen Tado-Call.
router.get('/:apartmentId/ratelimit', async (req, res) => {
  const apt = findApartment(req.params.apartmentId);
  if (!apt) return res.status(404).json({ error: 'Wohnung nicht gefunden.' });
  const rl = tadoService.getRateLimit(apt);
  if (!rl) return res.status(404).json({ error: 'Noch kein Rate-Limit bekannt. Dashboard zuerst laden.' });
  res.json(rl);
});

module.exports = router;
