/**
 * Detailseite – FaecherLofts Manager
 * PROJ-8: Minut History-Charts (Temperatur, Feuchte, Laerm, Bewegung)
 */

// ── Utilities ────────────────────────────────────────────────────────────────

function esc(val) {
  const d = document.createElement('div');
  d.textContent = String(val ?? '');
  return d.innerHTML;
}

function getApartmentIdFromUrl() {
  // /apartment/bf1 → "bf1"
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[1] || null;
}

// ── State ─────────────────────────────────────────────────────────────────────

let apartment = null;
let currentRange = '24h';
let charts = {}; // key → Chart-Instanz (fuer Destroy bei Re-Render)
let noiseProfile = null;

// ── API ──────────────────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function loadApartment(id) {
  const list = await apiGet('/api/apartments');
  const apt = list.find(a => a.id === id);
  if (!apt) throw new Error('Wohnung ' + id + ' nicht gefunden');
  return apt;
}

async function loadHistory(id, range) {
  return apiGet(`/api/minut/${encodeURIComponent(id)}/history?range=${encodeURIComponent(range)}`);
}

async function loadNoiseProfile(id) {
  try {
    return await apiGet(`/api/minut/${encodeURIComponent(id)}/noise-profile`);
  } catch (err) {
    console.warn('Noise-Profile nicht ladbar:', err.message);
    return { noiseLimit: null, quietHours: [] };
  }
}

async function loadDeviceStatus(id) {
  try {
    return await apiGet(`/api/minut/${encodeURIComponent(id)}`);
  } catch (err) {
    return { error: err.message };
  }
}

// ── Layout ────────────────────────────────────────────────────────────────────

function renderLayout() {
  const root = document.getElementById('detail-root');
  if (!apartment) {
    root.innerHTML = `
      <div class="empty-state">
        <h2 class="text-danger">Wohnung nicht gefunden</h2>
        <p><a href="/" class="btn btn--ghost">Zurueck zum Dashboard</a></p>
      </div>`;
    return;
  }

  const minutOn = apartment.integrations && apartment.integrations.minut && apartment.integrations.minut.enabled;
  if (!minutOn) {
    root.innerHTML = `
      <div class="empty-state">
        <h2>Kein Minut-Sensor konfiguriert</h2>
        <p>Diese Wohnung hat keine aktive Minut-Integration.</p>
        <p><a href="/" class="btn btn--ghost">Zurueck zum Dashboard</a>
        <a href="/setup" class="btn btn--primary">Zu Setup</a></p>
      </div>`;
    return;
  }

  root.innerHTML = `
    <div class="detail-header">
      <div>
        <a href="/" class="detail-back">← Dashboard</a>
        <h1>${esc(apartment.name)}
          ${apartment.location ? `<span class="detail-loc">${esc(apartment.location)}</span>` : ''}
        </h1>
        <div id="detail-sensor-info" class="text-muted" style="font-size:12px">Sensor-Info laedt…</div>
      </div>
      <div class="detail-range">
        <button class="chip js-range" data-range="24h">24 h</button>
        <button class="chip js-range" data-range="7d">7 Tage</button>
        <button class="chip js-range" data-range="30d">30 Tage</button>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-card__title">Temperatur (°C)</div>
        <div class="chart-card__body"><canvas id="chart-temperature"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card__title">Luftfeuchte (%)</div>
        <div class="chart-card__body"><canvas id="chart-humidity"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card__title">Laerm (dB)</div>
        <div class="chart-card__body"><canvas id="chart-noise"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card__title">Bewegung</div>
        <div class="chart-card__body"><canvas id="chart-motion"></canvas></div>
      </div>
    </div>

    <div id="detail-error" class="empty-state" style="display:none"></div>
  `;

  // Range-Chips binden
  document.querySelectorAll('.js-range').forEach(btn => {
    if (btn.dataset.range === currentRange) btn.classList.add('chip--active');
    btn.addEventListener('click', async () => {
      currentRange = btn.dataset.range;
      document.querySelectorAll('.js-range').forEach(b => b.classList.toggle('chip--active', b.dataset.range === currentRange));
      await refreshCharts();
    });
  });
}

function renderSensorInfo(status) {
  const el = document.getElementById('detail-sensor-info');
  if (!el) return;
  if (!status || status.error) {
    el.innerHTML = `<span class="text-warning">Sensor-Info nicht verfuegbar</span>`;
    return;
  }
  const battTxt = status.batteryPercent !== null && status.batteryPercent !== undefined ? `${status.batteryPercent}%` : 'unbekannt';
  const battCls = status.batteryLow ? 'text-warning' : '';
  el.innerHTML = `
    <strong>${esc(status.deviceName || 'Sensor')}</strong>
    · Batterie <span class="${battCls}">${esc(battTxt)}</span>
    ${status.offline ? '· <span class="text-warning">Offline</span>' : ''}
  `;
}

// ── Charts ───────────────────────────────────────────────────────────────────

function destroyCharts() {
  for (const key of Object.keys(charts)) {
    charts[key].destroy();
    delete charts[key];
  }
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function makeLineConfig(series, color, unit) {
  const grid = cssVar('--color-chart-grid', '#2e3347');
  const tick = cssVar('--color-chart-tick', '#7c84a0');
  return {
    type: 'line',
    data: {
      datasets: [{
        data: series.map(p => ({ x: new Date(p.timestamp), y: p.value })),
        borderColor: color,
        backgroundColor: color + '22',
        borderWidth: 2,
        fill: true,
        pointRadius: 0,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              return v !== null && v !== undefined ? `${v.toFixed(1)} ${unit}` : '—';
            }
          }
        }
      },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'dd.MM. HH:mm', displayFormats: { hour: 'HH:mm', day: 'dd.MM.', minute: 'HH:mm' } }, max: new Date(), grid: { color: grid }, ticks: { color: tick } },
        y: { grid: { color: grid }, ticks: { color: tick } }
      }
    }
  };
}

function renderTempChart(series) {
  const ctx = document.getElementById('chart-temperature');
  if (!ctx) return;
  charts.temperature = new Chart(ctx, makeLineConfig(series, '#4f72ff', '°C'));
}

function renderHumidityChart(series) {
  const ctx = document.getElementById('chart-humidity');
  if (!ctx) return;
  charts.humidity = new Chart(ctx, makeLineConfig(series, '#34c97b', '%'));
}

function isInQuietHours(date, quietHoursList) {
  if (!Array.isArray(quietHoursList) || quietHoursList.length === 0) return false;
  const h = date.getHours() + date.getMinutes() / 60;
  return quietHoursList.some(qh => {
    const start = qh.startHour;
    const end = qh.endHour;
    if (start < end) return h >= start && h < end;        // z.B. 13–17
    return h >= start || h < end;                          // z.B. 22–8 (over midnight)
  });
}

function renderNoiseChart(series) {
  const ctx = document.getElementById('chart-noise');
  if (!ctx) return;
  const config = makeLineConfig(series, '#f5a623', 'dB');

  // Pro Messpunkt das zur Uhrzeit passende Limit berechnen.
  // Minut nutzt einen niedrigeren Schwellwert waehrend Quiet Hours.
  if (noiseProfile && (noiseProfile.noiseLimit || noiseProfile.quietHoursLimit)) {
    const normalLimit = noiseProfile.noiseLimit ?? noiseProfile.quietHoursLimit;
    const quietLimit = noiseProfile.quietHoursLimit ?? noiseProfile.noiseLimit;
    const quietHoursList = noiseProfile.quietHours || [];

    const limitPoints = series.map(p => {
      const d = new Date(p.timestamp);
      const limit = isInQuietHours(d, quietHoursList) ? quietLimit : normalLimit;
      return { x: d, y: limit };
    });

    config.data.datasets.push({
      data: limitPoints,
      borderColor: '#e05252',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [6, 4],
      fill: false,
      pointRadius: 0,
      stepped: true,
      tension: 0,
      label: 'Limit'
    });
  }

  charts.noise = new Chart(ctx, config);
}

function renderMotionChart(series) {
  const ctx = document.getElementById('chart-motion');
  if (!ctx) return;
  // Nur Buckets mit echtem Wert > 0 als Balken darstellen.
  // Minut liefert pro Bucket einen count; 0 bedeutet keine Bewegung.
  const points = (series || [])
    .filter(p => typeof p.value === 'number' && p.value > 0)
    .map(p => ({ x: new Date(p.timestamp), y: p.value }));

  const config = {
    type: 'bar',
    data: {
      datasets: [{
        data: points,
        backgroundColor: '#4f72ff',
        borderColor: '#4f72ff',
        barThickness: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => 'Bewegung' } }
      },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'dd.MM. HH:mm', displayFormats: { hour: 'HH:mm', day: 'dd.MM.', minute: 'HH:mm' } }, max: new Date(), grid: { color: cssVar('--color-chart-grid', '#2e3347') }, ticks: { color: cssVar('--color-chart-tick', '#7c84a0') } },
        y: { display: false, beginAtZero: true }
      }
    }
  };
  charts.motion = new Chart(ctx, config);
}

// ── Load + Render ────────────────────────────────────────────────────────────

async function refreshCharts() {
  const errEl = document.getElementById('detail-error');
  errEl.style.display = 'none';
  try {
    const history = await loadHistory(apartment.id, currentRange);
    destroyCharts();
    renderTempChart(history.temperature || []);
    renderHumidityChart(history.humidity || []);
    renderNoiseChart(history.noise || []);
    renderMotionChart(history.motion || []);
  } catch (err) {
    errEl.style.display = '';
    errEl.innerHTML = `<h2 class="text-danger">Daten nicht ladbar</h2><p>${esc(err.message)}</p>`;
  }
}

// Theme-Wechsel → Charts mit neuen Farben rebuilden (aus Cache, kein Reload)
document.addEventListener('themechange', () => {
  if (apartment) refreshCharts();
});

async function init() {
  const id = getApartmentIdFromUrl();
  if (!id) {
    document.getElementById('detail-root').innerHTML = `
      <div class="empty-state">
        <h2 class="text-danger">Keine Wohnungs-ID in URL</h2>
        <p><a href="/" class="btn btn--ghost">Zurueck zum Dashboard</a></p>
      </div>`;
    return;
  }

  try {
    apartment = await loadApartment(id);
    renderLayout();

    // Noise-Profile + Sensor-Status parallel laden, danach Charts
    const [profile, sensor] = await Promise.all([
      loadNoiseProfile(id),
      loadDeviceStatus(id)
    ]);
    noiseProfile = profile;
    renderSensorInfo(sensor);

    await refreshCharts();
  } catch (err) {
    document.getElementById('detail-root').innerHTML = `
      <div class="empty-state">
        <h2 class="text-danger">Fehler</h2>
        <p>${esc(err.message)}</p>
        <p><a href="/" class="btn btn--ghost">Zurueck zum Dashboard</a></p>
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
