/**
 * Session-Auth-Middleware (Multi-User mit Rollen).
 *
 * Login prueft Username + Passwort gegen userStore. Session-Cookie
 * enthaelt userId + role + expiry als HMAC-signiertes Token.
 *
 * Rollen:
 *   admin   — sieht alles
 *   cleaner — sieht nur /my und eigene Cleaning-Events
 *
 * Ohne User in users.json UND ohne DASHBOARD_PASSWORD_HASH ist die
 * Middleware passiv (Dev-Modus).
 */

const crypto = require('crypto');
const userStore = require('../services/userStore');

const COOKIE_NAME = 'faecherlofts_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

function getSecret() {
  return process.env.SESSION_SECRET
    || process.env.DASHBOARD_PASSWORD_HASH
    || 'dev-secret-not-for-production';
}

function isAuthEnabled() {
  return userStore.readUsers().length > 0 || !!process.env.DASHBOARD_PASSWORD_HASH;
}

// ── Cookie-Signierung ──────────────────────────────────────────────────────

function sign(payload) {
  const mac = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verify(signed) {
  if (!signed || typeof signed !== 'string') return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const payload = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return payload;
}

// Payload: userId|role|expiryMs
function buildPayload(user) {
  return `${user.id}|${user.role}|${Date.now() + MAX_AGE_MS}`;
}

function parsePayload(payload) {
  const parts = payload.split('|');
  if (parts.length < 3) return null;
  const userId = parts[0];
  const role = parts[1];
  const exp = parseInt(parts[2], 10);
  if (!userId || !role || !exp || isNaN(exp)) return null;
  return { userId, role, exp };
}

function readCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const p of header.split(';')) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    if (p.slice(0, eq).trim() === COOKIE_NAME) {
      return decodeURIComponent(p.slice(eq + 1).trim());
    }
  }
  return null;
}

function setCookie(res, req, value, maxAge) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Max-Age=${Math.floor(maxAge / 1000)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : null
  ].filter(Boolean);
  res.setHeader('Set-Cookie', parts.join('; '));
}

// ── Middleware ──────────────────────────────────────────────────────────────

function middleware(req, res, next) {
  if (!isAuthEnabled()) {
    // Dev-Modus: fake Admin-User
    req.user = { id: 'dev', username: 'dev', role: 'admin', displayName: 'Dev' };
    return next();
  }

  const cookie = readCookie(req);
  if (cookie) {
    const payload = verify(cookie);
    if (payload) {
      const parsed = parsePayload(payload);
      if (parsed && parsed.exp > Date.now()) {
        // User-Daten aus Cookie (kein DB-Lookup pro Request)
        req.user = { id: parsed.userId, role: parsed.role };
        return next();
      }
    }
  }

  const wantsHtml = (req.headers.accept || '').includes('text/html');
  if (wantsHtml) return res.redirect(302, '/login');
  return res.status(401).json({ error: 'Nicht angemeldet.' });
}

/**
 * Middleware-Factory fuer Rollen-Check.
 * requireRole('admin') → nur Admins duerfen durch.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
    if (!roles.includes(req.user.role)) {
      const wantsHtml = (req.headers.accept || '').includes('text/html');
      if (wantsHtml) return res.redirect(302, req.user.role === 'cleaner' ? '/my' : '/');
      return res.status(403).json({ error: 'Keine Berechtigung.' });
    }
    next();
  };
}

// ── Login / Logout / Login-Seite ────────────────────────────────────────────

async function login(req, res) {
  if (!isAuthEnabled()) {
    return res.status(503).json({ error: 'Auth nicht konfiguriert.' });
  }

  const { user: username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'User und Passwort erforderlich.' });
  }

  try {
    const user = await userStore.verifyPassword(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Anmeldung fehlgeschlagen.' });
    }

    const signed = sign(buildPayload(user));
    setCookie(res, req, signed, MAX_AGE_MS);
    res.json({ success: true, role: user.role, displayName: user.displayName });
  } catch (err) {
    console.error('[auth] login fehler:', err.message);
    return res.status(500).json({ error: 'Anmeldung fehlgeschlagen.' });
  }
}

function logout(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ success: true });
}

function loginPage(req, res) {
  const realm = process.env.DASHBOARD_REALM || 'FaecherLofts Manager';
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login – ${realm}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0f1117;
    color: #e8eaf0;
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .login-card {
    background: #1a1d27;
    border: 1px solid #2e3347;
    border-radius: 10px;
    padding: 32px;
    width: 100%;
    max-width: 360px;
  }
  .logo { font-size: 18px; font-weight: 700; margin-bottom: 24px; text-align: center; }
  .logo span { color: #4f72ff; }
  label { display: block; font-size: 12px; color: #7c84a0; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  input { width: 100%; padding: 10px 12px; background: #22263a; border: 1px solid #2e3347; border-radius: 6px; color: #e8eaf0; font-size: 14px; margin-bottom: 16px; font-family: inherit; }
  input:focus { outline: none; border-color: #4f72ff; }
  button { width: 100%; padding: 12px; background: #4f72ff; border: none; border-radius: 6px; color: white; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
  button:hover { background: #6685ff; }
  button:disabled { opacity: 0.6; cursor: wait; }
  .error { color: #e05252; font-size: 13px; margin-top: 12px; text-align: center; min-height: 18px; }
</style>
</head>
<body>
  <form class="login-card" id="loginForm">
    <div class="logo">Faecher<span>Lofts</span></div>
    <label for="user">Benutzer</label>
    <input type="text" id="user" name="user" autocomplete="username" required autofocus>
    <label for="password">Passwort</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <button type="submit" id="btn">Anmelden</button>
    <div class="error" id="err"></div>
  </form>
<script>
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn');
  const err = document.getElementById('err');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Anmelden…';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: document.getElementById('user').value,
        password: document.getElementById('password').value
      })
    });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.error || 'Anmeldung fehlgeschlagen.';
      btn.disabled = false;
      btn.textContent = 'Anmelden';
      return;
    }
    // Redirect basierend auf Rolle
    window.location.href = data.role === 'cleaner' ? '/my' : '/';
  } catch (ex) {
    err.textContent = 'Netzwerkfehler: ' + ex.message;
    btn.disabled = false;
    btn.textContent = 'Anmelden';
  }
});
</script>
</body>
</html>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

module.exports = {
  middleware,
  requireRole,
  login,
  logout,
  loginPage,
  isAuthEnabled
};
