/**
 * User Store — Mehrbenutzerverwaltung mit Rollen.
 *
 * Rollen:
 *   admin   — Vollzugriff (Dashboard, Setup, Reinigungsplan)
 *   cleaner — sieht nur eigene zugewiesene Reinigungen (/my)
 *
 * Gespeichert in CONFIG_DIR/users.json. Beim ersten Start wird aus den
 * ENV-Variablen DASHBOARD_USER + DASHBOARD_PASSWORD_HASH ein Admin-User
 * migriert, damit bestehende Installationen nahtlos weiterlaufen.
 *
 * Passwoerter werden als bcrypt-Hash gespeichert (nie Klartext).
 */

const fs = require('fs');
const bcrypt = require('bcryptjs');
const nodeCrypto = require('node:crypto');
const { configFile } = require('../config-path');

const USERS_PATH = configFile('users.json');
const BCRYPT_ROUNDS = 12;

function readUsers() {
  if (!fs.existsSync(USERS_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
}

function getUser(id) {
  return readUsers().find(u => u.id === id) || null;
}

function getUserByName(username) {
  const name = (username || '').trim().toLowerCase();
  return readUsers().find(u => u.username.toLowerCase() === name) || null;
}

/**
 * Erstellt einen neuen User. Passwort wird als Klartext uebergeben und
 * intern gehasht. Gibt den erstellten User (ohne Hash) zurueck.
 */
async function createUser({ username, password, displayName, role, cleanerId }) {
  if (!username || !password) throw new Error('Username und Passwort erforderlich.');
  if (!['admin', 'cleaner'].includes(role)) throw new Error('Rolle muss admin oder cleaner sein.');
  if (password.length < 4) throw new Error('Passwort muss mindestens 4 Zeichen haben.');

  const users = readUsers();
  if (users.some(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
    throw new Error(`Username "${username}" existiert bereits.`);
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = {
    id: 'u-' + Date.now(),
    username: username.trim(),
    displayName: (displayName || username).trim(),
    role,
    cleanerId: role === 'cleaner' ? (cleanerId || null) : null,
    calToken: nodeCrypto.randomBytes(24).toString('base64url'),
    passwordHash: hash,
    createdAt: new Date().toISOString()
  };

  users.push(user);
  writeUsers(users);
  return publicUser(user);
}

/**
 * Aktualisiert einen User. Passwort nur wenn angegeben (sonst bleibt
 * der bestehende Hash).
 */
async function updateUser(id, patch) {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;

  const user = users[idx];
  if (patch.username !== undefined && patch.username.trim()) {
    const newName = patch.username.trim().toLowerCase();
    const conflict = users.find(u => u.id !== id && u.username.toLowerCase() === newName);
    if (conflict) throw new Error(`Username "${patch.username}" ist bereits vergeben.`);
    user.username = patch.username.trim();
  }
  if (patch.displayName !== undefined) user.displayName = patch.displayName.trim();
  if (patch.role !== undefined && ['admin', 'cleaner'].includes(patch.role)) {
    user.role = patch.role;
    user.cleanerId = patch.role === 'cleaner' ? (patch.cleanerId || user.cleanerId || null) : null;
  }
  if (patch.cleanerId !== undefined) user.cleanerId = patch.cleanerId;
  if (patch.password && patch.password.length >= 4) {
    user.passwordHash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS);
  }

  users[idx] = user;
  writeUsers(users);
  return publicUser(user);
}

function deleteUser(id) {
  const users = readUsers();
  // Letzten Admin nicht loeschen
  const admins = users.filter(u => u.role === 'admin');
  const target = users.find(u => u.id === id);
  if (target && target.role === 'admin' && admins.length <= 1) {
    throw new Error('Der letzte Admin kann nicht geloescht werden.');
  }
  const filtered = users.filter(u => u.id !== id);
  if (filtered.length === users.length) return false;
  writeUsers(filtered);
  return true;
}

/**
 * Prueft Username + Passwort. Gibt den User zurueck (ohne Hash) oder null.
 */
async function verifyPassword(username, password) {
  const user = getUserByName(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? publicUser(user) : null;
}

/**
 * Gibt alle User zurueck (ohne Hashes).
 */
function listUsers() {
  return readUsers().map(publicUser);
}

/**
 * Entfernt den Hash aus einem User-Objekt fuer API-Responses.
 */
function publicUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}

/**
 * Migration: wenn users.json leer ist aber ENV-Variablen gesetzt sind,
 * wird ein Admin-User daraus erstellt. Laeuft einmal beim Server-Start.
 */
function migrateFromEnv() {
  const users = readUsers();

  // Bestehende User ohne calToken nachrüsten
  let patched = false;
  for (const u of users) {
    if (!u.calToken) {
      u.calToken = nodeCrypto.randomBytes(24).toString('base64url');
      patched = true;
    }
  }
  if (patched) writeUsers(users);

  if (users.length > 0) return; // bereits User vorhanden

  const hash = process.env.DASHBOARD_PASSWORD_HASH;
  const username = process.env.DASHBOARD_USER || 'admin';
  if (!hash) return; // kein alter Hash → nichts migrieren

  const user = {
    id: 'u-admin',
    username,
    displayName: 'Administrator',
    role: 'admin',
    cleanerId: null,
    calToken: nodeCrypto.randomBytes(24).toString('base64url'),
    passwordHash: hash,
    createdAt: new Date().toISOString()
  };

  writeUsers([user]);
  console.log(`[userStore] Admin-User "${username}" aus ENV migriert.`);
}

module.exports = {
  getUser,
  getUserByName,
  createUser,
  updateUser,
  deleteUser,
  verifyPassword,
  listUsers,
  migrateFromEnv,
  readUsers,
  USERS_PATH
};
