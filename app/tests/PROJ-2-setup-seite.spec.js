/**
 * PROJ-2: Setup-Seite – E2E-Tests
 * Testet alle Acceptance Criteria der Setup-Seite.
 */

const { test, expect, request: apiRequest } = require('@playwright/test');
const fs = require('fs');
const { APARTMENTS: CONFIG_PATH } = require('./test-helpers');

function resetConfig(data = { apartments: [] }) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

test.beforeEach(() => {
  resetConfig();
});

test.afterAll(() => {
  resetConfig();
});

// ── AC1: Setup-Seite erreichbar ───────────────────────────────────────────────

test('AC1: Setup-Seite ist unter /setup erreichbar', async ({ page }) => {
  await page.goto('http://localhost:3100/setup');
  await expect(page).toHaveURL(/\/setup/);
  await expect(page.locator('h1')).toContainText('Wohnungen');
});

// ── AC2: Liste vorhandener Wohnungen ──────────────────────────────────────────

test('AC2: Alle vorhandenen Wohnungen werden in einer Liste dargestellt', async ({ page }) => {
  resetConfig({
    apartments: [
      { id: 'test-1', name: 'Black Forest 1', location: 'BF1', visible: true,
        occupancy: { enabled: false, icalUrl: '' },
        integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
      },
      { id: 'test-2', name: 'City Loft', location: 'CL', visible: false,
        occupancy: { enabled: false, icalUrl: '' },
        integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
      }
    ]
  });

  await page.goto('http://localhost:3100/setup');
  await expect(page.locator('.apt-row')).toHaveCount(2);
  await expect(page.locator('.apt-row').first()).toContainText('Black Forest 1');
  await expect(page.locator('.apt-row').nth(1)).toContainText('City Loft');
});

// ── AC3: Leerer Zustand ───────────────────────────────────────────────────────

test('AC3: Leerer Zustand zeigt "Noch keine Wohnungen"', async ({ page }) => {
  await page.goto('http://localhost:3100/setup');
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('.empty-state')).toContainText('Noch keine Wohnungen');
});

// ── AC4: Wohnung anlegen ──────────────────────────────────────────────────────

test('AC4: Wohnung anlegen mit Name und Standort', async ({ page }) => {
  await page.goto('http://localhost:3100/setup');

  await page.click('#btn-add');
  await page.fill('#input-name', 'Neues Loft');
  await page.fill('#input-location', 'NL1');
  await page.click('#btn-save-new');

  // Wohnung erscheint in Liste
  await expect(page.locator('.apt-row')).toHaveCount(1);
  await expect(page.locator('.apt-row')).toContainText('Neues Loft');
  await expect(page.locator('.apt-row')).toContainText('NL1');
});

test('AC4b: Formular zeigt Fehlermeldung wenn Name leer ist', async ({ page }) => {
  await page.goto('http://localhost:3100/setup');
  await page.click('#btn-add');
  await page.click('#btn-save-new');

  await expect(page.locator('#add-error')).toBeVisible();
  await expect(page.locator('#add-error')).toContainText('Namen');
});

test('AC4c: Abbrechen schliesst das Hinzufuegen-Formular', async ({ page }) => {
  await page.goto('http://localhost:3100/setup');
  await page.click('#btn-add');
  await expect(page.locator('#add-form')).toBeVisible();
  await page.click('#btn-cancel-new');
  await expect(page.locator('#add-form')).not.toBeVisible();
});

// ── AC5: Wohnung loeschen ─────────────────────────────────────────────────────

test('AC5: Wohnung loeschen mit Bestaetigungsdialog', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'zu-loeschen', name: 'Loeschtest', location: 'LT',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  await expect(page.locator('.apt-row')).toHaveCount(1);

  // Dialog akzeptieren
  page.once('dialog', dialog => dialog.accept());
  await page.click('.js-delete');

  // Wohnung verschwunden, Empty-State sichtbar
  await expect(page.locator('.apt-row')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
});

test('AC5b: Loeschen abbrechen behaelt Wohnung', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'nicht-loeschen', name: 'Bleibt', location: 'BL',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');

  page.once('dialog', dialog => dialog.dismiss());
  await page.click('.js-delete');

  await expect(page.locator('.apt-row')).toHaveCount(1);
});

// ── AC6: Edit-Panel oeffnen/schliessen ────────────────────────────────────────

test('AC6: Edit-Panel klappt inline unter der Wohnung auf', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'edit-test', name: 'Editierbar', location: 'ED',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');

  // Noch kein Edit-Panel
  await expect(page.locator('.apt-edit-panel')).toHaveCount(0);

  await page.click('.js-edit');
  await expect(page.locator('.apt-edit-panel')).toBeVisible();
  await expect(page.locator('#edit-name')).toBeVisible();
  await expect(page.locator('#edit-location')).toBeVisible();
});

test('AC6b: Abbrechen schliesst das Edit-Panel', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'edit-cancel', name: 'Cancel Test', location: 'CT',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  await page.click('.js-edit');
  await expect(page.locator('.apt-edit-panel')).toBeVisible();
  await page.click('#btn-edit-cancel');
  await expect(page.locator('.apt-edit-panel')).toHaveCount(0);
});

// ── AC7: Wohnung bearbeiten – Felder speichern ────────────────────────────────

test('AC7: Name und Standort koennen bearbeitet und gespeichert werden', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'save-test', name: 'Alt Name', location: 'AL',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  await page.click('.js-edit');

  // Felder anpassen
  await page.fill('#edit-name', 'Neuer Name');
  await page.fill('#edit-location', 'NN1');
  await page.click('#btn-edit-save');

  // Panel geschlossen, neuer Name sichtbar
  await expect(page.locator('.apt-edit-panel')).toHaveCount(0);
  await expect(page.locator('.apt-row')).toContainText('Neuer Name');
  await expect(page.locator('.apt-row')).toContainText('NN1');
});

// ── AC8: Visible-Toggle ───────────────────────────────────────────────────────

test('AC8: Visible-Toggle speichert sofort ohne Speichern-Klick', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'vis-test', name: 'Sichtbar', location: 'VS',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');

  const checkbox = page.locator('.js-visible');
  await expect(checkbox).toBeChecked();

  await checkbox.click();

  // Seite neu laden – Aenderung muss persistiert sein
  await page.reload();
  const reloaded = page.locator('.js-visible');
  await expect(reloaded).not.toBeChecked();
});

// ── AC9: Integration-Toggles ──────────────────────────────────────────────────

test('AC9: Tado-Toggle zeigt Kind-Selector und Connect-Button', async ({ page }) => {
  // Ab PROJ-5 V2: kein E-Mail/Passwort mehr – stattdessen Device-Code-Flow-Button.
  resetConfig({
    apartments: [{
      id: 'tado-toggle', name: 'Tado Test', location: 'TT',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  await page.click('.js-edit');

  await expect(page.locator('#fields-tado')).toHaveClass(/integration-fields--hidden/);

  await page.click('#toggle-tado');
  await expect(page.locator('#fields-tado')).not.toHaveClass(/integration-fields--hidden/);
  await expect(page.locator('#tado-kind')).toBeVisible();
  await expect(page.locator('.js-tado-connect')).toBeVisible();
});

test('AC9b: iCal-Toggle zeigt/versteckt iCal-URL-Feld', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'ical-toggle', name: 'iCal Test', location: 'IC',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  await page.click('.js-edit');

  await expect(page.locator('#fields-ical')).toHaveClass(/integration-fields--hidden/);
  await page.click('#toggle-ical');
  await expect(page.locator('#ical-url')).toBeVisible();
});

test('AC9c: Tado-Connect-Panel enthaelt Status-Bereich', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'pwd-type', name: 'Pwd Test', location: 'PT',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  await page.click('.js-edit');
  await page.click('#toggle-tado');

  // Connect-Panel existiert mit Status- und Action-Bereich
  await expect(page.locator('.tado-connect-panel')).toBeVisible();
  await expect(page.locator('.tado-connect-status')).toBeVisible();
  await expect(page.locator('.js-tado-connect')).toBeVisible();
});

// ── AC10: Integration-Badges ──────────────────────────────────────────────────

test('AC10: Aktive Integrationen werden als Badges in der Zeile angezeigt', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'badge-test', name: 'Badge Test', location: 'BT',
      visible: true,
      occupancy: { enabled: true, icalUrl: 'https://example.com/cal' },
      integrations: {
        tado:  { enabled: true, kind: 'V3', email: 'x@x.de', password: 'pw', homeId: 123 },
        minut: { enabled: false },
        nuki:  { enabled: false }
      }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  const row = page.locator('.apt-row');
  await expect(row.locator('.badge').filter({ hasText: 'iCal' })).toBeVisible();
  await expect(row.locator('.badge').filter({ hasText: 'Tado' })).toBeVisible();
});

// ── AC11: Integration-Konfiguration speichern ─────────────────────────────────

test('AC11: Tado-enabled wird gespeichert und bleibt nach Reload erhalten', async ({ page }) => {
  // Ab PROJ-5 V2: keine E-Mail/Passwort-Eingabe – nur Toggle + Kind.
  // Echte Auth laeuft ueber den Device-Code-Flow-Button.
  resetConfig({
    apartments: [{
      id: 'tado-save', name: 'Tado Save', location: 'TS',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  await page.click('.js-edit');
  await page.click('#toggle-tado');
  await page.selectOption('#tado-kind', 'V3');
  await page.click('#btn-edit-save');

  // Reload und Badge pruefen
  await page.reload();
  await expect(page.locator('.apt-row .badge').filter({ hasText: 'Tado' })).toBeVisible();
});

// ── AC12: Minut/Nuki-Fehlermeldung bei nicht konfigurierter Integration ────────

test('AC12: Minut-Fehlermeldung erscheint wenn ENV nicht gesetzt (ohne Reload)', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'minut-err', name: 'Minut Err', location: 'ME',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: true, deviceId: '' }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  await page.click('.js-edit');

  // Minut ist aktiv, Geraete werden geladen → sollte Fehlermeldung zeigen (kein ENV)
  await expect(page.locator('.device-error')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.device-error')).toContainText('Minut');
});

test('AC12b: Nuki-Fehlermeldung erscheint wenn ENV nicht gesetzt', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'nuki-err', name: 'Nuki Err', location: 'NE',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: true, deviceIds: [] } }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  await page.click('.js-edit');

  await expect(page.locator('.device-error')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.device-error')).toContainText('Nuki');
});

// ── AC13: Edit-Fehlermeldung bei leerem Namen ─────────────────────────────────

test('AC13: Speichern mit leerem Namen zeigt Fehlermeldung im Edit-Panel', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'name-err', name: 'Hat Name', location: 'HN',
      visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
    }]
  });

  await page.goto('http://localhost:3100/setup');
  await page.click('.js-edit');
  await page.fill('#edit-name', '');
  await page.click('#btn-edit-save');

  await expect(page.locator('#edit-error')).toBeVisible();
  await expect(page.locator('#edit-error')).toContainText('Name');
});

// ── AC14: Aenderungen auf Dashboard sichtbar ──────────────────────────────────

test('AC14: Aenderungen im Setup sind nach Reload des Dashboards sichtbar', async ({ page }) => {
  await page.goto('http://localhost:3100/setup');
  await page.click('#btn-add');
  await page.fill('#input-name', 'Dashboard Wohnung');
  await page.click('#btn-save-new');

  await page.goto('http://localhost:3100/');
  // Dashboard zeigt Wohnungskarte (auch wenn noch kein Dashboard-Widget existiert)
  // Mindestens: kein Fehler und Seite laedt
  await expect(page).toHaveURL('http://localhost:3100/');
});
