/**
 * PROJ-3: Dashboard Basis – E2E-Tests
 * Testet alle Acceptance Criteria des Dashboards.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { APARTMENTS: CONFIG_PATH } = require('./test-helpers');

function resetConfig(data = { apartments: [] }) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function makeApartment(id, name, { visible = true, location = '' } = {}) {
  return {
    id, name, location, visible,
    occupancy: { enabled: false, icalUrl: '' },
    integrations: {
      tado:  { enabled: false, kind: 'V3', email: '', password: '', homeId: null },
      minut: { enabled: false, deviceId: '' },
      nuki:  { enabled: false, deviceIds: [] }
    }
  };
}

test.beforeEach(() => resetConfig());
test.afterAll(() => resetConfig());

// ── AC1: Dashboard unter / erreichbar ────────────────────────────────────────

test('AC1: Dashboard unter / zeigt alle sichtbaren Wohnungen', async ({ page }) => {
  resetConfig({
    apartments: [
      makeApartment('visible-1', 'Black Forest 1', { location: 'BF1' }),
      makeApartment('visible-2', 'City Loft',       { location: 'CL' }),
      makeApartment('hidden-1',  'Hidden Flat',     { location: 'HF', visible: false })
    ]
  });

  await page.goto('http://localhost:3100/');
  const cards = page.locator('.apartment-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Black Forest 1');
  await expect(cards.nth(1)).toContainText('City Loft');
});

// ── AC2: KPI-Zeile ───────────────────────────────────────────────────────────

test('AC2: KPI-Zeile zeigt Aktive Wohnungen, Mit Warnungen, Letzter Stand', async ({ page }) => {
  resetConfig({
    apartments: [
      makeApartment('a', 'Alpha'),
      makeApartment('b', 'Beta'),
      makeApartment('c', 'Gamma', { visible: false })
    ]
  });

  await page.goto('http://localhost:3100/');
  await expect(page.locator('.kpi-row')).toBeVisible();
  await expect(page.locator('.kpi-card')).toHaveCount(3);

  // Aktive Wohnungen = 2 (nur visible)
  const kpiCards = page.locator('.kpi-card');
  await expect(kpiCards.nth(0)).toContainText('Aktive Wohnungen');
  await expect(kpiCards.nth(0).locator('.kpi-value')).toHaveText('2');

  // Warnungen (Platzhalter = 0)
  await expect(kpiCards.nth(1)).toContainText('Mit Warnungen');
  await expect(kpiCards.nth(1).locator('.kpi-value')).toHaveText('0');

  // Letzter Stand (Zeitstempel im HH:MM Format)
  await expect(kpiCards.nth(2)).toContainText('Letzter Stand');
  await expect(kpiCards.nth(2).locator('.kpi-value')).toContainText(/\d{2}:\d{2}/);
});

// ── AC3: Statusbanner ausgeblendet wenn keine Probleme ───────────────────────

test('AC3: Statusbanner ist unsichtbar wenn keine Probleme vorhanden', async ({ page }) => {
  resetConfig({
    apartments: [makeApartment('a', 'Alpha')]
  });

  await page.goto('http://localhost:3100/');
  // In PROJ-3 gibt es noch keine echten Probleme → Banner leer
  await expect(page.locator('.status-banner')).toHaveCount(0);
});

// ── AC4: Filter-Bar mit Suche und Chips ──────────────────────────────────────

test('AC4: Filter-Bar zeigt Sucheingabe und drei Chips', async ({ page }) => {
  resetConfig({ apartments: [makeApartment('a', 'Alpha')] });
  await page.goto('http://localhost:3100/');

  await expect(page.locator('#search-input')).toBeVisible();
  await expect(page.locator('.chip')).toHaveCount(3);
  await expect(page.locator('.chip').nth(0)).toContainText('Alle');
  await expect(page.locator('.chip').nth(1)).toContainText('Mit Warnungen');
  await expect(page.locator('.chip').nth(2)).toContainText('Gast da');
});

test('AC4b: Chip "Alle" ist standardmaessig aktiv', async ({ page }) => {
  resetConfig({ apartments: [makeApartment('a', 'Alpha')] });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.chip').nth(0)).toHaveClass(/chip--active/);
});

test('AC4c: Klick auf einen anderen Chip aktiviert ihn', async ({ page }) => {
  resetConfig({ apartments: [makeApartment('a', 'Alpha')] });
  await page.goto('http://localhost:3100/');

  await page.locator('.chip').nth(1).click();
  await expect(page.locator('.chip').nth(1)).toHaveClass(/chip--active/);
  await expect(page.locator('.chip').nth(0)).not.toHaveClass(/chip--active/);
});

// ── AC5: Live-Suche filtert nach Name ────────────────────────────────────────

test('AC5: Sucheingabe filtert Wohnungen nach Name (live)', async ({ page }) => {
  resetConfig({
    apartments: [
      makeApartment('bf', 'Black Forest 1'),
      makeApartment('cl', 'City Loft'),
      makeApartment('nl', 'New Loft')
    ]
  });

  await page.goto('http://localhost:3100/');
  await expect(page.locator('.apartment-card')).toHaveCount(3);

  await page.fill('#search-input', 'Loft');
  await expect(page.locator('.apartment-card')).toHaveCount(2);
  await expect(page.locator('.apartment-card').filter({ hasText: 'Black Forest' })).toHaveCount(0);
});

test('AC5b: Sucheingabe filtert nach Standort', async ({ page }) => {
  resetConfig({
    apartments: [
      makeApartment('bf', 'Alpha', { location: 'BF1' }),
      makeApartment('cl', 'Beta',  { location: 'CL' })
    ]
  });

  await page.goto('http://localhost:3100/');
  await page.fill('#search-input', 'BF1');
  await expect(page.locator('.apartment-card')).toHaveCount(1);
  await expect(page.locator('.apartment-card')).toContainText('Alpha');
});

// ── AC6: Wohnungskarten-Inhalt ───────────────────────────────────────────────

test('AC6: Wohnungskarte zeigt Name, Standort und Platzhalter-Slots (ohne Integrationen)', async ({ page }) => {
  // Ohne aktive Integrationen wird nur der Actions-Slot gerendert.
  // Nuki-Slot ist ab PROJ-9 konditional und erscheint nur bei aktivierter Integration.
  resetConfig({
    apartments: [makeApartment('test', 'Testwohnung', { location: 'TW1' })]
  });

  await page.goto('http://localhost:3100/');
  const card = page.locator('.apartment-card');
  await expect(card).toContainText('Testwohnung');
  await expect(card).toContainText('TW1');

  const slots = card.locator('[data-slot]');
  await expect(slots).toHaveCount(1);
  await expect(slots.nth(0)).toHaveAttribute('data-slot', 'actions');
});

// ── AC7: Empty-States ────────────────────────────────────────────────────────

test('AC7a: Empty-State wenn keine Wohnungen konfiguriert', async ({ page }) => {
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('.empty-state')).toContainText('Noch keine Wohnungen');
  await expect(page.locator('.empty-state a[href="/setup"]')).toBeVisible();
});

test('AC7b: Empty-State wenn alle Wohnungen unsichtbar', async ({ page }) => {
  resetConfig({
    apartments: [
      makeApartment('a', 'Alpha', { visible: false }),
      makeApartment('b', 'Beta',  { visible: false })
    ]
  });

  await page.goto('http://localhost:3100/');
  await expect(page.locator('.empty-state')).toContainText('ausgeblendet');
});

test('AC7c: Empty-State wenn Suche ohne Treffer', async ({ page }) => {
  resetConfig({ apartments: [makeApartment('a', 'Alpha')] });
  await page.goto('http://localhost:3100/');

  await page.fill('#search-input', 'existiertnicht');
  await expect(page.locator('.empty-state')).toContainText('Keine Wohnungen gefunden');
  await expect(page.locator('.empty-state')).toContainText('existiertnicht');
});

// ── AC8: Navigation zwischen Dashboard und Setup ─────────────────────────────

test('AC8: Navigation-Links zwischen Dashboard und Setup funktionieren', async ({ page }) => {
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.app-header nav a[href="/"]')).toHaveClass(/active/);

  await page.click('.app-header nav a[href="/setup"]');
  await expect(page).toHaveURL(/\/setup/);

  await page.click('.app-header nav a[href="/"]');
  await expect(page).toHaveURL('http://localhost:3100/');
});

// ── AC9: Branding im Header ──────────────────────────────────────────────────

test('AC9: FaecherLofts-Branding im Header sichtbar', async ({ page }) => {
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.app-header .logo')).toContainText('FaecherLofts');
});

// ── AC10: Responsive Grid ────────────────────────────────────────────────────

test('AC10: Karten-Grid ist auf 375px Mobile lesbar', async ({ page }) => {
  resetConfig({
    apartments: [
      makeApartment('a', 'Alpha'),
      makeApartment('b', 'Beta'),
      makeApartment('c', 'Gamma')
    ]
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('http://localhost:3100/');

  // Karten sichtbar und mindestens nicht uebereinander gestapelt unsichtbar
  const cards = page.locator('.apartment-card');
  await expect(cards).toHaveCount(3);

  // Jede Karte sollte sichtbar sein
  for (let i = 0; i < 3; i++) {
    await expect(cards.nth(i)).toBeVisible();
  }
});

// ── Edge Case: Langer Wohnungsname bricht Layout nicht ──────────────────────

test('EC1: Sehr langer Wohnungsname bricht Layout nicht (text-overflow)', async ({ page }) => {
  resetConfig({
    apartments: [makeApartment('l', 'EinExtremLangerWohnungsnameOhneLeerzeichenDerKeinLayoutBrechenSollteSonstGibtsProbleme')]
  });

  await page.goto('http://localhost:3100/');
  const card = page.locator('.apartment-card');
  await expect(card).toBeVisible();

  // Kein horizontaler Overflow auf 375px
  await page.setViewportSize({ width: 375, height: 812 });
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(375);
});

// ── Edge Case: XSS in Apartment-Name wird geescaped ──────────────────────────

test('EC2: XSS in Wohnungsname wird escaped und nicht als HTML ausgefuehrt', async ({ page }) => {
  resetConfig({
    apartments: [makeApartment('xss', '<img src=x onerror="window.XSS=1">')]
  });

  await page.goto('http://localhost:3100/');
  const xss = await page.evaluate(() => window.XSS);
  expect(xss).toBeUndefined();

  // Name als Text dargestellt
  await expect(page.locator('.apartment-card')).toContainText('<img src=x');
});
