/**
 * PROJ-8: Minut Detailseite – E2E-Tests
 *
 * Alle /api/minut/* Endpoints werden via page.route() gemockt, damit keine
 * echte Minut-API angesprochen wird. Chart.js wird echt geladen (ueber die
 * Vendor-Mounts des Servers) und die Render-Pfade werden verifiziert.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { APARTMENTS: CONFIG_PATH } = require('./test-helpers');

function resetConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data || { apartments: [] }, null, 2), 'utf-8');
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

function makeSeries(count, baseVal = 20) {
  const out = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    out.push({
      timestamp: new Date(now - (count - i) * 10 * 60 * 1000).toISOString(),
      value: baseVal + Math.sin(i / 5) * 2
    });
  }
  return out;
}

async function mockMinutRoutes(page, overrides = {}) {
  const apartmentsList = overrides.apartmentsList || [makeApt('b39', 'b39 Test')];
  const deviceStatus = overrides.deviceStatus || {
    deviceId: 'dev-1', deviceName: 'Wohnzimmer-Sensor',
    batteryPercent: 82, batteryLow: false,
    lastHeardFromAt: new Date().toISOString(), offline: false
  };
  const history = overrides.history || {
    range: '24h',
    temperature: makeSeries(100, 22),
    humidity:    makeSeries(100, 45),
    noise:       makeSeries(100, 40),
    motion:      [{ timestamp: new Date().toISOString(), value: 3 }]
  };
  const noiseProfile = overrides.noiseProfile || {
    noiseLimit: 75, quietHoursLimit: 70,
    quietHours: [{ startHour: 22, endHour: 8 }]
  };

  await page.route('**/api/apartments', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apartmentsList) });
  });

  await page.route('**/api/minut/b39', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(deviceStatus) });
  });

  await page.route('**/api/minut/b39/history**', async (route) => {
    const url = route.request().url();
    const match = url.match(/range=([^&]+)/);
    const range = match ? match[1] : '24h';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...history, range }) });
  });

  await page.route('**/api/minut/b39/noise-profile', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(noiseProfile) });
  });
}

test.beforeEach(() => {
  resetConfig({ apartments: [makeApt('b39', 'b39 Test')] });
});

test.afterAll(() => resetConfig());

// ── AC1: Detailseite ist unter /apartment/:id erreichbar ───────────────────

test('AC1: /apartment/b39 liefert detail.html und laedt das JS', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/apartment/b39');
  await expect(page.locator('.detail-header h1')).toContainText('b39 Test');
});

// ── AC2: Zurueck-Link zum Dashboard ────────────────────────────────────────

test('AC2: Zurueck-Link fuehrt zum Dashboard', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/apartment/b39');
  await expect(page.locator('.detail-back')).toBeVisible();
  await page.locator('.detail-back').click();
  await expect(page).toHaveURL('http://localhost:3100/');
});

// ── AC3: Range-Picker zeigt 3 Optionen + Standard 24h ──────────────────────

test('AC3: Range-Picker hat drei Chips, 24h ist Standard', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/apartment/b39');
  const chips = page.locator('.js-range');
  await expect(chips).toHaveCount(3);
  await expect(chips.filter({ hasText: '24 h' })).toHaveClass(/chip--active/);
});

// ── AC4: Alle 4 Charts werden gerendert ────────────────────────────────────

test('AC4: Vier Chart-Canvas-Elemente werden angezeigt', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/apartment/b39');
  await expect(page.locator('#chart-temperature')).toBeVisible();
  await expect(page.locator('#chart-humidity')).toBeVisible();
  await expect(page.locator('#chart-noise')).toBeVisible();
  await expect(page.locator('#chart-motion')).toBeVisible();
});

// ── AC5: Range-Wechsel triggert History-Re-Fetch ──────────────────────────

test('AC5: Klick auf "7 Tage" laedt History neu mit range=7d', async ({ page }) => {
  const fetchedRanges = [];
  await mockMinutRoutes(page);
  // Zusaetzlich den Range protokollieren
  await page.route('**/api/minut/b39/history**', async (route) => {
    const url = route.request().url();
    const match = url.match(/range=([^&]+)/);
    if (match) fetchedRanges.push(match[1]);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      range: match ? match[1] : '24h',
      temperature: makeSeries(50), humidity: makeSeries(50), noise: makeSeries(50), motion: []
    }) });
  });

  await page.goto('http://localhost:3100/apartment/b39');
  await expect.poll(() => fetchedRanges.includes('24h')).toBe(true);

  await page.locator('.js-range', { hasText: '7 Tage' }).click();
  await expect.poll(() => fetchedRanges.includes('7d')).toBe(true);
});

// ── AC6: Sensor-Info oben (Name + Batterie) ────────────────────────────────

test('AC6: Sensor-Info zeigt Device-Name und Batterie', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.goto('http://localhost:3100/apartment/b39');
  await expect(page.locator('#detail-sensor-info')).toContainText('Wohnzimmer-Sensor');
  await expect(page.locator('#detail-sensor-info')).toContainText('82%');
});

// ── AC7: Wohnung ohne Minut zeigt Hinweis ──────────────────────────────────

test('AC7: Wohnung ohne Minut zeigt Hinweis-Empty-State', async ({ page }) => {
  resetConfig({ apartments: [makeApt('b39', 'b39 Test', { minutEnabled: false })] });
  await page.route('**/api/apartments', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([makeApt('b39', 'b39 Test', { minutEnabled: false })]) });
  });
  await page.goto('http://localhost:3100/apartment/b39');
  await expect(page.locator('.empty-state')).toContainText('Kein Minut-Sensor');
});

// ── AC8: Unbekannte Apartment-ID zeigt Fehler ──────────────────────────────

test('AC8: Unbekannte Apartment-ID zeigt "Wohnung nicht gefunden"', async ({ page }) => {
  await mockMinutRoutes(page, { apartmentsList: [] });
  await page.goto('http://localhost:3100/apartment/doesnotexist');
  await expect(page.locator('.empty-state')).toContainText('nicht gefunden');
});

// ── AC9: Klick auf Dashboard-Karte navigiert zur Detailseite ───────────────

test('AC9: Klick auf Apartment-Card-Head oeffnet Detailseite', async ({ page }) => {
  resetConfig({ apartments: [makeApt('b39', 'b39 Test')] });
  // Dashboard braucht keine Mocks fuer das Navigieren
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.apartment-card')).toBeVisible();
  await page.locator('.js-card-head').first().click();
  await expect(page).toHaveURL(/\/apartment\/b39/);
});

// ── AC10: Fehler bei History-Fetch zeigt Error-State ──────────────────────

test('AC10: History-Fetch-Fehler zeigt "Daten nicht ladbar"', async ({ page }) => {
  await mockMinutRoutes(page);
  await page.route('**/api/minut/b39/history**', async (route) => {
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Minut API down' }) });
  });
  await page.goto('http://localhost:3100/apartment/b39');
  await expect(page.locator('#detail-error')).toContainText('Daten nicht ladbar');
});

// ── Security: XSS im Apartment-Name ────────────────────────────────────────

test('XSS im Apartment-Name wird escaped', async ({ page }) => {
  const xssApt = makeApt('xss', '<img src=x onerror="window.DETAIL_XSS=1">');
  resetConfig({ apartments: [xssApt] });
  await mockMinutRoutes(page, { apartmentsList: [xssApt] });
  await page.goto('http://localhost:3100/apartment/xss');
  await expect(page.locator('.detail-header h1')).toContainText('<img src=x');
  const xss = await page.evaluate(() => window.DETAIL_XSS);
  expect(xss).toBeUndefined();
});
