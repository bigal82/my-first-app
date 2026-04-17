/**
 * PROJ-10: Globale Batterie- & Statuslogik – E2E-Tests
 *
 * Status-Aggregation wird via page.route() gemockt damit die Dashboard-UI
 * ohne echte Integrations-Caches getestet werden kann.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { APARTMENTS: CONFIG_PATH } = require('./test-helpers');

function resetConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data || { apartments: [] }, null, 2), 'utf-8');
}

function makeApt(id, name) {
  return {
    id, name, location: '', visible: true,
    occupancy: { enabled: false, icalUrl: '' },
    integrations: {
      tado: { enabled: false, kind: 'V3', email: '', password: '', homeId: null },
      minut: { enabled: false, deviceId: '' },
      nuki: { enabled: false, deviceIds: [] }
    }
  };
}

async function mockStatus(page, statusData) {
  await page.route('**/api/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusData) });
  });
  // Integration-Endpoints leer mocken damit das Dashboard lädt
  await page.route('**/api/occupancy/**', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/tado/**', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/minut/**', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/nuki/**', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
}

test.beforeEach(() => {
  resetConfig({ apartments: [makeApt('a', 'Alpha'), makeApt('b', 'Beta')] });
});
test.afterAll(() => resetConfig());

// ── AC1: Banner unsichtbar wenn keine Probleme ───────────────────────────

test('AC1: Banner wird nicht gerendert wenn keine Probleme', async ({ page }) => {
  await mockStatus(page, {
    offlineRooms: [], openWindows: [], lowBatteries: [], apartmentsWithWarnings: [],
    fetchedAt: new Date().toISOString()
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.status-banner')).toHaveCount(0);
});

// ── AC2: Banner zeigt Problem-Gruppen ────────────────────────────────────

test('AC2: Banner zeigt 3 Problem-Gruppen wenn alle Kategorien belegt', async ({ page }) => {
  await mockStatus(page, {
    offlineRooms: [{ apartmentId: 'a', apartmentName: 'Alpha', roomName: 'Flur', integration: 'tado' }],
    openWindows: [{ apartmentId: 'a', apartmentName: 'Alpha', roomName: 'Bad' }],
    lowBatteries: [{ apartmentId: 'b', apartmentName: 'Beta', deviceName: 'Minut', integration: 'minut', value: '25%' }],
    apartmentsWithWarnings: ['a', 'b'],
    fetchedAt: new Date().toISOString()
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.status-banner')).toBeVisible();
  await expect(page.locator('.status-banner__group')).toHaveCount(3);
  await expect(page.locator('.status-banner')).toContainText('Offline');
  await expect(page.locator('.status-banner')).toContainText('Fenster offen');
  await expect(page.locator('.status-banner')).toContainText('Batterie schwach');
});

// ── AC3: KPI "Mit Warnungen" zeigt Anzahl ────────────────────────────────

test('AC3: KPI "Mit Warnungen" zeigt apartmentsWithWarnings.length', async ({ page }) => {
  await mockStatus(page, {
    offlineRooms: [{ apartmentId: 'a', apartmentName: 'Alpha', roomName: 'X' }],
    openWindows: [],
    lowBatteries: [],
    apartmentsWithWarnings: ['a'],
    fetchedAt: new Date().toISOString()
  });
  await page.goto('http://localhost:3100/');
  const kpiCard = page.locator('.kpi-card').nth(1);
  await expect(kpiCard).toContainText('Mit Warnungen');
  await expect(kpiCard.locator('.kpi-value')).toContainText('1');
  await expect(kpiCard.locator('.kpi-value')).toHaveClass(/text-warning/);
});

// ── AC4: Klick auf Gruppe expandiert Details ────────────────────────────

test('AC4: Klick auf Problem-Gruppe zeigt Details', async ({ page }) => {
  await mockStatus(page, {
    offlineRooms: [
      { apartmentId: 'a', apartmentName: 'Alpha', roomName: 'Flur' },
      { apartmentId: 'b', apartmentName: 'Beta', roomName: 'Bad' }
    ],
    openWindows: [], lowBatteries: [],
    apartmentsWithWarnings: ['a', 'b'],
    fetchedAt: new Date().toISOString()
  });
  await page.goto('http://localhost:3100/');
  // Vor Klick: keine Details sichtbar
  await expect(page.locator('.status-banner__items')).toHaveCount(0);
  // Klick auf Gruppen-Head
  await page.locator('.js-banner-toggle').first().click();
  await expect(page.locator('.status-banner__items')).toBeVisible();
  await expect(page.locator('.status-banner__items')).toContainText('Alpha');
  await expect(page.locator('.status-banner__items')).toContainText('Beta');
});

// ── AC5: Dismiss-Button versteckt Banner ─────────────────────────────────

test('AC5: Dismiss-Button versteckt Banner bis Reload', async ({ page }) => {
  await mockStatus(page, {
    offlineRooms: [{ apartmentId: 'a', apartmentName: 'Alpha', roomName: 'X' }],
    openWindows: [], lowBatteries: [],
    apartmentsWithWarnings: ['a'],
    fetchedAt: new Date().toISOString()
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.status-banner')).toBeVisible();
  await page.locator('#banner-dismiss').click();
  await expect(page.locator('.status-banner')).toHaveCount(0);
});

// ── AC6: XSS in apartmentName wird escaped ───────────────────────────────

test('AC6: XSS im apartmentName wird escaped', async ({ page }) => {
  await mockStatus(page, {
    offlineRooms: [{
      apartmentId: 'x', apartmentName: '<img src=x onerror="window.STATUS_XSS=1">',
      roomName: 'Test'
    }],
    openWindows: [], lowBatteries: [],
    apartmentsWithWarnings: ['x'],
    fetchedAt: new Date().toISOString()
  });
  await page.goto('http://localhost:3100/');
  await page.locator('.js-banner-toggle').first().click();
  const xss = await page.evaluate(() => window.STATUS_XSS);
  expect(xss).toBeUndefined();
});
