/**
 * Reinigungsplan – Gantt-Timeline
 *
 * Zeigt alle Wohnungen als Zeilen, Tage als Spalten, Buchungen als farbige
 * Bloecke und Reinigungsfenster als markierte Luecken dazwischen.
 *
 * Farb-Schema Reinigungsfenster:
 *   < 3h  → rot   (kritisch eng)
 *   3-5h  → gelb  (machbar aber knapp)
 *   > 5h  → gruen (komfortabel)
 *
 * Status: open → planned → done (Klick-Zyklus auf Reinigungsfenster)
 */

function esc(val) {
  const d = document.createElement('div');
  d.textContent = String(val ?? '');
  return d.innerHTML;
}

// ── State ──────────────────────────────────────────────────────────────────

let timelineData = null;
let viewFrom = new Date();
let viewTo = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;

let daysAhead = 21;

async function loadSettings() {
  try {
    const res = await fetch('/api/integrations');
    if (!res.ok) return;
    const data = await res.json();
    if (data.dashboard && data.dashboard.cleaningDaysAhead) {
      daysAhead = data.dashboard.cleaningDaysAhead;
    }
  } catch {}
}

function initDates() {
  const now = new Date();
  viewFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
  viewTo = new Date(viewFrom.getTime() + (daysAhead + 2) * DAY_MS);
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// ── API ────────────────────────────────────────────────────────────────────

// Farbpalette fuer Mitarbeiter — stabile Zuordnung per Name
// Admin bekommt immer Neon-Pink
const ADMIN_COLOR = '#ff2d9b';
const CLEANER_COLORS = [
  '#4f72ff', '#e05252', '#34c97b', '#f5a623',
  '#8f54c9', '#1fb2c7', '#6c8a99', '#7c5cbf'
];
const cleanerColorMap = new Map();
let colorIdx = 0;

function cleanerColor(name) {
  if (!name) return null;
  if (!cleanerColorMap.has(name)) {
    cleanerColorMap.set(name, CLEANER_COLORS[colorIdx % CLEANER_COLORS.length]);
    colorIdx++;
  }
  return cleanerColorMap.get(name);
}

function cleanerColorWithAdmin(name, isAdmin) {
  if (isAdmin) return ADMIN_COLOR;
  return cleanerColor(name);
}

function shortName(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return parts[0][0] + parts[1][0]; // "Maria Schmidt" → "MS"
  return name.slice(0, 2); // "Alex" → "Al"
}

let absenceData = [];
let cleanerList = [];

async function loadTimeline() {
  const res = await fetch(`/api/cleaning/timeline?from=${isoDate(viewFrom)}&to=${isoDate(viewTo)}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  timelineData = await res.json();
}

async function loadAbsences() {
  try {
    const res = await fetch(`/api/absences?from=${isoDate(viewFrom)}&to=${isoDate(viewTo)}`);
    if (res.ok) absenceData = await res.json();
  } catch {}
}

async function loadCleaners() {
  try {
    const res = await fetch('/api/integrations/cleaners');
    if (res.ok) cleanerList = await res.json();
  } catch {}
}

// setCleaningState entfernt — Status wird jetzt auf der Detailseite geaendert

// ── Helpers ────────────────────────────────────────────────────────────────

function daysBetween(from, to) {
  const days = [];
  const d = new Date(from);
  while (d <= to) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function dayOffset(date, from) {
  return (date.getTime() - from.getTime()) / DAY_MS;
}

function formatDayHeader(d) {
  const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return `<span class="tl-day-name">${weekdays[d.getDay()]}</span><span class="tl-day-num">${d.getDate()}</span>`;
}

function formatMonthLabel(d) {
  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function stateIcon(state) {
  if (state === 'done') return '✓';
  if (state === 'planned') return '⏱';
  return '🧹';
}

// nextState entfernt — Status wird jetzt auf der Detailseite geaendert

function stripAptName(title, aptName) {
  if (!title || !aptName) return title || '';
  const parts = aptName.match(/[\p{L}\p{N}]+/gu) || [];
  if (parts.length === 0) return title;
  const chunk = parts
    .map(p => p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))
    .join('[\\s\\W]*');
  const token = new RegExp(`[\\s\\-–—,·|()\\[\\]]*${chunk}[\\s\\-–—,·|()\\[\\]]*`, 'giu');
  let cleaned = title.replace(token, ' ').replace(/\s{2,}/g, ' ').trim();
  cleaned = cleaned.replace(/^[-–—,·|()\[\]\s]+|[-–—,·|()\[\]\s]+$/g, '').trim();
  // Smoobu fallback
  const sepRegex = /\s+[-–—·|]\s+|,\s+/g;
  let lastMatch = null, m;
  while ((m = sepRegex.exec(cleaned)) !== null) lastMatch = { index: m.index, end: sepRegex.lastIndex };
  if (lastMatch) {
    const tail = cleaned.slice(lastMatch.end);
    if (/\d/.test(tail)) cleaned = cleaned.slice(0, lastMatch.index).trim();
  }
  return cleaned || title;
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  const root = document.getElementById('cleaning-root');
  if (!timelineData || !timelineData.apartments) {
    root.innerHTML = '<div class="empty-state"><h2>Keine Daten</h2></div>';
    return;
  }

  const days = daysBetween(viewFrom, viewTo);
  const totalDays = days.length;
  const apts = timelineData.apartments;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Navigation
  const navHtml = `
    <div class="tl-nav">
      <button class="btn btn--ghost btn--sm" id="tl-prev">← Früher</button>
      <span class="tl-nav__range">${isoDate(viewFrom)} – ${isoDate(viewTo)}</span>
      <button class="btn btn--ghost btn--sm" id="tl-next">Später →</button>
      <button class="btn btn--ghost btn--sm" id="tl-today">Heute</button>
      <button class="btn btn--ghost btn--sm" id="tl-sync" title="iCal-Feeds jetzt abgleichen">↻ Sync</button>
    </div>
  `;

  // Legende
  // Mitarbeiter-Farben aus den aktuellen Daten sammeln
  const assignedPeople = new Map(); // name → isAdmin
  if (timelineData) {
    for (const apt of apts) {
      for (const w of apt.cleaningWindows) {
        if (w.assignedName) assignedPeople.set(w.assignedName, w.isAdmin || false);
      }
    }
  }
  const cleanerLegend = Array.from(assignedPeople.entries()).map(([name, isAdmin]) =>
    `<span class="tl-legend__item"><span class="tl-dot" style="background:${cleanerColorWithAdmin(name, isAdmin)}"></span> ${esc(name)}${isAdmin ? ' (Admin)' : ''}</span>`
  ).join('');

  const legendHtml = `
    <div class="tl-legend">
      <span class="tl-legend__item"><span class="tl-dot tl-dot--booking"></span> Aufenthalt</span>
      <span class="tl-legend__item"><span class="tl-dot" style="background:rgba(245,166,35,0.75)"></span> 🧹 Offen</span>
      <span class="tl-legend__item"><span class="tl-dot" style="background:rgba(52,201,123,0.55)"></span> ✓ Erledigt</span>
      ${cleanerLegend}
    </div>
  `;

  // Month headers
  let monthHtml = '';
  let currentMonth = -1;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (d.getMonth() !== currentMonth) {
      currentMonth = d.getMonth();
      let span = 0;
      for (let j = i; j < days.length && days[j].getMonth() === currentMonth; j++) span++;
      monthHtml += `<div class="tl-month" style="grid-column:span ${span}">${esc(formatMonthLabel(d))}</div>`;
    }
  }

  // Day headers
  const dayHeaders = days.map((d, i) => {
    const isToday = d.getTime() === today.getTime();
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    let cls = 'tl-day-header';
    if (isToday) cls += ' tl-day--today';
    if (isWeekend) cls += ' tl-day--weekend';
    return `<div class="${cls}">${formatDayHeader(d)}</div>`;
  }).join('');

  // Apartment rows
  const rowsHtml = apts.map(apt => {
    const labelHtml = `<div class="tl-apt-label">
      <strong>${esc(apt.name)}</strong>
      ${apt.location ? `<span class="text-muted">${esc(apt.location)}</span>` : ''}
    </div>`;

    // Day cells (background grid)
    const cellsHtml = days.map(d => {
      const isToday = d.getTime() === today.getTime();
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      let cls = 'tl-cell';
      if (isToday) cls += ' tl-cell--today';
      if (isWeekend) cls += ' tl-cell--weekend';
      return `<div class="${cls}"></div>`;
    }).join('');

    // Buchungen als volle Tagesblöcke: Anreisetag bis Vortag des Abreisetags.
    // (Abreisetag ist der Reinigungstag, nicht mehr Teil des Aufenthalts.)
    const blocksHtml = apt.bookings.map(bk => {
      const ciDate = new Date(bk.checkIn);
      const coDate = new Date(bk.checkOut);
      const ciDay = Math.floor(dayOffset(ciDate, viewFrom));
      const coDay = Math.floor(dayOffset(coDate, viewFrom));
      // Check-in ab 16:00 = 60% des Anreisetags
      // Check-out um 10:00 = 40% des Abreisetags
      // So bleibt am Abreisetag Platz fuers Cleaning-Badge (rechte Haelfte)
      // und am Anreisetag startet der Block erst nachmittags (keine Kollision
      // mit dem Cleaning-Badge des vorherigen Gasts am selben Tag).
      const startPos = Math.max(0, ciDay + 0.6);
      const endPos = Math.min(totalDays, coDay + 0.38);
      if (endPos <= 0 || startPos >= totalDays) return '';
      const left = (startPos / totalDays) * 100;
      const width = ((endPos - startPos) / totalDays) * 100;
      if (width <= 0) return '';
      const guest = stripAptName(bk.guest, apt.name);
      return `<div class="tl-booking" style="left:${left}%;width:${width}%" title="${esc(guest)}: ${isoDate(ciDate)} – ${isoDate(coDate)}">
        <span class="tl-booking__label">${esc(guest)}</span>
      </div>`;
    }).join('');

    // Reinigung als kompaktes Badge am Abreisetag.
    // Nur nach Checkout — kein Bezug zum naechsten Check-in.
    const windowsHtml = apt.cleaningWindows.map(w => {
      const coDate = new Date(w.date);
      const dayIdx = Math.floor(dayOffset(coDate, viewFrom));
      if (dayIdx < 0 || dayIdx >= totalDays) return '';
      const badgeWidth = 0.55;
      const badgeStart = dayIdx + (1 - badgeWidth) / 2; // zentriert im Tag
      const left = (badgeStart / totalDays) * 100;
      const width = (badgeWidth / totalDays) * 100;
      const stateCls = `tl-clean--${w.state || 'open'}`;
      const timeRange = `${w.checkoutTime || '10:00'} – ${w.checkinTime || '16:00'}`;
      const titleParts = [`Reinigung nach ${w.after}`, isoDate(coDate), timeRange];
      if (w.assignedName) titleParts.push(`→ ${w.assignedName}`);
      titleParts.push(w.state);

      // Zugewiesene Reinigungen: Farbe + Kurzname des Mitarbeiters
      // Admin bekommt Neon-Pink. Erledigte → gruen (nicht Cleaner-Farbe).
      const hasAssignee = w.assignedName && w.state === 'assigned';
      const isDone = w.state === 'done';
      const bgColor = isDone ? null : (hasAssignee ? cleanerColorWithAdmin(w.assignedName, w.isAdmin) : null);
      const bgStyle = bgColor ? `background:${bgColor}` : '';
      const label = isDone ? '✓' : (hasAssignee ? shortName(w.assignedName) : stateIcon(w.state));

      return `<div class="tl-clean-badge ${stateCls}"
        style="left:${left}%;width:${width}%;${bgStyle}"
        data-window-id="${esc(w.id)}" data-state="${w.state}"
        title="${esc(titleParts.join(' · '))}">
        <span class="tl-clean-badge__label">${esc(label)}</span>
      </div>`;
    }).join('');

    return `
      ${labelHtml}
      <div class="tl-row">
        <div class="tl-cells">${cellsHtml}</div>
        <div class="tl-blocks">${blocksHtml}${windowsHtml}</div>
      </div>
    `;
  }).join('');

  // Mitarbeiter-Zeilen mit Abwesenheiten
  const typeLabel = { vacation: '🏖 Urlaub', sick: '🤒 Krank', unavailable: '❌' };
  const typeColor = { vacation: 'rgba(79,114,255,0.7)', sick: 'rgba(224,82,82,0.7)', unavailable: 'rgba(124,132,160,0.5)' };

  const cleanerRowsHtml = cleanerList.map(c => {
    const myAbsences = absenceData.filter(a => a.cleanerId === c.id);
    const color = cleanerColor(c.name);

    const labelHtml = `<div class="tl-apt-label" style="border-left:3px solid ${color}">
      <strong>${esc(c.name)}</strong>
      <span class="text-muted" style="font-size:10px">Mitarbeiter</span>
    </div>`;

    const cellsHtml = days.map(d => {
      const isToday = d.getTime() === today.getTime();
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      let cls = 'tl-cell';
      if (isToday) cls += ' tl-cell--today';
      if (isWeekend) cls += ' tl-cell--weekend';
      return `<div class="${cls}"></div>`;
    }).join('');

    const absBlocksHtml = myAbsences.map(a => {
      const startDay = Math.max(0, Math.floor(dayOffset(new Date(a.fromDate), viewFrom)));
      const endDay = Math.min(totalDays, Math.floor(dayOffset(new Date(a.toDate), viewFrom)) + 1);
      if (endDay <= 0 || startDay >= totalDays) return '';
      const left = (startDay / totalDays) * 100;
      const width = ((endDay - startDay) / totalDays) * 100;
      const bg = typeColor[a.type] || typeColor.unavailable;
      const lbl = typeLabel[a.type] || '❌';
      return `<div class="tl-absence" style="left:${left}%;width:${width}%;background:${bg}" title="${esc(c.name)}: ${lbl} ${a.fromDate} – ${a.toDate}${a.note ? ' · ' + a.note : ''}">
        <span class="tl-absence__label">${lbl}${a.note ? ' ' + esc(a.note) : ''}</span>
      </div>`;
    }).join('');

    return `
      ${labelHtml}
      <div class="tl-row">
        <div class="tl-cells">${cellsHtml}</div>
        <div class="tl-blocks">${absBlocksHtml}</div>
      </div>
    `;
  }).join('');

  // Upcoming cleanings list
  const upcoming = [];
  for (const apt of apts) {
    for (const w of apt.cleaningWindows) {
      const d = new Date(w.date);
      d.setHours(0, 0, 0, 0);
      // Nur ab heute (Vergangenheit gehoert ins Gantt, nicht in "Anstehend")
      if (d.getTime() < today.getTime()) continue;
      if (d.getTime() > today.getTime() + 14 * DAY_MS) continue;
      upcoming.push({ ...w, aptName: apt.name, aptId: apt.id });
    }
  }
  // Offene/zugewiesene zuerst (nach Datum), dann erledigte, dann stornierte
  const stateOrder = { open: 0, assigned: 1, done: 2, cancelled: 3 };
  upcoming.sort((a, b) => {
    const oa = stateOrder[a.state] ?? 1;
    const ob = stateOrder[b.state] ?? 1;
    if (oa !== ob) return oa - ob;
    return new Date(a.date) - new Date(b.date);
  });

  function stateBadge(state) {
    const colors = { open: 'var(--color-warning)', assigned: 'var(--color-accent)', done: 'var(--color-success)', cancelled: 'var(--color-danger)' };
    const labels = { open: 'Offen', assigned: 'Zugewiesen', done: 'Erledigt', cancelled: 'Storniert' };
    return `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;color:#fff;background:${colors[state] || '#666'}">${labels[state] || state}</span>`;
  }

  const upcomingHtml = upcoming.length === 0
    ? '<div class="text-muted" style="padding:12px;font-size:13px">Keine Reinigungen im Zeitfenster.</div>'
    : upcoming.map(w => {
        const d = new Date(w.date);
        const dateStr = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
        const dimmed = w.state === 'done' || w.state === 'cancelled' ? 'opacity:0.5' : '';
        return `<div class="tl-upcoming-row" style="${dimmed}">
          <span class="tl-upcoming__date">${esc(dateStr)}</span>
          ${stateBadge(w.state)}
          <span class="tl-upcoming__apt"><strong>${esc(w.aptName)}</strong></span>
          <span class="tl-upcoming__guests text-muted">nach ${esc(w.after)}</span>
          <button class="btn btn--ghost btn--sm tl-upcoming__btn" data-window-id="${esc(w.id)}">
            Details →
          </button>
        </div>`;
      }).join('');

  root.innerHTML = `
    ${navHtml}
    ${legendHtml}
    <div class="tl-container">
      <div class="tl-grid" style="--tl-days:${totalDays}">
        <div class="tl-corner"></div>
        <div class="tl-months">${monthHtml}</div>
        <div class="tl-corner"></div>
        <div class="tl-day-headers">${dayHeaders}</div>
        ${rowsHtml}
        ${cleanerList.length > 0 ? `
          <div class="tl-separator">Mitarbeiter</div>
          <div class="tl-separator"></div>
          ${cleanerRowsHtml}
        ` : ''}
      </div>
    </div>
    <div class="tl-upcoming">
      <h3 style="margin:0 0 8px">Anstehende Reinigungen (7 Tage)</h3>
      ${upcomingHtml}
    </div>
  `;

  bindEvents();
}

function bindEvents() {
  // Navigation
  document.getElementById('tl-prev')?.addEventListener('click', () => {
    viewFrom = new Date(viewFrom.getTime() - 7 * DAY_MS);
    viewTo = new Date(viewTo.getTime() - 7 * DAY_MS);
    refresh();
  });
  document.getElementById('tl-next')?.addEventListener('click', () => {
    viewFrom = new Date(viewFrom.getTime() + 7 * DAY_MS);
    viewTo = new Date(viewTo.getTime() + 7 * DAY_MS);
    refresh();
  });
  document.getElementById('tl-today')?.addEventListener('click', () => {
    initDates();
    refresh();
  });
  document.getElementById('tl-sync')?.addEventListener('click', async () => {
    const btn = document.getElementById('tl-sync');
    btn.disabled = true;
    btn.textContent = '↻ …';
    try {
      await fetch('/api/cleaning/sync', { method: 'POST' });
      await refresh();
    } catch (err) {
      alert('Sync fehlgeschlagen: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Sync';
    }
  });

  // Klick auf Cleaning-Badge im Gantt → Detailseite oeffnen
  document.querySelectorAll('.tl-clean-badge[data-window-id]').forEach(el => {
    el.addEventListener('click', () => {
      window.location.href = '/cleaning/event/' + encodeURIComponent(el.dataset.windowId);
    });
  });

  // Klick auf Zeile in der Upcoming-Liste → Detailseite oeffnen
  document.querySelectorAll('.tl-upcoming__btn[data-window-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = '/cleaning/event/' + encodeURIComponent(btn.dataset.windowId);
    });
  });
}

async function refresh() {
  try {
    await Promise.all([loadTimeline(), loadAbsences(), loadCleaners()]);
    render();
  } catch (err) {
    document.getElementById('cleaning-root').innerHTML = `
      <div class="empty-state">
        <h2 class="text-danger">Fehler</h2>
        <p>${esc(err.message)}</p>
      </div>`;
  }
}

async function init() {
  await loadSettings();
  initDates();
  await refresh();
}

document.addEventListener('DOMContentLoaded', init);
