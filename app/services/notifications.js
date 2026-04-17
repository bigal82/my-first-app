/**
 * E-Mail-Benachrichtigungen bei Tado-Aktionen (Automation + Manuell).
 *
 * Wird von services/actionLog.append() aus fire-and-forget aufgerufen.
 * Wenn keine Config vorhanden ist oder die betreffende Source ausgeschaltet
 * ist, passiert nichts. Fehler beim Versand werden geloggt, brechen aber
 * nichts ab — Notifications sollen nie den Haupt-Flow stoeren.
 */

const nodemailer = require('nodemailer');
const integrationsStore = require('./integrationsStore');

let cachedTransporter = null;
let cachedSignature = '';

function buildTransporter(cfg) {
  // Effektiver Host: wenn leer oder Platzhalter → localhost (der Postfix im
  // selben Docker-Container). Damit funktioniert Mailversand out-of-the-box
  // ohne dass der User SMTP konfigurieren muss.
  const isLocalFallback = !cfg.smtpHost
    || cfg.smtpHost === 'localhost'
    || cfg.smtpHost === 'smtp.example.com';

  const host = isLocalFallback ? 'localhost' : cfg.smtpHost;
  const port = isLocalFallback ? 25 : (cfg.smtpPort || 587);
  const auth = (!isLocalFallback && cfg.smtpUser)
    ? { user: cfg.smtpUser, pass: cfg.smtpPass }
    : undefined;

  const sig = `smtp|${host}|${port}|${cfg.smtpUser || ''}`;
  if (cachedTransporter && cachedSignature === sig) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth,
    // Lokaler Postfix hat kein TLS-Zertifikat
    tls: isLocalFallback ? { rejectUnauthorized: false } : undefined
  });
  cachedSignature = sig;
  return cachedTransporter;
}

function resetTransporter() {
  cachedTransporter = null;
  cachedSignature = '';
}

// ── Template ────────────────────────────────────────────────────────────────

function subjectFor(entry) {
  const badge = entry.source === 'automation' ? '[auto]' : '[manuell]';
  const result = entry.result === 'success'
    ? 'OK'
    : (entry.result === 'partial' ? 'TEIL' : 'FEHLER');
  return `${badge} ${entry.apartmentName}: ${entry.actionLabel || entry.action} — ${result}`;
}

function plainTextFor(entry) {
  const ts = new Date(entry.timestamp).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'medium' });
  const lines = [
    `Wohnung:    ${entry.apartmentName}`,
    `Aktion:     ${entry.actionLabel || entry.action}`,
    `Quelle:     ${entry.source === 'automation' ? 'Automation (iCal)' : 'Manuell (Dashboard)'}`,
    `Ergebnis:   ${entry.result}`,
    `Zeitpunkt:  ${ts}`
  ];
  if (entry.roomName) lines.push(`Raum:       ${entry.roomName}`);
  if (entry.eventTitle) lines.push(`Gast:       ${entry.eventTitle}`);
  if (entry.eventStart && entry.eventEnd) {
    const start = new Date(entry.eventStart).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    const end   = new Date(entry.eventEnd).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    lines.push(`Buchung:    ${start} bis ${end}`);
  }
  if (entry.message) lines.push(`Meldung:    ${entry.message}`);
  if (entry.failedRooms && entry.failedRooms.length > 0) {
    lines.push('Fehler in Raeumen:');
    for (const f of entry.failedRooms) lines.push(`  - ${f.name}: ${f.error}`);
  }
  return lines.join('\n') + '\n\n-- \nFaecherLofts Manager\n';
}

function htmlFor(entry) {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ts = new Date(entry.timestamp).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'medium' });
  const resultColor = entry.result === 'success' ? '#34c97b' : (entry.result === 'partial' ? '#f5a623' : '#e05252');
  const sourceLabel = entry.source === 'automation' ? 'Automation (iCal)' : 'Manuell (Dashboard)';
  const sourceColor = entry.source === 'automation' ? '#4f72ff' : '#7c84a0';

  const rows = [
    ['Wohnung', esc(entry.apartmentName)],
    ['Aktion', esc(entry.actionLabel || entry.action)],
    ['Quelle', `<span style="color:${sourceColor};font-weight:600">${esc(sourceLabel)}</span>`],
    ['Ergebnis', `<span style="color:${resultColor};font-weight:600">${esc(entry.result)}</span>`],
    ['Zeitpunkt', esc(ts)]
  ];
  if (entry.roomName)  rows.push(['Raum', esc(entry.roomName)]);
  if (entry.eventTitle) rows.push(['Gast', esc(entry.eventTitle)]);
  if (entry.eventStart && entry.eventEnd) {
    const start = new Date(entry.eventStart).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    const end   = new Date(entry.eventEnd).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    rows.push(['Buchung', `${esc(start)} &ndash; ${esc(end)}`]);
  }
  if (entry.message) rows.push(['Meldung', esc(entry.message)]);

  const tbody = rows.map(([k, v]) => `
    <tr>
      <td style="padding:6px 12px 6px 0;color:#7c84a0;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;white-space:nowrap">${k}</td>
      <td style="padding:6px 0;color:#1b1f2a;font-size:14px">${v}</td>
    </tr>`).join('');

  let failedHtml = '';
  if (entry.failedRooms && entry.failedRooms.length > 0) {
    failedHtml = `
      <div style="margin-top:16px;padding:12px;background:#fdf2f2;border-left:3px solid #e05252;border-radius:4px">
        <div style="font-weight:600;color:#e05252;margin-bottom:6px">Fehler in Raeumen:</div>
        <ul style="margin:0;padding-left:18px;color:#1b1f2a;font-size:13px">
          ${entry.failedRooms.map(f => `<li>${esc(f.name)}: ${esc(f.error)}</li>`).join('')}
        </ul>
      </div>`;
  }

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f8;font-family:'Segoe UI',system-ui,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="padding:20px 24px;background:#0f1117;color:#ffffff">
      <div style="font-size:18px;font-weight:700;letter-spacing:-0.3px">Faecher<span style="color:#4f72ff">Lofts</span> Manager</div>
      <div style="font-size:12px;color:#7c84a0;margin-top:2px">Aktions-Benachrichtigung</div>
    </div>
    <div style="padding:24px">
      <table style="width:100%;border-collapse:collapse">${tbody}</table>
      ${failedHtml}
    </div>
    <div style="padding:12px 24px;background:#f3f4f8;color:#7c84a0;font-size:11px;text-align:center">
      Diese E-Mail wurde vom FaecherLofts Manager automatisch erzeugt.
    </div>
  </div>
</body></html>`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Wird von actionLog.append() nach jedem erfolgreichen Schreib-Log-Eintrag
 * aufgerufen. Fire-and-forget — Fehler werden nur geloggt.
 */
function notifyActionLogged(entry) {
  const cfg = integrationsStore.getNotifications();
  if (!cfg.emailTo) return; // kein Empfaenger → nichts zu tun

  const sourceAllowed = entry.source === 'automation'
    ? cfg.notifyAutomation
    : cfg.notifyManual;
  if (!sourceAllowed) return;

  const transporter = buildTransporter(cfg);
  if (!transporter) return;

  const from = cfg.smtpFrom || cfg.smtpUser || 'noreply@faecherlofts.de';
  const mail = {
    from,
    to: splitRecipients(cfg.emailTo),
    subject: subjectFor(entry),
    text: plainTextFor(entry),
    html: htmlFor(entry)
  };

  transporter.sendMail(mail).catch(err => {
    console.error('[notifications] sendMail fehlgeschlagen:', err.message);
  });
}

/**
 * Test-Versand von der Setup-Seite. Wirft Fehler, damit die UI sie anzeigen
 * kann.
 */
async function sendTestEmail() {
  const cfg = integrationsStore.getNotifications();
  if (!cfg.emailTo) throw new Error('Keine Empfaenger-Adresse konfiguriert.');

  const transporter = buildTransporter(cfg);
  if (!transporter) throw new Error('Mail-Transport konnte nicht aufgebaut werden.');

  const from = cfg.smtpFrom || cfg.smtpUser || 'noreply@faecherlofts.de';
  const testEntry = {
    timestamp: new Date().toISOString(),
    source: 'manual',
    apartmentName: 'Test-Wohnung',
    action: 'test',
    actionLabel: 'Test-Nachricht',
    result: 'success',
    message: 'Dies ist eine Test-Mail aus dem FaecherLofts Manager.'
  };

  await transporter.sendMail({
    from,
    to: splitRecipients(cfg.emailTo),
    subject: `[TEST] FaecherLofts Manager — Benachrichtigung`,
    text: plainTextFor(testEntry),
    html: htmlFor(testEntry)
  });
}

// ── Daily Health Report ─────────────────────────────────────────────────────

/**
 * Schickt einen Morgen-Report, wenn der status-Aggregator mindestens eine
 * Warnung/Offline/Batterie-Problem liefert. issues ist der Return-Value von
 * statusService.aggregate(): { offlineRooms, openWindows, lowBatteries,
 * apartmentsWithWarnings, fetchedAt }.
 *
 * Wenn keine Probleme vorliegen, wird NICHTS verschickt (Absicht: stille
 * Mornings sind gute Mornings).
 *
 * Empfaenger kann eine Komma/Semikolon-getrennte Liste sein.
 */
async function sendHealthReport(issues) {
  const cfg = integrationsStore.getNotifications();
  if (!cfg.emailTo) return { sent: false, reason: 'no-recipient' };
  if (!cfg.dailyHealthReport) return { sent: false, reason: 'disabled' };

  const totalIssues =
    (issues.offlineRooms?.length || 0) +
    (issues.openWindows?.length || 0) +
    (issues.lowBatteries?.length || 0);

  if (totalIssues === 0) return { sent: false, reason: 'all-clear' };

  const transporter = buildTransporter(cfg);
  if (!transporter) return { sent: false, reason: 'no-transport' };

  const from = cfg.smtpFrom || cfg.smtpUser || 'noreply@faecherlofts.de';
  const recipients = splitRecipients(cfg.emailTo);

  const subject = `[Morgen-Report] FaecherLofts — ${totalIssues} Warnung${totalIssues === 1 ? '' : 'en'}`;
  const text = healthReportText(issues);
  const html = healthReportHtml(issues);

  await transporter.sendMail({ from, to: recipients, subject, text, html });
  return { sent: true, totalIssues, recipients };
}

function splitRecipients(str) {
  return String(str || '')
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function healthReportText(issues) {
  const lines = [
    `FaecherLofts Morgen-Report — ${new Date().toLocaleDateString('de-DE', { dateStyle: 'full' })}`,
    '',
  ];
  if (issues.offlineRooms?.length > 0) {
    lines.push('Offline / nicht erreichbar:');
    for (const o of issues.offlineRooms) {
      lines.push(`  - ${o.apartmentName} · ${o.roomName}${o.integration ? ` (${o.integration})` : ''}`);
    }
    lines.push('');
  }
  if (issues.openWindows?.length > 0) {
    lines.push('Offene Fenster:');
    for (const w of issues.openWindows) {
      lines.push(`  - ${w.apartmentName} · ${w.roomName}`);
    }
    lines.push('');
  }
  if (issues.lowBatteries?.length > 0) {
    lines.push('Batterien schwach:');
    for (const b of issues.lowBatteries) {
      lines.push(`  - ${b.apartmentName} · ${b.deviceName} (${b.integration}${b.value ? ` · ${b.value}` : ''})`);
    }
    lines.push('');
  }
  lines.push('-- ');
  lines.push('FaecherLofts Manager');
  return lines.join('\n');
}

function healthReportHtml(issues) {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dateStr = new Date().toLocaleDateString('de-DE', { dateStyle: 'full' });

  function section(title, icon, color, items, renderItem) {
    if (!items || items.length === 0) return '';
    return `
      <div style="margin-top:18px">
        <div style="font-weight:600;color:${color};margin-bottom:8px;font-size:14px">${icon} ${esc(title)} (${items.length})</div>
        <ul style="margin:0;padding-left:18px;color:#1b1f2a;font-size:13px;line-height:1.5">
          ${items.map(renderItem).join('')}
        </ul>
      </div>`;
  }

  const offlineHtml = section('Offline / nicht erreichbar', '⚠', '#e05252',
    issues.offlineRooms,
    o => `<li><strong>${esc(o.apartmentName)}</strong> · ${esc(o.roomName)}${o.integration ? ` <span style="color:#7c84a0">(${esc(o.integration)})</span>` : ''}</li>`
  );

  const windowsHtml = section('Offene Fenster', '🪟', '#d48806',
    issues.openWindows,
    w => `<li><strong>${esc(w.apartmentName)}</strong> · ${esc(w.roomName)}</li>`
  );

  const batteryHtml = section('Batterien schwach', '🔋', '#d48806',
    issues.lowBatteries,
    b => `<li><strong>${esc(b.apartmentName)}</strong> · ${esc(b.deviceName)} <span style="color:#7c84a0">(${esc(b.integration)}${b.value ? ` · ${esc(b.value)}` : ''})</span></li>`
  );

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f8;font-family:'Segoe UI',system-ui,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="padding:20px 24px;background:#0f1117;color:#ffffff">
      <div style="font-size:18px;font-weight:700;letter-spacing:-0.3px">Faecher<span style="color:#4f72ff">Lofts</span> Manager</div>
      <div style="font-size:12px;color:#7c84a0;margin-top:2px">Morgen-Report — ${esc(dateStr)}</div>
    </div>
    <div style="padding:24px">
      <p style="color:#1b1f2a;font-size:14px;margin:0 0 8px">Guten Morgen — heute gibt es Dinge, die Aufmerksamkeit brauchen:</p>
      ${offlineHtml}
      ${windowsHtml}
      ${batteryHtml}
    </div>
    <div style="padding:12px 24px;background:#f3f4f8;color:#7c84a0;font-size:11px;text-align:center">
      Dieser Report wird nur verschickt wenn mindestens eine Warnung vorliegt. Stille Morgen sind gute Morgen.
    </div>
  </div>
</body></html>`;
}

module.exports = {
  notifyActionLogged,
  sendTestEmail,
  sendHealthReport,
  splitRecipients,
  resetTransporter
};
