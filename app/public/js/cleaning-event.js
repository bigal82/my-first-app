/**
 * Reinigungsevent-Detailseite
 *
 * URL: /cleaning/event/:eventId
 * Zeigt Eventdetails, Mitarbeiter-Zuweisung, Status-Aktionen.
 */

function esc(val) {
  const d = document.createElement('div');
  d.textContent = String(val ?? '');
  return d.innerHTML;
}

function getEventIdFromUrl() {
  const parts = window.location.pathname.split('/');
  // /cleaning/event/:id
  const idx = parts.indexOf('event');
  return idx !== -1 && parts[idx + 1] ? decodeURIComponent(parts[idx + 1]) : null;
}

let eventData = null;
let cleaners = [];
let currentUser = null;

async function loadEvent() {
  const id = getEventIdFromUrl();
  if (!id) throw new Error('Keine Event-ID in URL');
  const res = await fetch(`/api/cleaning/event/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  eventData = await res.json();
}

async function loadCleaners() {
  const res = await fetch('/api/integrations/cleaners');
  if (!res.ok) return;
  cleaners = await res.json();
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function stripAptName(title, aptName) {
  if (!title || !aptName) return title || '';
  const parts = aptName.match(/[\p{L}\p{N}]+/gu) || [];
  if (parts.length === 0) return title;
  const chunk = parts.map(p => p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('[\\s\\W]*');
  let cleaned = title.replace(new RegExp(`[\\s\\-–—,·|()\\[\\]]*${chunk}[\\s\\-–—,·|()\\[\\]]*`, 'giu'), ' ').replace(/\s{2,}/g, ' ').trim();
  cleaned = cleaned.replace(/^[-–—,·|()\[\]\s]+|[-–—,·|()\[\]\s]+$/g, '').trim();
  const sepRegex = /\s+[-–—·|]\s+|,\s+/g;
  let lastMatch = null, m;
  while ((m = sepRegex.exec(cleaned)) !== null) lastMatch = { index: m.index, end: sepRegex.lastIndex };
  if (lastMatch) { const tail = cleaned.slice(lastMatch.end); if (/\d/.test(tail)) cleaned = cleaned.slice(0, lastMatch.index).trim(); }
  return cleaned || title;
}

function stateLabel(state) {
  const labels = { open: 'Offen', assigned: 'Zugewiesen', done: 'Erledigt', cancelled: 'Storniert' };
  return labels[state] || state;
}

function stateColor(state) {
  const colors = { open: 'var(--color-warning)', assigned: 'var(--color-accent)', done: 'var(--color-success)', cancelled: 'var(--color-danger)' };
  return colors[state] || 'var(--color-text-muted)';
}

function canMarkDone() {
  if (!eventData) return false;
  const coDate = new Date(eventData.checkoutDate);
  coDate.setHours(10, 0, 0, 0); // Reinigung ab 10:00
  return new Date() >= coDate;
}

async function saveEvent(patch) {
  const id = getEventIdFromUrl();
  const res = await fetch(`/api/cleaning/event/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

function render() {
  const root = document.getElementById('event-root');
  if (!eventData) {
    root.innerHTML = '<div class="empty-state"><h2>Event nicht gefunden</h2><p><a href="/cleaning">← Zurück</a></p></div>';
    return;
  }

  const e = eventData;
  const guest = stripAptName(e.guest, e.apartmentName);
  const coDate = formatDate(e.checkoutDate);
  const assignedCleaner = cleaners.find(c => c.id === e.assignedTo);
  const isDone = e.state === 'done';
  const isCancelled = e.state === 'cancelled';
  const canDone = canMarkDone();
  const isAdmin = currentUser && currentUser.role === 'admin';

  // Admins auch als Zuweisungsoption anbieten (fuer Notfaelle)
  let allAssignees = [...cleaners];
  if (isAdmin && currentUser) {
    // Admin selbst als Option hinzufuegen falls nicht schon als Cleaner drin
    const adminAlreadyCleaner = cleaners.some(c => c.id === currentUser.cleanerId || c.id === currentUser.id);
    if (!adminAlreadyCleaner) {
      allAssignees.push({ id: currentUser.id, name: `${currentUser.displayName || currentUser.username} (Admin)` });
    }
  }
  const cleanerOptions = allAssignees.map(c =>
    `<option value="${esc(c.id)}" ${c.id === e.assignedTo ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');

  root.innerHTML = `
    <div style="margin-bottom:16px">
      <a href="/cleaning" class="btn btn--ghost btn--sm">← Reinigungsplan</a>
    </div>

    <div class="card" style="max-width:600px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h2 style="margin:0">Reinigung</h2>
        <span style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;color:#fff;background:${stateColor(e.state)}">
          ${esc(stateLabel(e.state))}
        </span>
      </div>

      ${isCancelled ? `
        <div style="padding:12px;background:rgba(224,82,82,0.15);border-left:3px solid var(--color-danger);border-radius:var(--radius-sm);margin-bottom:16px">
          <strong style="color:var(--color-danger)">Buchung storniert</strong>
          <div class="text-muted" style="font-size:12px;margin-top:4px">
            ${assignedCleaner ? `${esc(assignedCleaner.name)} war zugewiesen — bitte informieren!` : 'Kein Mitarbeiter war zugewiesen.'}
          </div>
        </div>
      ` : ''}

      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td class="text-muted" style="padding:8px 16px 8px 0;width:140px">Wohnung</td><td><strong>${esc(e.apartmentName)}</strong> ${e.apartmentLocation ? `<span class="text-muted">(${esc(e.apartmentLocation)})</span>` : ''}</td></tr>
        <tr><td class="text-muted" style="padding:8px 16px 8px 0">Gast</td><td>${esc(guest)}</td></tr>
        <tr><td class="text-muted" style="padding:8px 16px 8px 0">Abreise</td><td>${esc(coDate)}</td></tr>
        <tr><td class="text-muted" style="padding:8px 16px 8px 0">Reinigungszeit</td><td>${esc(e.checkoutTime || '10:00')} – ${esc(e.checkinTime || '16:00')} Uhr</td></tr>
        ${e.completedAt ? `<tr><td class="text-muted" style="padding:8px 16px 8px 0">Erledigt am</td><td>${formatDateTime(e.completedAt)}</td></tr>` : ''}
        ${e.cancelledAt ? `<tr><td class="text-muted" style="padding:8px 16px 8px 0">Storniert am</td><td>${formatDateTime(e.cancelledAt)}</td></tr>` : ''}
        <tr><td class="text-muted" style="padding:8px 16px 8px 0">Erstellt</td><td class="text-muted">${formatDateTime(e.createdAt)}</td></tr>
      </table>

      ${!isCancelled ? `
        ${isAdmin ? `
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--color-border)">
            <label style="font-size:12px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Mitarbeiter zuweisen</label>
            <div style="display:flex;gap:8px;align-items:center">
              <select id="cleaner-select" style="flex:1;padding:8px 12px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px;font-family:inherit">
                <option value="">— nicht zugewiesen —</option>
                ${cleanerOptions}
              </select>
              <button class="btn btn--primary btn--sm" id="btn-assign">Zuweisen</button>
            </div>
          </div>
        ` : ''}

        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          ${!isDone ? `
            <button class="btn btn--primary btn--sm" id="btn-done" ${!canDone ? 'disabled title="Erst ab 10:00 am Abreisetag moeglich"' : ''}>
              ✓ Als erledigt markieren
            </button>
          ` : `
            ${isAdmin ? '<button class="btn btn--ghost btn--sm" id="btn-reopen">↩ Wieder oeffnen</button>' : '<span style="color:var(--color-success);font-weight:600">✓ Erledigt</span>'}
          `}
        </div>
        ${!canDone && !isDone ? `<div class="text-muted" style="font-size:11px;margin-top:6px">Kann erst am ${esc(coDate)} ab 10:00 Uhr als erledigt markiert werden.</div>` : ''}
      ` : `
        ${isAdmin ? `
          <div style="margin-top:16px">
            <button class="btn btn--ghost btn--sm" id="btn-reopen">↩ Wieder oeffnen (Stornierung aufheben)</button>
          </div>
        ` : ''}
      `}

      <div id="event-msg" style="margin-top:12px;font-size:13px"></div>

      <!-- Aufgabenliste -->
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--color-border)">
        <h3 style="margin:0 0 12px;font-size:14px">Aufgaben</h3>

        ${(e.autoTasks || []).length > 0 ? `
          <div style="margin-bottom:12px">
            <div class="text-muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Automatisch (aus Geraete-Status)</div>
            ${(e.autoTasks || []).map(t => `
              <div class="task-row task-row--auto">
                <span class="task-row__icon">⚡</span>
                <span class="task-row__text">${esc(t.text)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div id="manual-tasks">
          ${(e.tasks || []).length > 0 ? (e.tasks || []).map(t => `
            <div class="task-row ${t.done ? 'task-row--done' : ''}">
              <button class="task-row__check js-toggle-task" data-task-id="${esc(t.id)}" title="${t.done ? 'Wieder oeffnen' : 'Abhaken'}">${t.done ? '✓' : '○'}</button>
              <span class="task-row__text ${t.done ? 'task-row__text--done' : ''}">${esc(t.text)}</span>
              <button class="task-row__delete js-delete-task" data-task-id="${esc(t.id)}" title="Loeschen">×</button>
            </div>
          `).join('') : '<div class="text-muted" style="font-size:12px">Keine manuellen Aufgaben.</div>'}
        </div>

        <div style="display:flex;gap:8px;margin-top:10px">
          <input type="text" id="new-task-text" placeholder="Neue Aufgabe…" style="flex:1;padding:8px 12px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:13px;font-family:inherit" />
          <button class="btn btn--primary btn--sm" id="btn-add-task">+</button>
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function bindEvents() {
  const msgEl = document.getElementById('event-msg');

  document.getElementById('btn-assign')?.addEventListener('click', async () => {
    const val = document.getElementById('cleaner-select').value;
    try {
      await saveEvent({ assignedTo: val || null });
      await loadEvent();
      render();
    } catch (err) {
      msgEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    }
  });

  document.getElementById('btn-done')?.addEventListener('click', async () => {
    try {
      await saveEvent({ state: 'done' });
      await loadEvent();
      render();
    } catch (err) {
      msgEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    }
  });

  document.getElementById('btn-reopen')?.addEventListener('click', async () => {
    try {
      await saveEvent({ state: 'open', assignedTo: null });
      await loadEvent();
      render();
    } catch (err) {
      msgEl.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    }
  });

  // ── Tasks ──
  const eventId = getEventIdFromUrl();

  document.getElementById('btn-add-task')?.addEventListener('click', async () => {
    const input = document.getElementById('new-task-text');
    const text = input.value.trim();
    if (!text) return;
    try {
      await fetch(`/api/cleaning/event/${encodeURIComponent(eventId)}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      input.value = '';
      await loadEvent();
      render();
    } catch (err) { alert(err.message); }
  });

  // Enter-Taste im Task-Input
  document.getElementById('new-task-text')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btn-add-task')?.click();
    }
  });

  document.querySelectorAll('.js-toggle-task').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await fetch(`/api/cleaning/event/${encodeURIComponent(eventId)}/tasks/${btn.dataset.taskId}`, { method: 'PUT' });
        await loadEvent();
        render();
      } catch (err) { alert(err.message); }
    });
  });

  document.querySelectorAll('.js-delete-task').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await fetch(`/api/cleaning/event/${encodeURIComponent(eventId)}/tasks/${btn.dataset.taskId}`, { method: 'DELETE' });
        await loadEvent();
        render();
      } catch (err) { alert(err.message); }
    });
  });
}

async function loadMe() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) currentUser = await res.json();
  } catch {}
}

async function init() {
  try {
    await Promise.all([loadEvent(), loadCleaners(), loadMe()]);
    render();
  } catch (err) {
    document.getElementById('event-root').innerHTML = `
      <div class="empty-state">
        <h2 class="text-danger">Fehler</h2>
        <p>${esc(err.message)}</p>
        <p><a href="/cleaning">← Zurueck zum Reinigungsplan</a></p>
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
