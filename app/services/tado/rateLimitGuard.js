/**
 * Tado Rate Limit Guard (PROJ-6)
 *
 * Verhindert, dass eine Schreib-Aktion ausgefuehrt wird, wenn Tados tagliches
 * Kontingent nahezu erschoepft ist. Nutzt die echten RFC-9239-Header-Werte aus
 * v3Client/xClient und ergaenzt sie um einen Sicherheits-Puffer.
 *
 * Policy:
 *   - remaining > BUFFER     → Aktion erlaubt
 *   - remaining <= 0         → Aktion abgelehnt (429)
 *   - 0 < remaining <= BUFFER → Aktion erlaubt aber als "warnend" markiert
 *   - kein Header bekannt    → Fallback auf Request-Count, konservativer Puffer
 *
 * Zusaetzlich: wenn Tado selbst 429 liefert, markieren wir den Guard als
 * exhausted bis zum Header-Reset.
 */

const BUFFER = 20; // Requests die wir fuer Auto-Refreshes reservieren
const COUNT_FALLBACK_MAX = 80; // Maximalbewegung wenn nur Counter verfuegbar

// credKey -> { exhaustedUntil?: number }
const exhaustedUntil = new Map();

function isExhausted(credKey) {
  const until = exhaustedUntil.get(credKey);
  if (!until) return false;
  if (Date.now() > until) {
    exhaustedUntil.delete(credKey);
    return false;
  }
  return true;
}

function markExhausted(credKey, windowSec = 86400) {
  // Reset nach dem 24h-Fenster (oder Window aus Header, falls bekannt)
  exhaustedUntil.set(credKey, Date.now() + windowSec * 1000);
}

/**
 * Prueft ob eine Schreib-Aktion erlaubt ist.
 *
 * @param {object} rateLimit  normalisierte Form aus getRateLimit()
 * @param {string} credKey    Schluessel des Accounts (fuer exhausted-State)
 * @returns {{ allowed: boolean, reason?: string, warning?: string, remaining?: number, limit?: number }}
 */
function checkAction(rateLimit, credKey) {
  if (isExhausted(credKey)) {
    return { allowed: false, reason: 'Tado Rate-Limit erschoepft. Warte auf Reset.' };
  }

  if (rateLimit && rateLimit.source === 'header' && rateLimit.remaining !== null && rateLimit.remaining !== undefined) {
    const remaining = Number(rateLimit.remaining);
    if (remaining <= 0) {
      return {
        allowed: false,
        reason: `Tado-Limit erreicht (${rateLimit.used}/${rateLimit.limit}). Bitte warte auf Reset.`,
        remaining: 0,
        limit: rateLimit.limit
      };
    }
    if (remaining <= BUFFER) {
      return {
        allowed: true,
        warning: `Nur noch ${remaining} Requests uebrig – Aktion wurde trotzdem ausgefuehrt.`,
        remaining,
        limit: rateLimit.limit
      };
    }
    return { allowed: true, remaining, limit: rateLimit.limit };
  }

  // Fallback: keine Header, nutze lokalen Counter
  const used = (rateLimit && rateLimit.used) || 0;
  if (used >= COUNT_FALLBACK_MAX) {
    return {
      allowed: false,
      reason: `Lokaler Sicherheits-Puffer erreicht (${used}/${COUNT_FALLBACK_MAX}). Ein echter Tado-Read muss zuerst das aktuelle Limit liefern.`
    };
  }
  return { allowed: true, remaining: COUNT_FALLBACK_MAX - used, limit: COUNT_FALLBACK_MAX };
}

/**
 * Handler fuer Tado-429-Antworten: markiert den Account als erschoepft.
 */
function handleTado429(credKey, windowSec) {
  markExhausted(credKey, windowSec);
}

function _clearAll() {
  exhaustedUntil.clear();
}

module.exports = {
  checkAction,
  handleTado429,
  isExhausted,
  markExhausted,
  _clearAll,
  BUFFER,
  COUNT_FALLBACK_MAX
};
