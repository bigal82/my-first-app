/**
 * Setup – FaecherLofts Manager
 * PROJ-2: vollstaendige Implementierung
 */

// ── Utilities ────────────────────────────────────────────────────────────────

/** HTML-escaped einen Wert sicher fuer innerHTML. */
function esc(val) {
  const d = document.createElement('div');
  d.textContent = String(val ?? '');
  return d.innerHTML;
}

/** Zeigt/versteckt ein Element per display-Eigenschaft. */
function setVisible(el, show) {
  if (el) el.style.display = show ? '' : 'none';
}

// ── State ─────────────────────────────────────────────────────────────────────

let apartments = [];
let editingId = null;          // ID der Wohnung, die gerade bearbeitet wird
let minutDevices = null;       // null = noch nicht geladen
let nukiDevices = null;        // null = noch nicht geladen

// ── API-Funktionen ────────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function loadApartments() {
  apartments = await apiGet('/api/apartments');
}

async function loadMinutDevices() {
  if (minutDevices !== null) return minutDevices;
  try {
    minutDevices = await apiGet('/api/minut/devices');
  } catch (err) {
    minutDevices = { error: err.message };
  }
  return minutDevices;
}

async function loadNukiDevices() {
  if (nukiDevices !== null) return nukiDevices;
  try {
    nukiDevices = await apiGet('/api/nuki/devices');
  } catch (err) {
    nukiDevices = { error: err.message };
  }
  return nukiDevices;
}

// ── Render-Hilfsfunktionen ────────────────────────────────────────────────────

function integrationBadges(apt) {
  const active = [];
  if (apt.occupancy?.enabled)           active.push('iCal');
  if (apt.integrations?.tado?.enabled)  active.push('Tado');
  if (apt.integrations?.minut?.enabled) active.push('Minut');
  if (apt.integrations?.nuki?.enabled)  active.push('Nuki');
  if (!active.length) return '<span class="text-muted" style="font-size:11px">Keine Integrationen</span>';
  return active.map(label =>
    `<span class="badge badge--occupied" style="font-size:10px;padding:2px 6px">${esc(label)}</span>`
  ).join('');
}

function renderMinutDropdown(apt, devices) {
  if (!apt.integrations?.minut?.enabled) return '';
  const currentId = apt.integrations.minut.deviceId || '';

  if (devices === null) {
    return `<div class="device-loading">Lade Minut-Geraete…</div>`;
  }
  if (devices.error) {
    return `<div class="device-error">⚠ Minut nicht erreichbar: ${esc(devices.error)}${currentId ? ` (gespeichert: ${esc(currentId)})` : ''}</div>`;
  }

  const options = devices.length
    ? devices.map(d => `<option value="${esc(d.id)}" ${d.id === currentId ? 'selected' : ''}>${esc(d.name || d.id)}</option>`).join('')
    : `<option value="${esc(currentId)}" ${currentId ? 'selected' : ''}>${currentId ? esc(currentId) : '(keine Geraete gefunden)'}</option>`;

  return `
    <div class="field">
      <label>Geraet</label>
      <select id="minut-device-id">${options}</select>
    </div>`;
}

function renderNukiCheckboxes(apt, devices) {
  if (!apt.integrations?.nuki?.enabled) return '';
  // String-Normalisierung: Nuki-IDs sind numerisch, Checkbox-Values werden
  // als String zurueckgelesen. Wir vergleichen immer ueber String.
  const selected = (apt.integrations.nuki.deviceIds || []).map(String);

  if (devices === null) {
    return `<div class="device-loading">Lade Nuki-Geraete…</div>`;
  }
  if (devices.error) {
    return `<div class="device-error">⚠ Nuki nicht erreichbar: ${esc(devices.error)}${selected.length ? ` (${selected.length} gespeichert)` : ''}</div>`;
  }
  if (!devices.length) {
    return `<div class="device-loading text-muted">Keine Nuki-Geraete gefunden${selected.length ? ` (${selected.length} gespeichert)` : ''}.</div>`;
  }

  return `<div class="nuki-device-list">${
    devices.map(d => {
      const idStr = String(d.id);
      const isChecked = selected.includes(idStr);
      return `
      <label class="nuki-device-item">
        <input type="checkbox" class="nuki-cb" value="${esc(idStr)}" ${isChecked ? 'checked' : ''} />
        ${esc(d.name || idStr)}
        <span class="text-muted" style="font-size:11px">(${esc(d.type || 'Geraet')})</span>
      </label>`;
    }).join('')
  }</div>`;
}

function renderEditPanel(apt) {
  const tado = apt.integrations?.tado || {};
  const minut = apt.integrations?.minut || {};
  const nuki = apt.integrations?.nuki || {};
  const occ = apt.occupancy || {};

  const minutHtml = renderMinutDropdown(apt, minutDevices);
  const nukiHtml = renderNukiCheckboxes(apt, nukiDevices);

  return `
  <div class="apt-edit-panel" id="edit-panel-${esc(apt.id)}">

    <!-- Basis -->
    <div class="edit-section">
      <div class="field-row">
        <div class="field">
          <label>Name</label>
          <input id="edit-name" type="text" value="${esc(apt.name)}" placeholder="z.B. Black Forest 1" />
        </div>
        <div class="field">
          <label>Kuerzel / Standort</label>
          <input id="edit-location" type="text" value="${esc(apt.location || '')}" placeholder="z.B. IK12C" />
        </div>
      </div>
    </div>

    <!-- iCal -->
    <div class="edit-section">
      <label class="integration-toggle">
        <input type="checkbox" id="toggle-ical" ${occ.enabled ? 'checked' : ''} />
        Belegungskalender (iCal)
      </label>
      <div class="integration-fields ${occ.enabled ? '' : 'integration-fields--hidden'}" id="fields-ical">
        <div class="field">
          <label>iCal-URL</label>
          <input id="ical-url" type="text" value="${esc(occ.icalUrl || '')}" placeholder="https://…ical" />
        </div>
        <div class="field-row" style="margin-top:8px">
          <div class="field" style="width:100px">
            <label>Check-out Uhr</label>
            <input id="ical-checkout-hour" type="number" min="0" max="23" value="${occ.checkoutHour ?? 10}" />
          </div>
          <div class="field" style="width:100px">
            <label>Check-in Uhr</label>
            <input id="ical-checkin-hour" type="number" min="0" max="23" value="${occ.checkinHour ?? 16}" />
          </div>
          <div class="text-muted" style="font-size:11px;align-self:center;margin-top:16px">Lokalzeit (${esc((apt.occupancy && apt.occupancy.checkoutHour) != null ? 'individuell' : 'Standard 10/16')})</div>
        </div>
        <label class="integration-toggle" style="margin-top:12px">
          <input type="checkbox" id="toggle-automation" ${(apt.automation && apt.automation.enabled) ? 'checked' : ''} />
          Heizung automatisch steuern (Check-in → Plan fortsetzen · Check-out → alles aus)
        </label>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <button type="button" class="btn btn--ghost btn--sm js-test-automation" data-id="${esc(apt.id)}">Testen</button>
          <button type="button" class="btn btn--ghost btn--sm js-force-action" data-id="${esc(apt.id)}" data-action="all-off" style="color:var(--color-danger)">Alles aus JETZT</button>
          <button type="button" class="btn btn--ghost btn--sm js-force-action" data-id="${esc(apt.id)}" data-action="resume-all" style="color:var(--color-success)">Plan fortsetzen JETZT</button>
          <span class="automation-test-result" data-id="${esc(apt.id)}" style="font-size:12px"></span>
        </div>
        <div class="text-muted" style="font-size:11px; margin-top:4px">
          Nur aktiv wenn Tado konfiguriert ist. Blocker ohne Gastname werden ignoriert.
        </div>
      </div>
    </div>

    <!-- Tado -->
    <div class="edit-section">
      <label class="integration-toggle">
        <input type="checkbox" id="toggle-tado" ${tado.enabled ? 'checked' : ''} />
        Tado
      </label>
      <div class="integration-fields ${tado.enabled ? '' : 'integration-fields--hidden'}" id="fields-tado">
        <div class="field-row">
          <div class="field">
            <label>Typ</label>
            <select id="tado-kind">
              <option value="V3" ${(tado.kind || 'V3') === 'V3' ? 'selected' : ''}>Tado V3</option>
              <option value="X"  ${tado.kind === 'X' ? 'selected' : ''}>Tado X</option>
            </select>
          </div>
          <div class="field">
            <label>Home-ID <span class="text-muted" style="font-size:10px">(leer lassen – automatisch)</span></label>
            <input id="tado-home-id" type="number" value="${esc(tado.homeId ?? '')}" placeholder="wird automatisch ermittelt" />
          </div>
        </div>

        <!-- Device Code Flow (V3 + X identisch) -->
        <div class="tado-connect-panel" id="tado-connect-panel-${esc(apt.id)}">
          <div class="tado-connect-status" id="tado-connect-status-${esc(apt.id)}">
            <span class="text-muted">Status wird geprueft…</span>
          </div>
          <div class="tado-connect-actions">
            <button type="button" class="btn btn--primary btn--sm js-tado-connect" data-id="${esc(apt.id)}">Tado verbinden</button>
            <button type="button" class="btn btn--ghost btn--sm js-tado-disconnect" data-id="${esc(apt.id)}" style="display:none">Trennen</button>
          </div>
          <div class="tado-connect-flow" id="tado-connect-flow-${esc(apt.id)}" style="display:none">
            <p class="text-muted" style="font-size:12px;margin:8px 0">
              1. Klick auf den Link unten (oeffnet im neuen Tab)<br>
              2. Logge dich bei Tado ein und klicke „Erlauben"<br>
              3. Diese Seite erkennt die Freigabe automatisch
            </p>
            <a class="tado-connect-link" id="tado-connect-link-${esc(apt.id)}" target="_blank" rel="noopener"></a>
            <div class="tado-connect-code" id="tado-connect-code-${esc(apt.id)}"></div>
          </div>
        </div>
        <!-- Hidden-Felder fuer Backwards-Compat mit dem Save-Payload -->
        <input type="hidden" id="tado-email" value="${esc(tado.email || '')}" />
        <input type="hidden" id="tado-password" value="${esc(tado.password || '')}" />
      </div>
    </div>

    <!-- Minut -->
    <div class="edit-section">
      <label class="integration-toggle">
        <input type="checkbox" id="toggle-minut" ${minut.enabled ? 'checked' : ''} />
        Minut
      </label>
      <div class="integration-fields ${minut.enabled ? '' : 'integration-fields--hidden'}" id="fields-minut">
        <div id="minut-device-wrapper">${minutHtml}</div>
      </div>
    </div>

    <!-- Nuki -->
    <div class="edit-section">
      <label class="integration-toggle">
        <input type="checkbox" id="toggle-nuki" ${nuki.enabled ? 'checked' : ''} />
        Nuki
      </label>
      <div class="integration-fields ${nuki.enabled ? '' : 'integration-fields--hidden'}" id="fields-nuki">
        <div id="nuki-device-wrapper">${nukiHtml}</div>
      </div>
    </div>

    <!-- Aktionen -->
    <div class="edit-actions">
      <button class="btn btn--primary" id="btn-edit-save">Speichern</button>
      <button class="btn btn--ghost" id="btn-edit-cancel">Abbrechen</button>
      <span class="edit-error" id="edit-error" style="display:none"></span>
    </div>

  </div>`;
}

function renderRow(apt) {
  const isEditing = apt.id === editingId;
  return `
  <div class="apt-row ${isEditing ? 'apt-row--editing' : ''}" data-id="${esc(apt.id)}">
    <div class="apt-row__summary">
      <div class="apt-row__name">
        <strong>${esc(apt.name)}</strong>
        ${apt.location ? `<span class="loc">${esc(apt.location)}</span>` : ''}
      </div>
      <div class="apt-row__badges">${integrationBadges(apt)}</div>
      <div class="apt-row__actions">
        <button class="btn btn--ghost btn--sm js-move-up" data-id="${esc(apt.id)}" title="Nach oben">▲</button>
        <button class="btn btn--ghost btn--sm js-move-down" data-id="${esc(apt.id)}" title="Nach unten">▼</button>
        <label class="visible-toggle">
          <input type="checkbox" class="js-visible" data-id="${esc(apt.id)}"
            data-current="${apt.visible ? 'true' : 'false'}"
            ${apt.visible ? 'checked' : ''} />
          Sichtbar
        </label>
        <button class="btn btn--ghost btn--sm js-edit" data-id="${esc(apt.id)}">Bearbeiten</button>
        <button class="btn btn--danger btn--sm js-delete" data-id="${esc(apt.id)}">Loeschen</button>
      </div>
    </div>
    ${isEditing ? renderEditPanel(apt) : ''}
  </div>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  const root = document.getElementById('setup-root');

  root.innerHTML = `
    <div id="integrations-settings"></div>

    <div id="my-cal-section"></div>

    <div id="users-section"></div>

    <div id="cleaners-section"></div>

    <div class="card integration-card" style="margin-bottom:20px">
      <div class="integration-card__head">
        <strong>Backup / Restore</strong>
      </div>
      <p class="text-muted" style="font-size:12px;margin-bottom:12px">
        Exportiert alle Wohnungen, Integrationen, Tado-Tokens und Automation-Logs als eine JSON-Datei.
        Beim Import werden alle vorhandenen Daten ueberschrieben.
      </p>
      <div class="integration-actions">
        <button class="btn btn--primary btn--sm" id="btn-backup">Backup herunterladen</button>
        <button class="btn btn--ghost btn--sm" id="btn-restore-pick">Restore aus Datei</button>
        <input type="file" id="restore-file" accept=".json" style="display:none" />
        <span class="integration-result" id="backup-result"></span>
      </div>
    </div>

    <div class="setup-header">
      <h1>Wohnungen</h1>
      <button class="btn btn--primary" id="btn-add">+ Wohnung hinzufuegen</button>
    </div>

    <div class="card add-form-card" id="add-form" style="display:none;margin-bottom:16px">
      <div class="field-row" style="align-items:flex-end">
        <div class="field">
          <label>Name</label>
          <input id="input-name" type="text" placeholder="z.B. Black Forest 1" />
        </div>
        <div class="field">
          <label>Kuerzel</label>
          <input id="input-location" type="text" placeholder="z.B. IK12C" />
        </div>
        <div style="display:flex;gap:8px;padding-bottom:1px">
          <button class="btn btn--primary" id="btn-save-new">Speichern</button>
          <button class="btn btn--ghost" id="btn-cancel-new">Abbrechen</button>
        </div>
      </div>
      <p class="edit-error" id="add-error" style="display:none;margin-top:8px"></p>
    </div>

    ${apartments.length === 0
      ? `<div class="empty-state">
           <h2>Noch keine Wohnungen</h2>
           <p>Klicke auf "+ Wohnung hinzufuegen" um loszulegen.</p>
         </div>`
      : `<div style="display:flex;flex-direction:column;gap:10px">
           ${apartments.map(apt => renderRow(apt)).join('')}
         </div>`
    }

    <div class="setup-header" style="margin-top:32px">
      <h1>Aktions-Log</h1>
      <div style="display:flex;gap:8px">
        <button class="btn btn--ghost btn--sm" id="btn-refresh-log">Aktualisieren</button>
        <button class="btn btn--ghost btn--sm" id="btn-reset-log" style="color:var(--color-danger)">Log leeren</button>
      </div>
    </div>
    <div id="automation-log" class="card" style="margin-top:8px">
      <div class="text-muted" style="font-size:12px">laedt…</div>
    </div>
  `;

  bindEvents(root);
  renderMyCalendar();
  renderIntegrationsSettings();
  renderUsers();
  renderCleaners();
  loadAutomationLog();
}

async function loadAutomationLog() {
  const container = document.getElementById('automation-log');
  if (!container) return;
  try {
    const log = await apiGet('/api/automation/log?limit=50');
    if (!Array.isArray(log) || log.length === 0) {
      container.innerHTML = '<div class="text-muted" style="font-size:12px">Noch keine Automationen ausgefuehrt. Der Scheduler laeuft im Hintergrund und protokolliert hier jeden Fire.</div>';
      return;
    }
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px;font-size:12px">
        ${log.map(e => {
          const cls = e.result === 'error' ? 'text-danger' : (e.result === 'partial' ? 'text-warning' : '');
          const ts = new Date(e.timestamp).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
          const srcLabel = e.source === 'automation' ? 'auto' : 'manuell';
          const srcStyle = e.source === 'automation'
            ? 'background:#2a3450;color:#9fb3ff'
            : 'background:#33384a;color:#c3c9da';
          const detail = e.eventTitle
            ? esc(e.eventTitle)
            : (e.roomName ? esc(e.roomName) : (e.roomId !== undefined ? `Raum ${e.roomId}` : ''));
          return `
            <div style="display:flex;gap:10px;align-items:baseline;border-bottom:1px solid var(--color-border);padding-bottom:4px">
              <span class="text-muted" style="min-width:110px">${esc(ts)}</span>
              <span style="min-width:60px;padding:2px 6px;border-radius:4px;font-size:10px;text-align:center;${srcStyle}">${srcLabel}</span>
              <span style="min-width:120px"><strong>${esc(e.apartmentName)}</strong></span>
              <span style="min-width:160px">${esc(e.actionLabel || e.action)}</span>
              <span style="flex:1">${detail}</span>
              <span class="${cls}">${esc(e.result)}${e.message ? ' · ' + esc(e.message) : ''}</span>
            </div>`;
        }).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="text-danger" style="font-size:12px">Log konnte nicht geladen werden: ${esc(err.message)}</div>`;
  }
}

// ── Event-Binding ─────────────────────────────────────────────────────────────

function bindEvents(root) {
  // ── Backup/Restore ──
  root.querySelector('#btn-backup')?.addEventListener('click', async () => {
    const resultEl = root.querySelector('#backup-result');
    resultEl.textContent = 'Erstelle Backup…';
    try {
      const res = await fetch('/api/admin/backup');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `faecherlofts-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      resultEl.innerHTML = '<span class="text-success">✓ Backup heruntergeladen</span>';
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
    }
  });

  root.querySelector('#btn-restore-pick')?.addEventListener('click', () => {
    root.querySelector('#restore-file').click();
  });

  root.querySelector('#restore-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const resultEl = root.querySelector('#backup-result');
    resultEl.textContent = 'Stelle wieder her…';
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (!backup.files) throw new Error('Ungueltiges Backup-Format (kein "files"-Feld).');
      if (!confirm(`Restore aus "${file.name}"?\n\nAlle aktuellen Daten werden ueberschrieben.\nEnthaltene Dateien: ${Object.keys(backup.files).join(', ')}`)) {
        resultEl.textContent = '(abgebrochen)';
        return;
      }
      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>`;
        return;
      }
      resultEl.innerHTML = `<span class="text-success">✓ ${esc(data.message)} Seite wird neu geladen…</span>`;
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
    }
    e.target.value = '';
  });

  // ── Aktions-Log ──
  root.querySelector('#btn-refresh-log')?.addEventListener('click', loadAutomationLog);
  root.querySelector('#btn-reset-log')?.addEventListener('click', async () => {
    if (!confirm('Aktions-Log und Automation-State wirklich leeren?')) return;
    try {
      const res = await fetch('/api/admin/log', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) loadAutomationLog();
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  });

  // ── Add-Form ──
  const addForm  = root.querySelector('#add-form');
  const addError = root.querySelector('#add-error');

  root.querySelector('#btn-add').addEventListener('click', () => {
    setVisible(addForm, true);
    root.querySelector('#input-name').focus();
  });

  root.querySelector('#btn-cancel-new')?.addEventListener('click', () => {
    setVisible(addForm, false);
    setVisible(addError, false);
    root.querySelector('#input-name').value = '';
    root.querySelector('#input-location').value = '';
  });

  root.querySelector('#btn-save-new')?.addEventListener('click', async () => {
    const name = root.querySelector('#input-name').value.trim();
    const location = root.querySelector('#input-location').value.trim();
    setVisible(addError, false);
    if (!name) {
      addError.textContent = 'Bitte einen Namen eingeben.';
      setVisible(addError, true);
      return;
    }
    try {
      await apiPost('/api/apartments', { name, location, visible: true });
      await refreshAndRender();
    } catch (err) {
      addError.textContent = err.message;
      setVisible(addError, true);
    }
  });

  // ── Sortierung (Hoch/Runter) ──
  async function moveApartment(id, direction) {
    const ids = apartments.map(a => a.id);
    const idx = ids.indexOf(id);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= ids.length) return;
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    try {
      await fetch('/api/apartments/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      await refreshAndRender();
    } catch (err) { console.error(err); }
  }

  root.querySelectorAll('.js-move-up').forEach(btn => {
    btn.addEventListener('click', () => moveApartment(btn.dataset.id, -1));
  });
  root.querySelectorAll('.js-move-down').forEach(btn => {
    btn.addEventListener('click', () => moveApartment(btn.dataset.id, 1));
  });

  // ── Visible-Toggle ──
  root.querySelectorAll('.js-visible').forEach(cb => {
    cb.addEventListener('change', async () => {
      const current = cb.dataset.current === 'true';
      try {
        await apiPut(`/api/apartments/${cb.dataset.id}`, { visible: !current });
        await refreshAndRender();
      } catch (err) {
        console.error('Sichtbarkeit konnte nicht geaendert werden:', err.message);
      }
    });
  });

  // ── Automation Test ──
  root.querySelectorAll('.js-test-automation').forEach(btn => {
    btn.addEventListener('click', async () => {
      const resultEl = root.querySelector(`.automation-test-result[data-id="${btn.dataset.id}"]`);
      resultEl.textContent = 'Teste…';
      try {
        const res = await fetch(`/api/automation/test/${encodeURIComponent(btn.dataset.id)}`, { method: 'POST' });
        const data = await res.json();
        if (!data.automationEnabled) {
          resultEl.innerHTML = '<span class="text-warning">⚠ Automation nicht aktiviert — bitte Checkbox setzen + speichern</span>';
          return;
        }
        const eventsNow = (data.events || []).filter(e => e.checkinInWindow || e.checkoutInWindow);
        const nextEvents = (data.events || []).filter(e => !e.checkinInWindow && !e.checkoutInWindow).slice(0, 3);
        let html = `<span class="text-success">✓ OK</span> Lokal ${data.localTime} (${data.timezone}) · `;
        if (eventsNow.length > 0) {
          html += `<strong>${eventsNow.length} Aktion(en) JETZT im Fenster!</strong>`;
        } else if (nextEvents.length > 0) {
          const next = nextEvents[0];
          html += `Naechstes Event: ${esc(next.summary)} · CO: ${next.checkoutTriggerUTC?.slice(11,16)} UTC · CI: ${next.checkinTriggerUTC?.slice(11,16)} UTC`;
        } else {
          html += 'Keine Events in der Naehe';
        }
        resultEl.innerHTML = html;
      } catch (err) {
        resultEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
      }
    });
  });

  // ── Automation Force ──
  root.querySelectorAll('.js-force-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const resultEl = root.querySelector(`.automation-test-result[data-id="${btn.dataset.id}"]`);
      const label = btn.dataset.action === 'all-off' ? 'Alles aus' : 'Plan fortsetzen';
      if (!confirm(`${label} fuer diese Wohnung JETZT ausfuehren?`)) return;
      resultEl.textContent = 'Ausfuehren…';
      try {
        const res = await fetch(`/api/automation/force/${encodeURIComponent(btn.dataset.id)}/${btn.dataset.action}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) {
          resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>`;
          return;
        }
        resultEl.innerHTML = `<span class="text-success">✓ ${esc(label)} ausgefuehrt</span>`;
      } catch (err) {
        resultEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
      }
    });
  });

  // ── Bearbeiten-Button ──
  root.querySelectorAll('.js-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (editingId === id) {
        editingId = null;
        render();
        return;
      }
      editingId = id;
      render();
      // Geraete lazy laden wenn Minut/Nuki aktiv
      const apt = apartments.find(a => a.id === id);
      if (apt) {
        const needsMinut = apt.integrations?.minut?.enabled;
        const needsNuki  = apt.integrations?.nuki?.enabled;
        if (needsMinut || needsNuki) {
          const [md, nd] = await Promise.all([
            needsMinut ? loadMinutDevices() : Promise.resolve(minutDevices),
            needsNuki  ? loadNukiDevices()  : Promise.resolve(nukiDevices)
          ]);
          // Device-Bereiche im bestehenden Panel aktualisieren (kein Re-render noetig)
          const wrapper = document.getElementById(`edit-panel-${id}`);
          if (wrapper && needsMinut) {
            const mw = wrapper.querySelector('#minut-device-wrapper');
            if (mw) mw.innerHTML = renderMinutDropdown(apt, md);
          }
          if (wrapper && needsNuki) {
            const nw = wrapper.querySelector('#nuki-device-wrapper');
            if (nw) nw.innerHTML = renderNukiCheckboxes(apt, nd);
          }
        }
      }
      // bindEditPanel wurde bereits am Ende von bindEvents() aufgerufen
      // (via render()). Nicht doppelt binden, sonst bekommen Buttons doppelte
      // Click-Listener und oeffnen z.B. den Tado-Verifizierungslink zweimal.
    });
  });

  // ── Loeschen-Button ──
  root.querySelectorAll('.js-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Wohnung "${apartments.find(a => a.id === btn.dataset.id)?.name || btn.dataset.id}" wirklich loeschen?`)) return;
      try {
        await apiDelete(`/api/apartments/${btn.dataset.id}`);
        if (editingId === btn.dataset.id) editingId = null;
        await refreshAndRender();
      } catch (err) {
        alert('Loeschen fehlgeschlagen: ' + err.message);
      }
    });
  });

  // EditPanel-Events binden falls gerade eine Wohnung editiert wird
  if (editingId) bindEditPanel(editingId);
}

function bindEditPanel(id) {
  const panel = document.getElementById(`edit-panel-${id}`);
  if (!panel) return;

  // ── Tado Connect-Button (V3 + X) ──
  bindTadoConnect(panel, id);
  refreshTadoConnectStatus(id);

  // Integration-Toggles: Felder ein-/ausblenden
  ['ical', 'tado', 'minut', 'nuki'].forEach(key => {
    const toggle = panel.querySelector(`#toggle-${key}`);
    const fields = panel.querySelector(`#fields-${key}`);
    if (!toggle || !fields) return;

    toggle.addEventListener('change', async () => {
      fields.classList.toggle('integration-fields--hidden', !toggle.checked);
      if (!toggle.checked) return;

      const apt = apartments.find(a => a.id === id);
      if (!apt) return;

      // Device-Wrapper immer neu rendern wenn aktiviert. loadMinutDevices/
      // loadNukiDevices haben bereits Cache, der zweite Aufruf kostet also
      // nichts. Ohne Re-render blieb der Wrapper leer, wenn die Devices
      // vorher schon einmal (z.B. fuer eine andere Wohnung) geladen waren.
      if (key === 'minut') {
        const md = await loadMinutDevices();
        const mw = panel.querySelector('#minut-device-wrapper');
        if (mw) mw.innerHTML = renderMinutDropdown(
          { ...apt, integrations: { ...apt.integrations, minut: { enabled: true, deviceId: apt.integrations?.minut?.deviceId } } },
          md
        );
      }
      if (key === 'nuki') {
        const nd = await loadNukiDevices();
        const nw = panel.querySelector('#nuki-device-wrapper');
        if (nw) nw.innerHTML = renderNukiCheckboxes(
          { ...apt, integrations: { ...apt.integrations, nuki: { enabled: true, deviceIds: apt.integrations?.nuki?.deviceIds } } },
          nd
        );
      }
    });
  });

  // Speichern
  panel.querySelector('#btn-edit-save').addEventListener('click', async () => {
    const errEl = panel.querySelector('#edit-error');
    setVisible(errEl, false);

    const name = panel.querySelector('#edit-name').value.trim();
    if (!name) {
      errEl.textContent = 'Name darf nicht leer sein.';
      setVisible(errEl, true);
      return;
    }

    // Nuki-Checkboxen auslesen
    const nukiSelected = [...panel.querySelectorAll('.nuki-cb:checked')].map(cb => cb.value);

    const payload = {
      name,
      location: panel.querySelector('#edit-location').value.trim(),
      occupancy: {
        enabled: panel.querySelector('#toggle-ical').checked,
        icalUrl: panel.querySelector('#ical-url')?.value.trim() || '',
        checkoutHour: Number(panel.querySelector('#ical-checkout-hour')?.value) || 10,
        checkinHour: Number(panel.querySelector('#ical-checkin-hour')?.value) || 16
      },
      automation: {
        enabled: panel.querySelector('#toggle-automation')?.checked || false
      },
      integrations: {
        tado: {
          enabled: panel.querySelector('#toggle-tado').checked,
          kind:     panel.querySelector('#tado-kind')?.value || 'V3',
          email:    panel.querySelector('#tado-email')?.value.trim() || '',
          password: panel.querySelector('#tado-password')?.value || '',
          homeId:   panel.querySelector('#tado-home-id')?.value
                      ? Number(panel.querySelector('#tado-home-id').value) : null
        },
        minut: {
          enabled:  panel.querySelector('#toggle-minut').checked,
          deviceId: panel.querySelector('#minut-device-id')?.value || ''
        },
        nuki: {
          enabled:   panel.querySelector('#toggle-nuki').checked,
          deviceIds: nukiSelected
        }
      }
    };

    try {
      await apiPut(`/api/apartments/${id}`, payload);
      editingId = null;
      await refreshAndRender();
    } catch (err) {
      errEl.textContent = err.message;
      setVisible(errEl, true);
    }
  });

  // Abbrechen
  panel.querySelector('#btn-edit-cancel').addEventListener('click', () => {
    editingId = null;
    render();
  });
}

// ── Tado X Device Code Flow ─────────────────────────────────────────────────

// Aktive Poller pro Apartment-ID, damit ein zweiter Klick nicht doppelt laeuft
const tadoPollers = new Map();

async function refreshTadoConnectStatus(aptId) {
  const statusEl = document.getElementById(`tado-connect-status-${aptId}`);
  if (!statusEl) return;
  try {
    const res = await fetch(`/api/tado/${encodeURIComponent(aptId)}/auth/status`);
    if (!res.ok) {
      statusEl.innerHTML = `<span class="text-muted">Status nicht verfuegbar</span>`;
      return;
    }
    const data = await res.json();
    renderTadoConnectStatus(aptId, data.authorized);
  } catch (err) {
    statusEl.innerHTML = `<span class="text-warning">Fehler: ${esc(err.message)}</span>`;
  }
}

function renderTadoConnectStatus(aptId, authorized) {
  const statusEl = document.getElementById(`tado-connect-status-${aptId}`);
  const connectBtn = document.querySelector(`.js-tado-connect[data-id="${aptId}"]`);
  const disconnectBtn = document.querySelector(`.js-tado-disconnect[data-id="${aptId}"]`);
  if (!statusEl) return;

  if (authorized) {
    statusEl.innerHTML = `<span class="badge badge--free">✓ Tado verbunden</span>`;
    if (connectBtn) connectBtn.textContent = 'Neu verbinden';
    if (disconnectBtn) disconnectBtn.style.display = '';
  } else {
    statusEl.innerHTML = `<span class="text-muted">Noch nicht verbunden</span>`;
    if (connectBtn) connectBtn.textContent = 'Tado verbinden';
    if (disconnectBtn) disconnectBtn.style.display = 'none';
  }
}

function bindTadoConnect(panel, aptId) {
  const connectBtn = panel.querySelector('.js-tado-connect');
  const disconnectBtn = panel.querySelector('.js-tado-disconnect');

  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      connectBtn.disabled = true;
      const statusEl = document.getElementById(`tado-connect-status-${aptId}`);
      const flowEl = document.getElementById(`tado-connect-flow-${aptId}`);
      const linkEl = document.getElementById(`tado-connect-link-${aptId}`);
      const codeEl = document.getElementById(`tado-connect-code-${aptId}`);

      if (statusEl) statusEl.innerHTML = `<span class="text-muted">Starte Autorisierung…</span>`;

      try {
        const res = await fetch(`/api/tado/${encodeURIComponent(aptId)}/auth/start`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        // URL + Code anzeigen und neuen Tab oeffnen
        if (linkEl) {
          linkEl.href = data.verificationUriComplete;
          linkEl.textContent = data.verificationUriComplete;
        }
        if (codeEl) codeEl.innerHTML = `Code: <strong>${esc(data.userCode)}</strong>`;
        if (flowEl) flowEl.style.display = '';
        if (statusEl) statusEl.innerHTML = `<span class="text-warning">Warte auf Bestaetigung…</span>`;

        // Polling starten — User klickt den Link selbst an
        startTadoPolling(aptId);
      } catch (err) {
        if (statusEl) statusEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
        connectBtn.disabled = false;
      }
    });
  }

  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      if (!confirm('Tado-Verbindung wirklich trennen?')) return;
      try {
        await fetch(`/api/tado/${encodeURIComponent(aptId)}/auth`, { method: 'DELETE' });
        renderTadoConnectStatus(aptId, false);
      } catch (err) {
        alert('Trennen fehlgeschlagen: ' + err.message);
      }
    });
  }
}

function startTadoPolling(aptId) {
  // Doppel-Polling verhindern
  if (tadoPollers.has(aptId)) return;

  const statusEl = document.getElementById(`tado-connect-status-${aptId}`);
  const flowEl = document.getElementById(`tado-connect-flow-${aptId}`);
  const connectBtn = document.querySelector(`.js-tado-connect[data-id="${aptId}"]`);

  let pollCount = 0;

  const intervalId = setInterval(async () => {
    pollCount++;
    try {
      const res = await fetch(`/api/tado/${encodeURIComponent(aptId)}/auth/poll`, { method: 'POST' });
      const data = await res.json();

      if (data.status === 'success') {
        clearInterval(intervalId);
        tadoPollers.delete(aptId);
        if (flowEl) flowEl.style.display = 'none';
        renderTadoConnectStatus(aptId, true);
        // Hinweis, damit User "Speichern" im Edit-Panel nicht vergisst
        const statusEl2 = document.getElementById(`tado-connect-status-${aptId}`);
        if (statusEl2) {
          statusEl2.innerHTML = `
            <span class="badge badge--free">✓ Tado verbunden</span>
            <div class="text-warning" style="font-size:12px;margin-top:6px">
              Bitte jetzt unten auf <strong>„Speichern"</strong> klicken, damit die Integration aktiviert wird.
            </div>
          `;
        }
        if (connectBtn) connectBtn.disabled = false;
      } else if (data.status === 'pending') {
        const now = new Date().toLocaleTimeString('de-DE');
        if (statusEl) statusEl.innerHTML = `
          <span class="text-warning">⏳ Warte auf Bestaetigung…</span>
          <span class="text-muted" style="font-size:11px"> (Poll #${pollCount} · ${now})</span>
          <br>
          <span class="text-muted" style="font-size:11px">Hast du im Tado-Tab auf „Erlauben" geklickt?</span>
        `;
      } else if (data.status === 'expired' || data.status === 'not_started') {
        clearInterval(intervalId);
        tadoPollers.delete(aptId);
        if (statusEl) statusEl.innerHTML = `<span class="text-warning">Code abgelaufen – bitte neu starten</span>`;
        if (flowEl) flowEl.style.display = 'none';
        if (connectBtn) connectBtn.disabled = false;
      } else if (data.status === 'error') {
        clearInterval(intervalId);
        tadoPollers.delete(aptId);
        if (statusEl) statusEl.innerHTML = `
          <span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>
          <br>
          <span class="text-muted" style="font-size:11px">HTTP ${esc(data.httpStatus ?? '?')} · rawError: ${esc(data.rawError || '')}</span>
        `;
        if (flowEl) flowEl.style.display = 'none';
        if (connectBtn) connectBtn.disabled = false;
      }
    } catch (err) {
      // Netzwerkfehler → weiter pollen (max 10 Minuten)
    }
  }, 3000);

  tadoPollers.set(aptId, intervalId);

  // Sicherheits-Timeout nach 10 Minuten
  setTimeout(() => {
    if (tadoPollers.has(aptId)) {
      clearInterval(tadoPollers.get(aptId));
      tadoPollers.delete(aptId);
      if (statusEl) statusEl.innerHTML = `<span class="text-warning">Timeout – bitte neu starten</span>`;
      if (connectBtn) connectBtn.disabled = false;
    }
  }, 10 * 60 * 1000);
}

// ── Integration Settings (PROJ-7) ───────────────────────────────────────────

async function renderIntegrationsSettings() {
  const container = document.getElementById('integrations-settings');
  if (!container) return;

  // Status laden
  let status = { minut: { clientIdSet: false, clientSecretSet: false } };
  try {
    status = await apiGet('/api/integrations');
  } catch (err) {
    console.error('Status laden fehlgeschlagen:', err.message);
  }

  const minutOk = status.minut && status.minut.clientIdSet && status.minut.clientSecretSet;
  const nukiOk = status.nuki && status.nuki.apiTokenSet;
  const smoobuOk = status.smoobu && status.smoobu.apiKeySet;
  const notif = status.notifications || {};
  const notifOk = !!notif.emailTo && (notif.notifyAutomation || notif.notifyManual);
  const dash = status.dashboard || { refreshIntervalMinutes: 15 };

  const headlineParts = [];
  headlineParts.push(minutOk ? '✓ Minut' : '⚠ Minut');
  headlineParts.push(nukiOk ? '✓ Nuki' : '⚠ Nuki');
  headlineParts.push(smoobuOk ? '✓ Smoobu' : '○ Smoobu');
  headlineParts.push(notifOk ? '✓ Mail' : '○ Mail');

  container.innerHTML = `
    <div class="integrations-block">
      <div class="integrations-header">
        <h2>Integration-Zugangsdaten</h2>
        <button class="btn btn--ghost btn--sm" id="btn-integrations-toggle">
          ${esc(headlineParts.join(' · '))} · Bearbeiten
        </button>
      </div>
      <div class="integrations-body" id="integrations-body" style="display:none">

        <div class="card integration-card">
          <div class="integration-card__head">
            <strong>Minut</strong>
            <span class="integration-status" id="minut-status">
              ${minutOk ? '<span class="badge badge--free">✓ konfiguriert</span>' : '<span class="badge badge--offline">nicht konfiguriert</span>'}
            </span>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Client ID</label>
              <input id="minut-client-id" type="text" placeholder="${minutOk ? '(gesetzt – leer lassen um zu behalten)' : 'Client ID eintragen'}" />
            </div>
            <div class="field">
              <label>Client Secret</label>
              <input id="minut-client-secret" type="password" placeholder="${minutOk ? '(gesetzt – leer lassen um zu behalten)' : 'Client Secret'}" autocomplete="new-password" />
            </div>
          </div>
          <div class="integration-actions">
            <button class="btn btn--primary btn--sm" id="btn-minut-save">Speichern</button>
            <button class="btn btn--ghost btn--sm" id="btn-minut-test">Verbindung testen</button>
            <span class="integration-result" id="minut-result"></span>
          </div>
        </div>

        <div class="card integration-card">
          <div class="integration-card__head">
            <strong>Nuki</strong>
            <span class="integration-status" id="nuki-status">
              ${nukiOk ? '<span class="badge badge--free">✓ konfiguriert</span>' : '<span class="badge badge--offline">nicht konfiguriert</span>'}
            </span>
          </div>
          <div class="field">
            <label>API Token</label>
            <input id="nuki-api-token" type="password" placeholder="${nukiOk ? '(gesetzt – leer lassen um zu behalten)' : 'API-Token aus web.nuki.io'}" autocomplete="new-password" />
          </div>
          <div class="integration-actions">
            <button class="btn btn--primary btn--sm" id="btn-nuki-save">Speichern</button>
            <button class="btn btn--ghost btn--sm" id="btn-nuki-test">Verbindung testen</button>
            <span class="integration-result" id="nuki-result"></span>
          </div>
        </div>

        <div class="card integration-card">
          <div class="integration-card__head">
            <strong>Smoobu</strong>
            <span class="integration-status">
              ${smoobuOk ? '<span class="badge badge--free">✓ konfiguriert</span>' : '<span class="badge badge--offline">nicht konfiguriert</span>'}
            </span>
          </div>
          <p class="text-muted" style="font-size:12px;margin-bottom:10px">
            Buchungsdaten direkt aus Smoobu statt iCal. Liefert exakte Check-in/out Zeiten, Gastname, Personenzahl, Buchungskanal.
          </p>
          <div class="field">
            <label>API Key</label>
            <input id="smoobu-api-key" type="password" placeholder="${smoobuOk ? '(gesetzt – leer lassen um zu behalten)' : 'API-Key aus Smoobu Settings'}" autocomplete="new-password" />
          </div>
          <div class="integration-actions">
            <button class="btn btn--primary btn--sm" id="btn-smoobu-save">Speichern</button>
            <button class="btn btn--ghost btn--sm" id="btn-smoobu-test">Verbindung testen</button>
            <button class="btn btn--ghost btn--sm" id="btn-smoobu-load-apts">Wohnungen laden</button>
            <span class="integration-result" id="smoobu-result"></span>
          </div>
          <div id="smoobu-apartments-map" style="margin-top:12px"></div>
        </div>

        <div class="card integration-card">
          <div class="integration-card__head">
            <strong>E-Mail-Benachrichtigung</strong>
            <span class="integration-status">
              ${notifOk ? '<span class="badge badge--free">✓ aktiv</span>' : '<span class="badge badge--offline">aus</span>'}
            </span>
          </div>
          <p class="text-muted" style="font-size:12px;margin-bottom:12px">
            Schickt eine E-Mail bei jeder Tado-Aktion — manuell im Dashboard oder automatisch durch den iCal-Scheduler.<br>
            <strong>SMTP-Felder leer lassen</strong> um den lokalen Mailserver (sendmail/Postfix) des Plesk-Hosts zu nutzen — genauso wie PHPs <code>mail()</code>.
          </p>
          <div class="field">
            <label>Empfaenger-Adresse(n) <span class="text-muted" style="font-size:10px">(mehrere mit Komma oder Semikolon trennen)</span></label>
            <input id="notif-email" type="text" value="${esc(notif.emailTo || '')}" placeholder="alex@example.com, team@example.com" />
          </div>
          <div style="display:flex;gap:16px;margin:10px 0 8px;flex-wrap:wrap">
            <label class="integration-toggle" style="margin:0">
              <input type="checkbox" id="notif-automation" ${notif.notifyAutomation ? 'checked' : ''} />
              Automatische Aktionen
            </label>
            <label class="integration-toggle" style="margin:0">
              <input type="checkbox" id="notif-manual" ${notif.notifyManual ? 'checked' : ''} />
              Manuelle Aktionen
            </label>
            <label class="integration-toggle" style="margin:0">
              <input type="checkbox" id="notif-daily" ${notif.dailyHealthReport ? 'checked' : ''} />
              Morgen-Report um 07:00 (nur bei Warnungen)
            </label>
          </div>
          <details style="margin-bottom:12px">
            <summary style="cursor:pointer;font-size:12px;color:var(--color-text-muted)">SMTP-Server (einmalig)</summary>
            <div class="field-row" style="margin-top:10px">
              <div class="field">
                <label>SMTP Host</label>
                <input id="notif-smtp-host" type="text" value="${esc(notif.smtpHost || '')}" placeholder="smtp.example.com" />
              </div>
              <div class="field">
                <label>Port</label>
                <input id="notif-smtp-port" type="number" value="${esc(notif.smtpPort || 587)}" placeholder="587" />
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label>Benutzer</label>
                <input id="notif-smtp-user" type="text" value="${esc(notif.smtpUser || '')}" placeholder="login@example.com" autocomplete="off" />
              </div>
              <div class="field">
                <label>Passwort</label>
                <input id="notif-smtp-pass" type="password" placeholder="${notif.smtpPassSet ? '(gesetzt – leer lassen um zu behalten)' : 'SMTP-Passwort'}" autocomplete="new-password" />
              </div>
            </div>
            <div class="field">
              <label>Absender (From)</label>
              <input id="notif-smtp-from" type="text" value="${esc(notif.smtpFrom || '')}" placeholder="noreply@faecherlofts.de" />
            </div>
          </details>
          <div class="integration-actions">
            <button class="btn btn--primary btn--sm" id="btn-notif-save">Speichern</button>
            <button class="btn btn--ghost btn--sm" id="btn-notif-test">Test-Mail senden</button>
            <button class="btn btn--ghost btn--sm" id="btn-notif-daily-now">Morgen-Report jetzt senden</button>
            <span class="integration-result" id="notif-result"></span>
          </div>
        </div>

        <div class="card integration-card">
          <div class="integration-card__head">
            <strong>Dashboard</strong>
            <span class="integration-status">
              <span class="badge badge--free">${esc(dash.refreshIntervalMinutes)} min</span>
            </span>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Auto-Refresh-Intervall (Minuten)</label>
              <input id="dash-refresh-interval" type="number" min="1" max="120" value="${esc(dash.refreshIntervalMinutes)}" />
              <div class="text-muted" style="font-size:11px;margin-top:4px">Erlaubt: 1 – 120</div>
            </div>
            <div class="field">
              <label>Reinigungsplanung Tage im Voraus</label>
              <input id="dash-days-ahead" type="number" min="3" max="90" value="${esc(dash.cleaningDaysAhead || 21)}" />
              <div class="text-muted" style="font-size:11px;margin-top:4px">3 – 90 Tage</div>
            </div>
            <div class="field">
              <label>Zeitzone</label>
              <select id="dash-timezone" style="padding:6px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:13px">
                ${['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'UTC'].map(tz =>
                  `<option value="${tz}" ${(dash.timezone || 'Europe/Berlin') === tz ? 'selected' : ''}>${tz}</option>`
                ).join('')}
              </select>
              <div class="text-muted" style="font-size:11px;margin-top:4px" id="dash-live-clock">Server-Zeit wird geladen…</div>
            </div>
          </div>
          <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--color-border)">
            <strong style="font-size:13px">Tages-Mail an Mitarbeiter</strong>
            <div class="text-muted" style="font-size:11px;margin-bottom:8px">Jeder Mitarbeiter mit E-Mail erhaelt morgens eine Zusammenfassung seiner Reinigungen fuer den Tag.</div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px">
              <label class="integration-toggle" style="margin:0">
                <input type="checkbox" id="dash-cleaning-mail" ${dash.cleaningMailEnabled ? 'checked' : ''} />
                Tages-Mail aktiviert
              </label>
              <label class="integration-toggle" style="margin:0">
                <input type="checkbox" id="dash-cleaning-mail-admin" ${dash.cleaningMailAdminCopy ? 'checked' : ''} />
                Admin erhaelt Kopie
              </label>
              <div class="field" style="width:90px">
                <label>Morgens</label>
                <input id="dash-cleaning-mail-hour" type="number" min="0" max="23" value="${dash.cleaningMailHour ?? 7}" />
              </div>
              <div class="field" style="width:90px">
                <label>Abends</label>
                <input id="dash-cleaning-mail-evening" type="number" min="0" max="23" value="${dash.cleaningMailEveningHour ?? 20}" />
              </div>
            </div>
            <div class="text-muted" style="font-size:11px;margin-bottom:8px">Morgens: Tagesplan · Abends: Erinnerung fuer den Folgetag</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <label style="font-size:12px;color:var(--color-text-muted)">Test:</label>
              <input id="dash-mail-test-date" type="date" value="${new Date().toISOString().slice(0,10)}" style="padding:4px 8px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" />
              <input id="dash-mail-test-email" type="email" placeholder="Test-Adresse (leer=Mitarbeiter)" style="padding:4px 8px;width:200px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" />
              <button class="btn btn--ghost btn--sm" id="btn-cleaning-mail-test-morning">Morgen-Mail</button>
              <button class="btn btn--ghost btn--sm" id="btn-cleaning-mail-test-evening">Abend-Mail</button>
              <span id="cleaning-mail-result" style="font-size:12px"></span>
            </div>
          </div>
          <div class="integration-actions">
            <button class="btn btn--primary btn--sm" id="btn-dash-save">Speichern</button>
            <span class="integration-result" id="dash-result"></span>
          </div>
        </div>

      </div>
    </div>
  `;

  // Bindings
  container.querySelector('#btn-integrations-toggle').addEventListener('click', () => {
    const body = container.querySelector('#integrations-body');
    body.style.display = body.style.display === 'none' ? '' : 'none';
  });

  container.querySelector('#btn-minut-save').addEventListener('click', async () => {
    const resultEl = container.querySelector('#minut-result');
    resultEl.textContent = 'Speichere…';
    try {
      const clientId = container.querySelector('#minut-client-id').value.trim();
      const clientSecret = container.querySelector('#minut-client-secret').value.trim();
      // Wenn leer gelassen UND schon gesetzt → nichts machen
      const payload = { minut: {} };
      if (clientId) payload.minut.clientId = clientId;
      if (clientSecret) payload.minut.clientSecret = clientSecret;
      if (!clientId && !clientSecret) {
        resultEl.textContent = '(nichts eingegeben)';
        return;
      }
      // Merge mit bestehenden Werten: wenn nur eins neu, anderes aus Backend-Status übernehmen
      // Einfacher: nur die Felder senden die gefüllt sind, Backend merged NICHT → wir müssen beide setzen
      // Also: wenn nur eins eingegeben ist, das andere bleibt leer und wird überschrieben → warnen
      if (!clientId || !clientSecret) {
        if (!confirm('Nur ein Feld ausgefüllt — das andere wird geleert. Trotzdem speichern?')) {
          resultEl.textContent = '(abgebrochen)';
          return;
        }
      }
      const body = { minut: { clientId, clientSecret } };
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>`;
        return;
      }
      resultEl.innerHTML = `<span class="text-success">✓ gespeichert</span>`;
      // Status neu laden
      setTimeout(renderIntegrationsSettings, 800);
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
    }
  });

  container.querySelector('#btn-minut-test').addEventListener('click', async () => {
    const resultEl = container.querySelector('#minut-result');
    resultEl.textContent = 'Teste…';
    try {
      const res = await fetch('/api/integrations/minut/test', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        resultEl.innerHTML = `<span class="text-success">✓ verbunden · ${esc(data.deviceCount)} Geraete</span>`;
      } else {
        resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
    }
  });

  // Nuki Save
  container.querySelector('#btn-nuki-save').addEventListener('click', async () => {
    const resultEl = container.querySelector('#nuki-result');
    resultEl.textContent = 'Speichere…';
    try {
      const apiToken = container.querySelector('#nuki-api-token').value.trim();
      if (!apiToken) {
        resultEl.textContent = '(nichts eingegeben)';
        return;
      }
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nuki: { apiToken } })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>`;
        return;
      }
      resultEl.innerHTML = `<span class="text-success">✓ gespeichert</span>`;
      setTimeout(renderIntegrationsSettings, 800);
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
    }
  });

  // Nuki Test
  container.querySelector('#btn-nuki-test').addEventListener('click', async () => {
    const resultEl = container.querySelector('#nuki-result');
    resultEl.textContent = 'Teste…';
    try {
      const res = await fetch('/api/integrations/nuki/test', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        resultEl.innerHTML = `<span class="text-success">✓ verbunden · ${esc(data.deviceCount)} Geraete</span>`;
      } else {
        resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
    }
  });

  // ── Smoobu Save ──
  container.querySelector('#btn-smoobu-save')?.addEventListener('click', async () => {
    const resultEl = container.querySelector('#smoobu-result');
    resultEl.textContent = 'Speichere…';
    try {
      const apiKey = container.querySelector('#smoobu-api-key').value.trim();
      if (!apiKey) { resultEl.textContent = '(nichts eingegeben)'; return; }
      const res = await fetch('/api/integrations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smoobu: { apiKey } })
      });
      const data = await res.json();
      if (!res.ok) { resultEl.innerHTML = `<span class="text-danger">${esc(data.error)}</span>`; return; }
      resultEl.innerHTML = '<span class="text-success">✓ gespeichert</span>';
      setTimeout(renderIntegrationsSettings, 800);
    } catch (err) { resultEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`; }
  });

  container.querySelector('#btn-smoobu-test')?.addEventListener('click', async () => {
    const resultEl = container.querySelector('#smoobu-result');
    resultEl.textContent = 'Teste…';
    try {
      const res = await fetch('/api/integrations/smoobu/test', { method: 'POST' });
      const data = await res.json();
      if (data.success) { resultEl.innerHTML = '<span class="text-success">✓ Verbindung OK</span>'; }
      else { resultEl.innerHTML = `<span class="text-danger">${esc(data.error)}</span>`; }
    } catch (err) { resultEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`; }
  });

  container.querySelector('#btn-smoobu-load-apts')?.addEventListener('click', async () => {
    const resultEl = container.querySelector('#smoobu-result');
    const mapEl = container.querySelector('#smoobu-apartments-map');
    resultEl.textContent = 'Lade Wohnungen…';
    try {
      const smoobuApts = await apiGet('/api/integrations/smoobu/apartments');
      if (!Array.isArray(smoobuApts) || smoobuApts.length === 0) {
        resultEl.innerHTML = '<span class="text-warning">Keine Smoobu-Wohnungen gefunden.</span>';
        return;
      }
      resultEl.innerHTML = `<span class="text-success">${smoobuApts.length} Smoobu-Wohnungen geladen</span>`;
      const opts = smoobuApts.map(s => `<option value="${s.id}">${esc(s.name)} (ID: ${s.id})</option>`).join('');
      mapEl.innerHTML = `
        <div class="text-muted" style="font-size:11px;margin-bottom:8px">Smoobu-Wohnung zuordnen (pro lokale Wohnung):</div>
        ${apartments.map(a => {
          const current = a.occupancy?.smoobuApartmentId;
          const source = a.occupancy?.source || 'ical';
          return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--color-border);font-size:12px">
            <strong style="min-width:120px">${esc(a.name)}</strong>
            <select class="smoobu-apt-select" data-apt-id="${esc(a.id)}" style="flex:1;padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px">
              <option value="">— iCal (bisherig) —</option>
              ${opts.replace(new RegExp(`value="${current}"`), `value="${current}" selected`)}
            </select>
            <span class="text-muted">${source === 'smoobu' ? '✓ Smoobu' : 'iCal'}</span>
          </div>`;
        }).join('')}
        <button class="btn btn--primary btn--sm" id="btn-smoobu-map-save" style="margin-top:8px">Zuordnung speichern</button>
        <span id="smoobu-map-result" style="font-size:12px;margin-left:8px"></span>
      `;

      container.querySelector('#btn-smoobu-map-save')?.addEventListener('click', async () => {
        const mapResultEl = container.querySelector('#smoobu-map-result');
        mapResultEl.textContent = 'Speichere…';
        const selects = container.querySelectorAll('.smoobu-apt-select');
        for (const sel of selects) {
          const aptId = sel.dataset.aptId;
          const smoobuId = sel.value ? Number(sel.value) : null;
          const source = smoobuId ? 'smoobu' : 'ical';
          await fetch(`/api/apartments/${encodeURIComponent(aptId)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ occupancy: { source, smoobuApartmentId: smoobuId } })
          });
        }
        mapResultEl.innerHTML = '<span class="text-success">✓ Zuordnung gespeichert</span>';
        setTimeout(renderIntegrationsSettings, 800);
      });
    } catch (err) { resultEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`; }
  });

  // ── E-Mail-Benachrichtigung Save ──
  container.querySelector('#btn-notif-save')?.addEventListener('click', async () => {
    const resultEl = container.querySelector('#notif-result');
    resultEl.textContent = 'Speichere…';
    try {
      const payload = {
        notifications: {
          emailTo:          container.querySelector('#notif-email').value.trim(),
          notifyAutomation: container.querySelector('#notif-automation').checked,
          notifyManual:     container.querySelector('#notif-manual').checked,
          dailyHealthReport: container.querySelector('#notif-daily').checked,
          smtpHost:         container.querySelector('#notif-smtp-host').value.trim(),
          smtpPort:         Number(container.querySelector('#notif-smtp-port').value) || 587,
          smtpUser:         container.querySelector('#notif-smtp-user').value.trim(),
          smtpPass:         container.querySelector('#notif-smtp-pass').value,
          smtpFrom:         container.querySelector('#notif-smtp-from').value.trim()
        }
      };
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>`;
        return;
      }
      resultEl.innerHTML = `<span class="text-success">✓ gespeichert</span>`;
      setTimeout(renderIntegrationsSettings, 800);
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
    }
  });

  // ── E-Mail-Test ──
  container.querySelector('#btn-notif-test')?.addEventListener('click', async () => {
    const resultEl = container.querySelector('#notif-result');
    resultEl.textContent = 'Sende Test-Mail…';
    try {
      const res = await fetch('/api/integrations/notifications/test', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        resultEl.innerHTML = `<span class="text-success">✓ Test-Mail versendet</span>`;
      } else {
        resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
    }
  });

  // ── Dashboard-Settings Save ──
  // Live-Clock im Dashboard-Card
  async function updateDashClock() {
    try {
      const res = await fetch('/api/server-time');
      if (!res.ok) return;
      const t = await res.json();
      const el = container.querySelector('#dash-live-clock');
      if (el) el.innerHTML = `Server: <strong>${esc(t.localTime)}</strong> (${esc(t.timezone)}) · UTC: ${esc(t.utc.slice(11, 19))}`;
    } catch {}
  }
  updateDashClock();
  setInterval(updateDashClock, 10000);

  container.querySelector('#btn-dash-save')?.addEventListener('click', async () => {
    const resultEl = container.querySelector('#dash-result');
    resultEl.textContent = 'Speichere…';
    try {
      const minutes = Number(container.querySelector('#dash-refresh-interval').value);
      if (!isFinite(minutes) || minutes < 1 || minutes > 120) {
        resultEl.innerHTML = `<span class="text-danger">1 - 120 Minuten erlaubt</span>`;
        return;
      }
      const daysAhead = Number(container.querySelector('#dash-days-ahead')?.value);
      const cleaningMailEnabled = container.querySelector('#dash-cleaning-mail')?.checked || false;
      const cleaningMailAdminCopy = container.querySelector('#dash-cleaning-mail-admin')?.checked || false;
      const cleaningMailHour = Number(container.querySelector('#dash-cleaning-mail-hour')?.value);
      const cleaningMailEveningHour = Number(container.querySelector('#dash-cleaning-mail-evening')?.value);
      const timezone = container.querySelector('#dash-timezone')?.value || 'Europe/Berlin';
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboard: {
          refreshIntervalMinutes: minutes,
          cleaningDaysAhead: daysAhead || undefined,
          cleaningMailEnabled,
          cleaningMailAdminCopy,
          cleaningMailHour: isFinite(cleaningMailHour) ? cleaningMailHour : undefined,
          cleaningMailEveningHour: isFinite(cleaningMailEveningHour) ? cleaningMailEveningHour : undefined,
          timezone
        }})
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>`;
        return;
      }
      resultEl.innerHTML = `<span class="text-success">✓ gespeichert (wirkt beim naechsten Dashboard-Laden)</span>`;
      setTimeout(renderIntegrationsSettings, 800);
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
    }
  });

  // ── Reinigungs-Mail Tests ──
  async function testCleaningMail(mailType) {
    const resultEl = container.querySelector('#cleaning-mail-result');
    const date = container.querySelector('#dash-mail-test-date')?.value;
    const testEmail = container.querySelector('#dash-mail-test-email')?.value.trim();
    resultEl.textContent = 'Sende…';
    try {
      const res = await fetch('/api/integrations/cleaning-mail/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, mailType, testEmail: testEmail || undefined })
      });
      const data = await res.json();
      if (!data.success) { resultEl.innerHTML = `<span class="text-danger">${esc(data.error)}</span>`; return; }
      const sent = (data.results || []).filter(r => r.sent).length;
      const skipped = (data.results || []).filter(r => !r.sent).length;
      resultEl.innerHTML = `<span class="text-success">✓ ${sent} gesendet, ${skipped} uebersprungen (${mailType})</span>`;
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    }
  }
  container.querySelector('#btn-cleaning-mail-test-morning')?.addEventListener('click', () => testCleaningMail('morning'));
  container.querySelector('#btn-cleaning-mail-test-evening')?.addEventListener('click', () => testCleaningMail('evening'));

  // ── Morgen-Report jetzt senden (ignoriert das 7-Uhr-Fenster) ──
  container.querySelector('#btn-notif-daily-now')?.addEventListener('click', async () => {
    const resultEl = container.querySelector('#notif-result');
    resultEl.textContent = 'Baue Report…';
    try {
      const res = await fetch('/api/integrations/notifications/daily-report/run', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(data.error || 'unbekannt')}</span>`;
        return;
      }
      if (data.sent) {
        resultEl.innerHTML = `<span class="text-success">✓ Report an ${data.recipients.length} Empfaenger, ${data.totalIssues} Warnungen</span>`;
      } else {
        const reasonLabel = {
          'all-clear': 'Keine Warnungen — Report wurde nicht gesendet (Absicht)',
          'disabled': 'Checkbox "Morgen-Report" ist nicht aktiviert',
          'no-recipient': 'Keine Empfaenger-Adresse',
          'no-transport': 'Mail-Transport nicht verfuegbar'
        }[data.reason] || data.reason;
        resultEl.innerHTML = `<span class="text-muted">${esc(reasonLabel)}</span>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">Fehler: ${esc(err.message)}</span>`;
    }
  });
}

// ── Mein Kalender (Admin) ────────────────────────────────────────────────────

async function renderMyCalendar() {
  const container = document.getElementById('my-cal-section');
  if (!container) return;

  // Kalender-Token: bevorzugt vom verknuepften Cleaner-Profil (gleicher Weg
  // wie auf der Mitarbeiter-Seite), Fallback auf User-Token.
  let calToken = null;
  try {
    const me = await apiGet('/api/auth/me');
    // Wenn Admin mit Cleaner verknuepft ist, dessen Token nutzen
    if (me && me.cleanerId) {
      const cleaners = await apiGet('/api/integrations/cleaners');
      const linked = cleaners.find(c => c.id === me.cleanerId);
      if (linked && linked.calToken) calToken = linked.calToken;
    }
    // Fallback: eigener User-Token
    if (!calToken && me && me.calToken) calToken = me.calToken;
  } catch {}
  if (!calToken || calToken === 'undefined') { container.innerHTML = ''; return; }

  const proto = location.protocol;
  const host = location.host;
  const url = `${proto}//${host}/api/cleaning/calendar/${calToken}.ics`;
  const webcalUrl = url.replace(/^https?:/, 'webcal:');

  container.innerHTML = `
    <div class="my-cal-widget" style="margin-bottom:20px">
      <div class="my-cal-widget__icon">📅</div>
      <div class="my-cal-widget__body">
        <strong>Mein Reinigungskalender</strong>
        <div class="text-muted" style="font-size:11px;margin-top:2px">Zeigt dir zugewiesene Reinigungen im Handy-Kalender (iPhone/Android)</div>
      </div>
      <a href="${esc(webcalUrl)}" class="btn btn--primary btn--sm">Kalender hinzufuegen</a>
      <button class="btn btn--ghost btn--sm" id="btn-admin-cal-copy" title="URL kopieren">📋</button>
    </div>
  `;

  container.querySelector('#btn-admin-cal-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(webcalUrl).then(() => {
      const btn = container.querySelector('#btn-admin-cal-copy');
      if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '📋'; }, 2000); }
    }).catch(() => prompt('Kalender-URL:', url));
  });
}

// ── Benutzerverwaltung ──────────────────────────────────────────────────────

async function renderUsers() {
  const container = document.getElementById('users-section');
  if (!container) return;
  let users = [];
  let cleaners = [];
  try {
    users = await apiGet('/api/users');
    cleaners = await apiGet('/api/integrations/cleaners');
  } catch {}

  const roleBadge = (r) => r === 'admin'
    ? '<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;color:#fff;background:var(--color-accent)">Admin</span>'
    : '<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;color:#fff;background:var(--color-success)">Reinigung</span>';

  const calUrl = (token) => token ? `webcal://${location.host}/api/cleaning/calendar/${token}.ics` : null;

  const cleanerOpts = cleaners.map(c =>
    `<option value="${esc(c.id)}">${esc(c.name)}</option>`
  ).join('');

  container.innerHTML = `
    <div class="card integration-card" style="margin-bottom:20px">
      <div class="integration-card__head">
        <strong>Benutzer</strong>
        <span class="integration-status"><span class="badge badge--free">${users.length} Benutzer</span></span>
      </div>
      ${users.length > 0 ? `
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
          ${users.map(u => `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-border);font-size:13px">
              ${roleBadge(u.role)}
              <strong style="flex:1">${esc(u.displayName || u.username)}</strong>
              <span class="text-muted">${esc(u.username)}</span>
              ${u.cleanerId ? `<span class="text-muted" style="font-size:11px">→ ${esc(cleaners.find(c=>c.id===u.cleanerId)?.name || u.cleanerId)}</span>` : ''}
              ${u.calToken ? `<button class="btn btn--ghost btn--sm js-copy-cal" data-url="${esc(calUrl(u.calToken))}" title="Kalender-URL kopieren">📅</button>` : ''}
              <button class="btn btn--ghost btn--sm js-edit-user" data-id="${esc(u.id)}">Bearbeiten</button>
              <button class="btn btn--ghost btn--sm js-delete-user" data-id="${esc(u.id)}" style="color:var(--color-danger)">×</button>
            </div>
            <div class="user-edit-panel" id="user-edit-${esc(u.id)}" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border)">
              <div class="field-row">
                <div class="field"><label>Username (Login)</label><input class="ue-username" type="text" value="${esc(u.username || '')}" /></div>
                <div class="field"><label>Anzeigename</label><input class="ue-display" type="text" value="${esc(u.displayName || '')}" /></div>
                <div class="field"><label>Neues Passwort</label><input class="ue-pass" type="password" placeholder="(leer = nicht aendern)" autocomplete="new-password" /></div>
              </div>
              <div class="field-row">
                <div class="field">
                  <label>Rolle</label>
                  <select class="ue-role">
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                    <option value="cleaner" ${u.role === 'cleaner' ? 'selected' : ''}>Reinigungskraft</option>
                  </select>
                </div>
                <div class="field">
                  <label>Verknuepfter Mitarbeiter</label>
                  <select class="ue-cleaner">
                    <option value="">— keiner —</option>
                    ${cleanerOpts.replace(new RegExp(`value="${u.cleanerId}"`)  , `value="${u.cleanerId}" selected`)}
                  </select>
                </div>
              </div>
              <div style="margin-top:8px;display:flex;gap:8px">
                <button class="btn btn--primary btn--sm js-save-user" data-id="${esc(u.id)}">Speichern</button>
                <button class="btn btn--ghost btn--sm js-cancel-user" data-id="${esc(u.id)}">Abbrechen</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<div class="text-muted" style="font-size:12px;margin-bottom:12px">Noch keine Benutzer (ENV-basierter Login aktiv).</div>'}
      <details>
        <summary style="cursor:pointer;font-size:12px;color:var(--color-accent)">+ Benutzer hinzufuegen</summary>
        <div class="field-row" style="margin-top:10px">
          <div class="field"><label>Username</label><input id="new-user-name" type="text" placeholder="z.B. maria" /></div>
          <div class="field"><label>Anzeigename</label><input id="new-user-display" type="text" placeholder="z.B. Maria Schmidt" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Passwort</label><input id="new-user-pass" type="password" placeholder="mind. 4 Zeichen" autocomplete="new-password" /></div>
          <div class="field">
            <label>Rolle</label>
            <select id="new-user-role">
              <option value="cleaner">Reinigungskraft</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="field" id="new-user-cleaner-row">
          <label>Verknuepfter Mitarbeiter</label>
          <select id="new-user-cleaner">
            <option value="">— keiner —</option>
            ${cleanerOpts}
          </select>
        </div>
        <button class="btn btn--primary btn--sm" id="btn-add-user" style="margin-top:8px">Erstellen</button>
        <span id="user-result" style="margin-left:8px;font-size:12px"></span>
      </details>
    </div>
  `;

  // Rolle wechsel → Cleaner-Feld ein/ausblenden
  container.querySelector('#new-user-role')?.addEventListener('change', (e) => {
    const row = container.querySelector('#new-user-cleaner-row');
    if (row) row.style.display = e.target.value === 'cleaner' ? '' : 'none';
  });

  container.querySelector('#btn-add-user')?.addEventListener('click', async () => {
    const resultEl = container.querySelector('#user-result');
    const username = container.querySelector('#new-user-name').value.trim();
    const displayName = container.querySelector('#new-user-display').value.trim();
    const password = container.querySelector('#new-user-pass').value;
    const role = container.querySelector('#new-user-role').value;
    const cleanerId = container.querySelector('#new-user-cleaner').value;
    if (!username || !password) { resultEl.innerHTML = '<span class="text-danger">Username + Passwort noetig</span>'; return; }
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName: displayName || username, password, role, cleanerId: cleanerId || null })
      });
      const data = await res.json();
      if (!res.ok) { resultEl.innerHTML = `<span class="text-danger">${esc(data.error)}</span>`; return; }
      renderUsers();
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    }
  });

  container.querySelectorAll('.js-edit-user').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById('user-edit-' + btn.dataset.id);
      if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });
  });

  container.querySelectorAll('.js-cancel-user').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById('user-edit-' + btn.dataset.id);
      if (panel) panel.style.display = 'none';
    });
  });

  container.querySelectorAll('.js-save-user').forEach(btn => {
    btn.addEventListener('click', async () => {
      const panel = document.getElementById('user-edit-' + btn.dataset.id);
      if (!panel) return;
      const patch = {
        username: panel.querySelector('.ue-username').value.trim(),
        displayName: panel.querySelector('.ue-display').value.trim(),
        role: panel.querySelector('.ue-role').value,
        cleanerId: panel.querySelector('.ue-cleaner').value || null
      };
      const pass = panel.querySelector('.ue-pass').value;
      if (pass) patch.password = pass;
      try {
        const res = await fetch(`/api/users/${btn.dataset.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch)
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Fehler'); return; }
        renderUsers();
      } catch (err) { alert(err.message); }
    });
  });

  container.querySelectorAll('.js-copy-cal').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '📅'; }, 2000);
      }).catch(() => prompt('Kalender-URL:', url));
    });
  });

  container.querySelectorAll('.js-delete-user').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Benutzer loeschen?')) return;
      try {
        const res = await fetch(`/api/users/${btn.dataset.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Fehler'); return; }
        renderUsers();
      } catch (err) { alert(err.message); }
    });
  });
}

// ── Reinigungsmitarbeiter ────────────────────────────────────────────────────

async function renderCleaners() {
  const container = document.getElementById('cleaners-section');
  if (!container) return;
  let cleaners = [];
  try { cleaners = await apiGet('/api/integrations/cleaners'); } catch {}

  const aptNames = apartments.map(a => ({ id: a.id, name: a.name }));

  container.innerHTML = `
    <div class="card integration-card" style="margin-bottom:20px">
      <div class="integration-card__head">
        <strong>Reinigungsmitarbeiter</strong>
        <span class="integration-status"><span class="badge ${cleaners.length > 0 ? 'badge--free' : 'badge--offline'}">${cleaners.length} Mitarbeiter</span></span>
      </div>
      ${cleaners.length > 0 ? cleaners.map(c => {
        const aptList = (c.apartments || []).map(id => { const a = aptNames.find(x=>x.id===id); return a ? a.name : id; }).join(', ');
        return `
          <div class="card" style="padding:12px;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <strong style="flex:1;font-size:14px">${esc(c.name)}</strong>
              ${c.monthlyHours ? `<span class="text-muted">${c.monthlyHours}h/Monat</span>` : ''}
              <span class="text-muted">${c.hourlyRate ?? 15}€/h</span>
              <button class="btn btn--ghost btn--sm js-edit-cleaner" data-id="${esc(c.id)}">Bearbeiten</button>
              <button class="btn btn--ghost btn--sm js-remove-cleaner" data-id="${esc(c.id)}" style="color:var(--color-danger)">×</button>
            </div>
            <div class="text-muted" style="font-size:11px">
              ${c.phone ? `📞 ${esc(c.phone)}` : ''} ${c.email ? `· ✉ ${esc(c.email)}` : ''}
              ${aptList ? `· Wohnungen: ${esc(aptList)}` : '· <em>Alle Wohnungen</em>'}
            </div>
            <div class="cleaner-edit-panel" id="cleaner-edit-${esc(c.id)}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--color-border)">
              <div class="field-row">
                <div class="field"><label>Name</label><input class="ce-name" type="text" value="${esc(c.name)}" /></div>
                <div class="field"><label>Telefon</label><input class="ce-phone" type="text" value="${esc(c.phone || '')}" /></div>
                <div class="field"><label>E-Mail</label><input class="ce-email" type="email" value="${esc(c.email || '')}" /></div>
                <div class="field"><label>Stunden/Monat</label><input class="ce-hours" type="number" min="0" value="${c.monthlyHours || 0}" /></div>
                <div class="field"><label>Brutto €/h</label><input class="ce-rate" type="number" min="0" step="0.5" value="${c.hourlyRate ?? 15}" /></div>
              </div>
              <div style="margin-top:8px">
                <label style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.5px">Wohnungen (leer = alle)</label>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
                  ${aptNames.map(a => `
                    <label style="display:flex;align-items:center;gap:4px;font-size:12px">
                      <input type="checkbox" class="ce-apt" value="${esc(a.id)}" ${(c.apartments || []).includes(a.id) ? 'checked' : ''} />
                      ${esc(a.name)}
                    </label>
                  `).join('')}
                </div>
              </div>
              <div style="margin-top:10px;display:flex;gap:8px">
                <button class="btn btn--primary btn--sm js-save-cleaner" data-id="${esc(c.id)}">Speichern</button>
                <button class="btn btn--ghost btn--sm js-cancel-cleaner" data-id="${esc(c.id)}">Abbrechen</button>
              </div>
            </div>
          </div>
        `;
      }).join('') : '<div class="text-muted" style="font-size:12px;margin-bottom:12px">Noch keine Mitarbeiter angelegt.</div>'}
      <details>
        <summary style="cursor:pointer;font-size:12px;color:var(--color-accent)">+ Mitarbeiter hinzufuegen</summary>
        <div class="field-row" style="margin-top:10px">
          <div class="field"><label>Name</label><input id="cleaner-name" type="text" placeholder="z.B. Maria Schmidt" /></div>
          <div class="field"><label>Telefon</label><input id="cleaner-phone" type="text" placeholder="+49..." /></div>
          <div class="field"><label>E-Mail</label><input id="cleaner-email" type="email" placeholder="optional" /></div>
          <div class="field"><label>Stunden/Monat</label><input id="cleaner-hours" type="number" min="0" value="0" /></div>
        </div>
        <button class="btn btn--primary btn--sm" id="btn-add-cleaner" style="margin-top:8px">Hinzufuegen</button>
        <span id="cleaner-result" style="margin-left:8px;font-size:12px"></span>
      </details>
    </div>
  `;

  // Bindings
  container.querySelector('#btn-add-cleaner')?.addEventListener('click', async () => {
    const name = container.querySelector('#cleaner-name').value.trim();
    const phone = container.querySelector('#cleaner-phone').value.trim();
    const email = container.querySelector('#cleaner-email').value.trim();
    const monthlyHours = Number(container.querySelector('#cleaner-hours').value) || 0;
    const resultEl = container.querySelector('#cleaner-result');
    if (!name) { resultEl.innerHTML = '<span class="text-danger">Name erforderlich</span>'; return; }
    try {
      await fetch('/api/integrations/cleaners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, monthlyHours })
      });
      renderCleaners();
    } catch (err) {
      resultEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    }
  });

  container.querySelectorAll('.js-edit-cleaner').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById('cleaner-edit-' + btn.dataset.id);
      if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });
  });

  container.querySelectorAll('.js-cancel-cleaner').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById('cleaner-edit-' + btn.dataset.id);
      if (panel) panel.style.display = 'none';
    });
  });

  container.querySelectorAll('.js-save-cleaner').forEach(btn => {
    btn.addEventListener('click', async () => {
      const panel = document.getElementById('cleaner-edit-' + btn.dataset.id);
      if (!panel) return;
      const patch = {
        name: panel.querySelector('.ce-name').value.trim(),
        phone: panel.querySelector('.ce-phone').value.trim(),
        email: panel.querySelector('.ce-email').value.trim(),
        monthlyHours: Number(panel.querySelector('.ce-hours').value) || 0,
        hourlyRate: Number(panel.querySelector('.ce-rate').value) || 15,
        apartments: [...panel.querySelectorAll('.ce-apt:checked')].map(cb => cb.value)
      };
      await fetch(`/api/integrations/cleaners/${btn.dataset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      renderCleaners();
    });
  });

  container.querySelectorAll('.js-remove-cleaner').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Mitarbeiter entfernen?')) return;
      await fetch(`/api/integrations/cleaners/${btn.dataset.id}`, { method: 'DELETE' });
      renderCleaners();
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function refreshAndRender() {
  await loadApartments();
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  refreshAndRender().catch(err => {
    document.getElementById('setup-root').innerHTML =
      `<div class="empty-state"><p class="text-danger">Fehler beim Laden: ${esc(err.message)}</p></div>`;
  });
});
