/**
 * Gemeinsames Aktions-Log fuer alle Tado-Aktionen — Automation wie auch
 * manuelle Button-Klicks aus dem Dashboard.
 *
 * Datei: CONFIG_DIR/automation-log.json (Name historisch, enthaelt beide
 * Quellen).
 *
 * Jeder Eintrag hat mindestens:
 *   timestamp, source ('automation' | 'manual'), apartmentId, apartmentName,
 *   action, actionLabel, result, message
 *
 * Rotation: max MAX_ENTRIES, neueste am Ende.
 */

const fs = require('fs');
const { configFile } = require('../config-path');

const LOG_PATH = configFile('automation-log.json');
const MAX_ENTRIES = 500;

function read() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function append(entry) {
  const full = {
    timestamp: new Date().toISOString(),
    source: 'manual',
    ...entry
  };

  try {
    const log = read();
    log.push(full);
    const trimmed = log.slice(-MAX_ENTRIES);
    fs.writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (err) {
    console.error('[actionLog] schreiben fehlgeschlagen:', err.message);
  }

  // Fire-and-forget E-Mail-Notification (nur wenn konfiguriert). Late-require,
  // um einen Zirkelbezug zwischen actionLog, notifications und integrationsStore
  // zu vermeiden.
  try {
    const notifications = require('./notifications');
    notifications.notifyActionLogged(full);
  } catch (err) {
    console.error('[actionLog] notification dispatch fehlgeschlagen:', err.message);
  }
}

function _clear() {
  try { fs.unlinkSync(LOG_PATH); } catch {}
}

module.exports = { read, append, _clear, LOG_PATH };
