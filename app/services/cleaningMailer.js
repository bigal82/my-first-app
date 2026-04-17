/**
 * Taegliche Reinigungs-Zusammenfassung per E-Mail.
 *
 * Jeden Morgen um eine konfigurierbare Uhrzeit (Default 7:00) erhaelt
 * jeder Mitarbeiter mit E-Mail-Adresse eine Zusammenfassung seiner
 * Reinigungen fuer den Tag. Optional kriegt der Admin eine Kopie aller Mails.
 *
 * Konfiguration in integrations.json → dashboard:
 *   cleaningMailEnabled: true/false
 *   cleaningMailHour: 7 (0-23)
 *   cleaningMailAdminCopy: true/false
 */

const fs = require('fs');
const nodemailer = require('nodemailer');
const integrationsStore = require('./integrationsStore');
const cleaningSync = require('./cleaningSync');
const { APARTMENTS, configFile } = require('../config-path');

const STATE_PATH = configFile('cleaning-mail-state.json');
const POLL_INTERVAL_MS = 60 * 1000;

// Zwei Mail-Typen: morgens (Tagesplan) + abends (Erinnerung fuer morgen)

function readApartments() {
  if (!fs.existsSync(APARTMENTS)) return [];
  try { return JSON.parse(fs.readFileSync(APARTMENTS, 'utf-8')).apartments || []; }
  catch { return []; }
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) || {}; }
  catch { return {}; }
}

function writeState(state) {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8'); }
  catch {}
}

function buildTransporter() {
  const cfg = integrationsStore.getNotifications();
  if (!cfg.smtpHost || cfg.smtpHost === 'smtp.example.com' || cfg.smtpHost === 'localhost') {
    return nodemailer.createTransport({
      host: 'localhost', port: 25,
      tls: { rejectUnauthorized: false }
    });
  }
  return nodemailer.createTransport({
    host: cfg.smtpHost, port: cfg.smtpPort || 587,
    secure: cfg.smtpPort === 465,
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPass } : undefined
  });
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripAptName(title, aptName) {
  if (!title || !aptName) return title || '';
  const parts = aptName.match(/[\p{L}\p{N}]+/gu) || [];
  if (parts.length === 0) return title;
  const chunk = parts.map(p => p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('[\\s\\W]*');
  let cleaned = title.replace(new RegExp(`[\\s\\-–—,·|()\\[\\]]*${chunk}[\\s\\-–—,·|()\\[\\]]*`, 'giu'), ' ').replace(/\s{2,}/g, ' ').trim();
  cleaned = cleaned.replace(/^[-–—,·|()\[\]\s]+|[-–—,·|()\[\]\s]+$/g, '').trim();
  return cleaned || title;
}

/**
 * Erzeugt die E-Mail fuer einen Mitarbeiter fuer ein bestimmtes Datum.
 * @param {'morning'|'evening'} mailType — morning=Tagesplan, evening=Erinnerung fuer morgen
 */
function buildMailForCleaner(cleaner, dateStr, mailType = 'morning') {
  const allEvents = cleaningSync.readEvents();
  const myEvents = allEvents.filter(e =>
    e.assignedTo === cleaner.id &&
    e.checkoutDate && e.checkoutDate.slice(0, 10) === dateStr &&
    e.state !== 'cancelled'
  );

  if (myEvents.length === 0) return null;

  const apartments = readApartments();
  const aptMap = new Map(apartments.map(a => [a.id, a]));
  const dateLabel = new Date(dateStr).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const isEvening = mailType === 'evening';
  const greeting = isEvening
    ? `Hallo ${cleaner.name}, nur zur Erinnerung — morgen ${myEvents.length === 1 ? 'steht eine Reinigung an' : `stehen ${myEvents.length} Reinigungen an`}:`
    : `Hallo ${cleaner.name}, heute ${myEvents.length === 1 ? 'steht eine Reinigung an' : `stehen ${myEvents.length} Reinigungen an`}:`;
  const subjectPrefix = isEvening ? 'Erinnerung morgen' : 'Reinigungsplan';
  const baseUrl = process.env.APP_URL || 'https://manager.xn--fcherlofts-q5a.de';

  const rows = myEvents.map(ev => {
    const apt = aptMap.get(ev.apartmentId) || {};
    const aptName = apt.name || ev.apartmentId;
    const guest = stripAptName(ev.guest, aptName);
    const tasks = (ev.tasks || []).filter(t => !t.done);
    const autoTasks = cleaningSync.getAutoTasks(ev.apartmentId);
    const allTasks = [...autoTasks, ...tasks];
    const eventUrl = `/cleaning/event/${encodeURIComponent(ev.id)}`;

    return {
      aptName,
      location: apt.location || '',
      guest,
      tasks: allTasks,
      state: ev.state,
      eventUrl,
      checkoutTime: ev.checkoutTime || '10:00',
      checkinTime: ev.checkinTime || '16:00'
    };
  });

  const subject = `${subjectPrefix} ${dateLabel} — ${rows.length} Wohnung${rows.length !== 1 ? 'en' : ''}`;

  const textLines = [
    greeting,
    '',
  ];
  for (const r of rows) {
    textLines.push(`■ ${r.aptName}${r.location ? ` (${r.location})` : ''}`);
    textLines.push(`  Gast: ${r.guest} · ${r.checkoutTime} – ${r.checkinTime}`);
    if (r.tasks.length > 0) {
      textLines.push('  Aufgaben:');
      r.tasks.forEach(t => textLines.push(`    - ${t.text}`));
    }
    textLines.push(`  → ${baseUrl}${r.eventUrl}`);
    textLines.push('');
  }
  textLines.push('-- ');
  textLines.push('FaecherLofts Manager');

  const htmlRows = rows.map((r, idx) => {
    const taskHtml = r.tasks.length > 0
      ? `<div style="margin-top:10px;padding:10px 12px;background:#fff7ed;border-left:3px solid #f5a623;border-radius:4px">
          <div style="font-size:11px;font-weight:600;color:#d48806;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Aufgaben</div>
          ${r.tasks.map(t => `<div style="font-size:13px;color:#1b1f2a;padding:2px 0">• ${esc(t.text)}</div>`).join('')}
        </div>`
      : '';
    return `
      <div style="margin-bottom:16px">
        <table cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
          <tr>
            <td style="background:#4f72ff;width:5px"></td>
            <td style="padding:16px 20px">
              <div style="display:flex;align-items:center">
                <span style="background:#4f72ff;color:#fff;width:32px;height:32px;border-radius:50%;display:inline-block;text-align:center;line-height:32px;font-size:14px;font-weight:700;margin-right:12px">${idx + 1}</span>
                <div>
                  <div style="font-weight:700;font-size:16px;color:#1b1f2a">${esc(r.aptName)}</div>
                  ${r.location ? `<div style="font-size:12px;color:#7c84a0">${esc(r.location)}</div>` : ''}
                </div>
              </div>
              <table cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:13px;color:#374151">
                <tr>
                  <td style="padding:4px 16px 4px 0;color:#7c84a0;white-space:nowrap">Gast</td>
                  <td style="padding:4px 0;font-weight:600">${esc(r.guest)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 16px 4px 0;color:#7c84a0;white-space:nowrap">Reinigung</td>
                  <td style="padding:4px 0">${esc(r.checkoutTime)} – ${esc(r.checkinTime)} Uhr</td>
                </tr>
              </table>
              ${taskHtml}
              <div style="margin-top:14px">
                <a href="${baseUrl}${r.eventUrl}" style="display:inline-block;padding:10px 24px;background:#4f72ff;color:#ffffff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;letter-spacing:0.3px">Details &amp; Erledigt markieren →</a>
              </div>
            </td>
          </tr>
        </table>
      </div>`;
  }).join('');

  const countLabel = rows.length === 1 ? '1 Reinigung' : `${rows.length} Reinigungen`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">

    <!-- Header -->
    <div style="background:#0f1117;border-radius:12px 12px 0 0;padding:24px 28px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">Faecher<span style="color:#4f72ff">Lofts</span></div>
      <div style="font-size:12px;color:#7c84a0;margin-top:4px;text-transform:uppercase;letter-spacing:1px">${esc(subjectPrefix)}</div>
    </div>

    <!-- Date Banner -->
    <div style="background:#4f72ff;padding:14px 28px;text-align:center">
      <div style="color:#ffffff;font-size:16px;font-weight:600">${esc(dateLabel)}</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:2px">${countLabel}</div>
    </div>

    <!-- Content -->
    <div style="background:#ffffff;padding:24px 20px;border-radius:0 0 12px 12px">
      <p style="margin:0 0 20px;font-size:15px;color:#1b1f2a;line-height:1.5">${esc(greeting)}</p>
      ${htmlRows}
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px;color:#9ca3af;font-size:11px">
      Automatisch versendet vom FaecherLofts Manager
    </div>

  </div>
</body></html>`;

  return { subject, text: textLines.join('\n'), html, eventCount: rows.length };
}

/**
 * Versendet die Zusammenfassung an alle Mitarbeiter.
 * @param {string} dateStr — Datum fuer die Reinigungen
 * @param {'morning'|'evening'} mailType
 * @param {string|null} testEmail — wenn gesetzt, geht ALLES nur an diese Adresse
 */
async function sendDailySummary(dateStr, mailType = 'morning', testEmail = null) {
  const cleaners = integrationsStore.getCleaners();
  const dash = integrationsStore.getDashboard();
  const notifCfg = integrationsStore.getNotifications();
  const adminEmail = dash.cleaningMailAdminCopy ? notifCfg.emailTo : null;
  const from = notifCfg.smtpFrom || notifCfg.smtpUser || 'noreply@faecherlofts.de';
  const transporter = buildTransporter();
  const results = [];

  for (const c of cleaners) {
    if (!c.email && !testEmail) continue;
    const mail = buildMailForCleaner(c, dateStr, mailType);
    if (!mail) { results.push({ name: c.name, sent: false, reason: 'keine-reinigungen' }); continue; }
    try {
      const recipients = testEmail ? [testEmail] : [c.email];
      if (!testEmail && adminEmail) {
        const adminAddrs = String(adminEmail).split(/[,;]/).map(s => s.trim()).filter(Boolean);
        recipients.push(...adminAddrs);
      }
      await transporter.sendMail({ from, to: recipients, subject: mail.subject, text: mail.text, html: mail.html });
      results.push({ name: c.name, sent: true, events: mail.eventCount });
      console.log(`[cleaningMailer] ${c.name}: ${mail.eventCount} Reinigungen gesendet`);
    } catch (err) {
      results.push({ name: c.name, sent: false, reason: err.message });
      console.error(`[cleaningMailer] ${c.name}: Fehler:`, err.message);
    }
  }

  return results;
}

// ── Scheduler ──────────────────────────────────────────────────────────────

let intervalHandle = null;

async function tick() {
  const dash = integrationsStore.getDashboard();
  if (!dash.cleaningMailEnabled) return;

  const tz = require('./timezone');
  const morningHour = dash.cleaningMailHour ?? 7;
  const eveningHour = dash.cleaningMailEveningHour ?? 20;

  const currentHour = tz.localHour();
  const todayKey = tz.localDateStr();
  const tomorrowKey = tz.tomorrowDateStr();
  const state = readState();

  // Morgen-Mail: Tagesplan fuer heute
  if (currentHour === morningHour && state.lastMorning !== todayKey) {
    state.lastMorning = todayKey;
    writeState(state);
    await sendDailySummary(todayKey, 'morning');
    console.log(`[cleaningMailer] Morgen-Mail fuer ${todayKey} verschickt (${currentHour}:00 lokal)`);
  }

  // Abend-Mail: Erinnerung fuer morgen
  if (currentHour === eveningHour && state.lastEvening !== todayKey) {
    state.lastEvening = todayKey;
    writeState(state);
    await sendDailySummary(tomorrowKey, 'evening');
    console.log(`[cleaningMailer] Abend-Mail fuer ${tomorrowKey} verschickt (${currentHour}:00 lokal)`);
  }
}

function start() {
  if (intervalHandle) return;
  console.log('[cleaningMailer] Scheduler gestartet');
  intervalHandle = setInterval(() => {
    tick().catch(err => console.error('[cleaningMailer] tick fehler:', err.message));
  }, POLL_INTERVAL_MS);
}

function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

module.exports = { start, stop, sendDailySummary, buildMailForCleaner };
