/**
 * Shared Playwright Test Helpers
 *
 * Alle Tests schreiben NIEMALS in das reale `app/config/`-Verzeichnis.
 * Stattdessen wird in `global-setup.js` ein temporaeres CONFIG_DIR unter
 * `os.tmpdir()` angelegt und ueber `process.env.CONFIG_DIR` an den Server,
 * die Worker und diese Datei weitergereicht.
 *
 * Spec-Files importieren hier APARTMENTS/INTEGRATIONS/TADO_TOKENS und
 * schreiben direkt in das temporaere Verzeichnis.
 */
const path = require('path');

function configDir() {
  const dir = process.env.CONFIG_DIR;
  if (!dir) {
    throw new Error(
      'CONFIG_DIR env var is not set. Tests must be started via Playwright (global-setup) or Vitest (vitest-setup).'
    );
  }
  return dir;
}

module.exports = {
  get CONFIG_DIR() { return configDir(); },
  get APARTMENTS() { return path.join(configDir(), 'apartments.json'); },
  get INTEGRATIONS() { return path.join(configDir(), 'integrations.json'); },
  get TADO_TOKENS() { return path.join(configDir(), 'tado-tokens.json'); }
};
