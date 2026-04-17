/**
 * Tado Action Lock (PROJ-6)
 *
 * Verhindert, dass dieselbe Aktion (z.B. "Raum 5 in Wohnung bf1 aus") mehrfach
 * parallel am Server ausgefuehrt wird. Wichtig, wenn ein ungeduldiger Klick
 * zweimal feuert oder das Dashboard parallel in mehreren Tabs offen ist.
 *
 * Locks sind in-memory, Schluessel-basiert und zeitlich begrenzt (auto-release
 * nach 30 s als Safety-Net fuer haengende Requests).
 */

const LOCK_TIMEOUT_MS = 30 * 1000;

// key -> expiresAt (timestamp)
const locks = new Map();

function gc() {
  const now = Date.now();
  for (const [key, expiresAt] of locks) {
    if (expiresAt < now) locks.delete(key);
  }
}

/**
 * Versucht einen Lock zu reservieren.
 * @returns {boolean} true wenn der Lock frisch reserviert wurde, false wenn schon belegt.
 */
function acquire(key) {
  gc();
  if (locks.has(key)) return false;
  locks.set(key, Date.now() + LOCK_TIMEOUT_MS);
  return true;
}

function release(key) {
  locks.delete(key);
}

function isLocked(key) {
  gc();
  return locks.has(key);
}

function _clearAll() {
  locks.clear();
}

module.exports = { acquire, release, isLocked, _clearAll, LOCK_TIMEOUT_MS };
