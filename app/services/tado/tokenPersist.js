/**
 * Tado Token Persistence
 *
 * Speichert Refresh-Tokens in config/tado-tokens.json damit der User nach
 * einem Server-Neustart nicht erneut autorisieren muss.
 *
 * Format:
 *   {
 *     "<apartment-id>": {
 *       "refreshToken": "...",
 *       "fetchedAt": "2026-04-15T12:00:00.000Z"
 *     }
 *   }
 */

const fs = require('fs');
const { TADO_TOKENS: TOKENS_PATH } = require('../../config-path');

function read() {
  if (!fs.existsSync(TOKENS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
  } catch (err) {
    return {};
  }
}

function write(data) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function getRefreshToken(apartmentId) {
  const store = read();
  return store[apartmentId] ? store[apartmentId].refreshToken : null;
}

function setRefreshToken(apartmentId, refreshToken) {
  const store = read();
  store[apartmentId] = {
    refreshToken,
    fetchedAt: new Date().toISOString()
  };
  write(store);
}

function remove(apartmentId) {
  const store = read();
  delete store[apartmentId];
  write(store);
}

function hasToken(apartmentId) {
  return !!getRefreshToken(apartmentId);
}

function _clearAll() {
  if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
}

module.exports = {
  getRefreshToken,
  setRefreshToken,
  remove,
  hasToken,
  _clearAll,
  TOKENS_PATH
};
