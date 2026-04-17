/**
 * Minut Normalizer
 *
 * Wandelt rohe Minut-API-Antworten in das einheitliche Dashboard-Format um.
 * Minut liefert Device-Objekte ungefaehr in dieser Form:
 *   {
 *     device_id, device_name, device_type,
 *     battery: { percent: 85 },
 *     last_heard_from_at: "2026-04-15T10:00:00Z",
 *     ...
 *   }
 *
 * Da verschiedene API-Versionen und Geraete minimal unterschiedliche Felder
 * liefern, ist der Normalizer defensiv gegen fehlende Felder.
 */

const OFFLINE_HOURS = 24;

function pickNumber(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/**
 * Normalisiert Geraete-Basisdaten fuer das Dashboard-Widget.
 */
function normalizeDevice(rawDevice) {
  if (!rawDevice || typeof rawDevice !== 'object') {
    throw new Error('Minut Normalizer: leere oder ungueltige Device-Antwort');
  }

  // Minut packt das Device-Objekt manchmal unter "device"
  const d = rawDevice.device || rawDevice;

  const battery = d.battery || {};
  const batteryPercent = pickNumber(
    battery.percent ?? battery.value ?? d.battery_percent
  );

  const lastHeardFromAt = d.last_heard_from_at || d.last_heard_from || null;
  let offline = false;
  if (lastHeardFromAt) {
    const age = Date.now() - new Date(lastHeardFromAt).getTime();
    offline = age > OFFLINE_HOURS * 60 * 60 * 1000;
  }

  // Latest sensor values koennen an zwei Stellen liegen: entweder unter
  // latest_sensor_values.{temperature|humidity|sound_level}.value oder direkt
  // top-level als Zahl. Wir lesen beide Varianten defensiv.
  const lsv = d.latest_sensor_values || {};
  function readLatest(key, topLevelKey) {
    const obj = lsv[key];
    if (obj && typeof obj === 'object') return pickNumber(obj.value);
    return pickNumber(d[topLevelKey || key]);
  }

  const temperature = readLatest('temperature');
  const humidity = readLatest('humidity');
  const soundLevel = readLatest('sound_level', 'sound_level');

  return {
    deviceId: d.device_id || d.id || null,
    deviceName: d.description || d.device_name || d.name || '',
    homeId: d.home_id || d.home || null,
    batteryPercent,
    batteryLow: batteryPercent !== null && batteryPercent < 30,
    lastHeardFromAt,
    offline,
    temperature,
    humidity,
    soundLevel,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Normalisiert historische Datenpunkte (fuer PROJ-8 Charts).
 * Unterstuetzt verschiedene Minut-Feldnamen:
 *   - .datetime (tatsaechliches Minut-Feld)
 *   - .timestamp, .time (generische Alternativen)
 *   - [unixSeconds, value] Tupel
 */
function normalizeTimeSeries(rawSeries) {
  if (!Array.isArray(rawSeries)) return [];
  return rawSeries.map(p => {
    if (Array.isArray(p)) {
      return { timestamp: new Date(p[0] * 1000).toISOString(), value: pickNumber(p[1]) };
    }
    return {
      timestamp: p.datetime || p.timestamp || p.time || p.at || null,
      value: pickNumber(p.value ?? p.val)
    };
  });
}

module.exports = { normalizeDevice, normalizeTimeSeries };
