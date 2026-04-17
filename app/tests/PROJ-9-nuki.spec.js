/**
 * PROJ-9: Nuki Integration – E2E-Tests
 *
 * Alle /api/nuki/* und /api/integrations/* Endpoints werden via page.route()
 * gemockt, damit keine echte Nuki-API angesprochen wird.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { APARTMENTS: CONFIG_PATH } = require('./test-helpers');

function resetConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data || { apartments: [] }, null, 2), 'utf-8');
}

function makeApt(id, name, { nukiEnabled = true, deviceIds = ['l1'] } = {}) {
  return {
    id, name, location: '', visible: true,
    occupancy: { enabled: false, icalUrl: '' },
    integrations: {
      tado: { enabled: false, kind: 'V3', email: '', password: '', homeId: null },
      minut: { enabled: false, deviceId: '' },
      nuki: { enabled: nukiEnabled, deviceIds }
    }
  };
}

function nukiDeviceResponse(overrides = {}) {
  return {
    devices: [
      {
        id: 'l1', name: 'Haustür', type: 'Lock',
        online: true, stateLabel: 'locked',
        batteryPercent: 80, batteryCharging: false, batteryLow: false, batteryCritical: false
      }
    ],
    cached: false, stale: false,
    fetchedAt: new Date().toISOString(),
    ...overrides
  };
}

async function mockNukiRoutes(page, { deviceData, statusData } = {}) {
  const status = statusData || { minut: { clientIdSet: false, clientSecretSet: false }, nuki: { apiTokenSet: true } };

  await page.route('**/api/integrations', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, status }) });
  });

  await page.route('**/api/integrations/nuki/test', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, deviceCount: 2 }) });
  });

  await page.route('**/api/nuki/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/nuki/devices')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'l1', name: 'Haustür', type: 'Lock' },
        { id: 'o1', name: 'Hofeingang', type: 'Opener' }
      ]) });
      return;
    }
    if (deviceData) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(deviceData) });
    } else {
      await route.fulfill({ status: 404, body: '{}' });
    }
  });
}

test.beforeEach(() => resetConfig());
test.afterAll(() => resetConfig());

// ── Setup: Nuki-Panel ─────────────────────────────────────────────────────

test('AC1: Setup zeigt Nuki-Panel neben Minut', async ({ page }) => {
  await mockNukiRoutes(page, {
    statusData: { minut: { clientIdSet: false, clientSecretSet: false }, nuki: { apiTokenSet: false } }
  });
  await page.goto('http://localhost:3100/setup');
  await page.locator('#btn-integrations-toggle').click();
  await expect(page.locator('#nuki-api-token')).toBeVisible();
  await expect(page.locator('#nuki-api-token')).toHaveAttribute('type', 'password');
});

test('AC2: Nuki-Status ist konfiguriert wenn Token gesetzt', async ({ page }) => {
  await mockNukiRoutes(page);
  await page.goto('http://localhost:3100/setup');
  await expect(page.locator('#btn-integrations-toggle')).toContainText('✓ Nuki');
});

test('AC3: Verbindung-testen-Button zeigt Device-Count', async ({ page }) => {
  await mockNukiRoutes(page);
  await page.goto('http://localhost:3100/setup');
  await page.locator('#btn-integrations-toggle').click();
  await page.locator('#btn-nuki-test').click();
  await expect(page.locator('#nuki-result')).toContainText('verbunden');
  await expect(page.locator('#nuki-result')).toContainText('2');
});

test('AC4: Speichern-Button schickt PUT mit apiToken', async ({ page }) => {
  await mockNukiRoutes(page);
  await page.goto('http://localhost:3100/setup');
  await page.locator('#btn-integrations-toggle').click();
  await page.fill('#nuki-api-token', 'my-token');
  await page.locator('#btn-nuki-save').click();
  await expect(page.locator('#nuki-result')).toContainText('gespeichert');
});

// ── Dashboard: Nuki-Slot ──────────────────────────────────────────────────

test('AC5: Wohnung ohne Nuki zeigt keinen Nuki-Slot', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha', { nukiEnabled: false })] });
  await mockNukiRoutes(page);
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.apartment-card')).toBeVisible();
  await expect(page.locator('[data-slot="nuki"]')).toHaveCount(0);
});

test('AC6: Wohnung mit Nuki zeigt Lock mit Batterie-Prozent', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await mockNukiRoutes(page, { deviceData: nukiDeviceResponse() });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="nuki"]');
  await expect(slot).toBeVisible();
  await expect(slot).toContainText('Haustür');
  await expect(slot).toContainText('80%');
  await expect(slot).toContainText('locked');
});

test('AC7: Lock mit Batterie < 50% wird gelb', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await mockNukiRoutes(page, {
    deviceData: nukiDeviceResponse({
      devices: [{ id: 'l1', name: 'Haustür', type: 'Lock', online: true, stateLabel: 'locked', batteryPercent: 35 }]
    })
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="nuki"] .text-warning')).toBeVisible();
});

test('AC8: Opener zeigt Bat OK statt Prozent', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha', { deviceIds: ['o1'] })] });
  await mockNukiRoutes(page, {
    deviceData: nukiDeviceResponse({
      devices: [{ id: 'o1', name: 'Hofeingang', type: 'Opener', online: true, stateLabel: 'ready', batteryPercent: null, batteryCritical: false }]
    })
  });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="nuki"]');
  await expect(slot).toContainText('Hofeingang');
  await expect(slot).toContainText('Bat OK');
  await expect(slot).not.toContainText('%');
});

test('AC9: Opener mit batteryCritical zeigt Bat kritisch', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha', { deviceIds: ['o1'] })] });
  await mockNukiRoutes(page, {
    deviceData: nukiDeviceResponse({
      devices: [{ id: 'o1', name: 'Hofeingang', type: 'Opener', online: true, stateLabel: 'ready', batteryPercent: null, batteryCritical: true }]
    })
  });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="nuki"]');
  await expect(slot).toContainText('Bat kritisch');
});

test('AC10: Offline-Gerät zeigt offline-Badge', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await mockNukiRoutes(page, {
    deviceData: nukiDeviceResponse({
      devices: [{ id: 'l1', name: 'Haustür', type: 'Lock', online: false, stateLabel: 'unknown', batteryPercent: 75 }]
    })
  });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="nuki"]');
  await expect(slot.locator('.badge').filter({ hasText: 'offline' })).toBeVisible();
});

test('AC11: batteryPercent=null beim Lock zeigt "—" statt "0%"', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await mockNukiRoutes(page, {
    deviceData: nukiDeviceResponse({
      devices: [{ id: 'l1', name: 'Haustür', type: 'Lock', online: true, stateLabel: 'locked', batteryPercent: null }]
    })
  });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="nuki"]');
  await expect(slot).not.toContainText('0%');
  await expect(slot).toContainText('—');
});

test('AC12: Mehrere Geräte werden als Liste gerendert', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha', { deviceIds: ['l1', 'o1'] })] });
  await mockNukiRoutes(page, {
    deviceData: nukiDeviceResponse({
      devices: [
        { id: 'l1', name: 'Haustür', type: 'Lock', online: true, stateLabel: 'locked', batteryPercent: 80 },
        { id: 'o1', name: 'Hofeingang', type: 'Opener', online: true, stateLabel: 'ready', batteryPercent: null }
      ]
    })
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.nuki-row')).toHaveCount(2);
});

test('AC13: Fehler-Response zeigt Warnhinweis', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await page.route('**/api/integrations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nuki: { apiTokenSet: true } }) });
  });
  await page.route('**/api/nuki/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/nuki/devices')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Nuki API nicht erreichbar' }) });
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="nuki"]')).toContainText('Nuki API nicht erreichbar');
});

test('AC14: XSS im Device-Namen wird escaped', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'Alpha')] });
  await mockNukiRoutes(page, {
    deviceData: nukiDeviceResponse({
      devices: [{ id: 'l1', name: '<img src=x onerror="window.NUKI_XSS=1">', type: 'Lock', online: true, stateLabel: 'locked', batteryPercent: 80 }]
    })
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="nuki"]')).toContainText('<img src=x');
  const xss = await page.evaluate(() => window.NUKI_XSS);
  expect(xss).toBeUndefined();
});
