/**
 * Dynamischer iCal-Feed pro Reinigungsmitarbeiter.
 *
 * GET /api/cleaning/calendar/:token.ics
 *
 * Token-basiert (kein Login noetig) — iPhone/Android-Kalender-Apps
 * koennen die URL direkt abonnieren und synchronisieren automatisch.
 *
 * Liefert nur dem Cleaner zugewiesene, nicht-erledigte Reinigungen
 * der naechsten 60 Tage als VCALENDAR.
 */

const integrationsStore = require('../services/integrationsStore');
const cleaningSync = require('../services/cleaningSync');
const userStore = require('../services/userStore');
const fs = require('fs');
const { APARTMENTS } = require('../config-path');

function readApartments() {
  if (!fs.existsSync(APARTMENTS)) return [];
  try {
    return JSON.parse(fs.readFileSync(APARTMENTS, 'utf-8')).apartments || [];
  } catch { return []; }
}

function escIcal(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function formatIcalDate(isoStr, hour, minute) {
  const d = new Date(isoStr);
  d.setHours(hour, minute, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(hour)}${pad(minute)}00`;
}

module.exports = function calendarHandler(req, res) {
  const token = req.params.token;

  // Token kann einem Cleaner ODER einem User (Admin) gehoeren
  let assigneeId = null;
  let calName = 'Reinigungen';

  const cleaner = integrationsStore.getCleanerByCalToken(token);
  if (cleaner) {
    assigneeId = cleaner.id;
    calName = `Reinigungen ${cleaner.name}`;
  } else {
    // Kein Cleaner → vielleicht ein User (Admin)
    const users = userStore.readUsers();
    const user = users.find(u => u.calToken === token);
    if (user) {
      assigneeId = user.id;
      calName = `Reinigungen ${user.displayName || user.username}`;
    }
  }

  if (!assigneeId) {
    return res.status(404).type('text/plain').send('Kalender nicht gefunden.');
  }

  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const events = cleaningSync.getEvents({ from, to });
  const myEvents = events.filter(e => e.assignedTo === assigneeId);

  const apartments = readApartments();
  const aptMap = new Map(apartments.map(a => [a.id, a]));

  // Gastname bereinigen (Apartment-Name rausstreichen)
  function cleanGuest(guest, aptName) {
    if (!guest || !aptName) return guest || 'Reinigung';
    const parts = aptName.match(/[\p{L}\p{N}]+/gu) || [];
    if (parts.length === 0) return guest;
    const chunk = parts.map(p => p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('[\\s\\W]*');
    let cleaned = guest.replace(new RegExp(`[\\s\\-–—,·|()\\[\\]]*${chunk}[\\s\\-–—,·|()\\[\\]]*`, 'giu'), ' ').replace(/\s{2,}/g, ' ').trim();
    cleaned = cleaned.replace(/^[-–—,·|()\[\]\s]+|[-–—,·|()\[\]\s]+$/g, '').trim();
    return cleaned || guest;
  }

  const vevents = myEvents.map(ev => {
    const apt = aptMap.get(ev.apartmentId) || {};
    const aptName = apt.name || ev.apartmentId;
    const guest = cleanGuest(ev.guest, aptName);
    const uid = ev.id.replace(/[^a-zA-Z0-9-]/g, '-') + '@faecherlofts';
    const dtStart = formatIcalDate(ev.checkoutDate, 10, 0);
    const dtEnd = formatIcalDate(ev.checkoutDate, 16, 0);
    const summary = `Reinigung: ${aptName}`;
    const host = req.get('host') || 'manager.faecherlofts.de';
    const proto = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const eventUrl = `${proto}://${host}/cleaning/event/${encodeURIComponent(ev.id)}`;
    const description = `Nach: ${guest}\\nWohnung: ${aptName}\\nZeit: 10:00 – 16:00\\n\\nDetails & Erledigt:\\n${eventUrl}`;
    const location = apt.location ? `${aptName} (${apt.location})` : aptName;
    const status = ev.state === 'done' ? 'COMPLETED' : (ev.state === 'cancelled' ? 'CANCELLED' : 'CONFIRMED');

    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${escIcal(summary)}`,
      `DESCRIPTION:${escIcal(description)}`,
      `LOCATION:${escIcal(location)}`,
      `STATUS:${status}`,
      `URL:${eventUrl}`,
      'END:VEVENT'
    ].join('\r\n');
  });

  const ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FaecherLofts Manager//Reinigungskalender//DE',
    `X-WR-CALNAME:Reinigungen ${escIcal(cleaner.name)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-TIMEZONE:Europe/Berlin`,
    ...vevents,
    'END:VCALENDAR'
  ].join('\r\n');

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `inline; filename="reinigung-${cleaner.id}.ics"`);
  res.send(ical);
};
