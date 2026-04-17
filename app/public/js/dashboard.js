/**
 * Dashboard – FaecherLofts Manager
 * PROJ-3: KPI-Zeile, Statusbanner, Filter, Wohnungskarten, Empty-States.
 * PROJ-4: Belegungs-Slot + Status-Badge + Chip "Gast da" via /api/occupancy/:id
 * PROJ-5: Tado-Raeume + Tado-RateLimit-Slot via /api/tado/:id
 *
 * Nuki-Slot bleibt Platzhalter fuer PROJ-9.
 */

// ── Utilities ────────────────────────────────────────────────────────────────

function esc(val) {
  const d = document.createElement('div');
  d.textContent = String(val ?? '');
  return d.innerHTML;
}

function setVisible(el, show) {
  if (el) el.style.display = show ? '' : 'none';
}

function formatTime(date) {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(date) {
  const d = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const t = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${t} · ${d}`;
}

// iCal-SUMMARY enthaelt bei vielen Plattformen den Wohnungsnamen irgendwo im
// Text (z.B. "Alex Mueller - B39", "Nadine Jacobi, H66 1.OG", "Gast (H66)").
// Auf dem Dashboard wird der Wohnungsname schon oben in der Karte angezeigt,
// deshalb hier aus dem Buchungstitel rausstreichen — unabhaengig von Position,
// Separator und kleinen Schreibweisen-Unterschieden (z.B. "H66 1. OG" vs
// "H66 1.OG"). Dafuer wird der Wohnungsname in alphanumerische Wort-Chunks
// zerlegt und dazwischen alles (Whitespace + Punkt + Komma …) erlaubt.
function stripAptNameFromTitle(title, aptName) {
  if (!title) return '';
  let cleaned = title;

  // 1. Versuch: exakter Match ueber apt.name (fuzzy: Wort-Chunks, beliebige
  //    Separatoren dazwischen, beliebige Position im Titel).
  if (aptName) {
    const parts = aptName.match(/[\p{L}\p{N}]+/gu) || [];
    if (parts.length > 0) {
      const chunk = parts
        .map(p => p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))
        .join('[\\s\\W]*');
      const token = new RegExp(`[\\s\\-–—,·|()\\[\\]]*${chunk}[\\s\\-–—,·|()\\[\\]]*`, 'giu');
      const afterExact = cleaned.replace(token, ' ').replace(/\s{2,}/g, ' ').trim()
        .replace(/^[-–—,·|()\[\]\s]+|[-–—,·|()\[\]\s]+$/g, '').trim();
      if (afterExact && afterExact !== cleaned) cleaned = afterExact;
    }
  }

  // 2. Fallback: Smoobu & Co. packen gern "Gastname, Apartment-ID" oder
  //    "Gastname - Apartment-ID" in die SUMMARY. Wenn der Name vom Setup
  //    abweicht, finden wir den letzten Separator und schneiden dahinter
  //    ab — ABER nur wenn der Teil dahinter nach Apartment-ID aussieht
  //    (enthaelt mindestens eine Ziffer). So bleiben Namens-Suffixe wie
  //    "Max Mueller, Jr." unangetastet.
  const sepRegex = /\s+[-–—·|]\s+|,\s+/g;
  let lastMatch = null;
  let m;
  while ((m = sepRegex.exec(cleaned)) !== null) {
    lastMatch = { index: m.index, end: sepRegex.lastIndex };
  }
  if (lastMatch) {
    const tail = cleaned.slice(lastMatch.end);
    if (/\d/.test(tail)) {
      cleaned = cleaned.slice(0, lastMatch.index).trim();
    }
  }

  return cleaned || title;
}

// ── State ─────────────────────────────────────────────────────────────────────

let apartments = [];
let lastLoaded = null;
let searchTerm = '';
let activeChip = 'alle';       // 'alle' | 'warnings' | 'guest'
let bannerDismissed = false;

// Belegungsdaten pro Apartment-ID:
//   'loading' | { occupied, statusLabel, currentBooking, nextBooking, stale?, error? }
const occupancyMap = new Map();

// Tado-Daten pro Apartment-ID:
//   'loading' | { kind, presence, averageTemperature, rooms, rateLimit, stale?, error? }
const tadoMap = new Map();

// Minut-Daten pro Apartment-ID:
//   'loading' | { deviceName, batteryPercent, batteryLow, lastHeardFromAt, offline, stale?, error? }
const minutMap = new Map();

// Nuki-Daten pro Apartment-ID:
//   'loading' | { devices, cached, stale?, error?, fetchedAt }
const nukiMap = new Map();

// Aggregierter globaler Status (PROJ-10)
let globalStatus = null;

// ── API ──────────────────────────────────────────────────────────────────────

async function loadApartments() {
  const res = await fetch('/api/apartments');
  if (!res.ok) throw new Error('API-Fehler ' + res.status);
  apartments = await res.json();
  lastLoaded = new Date();
}

async function loadOccupancy(aptId) {
  try {
    const res = await fetch('/api/occupancy/' + encodeURIComponent(aptId));
    if (!res.ok) {
      const msg = await res.json().catch(() => ({}));
      occupancyMap.set(aptId, { error: msg.error || 'HTTP ' + res.status });
      return;
    }
    occupancyMap.set(aptId, await res.json());
  } catch (err) {
    occupancyMap.set(aptId, { error: err.message });
  }
}

async function loadAllOccupancies() {
  const enabled = apartments.filter(a =>
    a.visible && a.occupancy && (
      (a.occupancy.enabled && a.occupancy.icalUrl) ||
      (a.occupancy.source === 'smoobu' && a.occupancy.smoobuApartmentId)
    )
  );
  enabled.forEach(a => occupancyMap.set(a.id, 'loading'));

  // Parallel laden, nach jeder Antwort das Grid neu zeichnen
  await Promise.all(enabled.map(async apt => {
    await loadOccupancy(apt.id);
    renderGrid();
    renderKpiRow();
  }));
}

async function loadTado(aptId) {
  try {
    const res = await fetch('/api/tado/' + encodeURIComponent(aptId));
    if (!res.ok) {
      const msg = await res.json().catch(() => ({}));
      tadoMap.set(aptId, { error: msg.error || 'HTTP ' + res.status });
      return;
    }
    tadoMap.set(aptId, await res.json());
  } catch (err) {
    tadoMap.set(aptId, { error: err.message });
  }
}

async function loadAllTado() {
  const enabled = apartments.filter(a =>
    a.visible && a.integrations && a.integrations.tado && a.integrations.tado.enabled
  );
  enabled.forEach(a => tadoMap.set(a.id, 'loading'));

  await Promise.all(enabled.map(async apt => {
    await loadTado(apt.id);
    renderGrid();
  }));
}

async function loadMinut(aptId) {
  try {
    const res = await fetch('/api/minut/' + encodeURIComponent(aptId));
    if (!res.ok) {
      const msg = await res.json().catch(() => ({}));
      minutMap.set(aptId, { error: msg.error || 'HTTP ' + res.status });
      return;
    }
    minutMap.set(aptId, await res.json());
  } catch (err) {
    minutMap.set(aptId, { error: err.message });
  }
}

async function loadAllMinut() {
  const enabled = apartments.filter(a =>
    a.visible && a.integrations && a.integrations.minut && a.integrations.minut.enabled && a.integrations.minut.deviceId
  );
  enabled.forEach(a => minutMap.set(a.id, 'loading'));

  await Promise.all(enabled.map(async apt => {
    await loadMinut(apt.id);
    renderGrid();
  }));
}

async function loadNuki(aptId) {
  try {
    const res = await fetch('/api/nuki/' + encodeURIComponent(aptId));
    if (!res.ok) {
      const msg = await res.json().catch(() => ({}));
      nukiMap.set(aptId, { error: msg.error || 'HTTP ' + res.status });
      return;
    }
    nukiMap.set(aptId, await res.json());
  } catch (err) {
    nukiMap.set(aptId, { error: err.message });
  }
}

async function loadAllNuki() {
  const enabled = apartments.filter(a =>
    a.visible && a.integrations && a.integrations.nuki && a.integrations.nuki.enabled &&
    Array.isArray(a.integrations.nuki.deviceIds) && a.integrations.nuki.deviceIds.length > 0
  );
  enabled.forEach(a => nukiMap.set(a.id, 'loading'));

  await Promise.all(enabled.map(async apt => {
    await loadNuki(apt.id);
    renderGrid();
  }));
}

async function loadGlobalStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    globalStatus = await res.json();
    renderStatusBanner();
    renderKpiRow();
  } catch (err) {
    console.warn('Status-Aggregation fehlgeschlagen:', err.message);
  }
}

// ── Filter & Berechnungen ────────────────────────────────────────────────────

function visibleApartments() {
  return apartments.filter(a => a.visible);
}

function filteredApartments() {
  const term = searchTerm.trim().toLowerCase();
  let list = visibleApartments();

  if (term) {
    list = list.filter(a =>
      (a.name || '').toLowerCase().includes(term) ||
      (a.location || '').toLowerCase().includes(term)
    );
  }

  // Chip "Gast da" filtert nach Belegungsstatus (PROJ-4)
  if (activeChip === 'guest') {
    list = list.filter(a => {
      const occ = occupancyMap.get(a.id);
      return occ && occ !== 'loading' && occ.occupied === true;
    });
  }

  // Chip "Mit Warnungen" bleibt Platzhalter bis PROJ-10
  return list;
}

function countWarnings() {
  // Platzhalter – PROJ-10 liefert echte Zahlen
  return 0;
}

// ── Render: KPI-Row ──────────────────────────────────────────────────────────

function renderKpiRow() {
  const container = document.getElementById('kpi-row');
  const active = visibleApartments().length;
  const warnings = globalStatus && Array.isArray(globalStatus.apartmentsWithWarnings)
    ? globalStatus.apartmentsWithWarnings.length
    : 0;
  const stamp = lastLoaded ? formatDateTime(lastLoaded) : '—';

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Aktive Wohnungen</div>
        <div class="kpi-value">${active}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Mit Warnungen</div>
        <div class="kpi-value ${warnings > 0 ? 'text-warning' : ''}">${warnings}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Letzter Stand</div>
        <div class="kpi-value kpi-value--small">${esc(stamp)}</div>
        <div class="kpi-sublabel">Naechster Refresh: <span id="kpi-next-refresh">—</span></div>
      </div>
    </div>
  `;
}

// ── Render: Sensor-Row (Lautstaerke + Temperatur) ────────────────────────────
//
// Zwei 50:50-Kacheln direkt unter der KPI-Row. Zeigen fuer jede Minut-
// Wohnung eine 24h-Linie, sodass Ausreisser auf einen Blick erkennbar
// sind. Die Temperatur-Kachel mischt Minut-Sensor + Tado-Raumdurchschnitt
// pro Wohnung (Mittelwert), sofern beide Quellen Daten liefern.

const SENSOR_RANGE = '24h';
const minutHistoryMap = new Map();       // aptId → { temperature:[], noise:[], ... }
const noiseProfileMap = new Map();       // aptId → { noiseLimit, quietHoursLimit, quietHours:[] }
let sensorCharts = { noise: null, temperature: null, humidity: null };

// Stabile Farbpalette fuer Wohnungen — index-basiert, wiederholt sich nach 8
const APT_COLORS = [
  '#4f72ff', '#34c97b', '#ffb020', '#e65b5b',
  '#8f54c9', '#1fb2c7', '#f07ab3', '#6c8a99'
];
function colorForIndex(i) { return APT_COLORS[i % APT_COLORS.length]; }

async function loadMinutHistory(aptId) {
  try {
    const res = await fetch(`/api/minut/${encodeURIComponent(aptId)}/history?range=${SENSOR_RANGE}`);
    if (!res.ok) return;
    minutHistoryMap.set(aptId, await res.json());
  } catch (err) {
    console.warn('[Dashboard] Minut-History fehlgeschlagen', aptId, err.message);
  }
}

async function loadMinutNoiseProfile(aptId) {
  try {
    const res = await fetch(`/api/minut/${encodeURIComponent(aptId)}/noise-profile`);
    if (!res.ok) return;
    noiseProfileMap.set(aptId, await res.json());
  } catch (err) {
    console.warn('[Dashboard] Noise-Profile fehlgeschlagen', aptId, err.message);
  }
}

async function loadAllMinutHistories() {
  const enabled = apartments.filter(a =>
    a.visible && a.integrations && a.integrations.minut && a.integrations.minut.enabled && a.integrations.minut.deviceId
  );
  await Promise.all(enabled.map(async apt => {
    await Promise.all([
      loadMinutHistory(apt.id),
      loadMinutNoiseProfile(apt.id)
    ]);
    renderSensorRow();
  }));
}

// Prueft ob ein Zeitpunkt in einem der Quiet-Hours-Slots liegt.
function isInQuietHours(date, quietHoursList) {
  if (!Array.isArray(quietHoursList) || quietHoursList.length === 0) return false;
  const h = date.getHours() + date.getMinutes() / 60;
  return quietHoursList.some(qh => {
    const start = qh.startHour;
    const end = qh.endHour;
    if (start < end) return h >= start && h < end;
    return h >= start || h < end;
  });
}

// Mischt zwei Serien zeitbasiert und bildet pro Bucket den Mittelwert.
// Verwendet Minut-Timestamps als Raster (Minut liefert bereits downgesampled),
// falls Tado-Historie eingepflegt wird, waere sie hier zu mergen.
function meanSeries(seriesA, seriesB) {
  if (!seriesA && !seriesB) return [];
  if (!seriesA) return seriesB || [];
  if (!seriesB) return seriesA || [];
  // Simples Raster-Matching per Millisekunde — Tado-Historie fehlt aktuell
  // ohnehin, also effektiv durchreichen. Platz halten fuer spaetere Mischung.
  return seriesA;
}

function getNoiseDatasets() {
  // Eine Linie pro Wohnung + EINE gemeinsame Limit-Linie (alle Geraete
  // haben das gleiche Noise-Profil). Limit wird vom ersten verfuegbaren
  // Profil gelesen — da alle identisch sind, reicht das.
  const datasets = [];
  let colorIdx = 0;
  let allPoints = []; // fuer die gemeinsame Limit-Linie
  let sharedProfile = null;

  visibleApartments().forEach(apt => {
    const h = minutHistoryMap.get(apt.id);
    if (!h || !Array.isArray(h.noise) || h.noise.length === 0) return;
    const color = colorForIndex(colorIdx);
    const points = h.noise.map(p => ({ x: new Date(p.timestamp), y: p.value }));

    datasets.push({
      label: apt.name,
      data: points,
      borderColor: color,
      backgroundColor: color + '22',
      borderWidth: 2,
      fill: false,
      pointRadius: 0,
      tension: 0.25
    });

    // Erstes verfuegbares Profil als gemeinsames Limit uebernehmen
    if (!sharedProfile) {
      const profile = noiseProfileMap.get(apt.id);
      if (profile && (profile.noiseLimit || profile.quietHoursLimit)) {
        sharedProfile = profile;
      }
    }
    if (points.length > allPoints.length) allPoints = points;

    colorIdx++;
  });

  // Gemeinsame Limit-Linie (eine fuer alle, nicht pro Wohnung)
  if (sharedProfile && allPoints.length > 0) {
    const normalLimit = sharedProfile.noiseLimit ?? sharedProfile.quietHoursLimit;
    const quietLimit  = sharedProfile.quietHoursLimit ?? sharedProfile.noiseLimit;
    const qh = sharedProfile.quietHours || [];
    const limitPoints = allPoints.map(p => ({
      x: p.x,
      y: isInQuietHours(p.x, qh) ? quietLimit : normalLimit
    }));
    datasets.push({
      label: 'Limit',
      data: limitPoints,
      borderColor: '#e05252',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [6, 4],
      fill: false,
      pointRadius: 0,
      stepped: true,
      tension: 0,
      _isLimit: true
    });
  }

  return datasets;
}

function getTempDatasets() {
  // Pro Wohnung: Mittelwert aus Minut-Temperaturhistorie + (spaeter) Tado.
  // Solange keine Tado-Historie vorliegt, fliesst nur Minut ein.
  const datasets = [];
  let colorIdx = 0;
  visibleApartments().forEach(apt => {
    const h = minutHistoryMap.get(apt.id);
    const minutSeries = h && Array.isArray(h.temperature) ? h.temperature : null;
    const merged = meanSeries(minutSeries, null);
    if (!merged || merged.length === 0) return;
    datasets.push({
      label: apt.name,
      data: merged.map(p => ({ x: new Date(p.timestamp), y: p.value })),
      borderColor: colorForIndex(colorIdx),
      backgroundColor: colorForIndex(colorIdx) + '22',
      borderWidth: 2,
      fill: false,
      pointRadius: 0,
      tension: 0.25
    });
    colorIdx++;
  });
  return datasets;
}

function getHumidityDatasets() {
  // Eine Linie pro Wohnung aus der Minut-Feuchte-Historie
  const datasets = [];
  let colorIdx = 0;
  visibleApartments().forEach(apt => {
    const h = minutHistoryMap.get(apt.id);
    if (!h || !Array.isArray(h.humidity) || h.humidity.length === 0) return;
    const color = colorForIndex(colorIdx);
    datasets.push({
      label: apt.name,
      data: h.humidity.map(p => ({ x: new Date(p.timestamp), y: p.value })),
      borderColor: color,
      backgroundColor: color + '22',
      borderWidth: 2,
      fill: false,
      pointRadius: 0,
      tension: 0.25
    });
    colorIdx++;
  });
  return datasets;
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function makeSensorChartConfig(datasets, unit) {
  const grid   = cssVar('--color-chart-grid', '#2e3347');
  const tick   = cssVar('--color-chart-tick', '#7c84a0');
  const legend = cssVar('--color-chart-legend', '#c3c9da');
  return {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: legend,
            boxWidth: 10,
            boxHeight: 10,
            font: { size: 11 },
            // Limit-Linien nicht in der Legende anzeigen
            filter: (item, data) => {
              const ds = data.datasets[item.datasetIndex];
              return !ds || !ds._isLimit;
            }
          },
          // Beim Klick auf eine Wohnung im Legend auch deren gepaarte
          // Limit-Linie mit an-/ausschalten. So verschwindet das Limit
          // zusammen mit der Linie der abgewaehlten Wohnung.
          onClick: (e, legendItem, legend) => {
            const chart = legend.chart;
            const idx = legendItem.datasetIndex;
            const ds = chart.data.datasets[idx];
            if (!ds) return;
            const wasVisible = chart.isDatasetVisible(idx);
            chart.setDatasetVisibility(idx, !wasVisible);
            // Gepaarte Limit-Linie anhand des Labels finden
            const limitIdx = chart.data.datasets.findIndex(
              d => d._isLimit && d.label === `${ds.label} Limit`
            );
            if (limitIdx !== -1) chart.setDatasetVisibility(limitIdx, !wasVisible);
            chart.update();
          }
        },
        tooltip: {
          filter: (item) => !item.dataset._isLimit,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              return v !== null && v !== undefined
                ? `${ctx.dataset.label}: ${v.toFixed(1)} ${unit}`
                : `${ctx.dataset.label}: —`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            tooltipFormat: 'dd.MM. HH:mm',
            displayFormats: { hour: 'HH:mm', day: 'dd.MM.', minute: 'HH:mm' }
          },
          max: new Date(), // Achse bis jetzt, auch wenn letzte Daten aelter sind
          grid: { color: grid },
          ticks: { color: tick, maxTicksLimit: 6 }
        },
        y: { grid: { color: grid }, ticks: { color: tick } }
      }
    }
  };
}

// Theme-Wechsel → Charts neu zeichnen, damit die neuen CSS-Farben greifen
document.addEventListener('themechange', () => renderSensorRow());

function destroySensorCharts() {
  if (sensorCharts.noise) { sensorCharts.noise.destroy(); sensorCharts.noise = null; }
  if (sensorCharts.temperature) { sensorCharts.temperature.destroy(); sensorCharts.temperature = null; }
  if (sensorCharts.humidity) { sensorCharts.humidity.destroy(); sensorCharts.humidity = null; }
}

function renderSensorRow() {
  const container = document.getElementById('sensor-row');
  if (!container) return;

  // Wenn der Container bereits die Charts hat, nur die Datasets updaten.
  // Beim ersten Aufruf den Skeleton-Markup setzen.
  if (!container.querySelector('.sensor-row-grid')) {
    container.innerHTML = `
      <div class="sensor-row-grid">
        <div class="kpi-card sensor-card">
          <div class="kpi-label">Lautstaerke (24h)</div>
          <div class="sensor-chart-body"><canvas id="dash-chart-noise"></canvas></div>
        </div>
        <div class="kpi-card sensor-card">
          <div class="kpi-label">Temperatur (24h)</div>
          <div class="sensor-chart-body"><canvas id="dash-chart-temperature"></canvas></div>
        </div>
        <div class="kpi-card sensor-card">
          <div class="kpi-label">Luftfeuchte (24h)</div>
          <div class="sensor-chart-body"><canvas id="dash-chart-humidity"></canvas></div>
        </div>
      </div>
    `;
  }

  if (typeof Chart === 'undefined') return; // Chart.js noch nicht geladen

  const noiseDs = getNoiseDatasets();
  const tempDs  = getTempDatasets();
  const humDs   = getHumidityDatasets();

  destroySensorCharts();

  const noiseCtx = document.getElementById('dash-chart-noise');
  const tempCtx  = document.getElementById('dash-chart-temperature');
  const humCtx   = document.getElementById('dash-chart-humidity');
  if (noiseCtx) sensorCharts.noise = new Chart(noiseCtx, makeSensorChartConfig(noiseDs, 'dB'));
  if (tempCtx)  sensorCharts.temperature = new Chart(tempCtx, makeSensorChartConfig(tempDs, '°C'));
  if (humCtx)   sensorCharts.humidity = new Chart(humCtx, makeSensorChartConfig(humDs, '%'));
}

// ── Render: Status-Banner ────────────────────────────────────────────────────

// Banner-Expand-State: welche Problem-Gruppen sind aufgeklappt
const bannerExpanded = new Set();

function renderStatusBanner() {
  const container = document.getElementById('status-banner');
  if (!globalStatus) {
    container.innerHTML = '';
    return;
  }

  const groups = [
    { key: 'offline',  icon: '⚠',  label: 'Offline', items: globalStatus.offlineRooms || [],
      renderItem: i => `${esc(i.apartmentName)} · ${esc(i.roomName)}${i.integration ? ` <span class="text-muted">(${esc(i.integration)})</span>` : ''}` },
    { key: 'windows',  icon: '🪟', label: 'Fenster offen', items: globalStatus.openWindows || [],
      renderItem: i => `${esc(i.apartmentName)} · ${esc(i.roomName)}` },
    { key: 'battery',  icon: '🔋', label: 'Batterie schwach', items: globalStatus.lowBatteries || [],
      renderItem: i => `${esc(i.apartmentName)} · ${esc(i.deviceName)} <span class="text-muted">(${esc(i.integration)} · ${esc(i.value)})</span>` }
  ].filter(g => g.items.length > 0);

  if (bannerDismissed || groups.length === 0) {
    container.innerHTML = '';
    return;
  }

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  container.innerHTML = `
    <div class="status-banner">
      <div class="status-banner__head">
        <strong>${total} Problem${total === 1 ? '' : 'e'} gefunden</strong>
        <button class="btn btn--ghost btn--sm" id="banner-dismiss">Ausblenden</button>
      </div>
      <ul class="status-banner__list">
        ${groups.map(g => {
          const expanded = bannerExpanded.has(g.key);
          return `
            <li class="status-banner__group">
              <div class="status-banner__group-head js-banner-toggle" data-key="${esc(g.key)}">
                <span>${g.icon} <strong>${g.items.length}</strong> ${esc(g.label)}</span>
                <span class="text-muted">${expanded ? '▾' : '▸'}</span>
              </div>
              ${expanded ? `
                <ul class="status-banner__items">
                  ${g.items.map(i => `<li>${g.renderItem(i)}</li>`).join('')}
                </ul>
              ` : ''}
            </li>`;
        }).join('')}
      </ul>
    </div>
  `;

  container.querySelector('#banner-dismiss').addEventListener('click', () => {
    bannerDismissed = true;
    renderStatusBanner();
  });
  container.querySelectorAll('.js-banner-toggle').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.key;
      if (bannerExpanded.has(key)) bannerExpanded.delete(key);
      else bannerExpanded.add(key);
      renderStatusBanner();
    });
  });
}

// ── Render: Filter-Bar ───────────────────────────────────────────────────────

function renderFilterBar() {
  const container = document.getElementById('filter-bar');
  const chips = [
    { id: 'alle',     label: 'Alle' },
    { id: 'warnings', label: 'Mit Warnungen' },
    { id: 'guest',    label: 'Gast da' }
  ];

  container.innerHTML = `
    <div class="filter-bar">
      <div class="filter-bar__search">
        <input id="search-input" type="search" placeholder="Wohnung suchen …"
               value="${esc(searchTerm)}" autocomplete="off" />
      </div>
      <div class="filter-bar__chips">
        ${chips.map(c => `
          <button class="chip ${c.id === activeChip ? 'chip--active' : ''}"
                  data-chip="${esc(c.id)}">${esc(c.label)}</button>
        `).join('')}
      </div>
    </div>
  `;

  const input = container.querySelector('#search-input');
  input.addEventListener('input', () => {
    searchTerm = input.value;
    renderGrid();
  });

  container.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      activeChip = btn.dataset.chip;
      renderFilterBar();
      renderGrid();
      // Focus zurueck auf Suche fuer schnellen Workflow
      document.getElementById('search-input')?.focus();
    });
  });
}

// ── Render: Apartment-Card ───────────────────────────────────────────────────

function formatDateDE(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.`;
}

function renderStatusBadge(apt) {
  const occ = occupancyMap.get(apt.id);
  const icalOn = apt.occupancy && ((apt.occupancy.enabled && apt.occupancy.icalUrl) || (apt.occupancy.source === 'smoobu' && apt.occupancy.smoobuApartmentId));
  if (!icalOn) {
    return `<span class="badge badge--offline">—</span>`;
  }
  if (!occ || occ === 'loading') {
    return `<span class="badge badge--offline">…</span>`;
  }
  if (occ.error && !occ.stale) {
    return `<span class="badge badge--warning">?</span>`;
  }
  if (occ.occupied) {
    return `<span class="badge badge--occupied">Gast da</span>`;
  }
  return `<span class="badge badge--free">Frei</span>`;
}

function renderBelegungSlot(apt) {
  const icalOn = apt.occupancy && ((apt.occupancy.enabled && apt.occupancy.icalUrl) || (apt.occupancy.source === 'smoobu' && apt.occupancy.smoobuApartmentId));
  if (!icalOn) return ''; // Variante F: keine Zeile wenn Belegung deaktiviert

  const occ = occupancyMap.get(apt.id);

  // Variante E: laedt noch
  if (!occ || occ === 'loading') {
    return `
      <div class="apartment-card__section" data-slot="belegung">
        <div class="slot-label">Belegung</div>
        <div class="slot-body text-muted">Belegung laedt…</div>
      </div>`;
  }

  // Variante D: Fehler ohne Cache
  if (occ.error && !occ.stale) {
    return `
      <div class="apartment-card__section" data-slot="belegung">
        <div class="slot-label">Belegung</div>
        <div class="slot-body text-warning">⚠ iCal nicht erreichbar</div>
      </div>`;
  }

  // Variante D: Fehler mit Stale-Cache
  const staleMark = occ.stale ? '<span class="text-warning" style="font-size:11px"> (letzter Stand)</span>' : '';

  // Variante A: belegt
  if (occ.occupied && occ.currentBooking) {
    const bk = occ.currentBooking;
    return `
      <div class="apartment-card__section" data-slot="belegung">
        <div class="slot-label">Belegung</div>
        <div class="slot-body">
          <strong>${esc(stripAptNameFromTitle(bk.title, apt.name))}</strong>
          <span class="text-muted"> · bis ${esc(formatDateDE(bk.checkOut))}</span>
          ${staleMark}
        </div>
      </div>`;
  }

  // Variante B: frei + nextBooking
  if (occ.nextBooking) {
    const bk = occ.nextBooking;
    return `
      <div class="apartment-card__section" data-slot="belegung">
        <div class="slot-label">Belegung</div>
        <div class="slot-body">
          <span class="text-muted">Naechste:</span> ${esc(stripAptNameFromTitle(bk.title, apt.name))}
          <span class="text-muted"> · ab ${esc(formatDateDE(bk.checkIn))}</span>
          ${staleMark}
        </div>
      </div>`;
  }

  // Variante C: frei, keine Buchung
  return `
    <div class="apartment-card__section" data-slot="belegung">
      <div class="slot-label">Belegung</div>
      <div class="slot-body text-muted">Keine Buchung${staleMark}</div>
    </div>`;
}

function formatStand(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function renderTadoRateLimitSlot(apt) {
  const tadoOn = apt.integrations && apt.integrations.tado && apt.integrations.tado.enabled;
  if (!tadoOn) return '';

  const data = tadoMap.get(apt.id);
  if (!data || data === 'loading') {
    return `
      <div class="apartment-card__section" data-slot="tado-ratelimit">
        <div class="slot-label">Tado Requests</div>
        <div class="slot-body text-muted">laedt…</div>
      </div>`;
  }
  if (data.error && !data.stale) {
    return `
      <div class="apartment-card__section" data-slot="tado-ratelimit">
        <div class="slot-label">Tado Requests</div>
        <div class="slot-body text-warning">⚠ Tado nicht erreichbar</div>
      </div>`;
  }
  const rl = data.rateLimit || {};

  // Wenn Tado echte Header geliefert hat: uebrig-Wert + Stand – alles in einer Zeile
  if (rl.source === 'header' && rl.remaining !== null && rl.remaining !== undefined) {
    const remaining = rl.remaining;
    const limit = rl.limit;
    const pct = limit ? Math.round(((limit - remaining) / limit) * 100) : 0;
    const cls = pct > 85 ? 'text-danger' : pct > 60 ? 'text-warning' : '';
    const stand = formatStand(rl.fetchedAt);
    return `
      <div class="apartment-card__section apartment-card__section--inline" data-slot="tado-ratelimit">
        <span class="slot-label-inline">Tado Requests</span>
        <span class="slot-body-inline">
          <strong class="${cls}">${esc(remaining)}</strong>${limit ? ` <span class="text-muted">/ ${esc(limit)}</span>` : ''}
          ${stand ? `<span class="text-muted" style="font-size:10px;margin-left:6px">${esc(stand)}</span>` : ''}
        </span>
      </div>`;
  }

  // Fallback: nur der lokale Zaehler, falls Tado keine Header schickt
  const used = rl.used ?? 0;
  return `
    <div class="apartment-card__section apartment-card__section--inline" data-slot="tado-ratelimit">
      <span class="slot-label-inline">Tado Requests</span>
      <span class="slot-body-inline">
        <strong>${esc(used)}</strong>
        <span class="text-muted" style="font-size:10px"> heute</span>
      </span>
    </div>`;
}

function renderTadoRoomsSlot(apt) {
  const tadoOn = apt.integrations && apt.integrations.tado && apt.integrations.tado.enabled;
  if (!tadoOn) return '';

  const data = tadoMap.get(apt.id);
  if (!data || data === 'loading') {
    return `
      <div class="apartment-card__section" data-slot="tado-rooms">
        <div class="slot-label">Tado-Raeume</div>
        <div class="slot-body text-muted">Raumdaten laden…</div>
      </div>`;
  }
  if (data.error && !data.stale) {
    return `
      <div class="apartment-card__section" data-slot="tado-rooms">
        <div class="slot-label">Tado-Raeume</div>
        <div class="slot-body text-warning">⚠ Keine Daten: ${esc(data.error)}</div>
      </div>`;
  }

  const rooms = Array.isArray(data.rooms) ? data.rooms : [];
  const avg = data.averageTemperature !== null && data.averageTemperature !== undefined
    ? `${esc(data.averageTemperature)} °C`
    : '—';
  const presenceBadge = data.presence === 'AWAY'
    ? `<span class="badge badge--offline">AWAY</span>`
    : `<span class="badge badge--free">HOME</span>`;

  const staleMark = data.stale ? '<span class="text-warning" style="font-size:11px"> (letzter Stand)</span>' : '';

  function modeBadge(mode) {
    if (mode === 'off')      return '<span class="room-mode room-mode--off" title="Manuell aus">Aus</span>';
    if (mode === 'manual')   return '<span class="room-mode room-mode--manual" title="Manuelle Einstellung">Manuell</span>';
    return '<span class="room-mode room-mode--schedule" title="Auf Zeitplan">Plan</span>';
  }

  const roomRows = rooms.length === 0
    ? `<div class="slot-body text-muted">Keine Raeume</div>`
    : rooms.map(r => `
        <div class="room-row ${r.offline ? 'room-row--offline' : ''}">
          <span class="room-row__name">${esc(r.name)}</span>
          <span class="room-row__status">${modeBadge(r.mode || 'schedule')}</span>
          <span class="room-row__temps">
            ${r.currentTemp !== null ? esc(r.currentTemp) + '°' : '—'}
            <span class="text-muted">/ ${r.targetTemp !== null ? esc(r.targetTemp) + '°' : '—'}</span>
            ${r.humidity !== null ? `<span class="text-muted"> · ${esc(r.humidity)}%</span>` : ''}
          </span>
          <span class="room-row__icons">
            ${r.heating ? '<span title="Heizt">🔥</span>' : ''}
            ${r.windowOpen ? '<span title="Fenster offen" class="text-warning">🪟</span>' : ''}
            ${r.offline ? '<span title="Offline" class="text-muted">⚠</span>' : ''}
            ${r.batteryLow ? '<span title="Batterie schwach" class="text-warning">🔋</span>' : ''}
          </span>
          <span class="room-row__actions">
            <button class="btn btn--danger btn--xs js-tado-room-off" data-apt="${esc(apt.id)}" data-room="${esc(r.id)}" title="Raum ausschalten">Aus</button>
            <button class="btn btn--ghost btn--xs js-tado-room-resume" data-apt="${esc(apt.id)}" data-room="${esc(r.id)}" title="Plan fortsetzen">Plan</button>
          </span>
        </div>`).join('');

  return `
    <div class="apartment-card__section" data-slot="tado-rooms">
      <div class="slot-label">Tado · Ø ${avg} ${presenceBadge}${staleMark}</div>
      <div class="slot-body">
        <div class="room-list">${roomRows}</div>
      </div>
    </div>`;
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const diffSec = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 60)       return rtf.format(diffSec, 'second');
  if (abs < 3600)     return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400)    return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86400*7)  return rtf.format(Math.round(diffSec / 86400), 'day');
  return new Date(iso).toLocaleDateString('de-DE');
}

function renderMinutSlot(apt) {
  const minutOn = apt.integrations && apt.integrations.minut && apt.integrations.minut.enabled && apt.integrations.minut.deviceId;
  if (!minutOn) return '';

  const data = minutMap.get(apt.id);
  if (!data || data === 'loading') {
    return `
      <div class="apartment-card__section" data-slot="minut">
        <div class="slot-label">Minut Sensor</div>
        <div class="slot-body text-muted">laedt…</div>
      </div>`;
  }
  if (data.error && !data.stale) {
    return `
      <div class="apartment-card__section" data-slot="minut">
        <div class="slot-label">Minut Sensor</div>
        <div class="slot-body text-warning">⚠ ${esc(data.error)}</div>
      </div>`;
  }

  const battPct = data.batteryPercent;
  const battCls = data.batteryLow ? 'text-warning' : '';
  const battText = battPct !== null && battPct !== undefined ? `${battPct}%` : 'unbekannt';
  const battIcon = data.batteryLow ? '🔋' : '';

  const lastHeard = data.lastHeardFromAt ? formatRelativeTime(data.lastHeardFromAt) : '—';
  const offlineBadge = data.offline ? '<span class="badge badge--offline">Offline</span>' : '';
  const staleMark = data.stale ? '<span class="text-warning" style="font-size:11px"> (letzter Stand)</span>' : '';

  return `
    <div class="apartment-card__section" data-slot="minut">
      <div class="slot-label">Minut Sensor ${offlineBadge}${staleMark}</div>
      <div class="slot-body">
        <div class="minut-row">
          <span><strong>${esc(data.deviceName || 'Sensor')}</strong></span>
          <span class="${battCls}">${battIcon} ${esc(battText)}</span>
        </div>
        <div class="text-muted" style="font-size:11px">Zuletzt gesehen: ${esc(lastHeard)}</div>
      </div>
    </div>`;
}

function renderNukiSlot(apt) {
  const nukiOn = apt.integrations && apt.integrations.nuki && apt.integrations.nuki.enabled
    && Array.isArray(apt.integrations.nuki.deviceIds) && apt.integrations.nuki.deviceIds.length > 0;
  if (!nukiOn) return '';

  const data = nukiMap.get(apt.id);
  if (!data || data === 'loading') {
    return `
      <div class="apartment-card__section" data-slot="nuki">
        <div class="slot-label">Nuki</div>
        <div class="slot-body text-muted">laedt…</div>
      </div>`;
  }
  if (data.error && !data.stale) {
    return `
      <div class="apartment-card__section" data-slot="nuki">
        <div class="slot-label">Nuki</div>
        <div class="slot-body text-warning">⚠ ${esc(data.error)}</div>
      </div>`;
  }

  const devices = (Array.isArray(data.devices) ? data.devices.slice() : [])
    .sort((a, b) => {
      const rank = d => d.type === 'Opener' ? 0 : 1;
      return rank(a) - rank(b);
    });
  if (devices.length === 0) {
    return `
      <div class="apartment-card__section" data-slot="nuki">
        <div class="slot-label">Nuki</div>
        <div class="slot-body text-muted">Keine zugeordneten Geraete gefunden</div>
      </div>`;
  }

  const staleMark = data.stale ? '<span class="text-warning" style="font-size:11px"> (letzter Stand)</span>' : '';

  function deviceRow(d) {
    const icon = d.type === 'Opener' ? '🚪' : '🔒';
    const onlineBadge = d.online
      ? '<span class="badge badge--free">online</span>'
      : '<span class="badge badge--offline">offline</span>';

    // Battery-Anzeige: Lock → Prozent mit Warnfarbe, Opener → Text
    let battery = '';
    if (d.type === 'Opener') {
      battery = d.batteryCritical
        ? '<span class="text-warning">Bat kritisch</span>'
        : '<span class="text-muted">Bat OK</span>';
    } else if (d.batteryPercent !== null && d.batteryPercent !== undefined) {
      const cls = d.batteryPercent < 50 ? 'text-warning' : '';
      battery = `<span class="${cls}">${esc(d.batteryPercent)}%</span>`;
    } else {
      battery = '<span class="text-muted">—</span>';
    }

    return `
      <div class="nuki-row">
        <span class="nuki-row__name">${icon} ${esc(d.name)}</span>
        <span class="nuki-row__state text-muted">${esc(d.stateLabel)}</span>
        <span class="nuki-row__online">${onlineBadge}</span>
        <span class="nuki-row__battery">${battery}</span>
      </div>`;
  }

  return `
    <div class="apartment-card__section" data-slot="nuki">
      <div class="slot-label">Nuki${staleMark}</div>
      <div class="slot-body">
        <div class="nuki-list">${devices.map(deviceRow).join('')}</div>
      </div>
    </div>`;
}

function renderTadoActionsSlot(apt) {
  const tadoOn = apt.integrations && apt.integrations.tado && apt.integrations.tado.enabled;
  if (!tadoOn) {
    return `<div class="apartment-card__actions" data-slot="actions">
      <button class="btn btn--ghost btn--sm" disabled>Aktionen (Tado inaktiv)</button>
    </div>`;
  }
  const data = tadoMap.get(apt.id);
  const loading = !data || data === 'loading';
  const err = data && data !== 'loading' && data.error && !data.stale;
  const disabled = loading || err ? 'disabled' : '';
  const presence = data && data !== 'loading' && data.presence;

  return `
    <div class="apartment-card__actions" data-slot="actions">
      <button class="btn btn--danger btn--sm js-tado-all-off" data-apt="${esc(apt.id)}" ${disabled}>Alles aus</button>
      <button class="btn btn--ghost btn--sm js-tado-resume-all" data-apt="${esc(apt.id)}" ${disabled}>Plan fortsetzen</button>
      <button class="btn ${presence === 'HOME' ? 'btn--primary' : 'btn--ghost'} btn--sm js-tado-home" data-apt="${esc(apt.id)}" ${disabled}>HOME</button>
      <button class="btn ${presence === 'AWAY' ? 'btn--primary' : 'btn--ghost'} btn--sm js-tado-away" data-apt="${esc(apt.id)}" ${disabled}>AWAY</button>
    </div>`;
}

function renderApartmentCard(apt) {
  return `
    <div class="apartment-card" data-id="${esc(apt.id)}">

      <div class="apartment-card__head js-card-head" data-nav="${esc(apt.id)}" role="button" title="Detailseite oeffnen">
        <div class="apartment-card__title">
          <strong>${esc(apt.name)}</strong>
          ${apt.location ? `<span class="loc">${esc(apt.location)}</span>` : ''}
        </div>
        ${renderStatusBadge(apt)}
      </div>

      ${renderBelegungSlot(apt)}

      ${renderTadoRateLimitSlot(apt)}

      ${renderTadoActionsSlot(apt)}

      ${renderMinutSlot(apt)}

      ${renderNukiSlot(apt)}

      ${renderTadoRoomsSlot(apt)}

    </div>
  `;
}

// ── Render: Grid + Empty States ──────────────────────────────────────────────

function renderGrid() {
  const container = document.getElementById('apartments-grid');
  const all = visibleApartments();
  const list = filteredApartments();

  // Fall 1: Gar keine Wohnungen konfiguriert
  if (apartments.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Noch keine Wohnungen konfiguriert</h2>
        <p>Leg zuerst eine Wohnung in Setup an, um das Dashboard zu nutzen.</p>
        <a href="/setup" class="btn btn--primary">Zu Setup</a>
      </div>
    `;
    return;
  }

  // Fall 2: Alle vorhandenen Wohnungen sind unsichtbar
  if (all.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Alle Wohnungen sind ausgeblendet</h2>
        <p>Aktiviere „Sichtbar" fuer mindestens eine Wohnung in Setup.</p>
        <a href="/setup" class="btn btn--ghost">Zu Setup</a>
      </div>
    `;
    return;
  }

  // Fall 3: Suche/Filter ohne Treffer
  if (list.length === 0) {
    const reason = searchTerm
      ? `Kein Treffer fuer „${esc(searchTerm)}".`
      : (activeChip === 'guest'
          ? 'Keine Wohnung hat aktuell einen Gast.'
          : 'Keine Wohnung mit aktiven Warnungen.');
    container.innerHTML = `
      <div class="empty-state">
        <h2>Keine Wohnungen gefunden</h2>
        <p>${reason}</p>
      </div>
    `;
    return;
  }

  // Normalfall: Karten-Grid
  container.innerHTML = `
    <div class="apartments-grid">
      ${list.map(renderApartmentCard).join('')}
    </div>
  `;
  bindTadoActionHandlers(container);
  bindCardNavigation(container);
}

function bindCardNavigation(root) {
  root.querySelectorAll('.js-card-head').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.nav;
      if (id) window.location.href = '/apartment/' + encodeURIComponent(id);
    });
  });
}

// ── Tado-Aktionen (PROJ-6) ──────────────────────────────────────────────────

async function runTadoAction(button, url, { confirm: needConfirm = false, confirmText = 'Aktion wirklich ausfuehren?' } = {}) {
  if (button.disabled) return;
  if (needConfirm && !confirm(confirmText)) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '…';
  try {
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      alert('Aktion fehlgeschlagen: ' + (data.error || ('HTTP ' + res.status)));
      return;
    }
    if (data.warning) {
      console.warn('[Tado] ' + data.warning);
    }
    // Erfolg → Karte neu laden (Server-Cache ist bereits invalidiert)
    const apt = button.dataset.apt;
    if (apt) {
      await loadTado(apt);
      renderGrid();
    }
  } catch (err) {
    alert('Netzwerkfehler: ' + err.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function bindTadoActionHandlers(root) {
  // Event-Delegation fuer alle Tado-Action-Buttons
  root.querySelectorAll('.js-tado-room-off').forEach(btn => {
    btn.addEventListener('click', () => runTadoAction(btn,
      `/api/tado/${encodeURIComponent(btn.dataset.apt)}/rooms/${encodeURIComponent(btn.dataset.room)}/off`));
  });
  root.querySelectorAll('.js-tado-room-resume').forEach(btn => {
    btn.addEventListener('click', () => runTadoAction(btn,
      `/api/tado/${encodeURIComponent(btn.dataset.apt)}/rooms/${encodeURIComponent(btn.dataset.room)}/resume`));
  });
  root.querySelectorAll('.js-tado-all-off').forEach(btn => {
    btn.addEventListener('click', () => runTadoAction(btn,
      `/api/tado/${encodeURIComponent(btn.dataset.apt)}/all-off`));
  });
  root.querySelectorAll('.js-tado-resume-all').forEach(btn => {
    btn.addEventListener('click', () => runTadoAction(btn,
      `/api/tado/${encodeURIComponent(btn.dataset.apt)}/resume-all`));
  });
  root.querySelectorAll('.js-tado-home').forEach(btn => {
    btn.addEventListener('click', () => runTadoAction(btn,
      `/api/tado/${encodeURIComponent(btn.dataset.apt)}/home`));
  });
  root.querySelectorAll('.js-tado-away').forEach(btn => {
    btn.addEventListener('click', () => runTadoAction(btn,
      `/api/tado/${encodeURIComponent(btn.dataset.apt)}/away`));
  });
}

// ── Init + Auto-Refresh ─────────────────────────────────────────────────────

// Auto-Refresh-Intervall in Millisekunden. Wird beim Init aus
// /api/integrations geladen (dashboard.refreshIntervalMinutes), Default 15.
let refreshIntervalMs = 15 * 60 * 1000;
let nextRefreshAt = null;  // Date | null
let isRefreshing = false;

async function loadDashboardSettings() {
  try {
    const res = await fetch('/api/integrations');
    if (!res.ok) return;
    const data = await res.json();
    const mins = data && data.dashboard && Number(data.dashboard.refreshIntervalMinutes);
    if (isFinite(mins) && mins >= 1) {
      refreshIntervalMs = mins * 60 * 1000;
    }
  } catch (err) {
    console.warn('[Dashboard] Settings laden fehlgeschlagen:', err.message);
  }
}

/**
 * Laedt alle Integrationen neu und aktualisiert GUI + lastLoaded. Wird
 * initial und vom Auto-Refresh aufgerufen. Bei Tab-Wechsel (hidden→visible)
 * auch.
 */
async function refreshAll({ silent = false } = {}) {
  if (isRefreshing) return;
  if (document.visibilityState === 'hidden') return;
  isRefreshing = true;
  try {
    document.body.classList.add('is-refreshing');
    await loadApartments();
    await Promise.all([
      loadAllOccupancies(),
      loadAllTado(),
      loadAllMinut(),
      loadAllNuki(),
      loadAllMinutHistories()
    ]);
    await loadGlobalStatus();
    renderStatusBanner();
    renderKpiRow();
    renderSensorRow();
    renderGrid();
    if (!silent) {
      console.log('[Dashboard] Daten erneuert um', new Date().toLocaleTimeString('de-DE'));
    }
  } finally {
    isRefreshing = false;
    document.body.classList.remove('is-refreshing');
    scheduleNextRefresh();
  }
}

function scheduleNextRefresh() {
  nextRefreshAt = new Date(Date.now() + refreshIntervalMs);
  renderKpiRow();
}

// Sekundenpuls fuer die "naechster: HH:MM"-Anzeige — so bleibt der Text
// immer aktuell ohne jedes Mal alle Daten neu zu zeichnen.
setInterval(() => {
  const el = document.getElementById('kpi-next-refresh');
  if (!el || !nextRefreshAt) return;
  const now = Date.now();
  const diffMs = nextRefreshAt.getTime() - now;
  if (diffMs <= 0) {
    el.textContent = 'jetzt…';
  } else {
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    el.textContent = mins > 0 ? `in ${mins} min` : `in ${secs}s`;
  }
}, 1000);

async function init() {
  try {
    await loadDashboardSettings();
    // Erst-Render mit minimalem Gerüst, damit der User nicht auf leere Seite schaut
    await loadApartments();
    renderStatusBanner();
    renderKpiRow();
    renderSensorRow();
    renderFilterBar();
    renderGrid();

    // Initial alle Integrationen laden — der Rest laeuft genauso wie ein
    // regulaerer Refresh-Zyklus.
    Promise.all([
      loadAllOccupancies(),
      loadAllTado(),
      loadAllMinut(),
      loadAllNuki(),
      loadAllMinutHistories()
    ]).then(async () => {
      await loadGlobalStatus();
      renderStatusBanner();
      renderKpiRow();
      renderSensorRow();
      renderGrid();
      scheduleNextRefresh();
    });

    // Auto-Refresh: alle N Minuten, Intervall wie aus dem Backend geladen.
    // Bei Hidden-Tab wird refreshAll() sowieso fruehzeitig beendet.
    setInterval(() => { refreshAll(); }, refreshIntervalMs);

    // Bei Tab-Wiedersichtbarkeit nach laengerer Pause sofort refreshen
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && nextRefreshAt && nextRefreshAt.getTime() < Date.now()) {
        refreshAll();
      }
    });
  } catch (err) {
    document.getElementById('apartments-grid').innerHTML = `
      <div class="empty-state">
        <h2 class="text-danger">Fehler beim Laden</h2>
        <p>${esc(err.message)}</p>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', init);
