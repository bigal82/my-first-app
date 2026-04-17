/**
 * PROJ-7: Minut Dashboard-Widget – E2E-Tests
 *
 * Alle /api/minut/* und /api/integrations/* Endpoints werden via page.route()
 * gemockt, damit keine echte Minut-API angesprochen wird.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const {
  APARTMENTS: CONFIG_PATH,
  INTEGRATIONS: INTEGRATIONS_PATH,
  TADO_TOKENS: TOKENS_PATH
} = require('./test-helpers');

function resetConfig(data = { apartments: [] }) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}
function clearIntegrations() {
  if (fs.existsSync(INTEGRATIONS_PATH)) fs.unlinkSync(INTEGRATIONS_PATH);
}
function clearTadoTokens() {
  if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
}

function makeApt(id, name, { minutEnabled = true, deviceId = 'dev-1' } = {}) {
  return {
    id, name, location: '', visible: true,
    occupancy: { enabled: false, icalUrl: '' },
    integrations: {
      tado: { enabled: false, kind: 'V3', email: '', password: '', homeId: null },
      minut: { enabled: minutEnabled, deviceId },
      nuki: { enabled: false, deviceIds: [] }
    }
  };
}

function minutDeviceResponse(overrides = {}) {
  return {
    deviceId: 'dev-1',
    deviceName: 'Wohnzimmer-Sensor',
    batteryPercent: 85,
    batteryLow: false,
    lastHeardFromAt: new Date().toISOString(),
    offline: false,
    cached: false,
    stale: false,
    fetchedAt: new Date().toISOString(),
    ...overrides
  };
}

async function mockMinutRoutes(page, { deviceData, statusData = { minut: { clientIdSet: true, clientSecretSet: true }, nuki: { apiTokenSet: false } } } = {}) {
  await page.route('**/api/integrations', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusData) });
      return;
    }
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, status: statusData }) });
      return;
    }
    await route.fulfill({ status: 405, body: '{}' });
  });

  await page.route('**/api/integrations/minut/test', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, deviceCount: 3 }) });
  });

  await page.route('**/api/minut/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/minut/devices')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'dev-1', name: 'Wohnzimmer', type: 'point' },
        { id: 'dev-2', name: 'Flur',       type: 'point' }
      ]) });
      return;
    }
    // Single-device route /api/minut/:apartmentId
    if (deviceData) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(deviceData) });
    } else {
      await route.fulfill({ status: 404, body: '{}' });
    }
  });
}

test.beforeEach(() => {
  resetConfig();
  clearIntegrations();
  clearTadoTokens();
});
test.afterAll(() => {
  resetConfig();
  clearIntegrations();
  clearTadoTokens();
});

// ── Setup: Integration-Panel ───────────────────────────────────────────────

test('AC1: Setup zeigt den Integration-Zugangsdaten-Block', async ({ page }) => {
  await mockMinutRoutes(page, { statusData: { minut: { clientIdSet: false, clientSecretSet: false }, nuki: { apiTokenSet: false } } });
  await page.goto('http://localhost:3100/setup');
  await expect(page.locator('.integrations-block')).toBeVisible();
  await expect(page.locator('.integrations-header h2')).toContainText('Integration-Zugangsdaten');
});

test('AC2: Integration-Block zeigt Warn-Indikator wenn keine Credentials', async ({ page }) => {
  await mockMinutRoutes(page, { statusData: { minut: { clientIdSet: false, clientSecretSet: false }, nuki: { apiTokenSet: false } } });
  await page.goto('http://localhost:3100/setup');
  // Ab PROJ-9 zeigt der Toggle beide Services, mit ⚠ Prefix wenn nicht konfiguriert
  await expect(page.locator('#btn-integrations-toggle')).toContainText('⚠ Minut');
});

test('AC3: Integration-Block zeigt "✓ Minut" wenn Credentials gesetzt', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/setup');
  await expect(page.locator('#btn-integrations-toggle')).toContainText('✓ Minut');
});

test('AC4: Toggle-Button klappt Integration-Body ein/aus', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/setup');
  await expect(page.locator('#integrations-body')).toBeHidden();
  await page.locator('#btn-integrations-toggle').click();
  await expect(page.locator('#integrations-body')).toBeVisible();
  await expect(page.locator('#minut-client-id')).toBeVisible();
});

test('AC5: Minut-Panel Passwort-Feld ist type=password', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/setup');
  await page.locator('#btn-integrations-toggle').click();
  await expect(page.locator('#minut-client-secret')).toHaveAttribute('type', 'password');
});

test('AC6: "Verbindung testen"-Button zeigt Erfolg mit Device-Count', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/setup');
  await page.locator('#btn-integrations-toggle').click();
  await page.locator('#btn-minut-test').click();
  await expect(page.locator('#minut-result')).toContainText('verbunden');
  await expect(page.locator('#minut-result')).toContainText('3');
});

test('AC7: "Speichern"-Button schickt PUT und zeigt Erfolg', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/setup');
  await page.locator('#btn-integrations-toggle').click();
  await page.fill('#minut-client-id', 'my-client-id');
  await page.fill('#minut-client-secret', 'my-secret');
  await page.locator('#btn-minut-save').click();
  await expect(page.locator('#minut-result')).toContainText('gespeichert');
});

// ── Dashboard: Minut-Slot ──────────────────────────────────────────────────

test('AC8: Wohnung ohne Minut zeigt keinen Minut-Slot', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha', { minutEnabled: false })] });
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.apartment-card')).toBeVisible();
  await expect(page.locator('[data-slot="minut"]')).toHaveCount(0);
});

test('AC9: Wohnung mit Minut zeigt Device-Name und Batterie', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await mockMinutRoutes(page, { deviceData: minutDeviceResponse() });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="minut"]');
  await expect(slot).toBeVisible();
  await expect(slot).toContainText('Wohnzimmer-Sensor');
  await expect(slot).toContainText('85%');
});

test('AC10: Batterie < 30% wird als Low markiert (text-warning)', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await mockMinutRoutes(page, { deviceData: minutDeviceResponse({ batteryPercent: 15, batteryLow: true }) });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="minut"]');
  await expect(slot.locator('.text-warning')).toBeVisible();
});

test('AC11: Offline-Sensor (> 24h) zeigt Offline-Badge', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  const oldIso = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  await mockMinutRoutes(page, { deviceData: minutDeviceResponse({ lastHeardFromAt: oldIso, offline: true }) });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="minut"]');
  await expect(slot).toContainText('Offline');
});

test('AC12: Relative Zeit "vor X Minuten" wird angezeigt', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await mockMinutRoutes(page, { deviceData: minutDeviceResponse({ lastHeardFromAt: fiveMinsAgo }) });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="minut"]');
  await expect(slot).toContainText('Zuletzt gesehen');
  // Relative time enthaelt "Minut" (vor 5 Minuten)
  await expect(slot).toContainText(/Minut/i);
});

test('AC13: batteryPercent=null zeigt "unbekannt"', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await mockMinutRoutes(page, { deviceData: minutDeviceResponse({ batteryPercent: null, batteryLow: false }) });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="minut"]');
  await expect(slot).toContainText('unbekannt');
});

test('AC14: Fehler-Response zeigt Warnhinweis', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await page.route('**/api/integrations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ minut: { clientIdSet: true, clientSecretSet: true } }) });
  });
  await page.route('**/api/minut/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/minut/devices')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Minut API nicht erreichbar' }) });
  });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="minut"]');
  await expect(slot).toContainText('Minut API nicht erreichbar');
});

// ── Security: XSS ──────────────────────────────────────────────────────────

test('AC15: XSS im Device-Name wird escaped', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await mockMinutRoutes(page, {
    deviceData: minutDeviceResponse({
      deviceName: '<img src=x onerror="window.MINUT_XSS=1">'
    })
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="minut"]')).toContainText('<img src=x');
  const xss = await page.evaluate(() => window.MINUT_XSS);
  expect(xss).toBeUndefined();
});
