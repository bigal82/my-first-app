/**
 * Zentrale Config-Verzeichnis-Aufloesung.
 *
 * Produktion: `app/config/` (relativ zu diesem Modul).
 * Tests:      `process.env.CONFIG_DIR` zeigt auf ein temporaeres Verzeichnis,
 *             damit die realen User-Daten (apartments.json, integrations.json,
 *             tado-tokens.json) niemals von Tests ueberschrieben werden.
 *
 * Alle Routen und Services MUESSEN ueber diesen Helper auf Config-Files zugreifen.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, 'config');

// Verzeichnis einmalig bei Modul-Load anlegen. Damit funktioniert ein frischer
// Deploy mit einem leeren CONFIG_DIR-Pfad (typisch auf einem Live-Server, wo
// das Verzeichnis bewusst ausserhalb des Git-Checkouts liegt).
try {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
} catch (err) {
  console.error(`[config-path] Konnte CONFIG_DIR nicht anlegen (${CONFIG_DIR}):`, err.message);
}

function configFile(name) {
  return path.join(CONFIG_DIR, name);
}

module.exports = {
  CONFIG_DIR,
  configFile,
  APARTMENTS: configFile('apartments.json'),
  INTEGRATIONS: configFile('integrations.json'),
  TADO_TOKENS: configFile('tado-tokens.json'),
  TADO_LAST_RESPONSE: configFile('tado-last-response.json')
};
