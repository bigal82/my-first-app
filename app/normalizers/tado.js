/**
 * Tado Normalizer
 *
 * Wandelt rohe Tado-API-Antworten (V3 oder X) in das einheitliche
 * Dashboard-Format um. Fehlende Felder werden zu `null` normalisiert.
 *
 * Unified-Shape siehe PROJ-5 Tech Design.
 */

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function toBoolStrict(v) {
  // null bleibt false (gemäß Edge-Cases: null nicht als true werten)
  return v === true;
}

function roundTo(n, digits = 1) {
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ── V3 Normalisierung ───────────────────────────────────────────────────────

/**
 * V3 Zone + State → normalisierter Raum.
 *
 * Modes (Tado V3):
 *   - 'schedule' → kein Overlay, folgt Zeitplan
 *   - 'manual'   → Overlay mit power=ON, manuelle Temperatur
 *   - 'off'      → Overlay mit power=OFF, manuell ausgeschaltet
 */
function normalizeV3Room(zoneWithState) {
  const z = zoneWithState || {};
  const state = z.state || {};
  const setting = state.setting || {};
  const sensor = state.sensorDataPoints || {};
  const activity = state.activityDataPoints || {};
  const openWindow = state.openWindow || null;
  const overlay = state.overlay || null;

  const innerTemp = sensor.insideTemperature || {};
  const humidity = sensor.humidity || {};
  const heatingPower = activity.heatingPower || {};

  const targetTemp = setting.temperature ? setting.temperature.celsius : null;
  const powerOn = setting.power === 'ON';

  // Mode-Erkennung via Overlay
  let mode = 'schedule';
  if (overlay) {
    const overlaySetting = overlay.setting || {};
    mode = overlaySetting.power === 'OFF' ? 'off' : 'manual';
  }

  const devices = Array.isArray(z.devices) ? z.devices : [];
  const offline = devices.length > 0 && devices.every(d =>
    d && d.connectionState && d.connectionState.value === false
  );
  const batteryLow = devices.some(d => d && d.batteryState === 'LOW');

  return {
    id: z.id ?? null,
    name: z.name || '',
    currentTemp: roundTo(toNumberOrNull(innerTemp.celsius)),
    targetTemp: roundTo(toNumberOrNull(targetTemp)),
    humidity: roundTo(toNumberOrNull(humidity.percentage), 0),
    heating: toNumberOrNull(heatingPower.percentage) > 0,
    powerOn,
    mode,
    offline,
    windowOpen: openWindow !== null && openWindow !== undefined,
    batteryLow
  };
}

/**
 * V3 Home → Presence.
 */
function normalizeV3Presence(rawHome) {
  if (!rawHome || !rawHome.presence) return null;
  return rawHome.presence === 'AWAY' ? 'AWAY' : 'HOME';
}

// ── X Normalisierung ────────────────────────────────────────────────────────

/**
 * X Raum → normalisierter Raum.
 *
 * Die hops.tado.com-API liefert Raum-Info und State in einem Objekt.
 * Feldpfade unterscheiden sich von V3:
 *   - insideTemperature.value  (nicht .celsius)
 *   - setting.temperature.value
 *   - heatingPower.percentage  (top-level)
 *   - connection.state === 'CONNECTED'
 *   - openWindow ist null oder ein Objekt
 *
 * Battery-Info ist pro-Raum nicht verfügbar (kein devices[]-Array), daher
 * immer false. Eine separate Abfrage koennte das ergaenzen.
 */
function normalizeXRoom(rawRoom) {
  const r = rawRoom || {};
  const sensor = r.sensorDataPoints || {};
  const setting = r.setting || {};

  const inside = sensor.insideTemperature || {};
  const humidity = sensor.humidity || {};
  const targetObj = setting.temperature || {};
  const heatingPower = r.heatingPower || {};
  const connection = r.connection || {};

  // Mode-Erkennung: hops-API hat manualControlTermination
  // null → auf Plan, Objekt → manuelle Kontrolle aktiv
  let mode = 'schedule';
  if (r.manualControlTermination) {
    mode = setting.power === 'OFF' ? 'off' : 'manual';
  }

  return {
    id: r.id ?? null,
    name: (r.name || '').trim(),
    currentTemp: roundTo(toNumberOrNull(inside.value ?? inside.celsius)),
    targetTemp: roundTo(toNumberOrNull(targetObj.value ?? targetObj.celsius)),
    humidity: roundTo(toNumberOrNull(humidity.percentage), 0),
    heating: toNumberOrNull(heatingPower.percentage) > 0,
    powerOn: setting.power === 'ON',
    mode,
    offline: connection.state !== undefined && connection.state !== 'CONNECTED',
    windowOpen: r.openWindow !== null && r.openWindow !== undefined,
    batteryLow: false
  };
}

/**
 * X Presence: kommt bei Tado X meist aus /homes/{id}/state, nicht aus /homes/{id}.
 * Wir akzeptieren beide Quellen.
 */
function normalizeXPresence(rawHome) {
  if (!rawHome) return null;
  if (rawHome.presence) {
    return rawHome.presence === 'AWAY' ? 'AWAY' : 'HOME';
  }
  if (rawHome.state && rawHome.state.presence) {
    return rawHome.state.presence === 'AWAY' ? 'AWAY' : 'HOME';
  }
  return null;
}

// ── Gemeinsame Aggregation ──────────────────────────────────────────────────

/**
 * Berechnet die Durchschnittstemperatur ueber alle Raeume mit vorhandenem
 * currentTemp-Wert.
 */
function computeAverageTemperature(rooms) {
  const valid = rooms.filter(r => r.currentTemp !== null);
  if (valid.length === 0) return null;
  const sum = valid.reduce((s, r) => s + r.currentTemp, 0);
  return roundTo(sum / valid.length);
}

/**
 * Haupt-Einstieg: aus Raw-Data (bereits von V3 oder X Client geholt)
 * plus Rate-Limit wird die einheitliche Wohnungsstruktur gebaut.
 *
 * @param {'V3'|'X'} kind
 * @param {object} raw  { home, zones (V3) | rooms (X) }
 * @param {object} rateLimit
 * @param {number|null} homeId  die ermittelte Tado Home-ID (optional)
 * @returns {object}
 */
function normalize(kind, raw, rateLimit, homeId = null) {
  let rooms = [];
  let presence = null;

  if (kind === 'V3') {
    const zones = Array.isArray(raw.zones) ? raw.zones : [];
    rooms = zones.map(normalizeV3Room);
    presence = normalizeV3Presence(raw.home);
  } else if (kind === 'X') {
    const xRooms = Array.isArray(raw.rooms) ? raw.rooms : [];
    rooms = xRooms.map(normalizeXRoom);
    presence = normalizeXPresence(raw.home);
  } else {
    throw new Error(`Unbekannter Tado-Typ: ${kind}`);
  }

  return {
    kind,
    homeId,
    presence,
    averageTemperature: computeAverageTemperature(rooms),
    rooms,
    // rateLimit kommt vom Client (Tado RFC 9239 Header oder Fallback-Count).
    // Wenn Tado Header liefert: used/remaining/limit sind gesetzt, source='header'
    rateLimit: rateLimit || {
      used: 0, remaining: null, limit: null, windowSec: 86400,
      fetchedAt: new Date().toISOString(), source: 'count'
    },
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  normalize,
  normalizeV3Room,
  normalizeV3Presence,
  normalizeXRoom,
  normalizeXPresence,
  computeAverageTemperature
};
