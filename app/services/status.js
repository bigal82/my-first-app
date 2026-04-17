/**
 * Status-Aggregations-Service (PROJ-10)
 *
 * Liest die In-Memory-Caches von Tado, Minut und Nuki und aggregiert
 * Offline-Raeume, offene Fenster und niedrige Batterien fuer das globale
 * Dashboard-Banner. Macht keine externen API-Calls.
 */

const fs = require('fs');
const tadoDataCache = require('./tado/dataCache');
const minutService = require('./minut');
const nukiService = require('./nuki');
const battery = require('../normalizers/battery');
const { APARTMENTS: CONFIG_PATH } = require('../config-path');

function readApartments() {
  if (!fs.existsSync(CONFIG_PATH)) return [];
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return cfg.apartments || [];
  } catch {
    return [];
  }
}

/**
 * Hauptfunktion: aggregiert den globalen Status aus allen Cache-Eintraegen.
 * Keine externen API-Calls.
 */
function aggregate() {
  const apartments = readApartments();
  const offlineRooms = [];
  const openWindows = [];
  const lowBatteries = [];
  const withWarnings = new Set();

  function markWarning(aptId) { withWarnings.add(aptId); }

  for (const apt of apartments) {
    if (!apt.visible) continue;
    const apartmentId = apt.id;
    const apartmentName = apt.name;
    const ints = apt.integrations || {};

    // ── Tado: rooms aus dataCache ──
    if (ints.tado && ints.tado.enabled) {
      const entry = tadoDataCache.getEntry(apartmentId);
      const rooms = entry && entry.data && Array.isArray(entry.data.rooms) ? entry.data.rooms : [];
      for (const r of rooms) {
        if (r.offline) {
          offlineRooms.push({ apartmentId, apartmentName, roomName: r.name, integration: 'tado' });
          markWarning(apartmentId);
        }
        if (r.windowOpen) {
          openWindows.push({ apartmentId, apartmentName, roomName: r.name });
          markWarning(apartmentId);
        }
        if (battery.isLowBattery(r, 'tado')) {
          lowBatteries.push({
            apartmentId, apartmentName,
            deviceName: r.name,
            integration: 'tado',
            value: battery.formatBatteryValue(r, 'tado')
          });
          markWarning(apartmentId);
        }
      }
    }

    // ── Minut: ein Geraet pro Wohnung aus dataCache ──
    if (ints.minut && ints.minut.enabled && ints.minut.deviceId) {
      const entry = minutService._getDeviceCacheEntry
        ? minutService._getDeviceCacheEntry(ints.minut.deviceId)
        : null;
      if (entry && entry.data) {
        const dev = entry.data;
        if (battery.isLowBattery(dev, 'minut')) {
          lowBatteries.push({
            apartmentId, apartmentName,
            deviceName: dev.deviceName || 'Minut-Sensor',
            integration: 'minut',
            value: battery.formatBatteryValue(dev, 'minut')
          });
          markWarning(apartmentId);
        }
        if (dev.offline) {
          offlineRooms.push({
            apartmentId, apartmentName,
            roomName: dev.deviceName || 'Minut-Sensor',
            integration: 'minut'
          });
          markWarning(apartmentId);
        }
      }
    }

    // ── Nuki: mehrere Geraete pro Wohnung aus globaler Liste ──
    if (ints.nuki && ints.nuki.enabled && Array.isArray(ints.nuki.deviceIds) && ints.nuki.deviceIds.length > 0) {
      const nukiList = nukiService._getCachedListRaw
        ? nukiService._getCachedListRaw()
        : null;
      if (Array.isArray(nukiList)) {
        const selectedSet = new Set(ints.nuki.deviceIds.map(String));
        const devices = nukiList.filter(d => selectedSet.has(String(d.id)));
        for (const d of devices) {
          const kind = d.type === 'Opener' ? 'nuki-opener' : 'nuki-lock';
          if (battery.isLowBattery(d, kind)) {
            lowBatteries.push({
              apartmentId, apartmentName,
              deviceName: d.name,
              integration: 'nuki',
              value: battery.formatBatteryValue(d, kind)
            });
            markWarning(apartmentId);
          }
          if (!d.online) {
            offlineRooms.push({
              apartmentId, apartmentName,
              roomName: d.name,
              integration: 'nuki'
            });
            markWarning(apartmentId);
          }
        }
      }
    }
  }

  return {
    offlineRooms,
    openWindows,
    lowBatteries,
    apartmentsWithWarnings: Array.from(withWarnings),
    fetchedAt: new Date().toISOString()
  };
}

module.exports = { aggregate };
