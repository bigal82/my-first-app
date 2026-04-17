/**
 * Nuki Normalizer (PROJ-9)
 *
 * Mappt Nuki-Web-API-v3-Antworten auf die Dashboard-Shape.
 * Numerische Type- und State-Codes werden immer zu Klartext konvertiert.
 * batteryPercent: null bleibt null (niemals 0 inferieren).
 */

// Typ-Mapping (Nuki device types).
// Fuer die UX unterscheiden wir nur Lock vs Opener.
function typeLabel(rawType) {
  if (rawType === 2) return 'Opener';
  if (rawType === 0 || rawType === 3 || rawType === 4 || rawType === 5) return 'Lock';
  return 'Geraet';
}

// Lock state mapping
function lockStateLabel(state) {
  switch (state) {
    case 0: return 'uncalibrated';
    case 1: return 'locked';
    case 2: return 'unlocking';
    case 3: return 'unlocked';
    case 4: return 'locking';
    case 5: return 'unlatched';
    case 6: return 'unlocked';
    case 7: return 'unlatching';
    case 254: return 'motor_blocked';
    default: return 'unknown';
  }
}

// Opener state mapping
function openerStateLabel(state) {
  switch (state) {
    case 0: return 'untrained';
    case 1: return 'ready';
    case 2: return 'rto_active';
    case 3: return 'open';
    case 5: return 'rto_timeout';
    case 7: return 'boot';
    default: return 'unknown';
  }
}

function pickBatteryPercent(stateObj) {
  if (!stateObj) return null;
  // Nuki Web API: das Lock-state-Objekt nutzt `batteryCharge` (0..100).
  // Wir akzeptieren auch Aliase fuer andere API-Versionen.
  const candidates = [
    stateObj.batteryCharge,
    stateObj.batteryChargeState,
    stateObj.batteryPercent,
    stateObj.battery
  ];
  for (const v of candidates) {
    if (typeof v === 'number') return v;
  }
  return null;
}

/**
 * Normalisiert ein einzelnes Nuki-Geraet aus /smartlock-Response.
 */
function normalizeDevice(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Nuki Normalizer: ungueltige Device-Antwort');
  }

  const rawType = raw.type;
  const label = typeLabel(rawType);

  const state = raw.state || {};
  const stateNum = typeof state.state === 'number' ? state.state : null;
  const stateLabelResult = label === 'Opener'
    ? openerStateLabel(stateNum)
    : lockStateLabel(stateNum);

  const batteryPercent = pickBatteryPercent(state);

  // Online: Nuki liefert serverState, 0 = online
  const online = raw.serverState === 0 || state.serverState === 0 || raw.online === true;

  return {
    id: raw.smartlockId || raw.id || null,
    name: raw.name || '(unbenannt)',
    type: label,
    online,
    stateLabel: stateLabelResult,
    batteryPercent,
    batteryCharging: !!state.batteryCharging,
    batteryLow: state.batteryCritical === true || (batteryPercent !== null && batteryPercent < 30),
    batteryCritical: state.batteryCritical === true
  };
}

/**
 * Normalisiert eine Device-Liste.
 */
function normalizeDeviceList(raw) {
  const list = Array.isArray(raw) ? raw : (raw && raw.devices) || [];
  return list.map(normalizeDevice);
}

/**
 * Reduziert normalisierte Liste auf die Geraete mit den angefragten IDs.
 */
function filterByIds(normalizedList, deviceIds) {
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) return [];
  const set = new Set(deviceIds.map(String));
  return normalizedList.filter(d => set.has(String(d.id)));
}

module.exports = {
  normalizeDevice,
  normalizeDeviceList,
  filterByIds,
  typeLabel,
  lockStateLabel,
  openerStateLabel
};
