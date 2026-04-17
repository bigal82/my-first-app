/**
 * Cleaner-Dashboard — /my
 *
 * Zeigt nur die dem eingeloggten Cleaner zugewiesenen Reinigungen.
 * Oben ein Mini-Gantt der betroffenen Wohnungen, darunter Karten
 * fuer jede Reinigung mit Status-Aktionen.
 */

function esc(val) {
  const d = document.createElement('div');
  d.textContent = String(val ?? '');
  return d.innerHTML;
}

let currentUser = null;
let myEvents = [];
let timeData = null;
let myAbsences = [];

async function loadMe() {
  const res = await fetch('/api/auth/me');
  currentUser = await res.json();
}

async function loadMyEvents() {
  // Server filtert jetzt auf assignedTo=me UND begrenzt auf daysAhead
  const res = await fetch('/api/cleaning/events?assignedTo=me');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  myEvents = await res.json();
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'long' });
}

function stateLabel(s) {
  return { open: 'Offen', assigned: 'Zugewiesen', done: 'Erledigt', cancelled: 'Storniert' }[s] || s;
}

function stateColor(s) {
  return { open: 'var(--color-warning)', assigned: 'var(--color-accent)', done: 'var(--color-success)', cancelled: 'var(--color-danger)' }[s] || '#666';
}

function canMarkDone(ev) {
  const co = new Date(ev.checkoutDate);
  co.setHours(10, 0, 0, 0); // Reinigung ab 10:00
  return new Date() >= co;
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

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=So
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // Montag
  return d;
}

function weekLabel(weekStart) {
  const now = new Date();
  const today = getWeekStart(now);
  const diff = Math.round((weekStart.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000));

  if (diff === 0) return 'Diese Woche';
  if (diff === 1) return 'Nächste Woche';
  if (diff === -1) return 'Letzte Woche';

  const von = weekStart.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const bis = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  if (diff > 0) return `In ${diff} Wochen (${von} – ${bis})`;
  return `${von} – ${bis}`;
}

function groupByWeek(events) {
  const groups = new Map();
  for (const e of events) {
    const ws = getWeekStart(new Date(e.checkoutDate));
    const key = ws.toISOString();
    if (!groups.has(key)) groups.set(key, { weekStart: ws, label: weekLabel(ws), events: [] });
    groups.get(key).events.push(e);
  }
  return Array.from(groups.values()).sort((a, b) => a.weekStart - b.weekStart);
}

async function markDone(eventId) {
  const res = await fetch(`/api/cleaning/event/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'done' })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Fehler');
    return;
  }
  await loadMyEvents();
  render();
}

async function loadAbsences() {
  try {
    const res = await fetch('/api/absences');
    if (res.ok) myAbsences = await res.json();
  } catch {}
}

async function loadTimeData() {
  try {
    const res = await fetch('/api/timetracking/me');
    if (res.ok) timeData = await res.json();
  } catch {}
}

async function timeAction(action) {
  try {
    const res = await fetch(`/api/timetracking/${action}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Fehler'); return; }
    await loadTimeData();
    render();
  } catch (err) { alert(err.message); }
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

function renderAbsenceWidget() {
  const typeLabel = { vacation: '🏖 Urlaub', sick: '🤒 Krank', unavailable: '❌ Nicht verfuegbar' };
  const typeColor = { vacation: 'var(--color-accent)', sick: 'var(--color-danger)', unavailable: 'var(--color-text-muted)' };
  const future = myAbsences.filter(a => a.toDate >= new Date().toISOString().slice(0, 10));

  const listHtml = future.length > 0 ? future.map(a => {
    const from = new Date(a.fromDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const to = new Date(a.toDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--color-border);font-size:12px">
      <span style="color:${typeColor[a.type] || '#666'}">${typeLabel[a.type] || a.type}</span>
      <span>${from} – ${to}</span>
      ${a.note ? `<span class="text-muted">${esc(a.note)}</span>` : ''}
      <button class="btn btn--ghost btn--sm js-delete-absence" data-id="${esc(a.id)}" style="margin-left:auto;color:var(--color-danger);font-size:11px">×</button>
    </div>`;
  }).join('') : '<div class="text-muted" style="font-size:12px">Keine eingetragenen Abwesenheiten.</div>';

  return `
    <div class="card" style="margin-bottom:16px;padding:16px">
      <strong style="font-size:13px">Abwesenheiten</strong>
      <div style="margin:8px 0">${listHtml}</div>
      <details>
        <summary style="cursor:pointer;font-size:12px;color:var(--color-accent)">+ Abwesenheit eintragen</summary>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-end">
          <div class="field" style="width:120px"><label>Von</label><input id="abs-from" type="date" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" /></div>
          <div class="field" style="width:120px"><label>Bis</label><input id="abs-to" type="date" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" /></div>
          <div class="field" style="width:140px"><label>Typ</label><select id="abs-type" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px"><option value="vacation">Urlaub</option><option value="sick">Krank</option><option value="unavailable">Nicht verfuegbar</option></select></div>
          <div class="field" style="flex:1;min-width:100px"><label>Notiz</label><input id="abs-note" type="text" placeholder="optional" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px;width:100%" /></div>
          <button class="btn btn--primary btn--sm" id="btn-add-absence">Eintragen</button>
        </div>
      </details>
    </div>
  `;
}

function renderCalendarWidget() {
  if (!timeData || !timeData.calToken) return '';
  const proto = location.protocol;
  const host = location.host;
  const url = `${proto}//${host}/api/cleaning/calendar/${timeData.calToken}.ics`;
  // webcal:// Protokoll fuer iPhone/Android Kalender-Abo
  const webcalUrl = url.replace(/^https?:/, 'webcal:');

  return `
    <div class="my-cal-widget">
      <div class="my-cal-widget__icon">📅</div>
      <div class="my-cal-widget__body">
        <strong>Reinigungskalender abonnieren</strong>
        <div class="text-muted" style="font-size:11px;margin-top:2px">Synchronisiert automatisch mit deinem Handy-Kalender</div>
      </div>
      <a href="${esc(webcalUrl)}" class="btn btn--primary btn--sm" id="btn-cal-subscribe">Kalender hinzufuegen</a>
      <button class="btn btn--ghost btn--sm" id="btn-cal-copy" title="URL kopieren">📋</button>
    </div>
  `;
}

function renderTimeWidget() {
  if (!timeData) return '';
  const active = timeData.active;
  const month = timeData.month || {};
  const lastMonth = timeData.lastMonth || {};
  const contractH = month.contractHours || 0;
  const workedH = month.totalHours || 0;
  const percent = contractH > 0 ? Math.min(100, Math.round(workedH / contractH * 100)) : 0;
  const barColor = percent >= 100 ? 'var(--color-success)' : (percent >= 75 ? 'var(--color-warning)' : 'var(--color-accent)');
  const rate = month.hourlyRate ?? 15;
  const monthEarnings = (workedH * rate).toFixed(2);
  const lastMonthEarnings = ((lastMonth.totalHours || 0) * rate).toFixed(2);

  // Heute: laufende Session + bereits abgeschlossene Sessions von heute.
  // Pending (noch nicht genehmigt) und rejected NICHT mitzaehlen.
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayEntries = (month.entries || []).filter(e =>
    e.date === todayStr && (e.status === 'completed' || e.status === 'active' || e.status === 'paused')
  );
  let todayMinutes = todayEntries.reduce((s, e) => s + (e.totalMinutes || 0), 0);
  if (active && active.currentMinutes) todayMinutes += active.currentMinutes;
  const todayH = Math.floor(todayMinutes / 60);
  const todayM = todayMinutes % 60;

  let statusHtml = '';
  if (!active) {
    statusHtml = `<button class="btn btn--primary btn--sm" id="btn-clock-in">▶ Einstempeln</button>`;
  } else if (active.status === 'active') {
    statusHtml = `
      <span id="live-clock" style="font-size:24px;font-weight:700;color:var(--color-success);font-variant-numeric:tabular-nums;letter-spacing:1px"></span>
      <button class="btn btn--ghost btn--sm" id="btn-pause">⏸ Pause</button>
      <button class="btn btn--ghost btn--sm" id="btn-clock-out" style="color:var(--color-danger)">⏹ Ausstempeln</button>
    `;
  } else if (active.status === 'paused') {
    statusHtml = `
      <span id="live-clock" style="font-size:24px;font-weight:700;color:var(--color-warning);font-variant-numeric:tabular-nums;letter-spacing:1px;opacity:0.7"></span>
      <span style="font-size:12px;color:var(--color-warning)">⏸</span>
      <button class="btn btn--primary btn--sm" id="btn-resume">▶ Weiter</button>
      <button class="btn btn--ghost btn--sm" id="btn-clock-out" style="color:var(--color-danger)">⏹ Ausstempeln</button>
    `;
  }

  // Ausstehende Nachtraege
  const pendingEntries = (month.entries || []).filter(e => e.status === 'pending');
  const pendingHtml = pendingEntries.length > 0
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border)">
        <span class="text-warning" style="font-size:11px">⏳ ${pendingEntries.length} Nachtrag${pendingEntries.length > 1 ? 'e' : ''} warten auf Genehmigung</span>
       </div>`
    : '';

  return `
    <div class="my-time-widget">
      <div class="my-time-widget__clock">
        <div class="my-time-widget__label">Zeiterfassung</div>
        <div class="my-time-widget__actions">${statusHtml}</div>
        <div class="my-time-today">
          <span class="my-time-today__label">Heute</span>
          <span class="my-time-today__value">${todayH}:${String(todayM).padStart(2, '0')}h</span>
        </div>
      </div>
      <div class="my-time-widget__stats">
        <div class="my-time-stat">
          <span class="my-time-stat__label">Dieser Monat</span>
          <span class="my-time-stat__value">${workedH}h${contractH ? ` / ${contractH}h` : ''}</span>
          ${contractH ? `
            <div class="my-time-bar">
              <div class="my-time-bar__fill" style="width:${percent}%;background:${barColor}"></div>
            </div>
            <span class="my-time-stat__percent">${percent}%</span>
          ` : ''}
          <span class="my-time-stat__earnings">${monthEarnings} € brutto</span>
        </div>
        <div class="my-time-stat">
          <span class="my-time-stat__label">Letzter Monat</span>
          <span class="my-time-stat__value">${lastMonth.totalHours || 0}h · ${lastMonthEarnings} €</span>
        </div>
        <div class="my-time-stat">
          <span class="my-time-stat__label">Arbeitstage diesen Monat</span>
          <span class="my-time-stat__value">${month.workDays || 0}</span>
        </div>
        ${pendingHtml}
        <details style="margin-top:8px">
          <summary style="cursor:pointer;font-size:12px;color:var(--color-accent)">+ Zeit nachtragen</summary>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-end">
            <div class="field" style="width:120px"><label>Datum</label><input id="manual-date" type="date" value="${new Date().toISOString().slice(0,10)}" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" /></div>
            <div class="field" style="width:90px"><label>Von</label><input id="manual-from" type="time" value="08:00" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" /></div>
            <div class="field" style="width:90px"><label>Bis</label><input id="manual-to" type="time" value="16:00" style="padding:4px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" /></div>
            <div class="field" style="flex:1;min-width:100px"><label>Notiz</label><input id="manual-note" type="text" placeholder="z.B. vergessen zu stempeln" style="padding:4px;width:100%;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:12px" /></div>
            <button class="btn btn--primary btn--sm" id="btn-submit-manual">Einreichen</button>
          </div>
          <div class="text-muted" style="font-size:10px;margin-top:4px">Wird nach Einreichung vom Admin geprueft und freigegeben.</div>
        </details>
      </div>
    </div>
  `;
}

function render() {
  const root = document.getElementById('my-root');
  const name = currentUser?.displayName || currentUser?.username || '';

  // Sortieren: offene/zugewiesene zuerst (chronologisch), dann erledigte
  const stateOrder = { open: 0, assigned: 0, done: 2, cancelled: 3 };
  const sorted = [...myEvents].sort((a, b) => {
    const oa = stateOrder[a.state] ?? 1;
    const ob = stateOrder[b.state] ?? 1;
    if (oa !== ob) return oa - ob;
    return new Date(a.checkoutDate) - new Date(b.checkoutDate);
  });

  // Heute erledigte bleiben in den Wochen-Karten (nicht ins Archiv).
  // Nur aeltere erledigte + stornierte kommen ins Archiv unten.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function isToday(ev) {
    const d = new Date(ev.checkoutDate);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  }

  const pending = sorted.filter(e => {
    if (e.state === 'cancelled') return false;
    if (e.state === 'done' && !isToday(e)) return false; // aeltere erledigte → Archiv
    return true; // open, assigned, oder heute-erledigt → bleibt in Wochen-Karten
  });
  const completed = sorted.filter(e => {
    if (e.state === 'cancelled') return true;
    if (e.state === 'done' && !isToday(e)) return true; // nur aeltere erledigte
    return false;
  });

  // Pending nach Wochen gruppieren
  const weekGroups = groupByWeek(pending);

  root.innerHTML = `
    <div class="my-header">
      <div>
        <h1 style="margin:0">Hallo ${esc(name)}</h1>
        <p class="text-muted" style="margin-top:4px">${pending.length} offene Reinigung${pending.length !== 1 ? 'en' : ''}</p>
      </div>
      <button class="btn btn--ghost btn--sm" id="btn-logout">Abmelden</button>
    </div>

    ${renderTimeWidget()}
    ${renderCalendarWidget()}
    ${renderAbsenceWidget()}

    ${pending.length === 0 && completed.length === 0
      ? '<div class="empty-state" style="margin-top:32px"><h2>Keine Reinigungen</h2><p>Dir wurden noch keine Reinigungen zugewiesen.</p></div>'
      : ''}

    ${weekGroups.map(g => `
      <h3 class="my-week-header">${esc(g.label)}</h3>
      <div class="my-cards">
        ${g.events.map(e => renderCard(e, false)).join('')}
      </div>
    `).join('')}

    ${completed.length > 0 ? `
      <h3 class="my-week-header" style="opacity:0.5">Erledigt / Storniert</h3>
      <div class="my-cards my-cards--dimmed">
        ${completed.map(e => renderCard(e, true)).join('')}
      </div>
    ` : ''}
  `;

  // Bindings
  document.getElementById('btn-logout')?.addEventListener('click', doLogout);
  document.getElementById('btn-add-absence')?.addEventListener('click', async () => {
    const fromDate = document.getElementById('abs-from')?.value;
    const toDate = document.getElementById('abs-to')?.value;
    const type = document.getElementById('abs-type')?.value;
    const note = document.getElementById('abs-note')?.value;
    if (!fromDate || !toDate) { alert('Von/Bis Datum erforderlich'); return; }
    try {
      const res = await fetch('/api/absences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromDate, toDate, type, note }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Fehler'); return; }
      await loadAbsences();
      render();
    } catch (err) { alert(err.message); }
  });

  document.querySelectorAll('.js-delete-absence').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Abwesenheit loeschen?')) return;
      await fetch(`/api/absences/${btn.dataset.id}`, { method: 'DELETE' });
      await loadAbsences();
      render();
    });
  });

  document.getElementById('btn-cal-copy')?.addEventListener('click', () => {
    if (!timeData || !timeData.calToken) return;
    const url = `${location.protocol}//${location.host}/api/cleaning/calendar/${timeData.calToken}.ics`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('btn-cal-copy');
      if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '📋'; }, 2000); }
    }).catch(() => prompt('URL kopieren:', url));
  });

  document.getElementById('btn-submit-manual')?.addEventListener('click', async () => {
    const date = document.getElementById('manual-date')?.value;
    const fromTime = document.getElementById('manual-from')?.value;
    const toTime = document.getElementById('manual-to')?.value;
    const note = document.getElementById('manual-note')?.value;
    if (!date || !fromTime || !toTime) { alert('Datum + Von + Bis erforderlich'); return; }
    try {
      const res = await fetch('/api/timetracking/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          clockIn: `${date}T${fromTime}:00.000Z`,
          clockOut: `${date}T${toTime}:00.000Z`,
          note
        })
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Fehler'); return; }
      alert('Eingereicht! Wird vom Admin geprueft.');
      await loadTimeData();
      render();
    } catch (err) { alert(err.message); }
  });

  document.getElementById('btn-clock-in')?.addEventListener('click', async () => { await timeAction('clock-in'); startLiveClock(); });
  document.getElementById('btn-clock-out')?.addEventListener('click', async () => { await timeAction('clock-out'); if (clockInterval) clearInterval(clockInterval); });
  document.getElementById('btn-pause')?.addEventListener('click', async () => { await timeAction('pause'); startLiveClock(); });
  document.getElementById('btn-resume')?.addEventListener('click', async () => { await timeAction('resume'); startLiveClock(); });
  document.querySelectorAll('.js-mark-done').forEach(btn => {
    btn.addEventListener('click', () => markDone(btn.dataset.id));
  });
  document.querySelectorAll('.js-open-detail').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = '/cleaning/event/' + encodeURIComponent(btn.dataset.id);
    });
  });
}

function renderCardTasks(ev) {
  const autoTasks = (ev.autoTasks || []);
  const manualTasks = (ev.tasks || []).filter(t => !t.done);
  const allTasks = [...autoTasks, ...manualTasks];
  if (allTasks.length === 0) return '';

  return `
    <div class="my-card__tasks">
      ${allTasks.map(t => `
        <div class="my-card__task ${t.type === 'auto' ? 'my-card__task--auto' : ''}">
          <span class="my-card__task-icon">${t.type === 'auto' ? '⚡' : '☐'}</span>
          <span>${esc(t.text)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderCard(ev, dimmed) {
  const guest = stripAptName(ev.guest, ev.apartmentName);
  const coDate = formatDate(ev.checkoutDate);
  const canDone = canMarkDone(ev);
  const isCancelled = ev.state === 'cancelled';
  const isDone = ev.state === 'done';
  const isFuture = !canDone;

  let cardClass = 'my-card';
  if (dimmed) cardClass += ' my-card--dimmed';
  if (isCancelled) cardClass += ' my-card--cancelled';
  if (isDone && !dimmed) cardClass += ' my-card--done-today';

  let actionHtml = '';
  if (isDone) {
    actionHtml = '<span style="color:var(--color-success);font-weight:600;font-size:13px">✓ Erledigt</span>';
  } else if (isCancelled) {
    actionHtml = '';
  } else if (isFuture) {
    actionHtml = `<span class="text-muted" style="font-size:11px">Erst am ${esc(coDate)} markierbar</span>`;
  } else {
    actionHtml = `<button class="btn btn--primary btn--sm js-mark-done" data-id="${esc(ev.id)}">✓ Erledigt</button>`;
  }

  return `
    <div class="${cardClass}">
      <div class="my-card__header">
        <span class="my-card__apt">${esc(ev.apartmentName)}</span>
        <span class="my-card__badge" style="background:${stateColor(ev.state)}">${stateLabel(ev.state)}</span>
      </div>
      <div class="my-card__body">
        <div class="my-card__row">
          <span class="text-muted">Abreise</span>
          <strong>${esc(coDate)}</strong>
        </div>
        <div class="my-card__row">
          <span class="text-muted">Gast</span>
          <span>${esc(guest)}</span>
        </div>
        <div class="my-card__row">
          <span class="text-muted">Zeit</span>
          <span>${esc(ev.checkoutTime || '10:00')} – ${esc(ev.checkinTime || '16:00')} Uhr</span>
        </div>
      </div>
      ${renderCardTasks(ev)}
      <div class="my-card__actions">
        ${actionHtml}
        <button class="btn btn--ghost btn--sm js-open-detail" data-id="${esc(ev.id)}">Details</button>
      </div>
      ${isCancelled ? '<div class="my-card__cancelled-notice">Buchung wurde storniert</div>' : ''}
    </div>
  `;
}

// Live-Uhr: tickt jede Sekunde wenn eingestempelt
let clockInterval = null;

function startLiveClock() {
  if (clockInterval) clearInterval(clockInterval);
  tickClock(); // sofort einmal
  clockInterval = setInterval(tickClock, 1000);
}

function tickClock() {
  const el = document.getElementById('live-clock');
  if (!el || !timeData || !timeData.active) return;
  const active = timeData.active;

  // Netto-Sekunden berechnen (wie server, aber client-seitig live)
  const now = Date.now();
  const start = new Date(active.clockIn).getTime();
  let totalMs = now - start;
  for (const b of (active.breaks || [])) {
    const bStart = new Date(b.start).getTime();
    const bEnd = b.end ? new Date(b.end).getTime() : now;
    totalMs -= (bEnd - bStart);
  }
  totalMs = Math.max(0, totalMs);

  const totalSec = Math.floor(totalMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  el.textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function init() {
  try {
    await loadMe();
    await Promise.all([loadMyEvents(), loadTimeData(), loadAbsences()]);
    render();
    startLiveClock();
  } catch (err) {
    document.getElementById('my-root').innerHTML = `
      <div class="empty-state">
        <h2 class="text-danger">Fehler</h2>
        <p>${esc(err.message)}</p>
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
