/**
 * Zentrale Batterie-Logik (PROJ-10)
 *
 * Eine einzige Quelle der Wahrheit für die Frage „ist dieses Geraet als
 * niedrig-Batterie zu werten?". Verhindert, dass verschiedene Services
 * uneinheitliche Schwellwerte nutzen und dass null-Werte faelschlich
 * als 0 interpretiert werden.
 *
 * Strikte null-Behandlung: batteryPercent === null/undefined → IMMER false.
 */

const LOW_THRESHOLD = 30;

/**
 * @param {object} device     Normalisiertes Device-Objekt
 * @param {'tado'|'minut'|'nuki-lock'|'nuki-opener'} kind
 * @returns {boolean}
 */
function isLowBattery(device, kind) {
  if (!device) return false;

  if (kind === 'tado') {
    return device.batteryLow === true;
  }

  if (kind === 'minut') {
    return typeof device.batteryPercent === 'number'
      && device.batteryPercent < LOW_THRESHOLD;
  }

  if (kind === 'nuki-lock') {
    if (device.batteryCritical === true) return true;
    return typeof device.batteryPercent === 'number'
      && device.batteryPercent < LOW_THRESHOLD;
  }

  if (kind === 'nuki-opener') {
    return device.batteryCritical === true || device.batteryLow === true;
  }

  return false;
}

/**
 * Liefert einen lesbaren Batterie-Wert fuer das UI
 * (z.B. "25%" oder "kritisch" je nach Geraet).
 */
function formatBatteryValue(device, kind) {
  if (!device) return '—';

  if (kind === 'nuki-opener') {
    return device.batteryCritical ? 'kritisch' : 'niedrig';
  }

  if (typeof device.batteryPercent === 'number') {
    return `${device.batteryPercent}%`;
  }

  if (device.batteryLow || device.batteryCritical) return 'niedrig';
  return '—';
}

module.exports = {
  isLowBattery,
  formatBatteryValue,
  LOW_THRESHOLD
};
