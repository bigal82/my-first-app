/**
 * Admin-Zeiterfassung — Monats-/Jahresübersicht aller Mitarbeiter.
 */

function esc(val) {
  const d = document.createElement('div');
  d.textContent = String(val ?? '');
  return d.innerHTML;
}

let currentMonth = new Date().toISOString().slice(0, 7); // "2026-04"
let overviewData = null;
let liveData = [];
let detailData = null;
let detailCleanerId = null;

async function loadOverview() {
  const res = await fetch(`/api/timetracking/admin/overview?month=${currentMonth}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  overviewData = await res.json();
}

async function loadLive() {
  try {
    const res = await fetch('/api/timetracking/admin/live');
    if (res.ok) liveData = await res.json();
  } catch {}
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function formatClockTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function renderLiveStatus() {
  if (liveData.length === 0) {
    return `
      <div class="tt-live-bar tt-live-bar--empty">
        <span class="tt-live-bar__dot"></span>
        <span>Kein Mitarbeiter eingestempelt</span>
      </div>
    `;
  }

  return `
    <div class="tt-live-section">
      <div class="tt-live-header">
        <span class="tt-live-pulse"></span>
        <strong>${liveData.length} Mitarbeiter aktiv</strong>
      </div>
      <div class="tt-live-grid">
        ${liveData.map(l => {
          const isPaused = l.status === 'paused';
          const statusLabel = isPaused ? '⏸ Pause' : '▶ Aktiv';
          const statusColor = isPaused ? 'var(--color-warning)' : 'var(--color-success)';
          return `
            <div class="tt-live-card">
              <div class="tt-live-card__header">
                <span class="tt-live-card__dot" style="background:${statusColor}"></span>
                <strong>${esc(l.name)}</strong>
                <span style="color:${statusColor};font-size:11px;font-weight:600">${statusLabel}</span>
              </div>
              <div class="tt-live-card__body">
                <span class="text-muted">Seit ${formatClockTime(l.clockIn)}</span>
                <span style="font-size:18px;font-weight:700;font-variant-numeric:tabular-nums">${formatDuration(l.currentMinutes)}</span>
                ${l.breakCount > 0 ? `<span class="text-muted" style="font-size:11px">${l.breakCount} Pause${l.breakCount > 1 ? 'n' : ''}</span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

let auditData = [];
let absenceData = [];
let cleanersList = [];
let pendingEntries = [];

async function loadDetail(cleanerId) {
  const res = await fetch(`/api/timetracking/admin/detail/${encodeURIComponent(cleanerId)}?month=${currentMonth}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  detailData = await res.json();
  detailCleanerId = cleanerId;
}

async function loadAudit() {
  try {
    const res = await fetch('/api/timetracking/admin/audit?limit=20');
    if (res.ok) auditData = await res.json();
  } catch {}
}

async function loadAbsences() {
  try {
    const res = await fetch('/api/absences');
    if (res.ok) absenceData = await res.json();
  } catch {}
}

async function loadCleanersList() {
  try {
    const res = await fetch('/api/integrations/cleaners');
    if (res.ok) cleanersList = await res.json();
  } catch {}
}

async function loadPending() {
  try {
    const res = await fetch('/api/timetracking/admin/pending');
    if (res.ok) pendingEntries = await res.json();
  } catch {}
}

function renderPendingSection() {
  if (pendingEntries.length === 0) return '';

  return `
    <div class="card" style="margin-bottom:20px;border-left:3px solid var(--color-warning)">
      <h3 style="margin:0 0 12px">⏳ ${pendingEntries.length} Nachtrag${pendingEntries.length > 1 ? 'e' : ''} zur Genehmigung</h3>
      ${pendingEntries.map(e => {
        const d = new Date(e.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
        const ci = e.clockIn ? new Date(e.clockIn).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—';
        const co = e.clockOut ? new Date(e.clockOut).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—';
        const h = Math.floor((e.totalMinutes || 0) / 60);
        const m = (e.totalMinutes || 0) % 60;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--color-border);font-size:13px;flex-wrap:wrap">
          <strong style="min-width:100px">${esc(e.cleanerName)}</strong>
          <span>${d}</span>
          <span>${ci} – ${co}</span>
          <span style="font-weight:600">${h}:${String(m).padStart(2,'0')}</span>
          ${e.note ? `<span class="text-muted">${esc(e.note)}</span>` : ''}
          <span style="font-size:10px;color:var(--color-text-muted)">${new Date(e.submittedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <div style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn--primary btn--sm js-review" data-id="${esc(e.id)}" data-decision="approve">✓ Genehmigen</button>
            <button class="btn btn--ghost btn--sm js-review" data-id="${esc(e.id)}" data-decision="reject" style="color:var(--color-danger)">× Ablehnen</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderAbsenceSection() {
  const typeLabel = { vacation: '🏖 Urlaub', sick: '🤒 Krank', unavailable: '❌ Nicht verfuegbar' };
  const upcoming = absenceData.filter(a => a.toDate >= new Date().toISOString().slice(0, 10));

  const listHtml = upcoming.length > 0 ? upcoming.map(a => {
    const from = new Date(a.fromDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const to = new Date(a.toDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-border);font-size:13px">
      <strong style="min-width:100px">${esc(a.cleanerName || a.cleanerId)}</strong>
      <span>${typeLabel[a.type] || a.type}</span>
      <span>${from} – ${to}</span>
      ${a.note ? `<span class="text-muted">${esc(a.note)}</span>` : ''}
      <button class="btn btn--ghost btn--sm js-del-absence" data-id="${esc(a.id)}" style="margin-left:auto;color:var(--color-danger)">×</button>
    </div>`;
  }).join('') : '<div class="text-muted" style="font-size:12px">Keine aktuellen Abwesenheiten.</div>';

  const cleanerOpts = cleanersList.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

  return `
    <div class="card" style="margin-top:20px">
      <h3 style="margin:0 0 12px">Abwesenheiten</h3>
      ${listHtml}
      <details style="margin-top:10px">
        <summary style="cursor:pointer;font-size:12px;color:var(--color-accent)">+ Abwesenheit eintragen</summary>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-end">
          <div class="field" style="width:140px"><label>Mitarbeiter</label><select id="abs-cleaner" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px">${cleanerOpts}</select></div>
          <div class="field" style="width:120px"><label>Von</label><input id="abs-from" type="date" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" /></div>
          <div class="field" style="width:120px"><label>Bis</label><input id="abs-to" type="date" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" /></div>
          <div class="field" style="width:140px"><label>Typ</label><select id="abs-type" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px"><option value="vacation">Urlaub</option><option value="sick">Krank</option><option value="unavailable">Nicht verfuegbar</option></select></div>
          <div class="field" style="flex:1;min-width:80px"><label>Notiz</label><input id="abs-note" type="text" placeholder="optional" style="padding:4px;width:100%;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" /></div>
          <button class="btn btn--primary btn--sm" id="btn-add-absence">+</button>
        </div>
      </details>
    </div>
  `;
}

async function adminDeleteEntry(id) {
  if (!confirm('Eintrag wirklich loeschen? Wird im Audit-Protokoll dokumentiert.')) return;
  const res = await fetch(`/api/timetracking/admin/entry/${id}`, { method: 'DELETE' });
  if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Fehler'); return; }
  await refresh();
}

let editingEntryId = null;

function showEntryForm(mode, entry) {
  // mode: 'add' oder 'edit'
  editingEntryId = mode === 'edit' ? entry?.id : null;
  const date = mode === 'edit' ? (entry?.date || '') : new Date().toISOString().slice(0, 10);
  const ciTime = mode === 'edit' && entry?.clockIn ? entry.clockIn.slice(11, 16) : '08:00';
  const coTime = mode === 'edit' && entry?.clockOut ? entry.clockOut.slice(11, 16) : '16:00';

  const formHtml = `
    <div class="card" style="margin-top:12px;padding:16px;border-left:3px solid var(--color-accent)" id="tt-entry-form">
      <strong style="font-size:13px">${mode === 'edit' ? '✏ Eintrag bearbeiten' : '+ Neuer Eintrag'}</strong>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:flex-end">
        <div class="field" style="width:140px">
          <label>Datum</label>
          <input id="ef-date" type="date" value="${date}" style="padding:6px 8px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:13px;width:100%" />
        </div>
        <div class="field" style="width:110px">
          <label>Von</label>
          <input id="ef-from" type="time" value="${ciTime}" style="padding:6px 8px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:13px;width:100%" />
        </div>
        <div class="field" style="width:110px">
          <label>Bis</label>
          <input id="ef-to" type="time" value="${coTime}" style="padding:6px 8px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:13px;width:100%" />
        </div>
        <button class="btn btn--primary btn--sm" id="ef-save">Speichern</button>
        <button class="btn btn--ghost btn--sm" id="ef-cancel">Abbrechen</button>
        <span id="ef-result" style="font-size:12px"></span>
      </div>
    </div>
  `;

  // Altes Formular entfernen falls vorhanden
  document.getElementById('tt-entry-form')?.remove();

  // Nach dem Add-Button einfügen
  const addBtn = document.getElementById('btn-tt-add');
  if (addBtn) addBtn.insertAdjacentHTML('afterend', formHtml);

  document.getElementById('ef-cancel')?.addEventListener('click', () => {
    document.getElementById('tt-entry-form')?.remove();
    editingEntryId = null;
  });

  document.getElementById('ef-save')?.addEventListener('click', async () => {
    const d = document.getElementById('ef-date')?.value;
    const from = document.getElementById('ef-from')?.value;
    const to = document.getElementById('ef-to')?.value;
    const resultEl = document.getElementById('ef-result');
    if (!d || !from || !to) { resultEl.innerHTML = '<span class="text-danger">Alle Felder noetig</span>'; return; }

    try {
      let res;
      if (editingEntryId) {
        res = await fetch(`/api/timetracking/admin/entry/${editingEntryId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: d, clockIn: `${d}T${from}:00.000Z`, clockOut: `${d}T${to}:00.000Z` })
        });
      } else {
        res = await fetch('/api/timetracking/admin/entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cleanerId: detailCleanerId, date: d, clockIn: `${d}T${from}:00.000Z`, clockOut: `${d}T${to}:00.000Z` })
        });
      }
      if (!res.ok) { const data = await res.json().catch(() => ({})); resultEl.innerHTML = `<span class="text-danger">${esc(data.error || 'Fehler')}</span>`; return; }
      editingEntryId = null;
      await refresh();
    } catch (err) { resultEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`; }
  });
}

function monthLabel(str) {
  const [y, m] = str.split('-');
  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

function prevMonth(str) {
  const d = new Date(str + '-01');
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function nextMonth(str) {
  const d = new Date(str + '-01');
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 7);
}

function render() {
  const root = document.getElementById('tt-root');
  if (!overviewData) { root.innerHTML = '<div class="text-muted">Keine Daten</div>'; return; }

  const ov = overviewData.overview || [];

  const navHtml = `
    <div class="tl-nav" style="margin-bottom:20px">
      <button class="btn btn--ghost btn--sm" id="tt-prev">← ${monthLabel(prevMonth(currentMonth))}</button>
      <h2 style="margin:0">${monthLabel(currentMonth)}</h2>
      <button class="btn btn--ghost btn--sm" id="tt-next">${monthLabel(nextMonth(currentMonth))} →</button>
    </div>
  `;

  const overviewHtml = ov.length === 0
    ? '<div class="text-muted">Keine Mitarbeiter konfiguriert.</div>'
    : `<div class="tt-grid">${ov.map(c => {
        const pct = c.percentUsed;
        const barColor = pct >= 100 ? 'var(--color-success)' : (pct >= 75 ? 'var(--color-warning)' : 'var(--color-accent)');
        return `
          <div class="tt-card js-tt-detail" data-cleaner="${esc(c.cleanerId)}">
            <div class="tt-card__header">
              <strong>${esc(c.name)}</strong>
              <span class="text-muted">${c.workDays} Tage</span>
            </div>
            <div class="tt-card__hours">
              <span style="font-size:24px;font-weight:700">${c.totalHours}h</span>
              ${c.contractHours ? `<span class="text-muted"> / ${c.contractHours}h</span>` : ''}
            </div>
            <div style="font-size:14px;font-weight:600;color:var(--color-success);margin-top:4px">${c.earnings?.toFixed(2) || '0.00'} € <span class="text-muted" style="font-weight:400;font-size:11px">(${c.hourlyRate || 15}€/h)</span></div>
            ${c.contractHours ? `
              <div class="my-time-bar" style="margin-top:8px">
                <div class="my-time-bar__fill" style="width:${Math.min(100, pct)}%;background:${barColor}"></div>
              </div>
              <div class="text-muted" style="font-size:11px;margin-top:4px">${pct}% der Vertragsstunden</div>
            ` : ''}
          </div>
        `;
      }).join('')}</div>`;

  // Detail-Bereich (wenn ein Mitarbeiter angeklickt wurde)
  let detailHtml = '';
  if (detailData && detailCleanerId) {
    const entries = detailData.entries || [];
    detailHtml = `
      <div class="card" style="margin-top:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h3 style="margin:0">${esc(detailData.cleanerName)} — ${monthLabel(currentMonth)}</h3>
          <button class="btn btn--primary btn--sm" id="btn-tt-add">+ Eintrag hinzufuegen</button>
        </div>
        <div style="margin-bottom:12px;font-size:14px">
          <strong>${detailData.totalHours}h</strong> gearbeitet
          ${detailData.contractHours ? ` von ${detailData.contractHours}h Vertrag` : ''}
          · ${detailData.workDays} Arbeitstage
        </div>
        ${entries.length === 0
          ? '<div class="text-muted">Keine Eintraege in diesem Monat.</div>'
          : `<table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="border-bottom:2px solid var(--color-border)">
                  <th style="text-align:left;padding:6px 8px">Datum</th>
                  <th style="text-align:left;padding:6px 8px">Ein</th>
                  <th style="text-align:left;padding:6px 8px">Aus</th>
                  <th style="text-align:left;padding:6px 8px">Pausen</th>
                  <th style="text-align:right;padding:6px 8px">Netto</th>
                  <th style="width:60px"></th>
                </tr>
              </thead>
              <tbody>
                ${entries.map(e => {
                  const d = new Date(e.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
                  const ci = e.clockIn ? new Date(e.clockIn).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—';
                  const co = e.clockOut ? new Date(e.clockOut).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—';
                  const breaks = (e.breaks || []).length;
                  const breakMins = (e.breaks || []).reduce((s, b) => {
                    if (!b.start || !b.end) return s;
                    return s + (new Date(b.end) - new Date(b.start)) / 60000;
                  }, 0);
                  const h = Math.floor((e.totalMinutes || 0) / 60);
                  const m = (e.totalMinutes || 0) % 60;
                  const statusIcon = e.status === 'completed' ? '' : (e.status === 'paused' ? '⏸' : '▶');
                  return `<tr style="border-bottom:1px solid var(--color-border)">
                    <td style="padding:6px 8px">${esc(d)} ${statusIcon}</td>
                    <td style="padding:6px 8px">${ci}</td>
                    <td style="padding:6px 8px">${co}</td>
                    <td style="padding:6px 8px">${breaks > 0 ? `${breaks}× (${Math.round(breakMins)} min)` : '—'}</td>
                    <td style="padding:6px 8px;text-align:right;font-weight:600">${h}:${String(m).padStart(2, '0')}</td>
                    <td style="padding:6px 8px;text-align:right">
                      <button class="btn btn--ghost btn--sm js-tt-edit" data-id="${esc(e.id)}" data-idx="${entries.indexOf(e)}" style="font-size:11px">✏</button>
                      <button class="btn btn--ghost btn--sm js-tt-delete" data-id="${esc(e.id)}" style="font-size:11px;color:var(--color-danger)">×</button>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>`
        }
      </div>
    `;
  }

  // Audit-Log
  const auditHtml = auditData.length > 0 ? `
    <div class="card" style="margin-top:20px">
      <h3 style="margin:0 0 12px">Audit-Protokoll <span class="text-muted" style="font-size:12px;font-weight:400">(letzte 20)</span></h3>
      <div style="display:flex;flex-direction:column;gap:4px;font-size:12px">
        ${auditData.map(a => {
          const ts = new Date(a.timestamp).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
          const actionLabel = { create: '➕ Erstellt', update: '✏ Geaendert', delete: '🗑 Geloescht' }[a.action] || a.action;
          const detail = a.details ? (a.details.date || a.details.cleanerId || '') : '';
          return `<div style="display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px solid var(--color-border)">
            <span class="text-muted" style="min-width:100px">${esc(ts)}</span>
            <span style="min-width:100px">${actionLabel}</span>
            <span class="text-muted" style="flex:1">${esc(detail)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  ` : '';

  root.innerHTML = renderPendingSection() + renderLiveStatus() + navHtml + overviewHtml + detailHtml + renderAbsenceSection() + auditHtml;
  bindEvents();

  // Review handlers (pending entries)
  document.querySelectorAll('.js-review').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/timetracking/admin/review/${btn.dataset.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: btn.dataset.decision })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Fehler'); return; }
        await refresh();
      } catch (err) { alert(err.message); }
    });
  });

  // Absence handlers
  document.getElementById('btn-add-absence')?.addEventListener('click', async () => {
    const cleanerId = document.getElementById('abs-cleaner')?.value;
    const fromDate = document.getElementById('abs-from')?.value;
    const toDate = document.getElementById('abs-to')?.value;
    const type = document.getElementById('abs-type')?.value;
    const note = document.getElementById('abs-note')?.value;
    if (!cleanerId || !fromDate || !toDate) { alert('Mitarbeiter + Von/Bis erforderlich'); return; }
    try {
      await fetch('/api/absences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cleanerId, fromDate, toDate, type, note }) });
      await refresh();
    } catch (err) { alert(err.message); }
  });

  document.querySelectorAll('.js-del-absence').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Abwesenheit loeschen?')) return;
      await fetch(`/api/absences/${btn.dataset.id}`, { method: 'DELETE' });
      await refresh();
    });
  });
}

function bindEvents() {
  document.getElementById('tt-prev')?.addEventListener('click', () => {
    currentMonth = prevMonth(currentMonth);
    detailData = null;
    detailCleanerId = null;
    refresh();
  });
  document.getElementById('tt-next')?.addEventListener('click', () => {
    currentMonth = nextMonth(currentMonth);
    detailData = null;
    detailCleanerId = null;
    refresh();
  });
  document.querySelectorAll('.js-tt-detail').forEach(card => {
    card.addEventListener('click', async () => {
      await loadDetail(card.dataset.cleaner);
      await loadAudit();
      render();
    });
  });

  document.getElementById('btn-tt-add')?.addEventListener('click', () => showEntryForm('add'));

  document.querySelectorAll('.js-tt-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      const entry = detailData && detailData.entries ? detailData.entries[idx] : null;
      if (entry) showEntryForm('edit', { ...entry, id: btn.dataset.id });
    });
  });

  document.querySelectorAll('.js-tt-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      adminDeleteEntry(btn.dataset.id);
    });
  });
}

async function refresh() {
  await Promise.all([loadOverview(), loadLive(), loadAbsences(), loadCleanersList(), loadPending()]);
  if (detailCleanerId) {
    await loadDetail(detailCleanerId);
    await loadAudit();
  }
  render();
}

async function init() {
  try {
    await Promise.all([loadOverview(), loadLive(), loadAbsences(), loadCleanersList(), loadPending()]);
    render();
    // Live-Status alle 30 Sekunden aktualisieren
    setInterval(async () => {
      await loadLive();
      render();
    }, 30000);
  } catch (err) {
    document.getElementById('tt-root').innerHTML = `<div class="empty-state"><h2 class="text-danger">Fehler</h2><p>${esc(err.message)}</p></div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
