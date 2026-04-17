/**
 * Tado Token Store (in-memory)
 *
 * Speichert OAuth-Tokens pro Credential-Schluessel. Ein Schluessel ist ein
 * einfacher Hash aus E-Mail + homeId, damit mehrere Wohnungen mit gleichem
 * Account sich einen Token teilen.
 *
 * Tokens werden automatisch erneuert wenn ihre Restlaufzeit < 60 s betraegt.
 * Kein Persist, Reset bei Server-Neustart (PRD-konform).
 */

const crypto = require('crypto');

const REFRESH_WINDOW_MS = 60 * 1000; // 60 s vor Ablauf erneuern

// Map<credentialKey, { accessToken, refreshToken, expiresAt }>
const tokens = new Map();

function makeKey(identifier, homeId) {
  return crypto
    .createHash('sha256')
    .update(`${identifier || ''}::${homeId || ''}`)
    .digest('hex')
    .slice(0, 16);
}

function get(key) {
  return tokens.get(key) || null;
}

function isFresh(entry) {
  if (!entry || !entry.expiresAt) return false;
  return entry.expiresAt > Date.now() + REFRESH_WINDOW_MS;
}

/**
 * Speichert einen Token mit absoluter Ablaufzeit.
 * @param {string} key
 * @param {object} token  { accessToken, refreshToken, expiresIn (Sekunden) }
 */
function set(key, token) {
  const expiresAt = Date.now() + (Number(token.expiresIn || 0) * 1000);
  tokens.set(key, {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken || null,
    expiresAt
  });
}

function remove(key) {
  tokens.delete(key);
}

function _clearAll() {
  tokens.clear();
}

module.exports = {
  makeKey,
  get,
  set,
  remove,
  isFresh,
  _clearAll
};
