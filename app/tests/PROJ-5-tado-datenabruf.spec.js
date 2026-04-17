/**
 * PROJ-5: Tado – Datenabruf (V3 + X) – E2E-Tests
 *
 * Die /api/tado/:id-Route wird via page.route() gemockt, um die verschiedenen
 * Zustände (Erfolg V3/X, Fehler, stale, leere Raumliste) zu testen.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { APARTMENTS: CONFIG_PATH } = require('./test-helpers');

function resetConfig(data = { apartments: [] }) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function makeApt(id, name, { kind = 'V3', enabled = true, location = '' } = {}) {
  return {
    id, name, location, visible: true,
    occupancy: { enabled: false, icalUrl: '' },
    integrations: {
      tado:  { enabled, kind, email: 'a@x.com', password: 'p', homeId: 42 },
      minut: { enabled: false, deviceId: '' },
      nuki:  { enabled: false, deviceIds: [] }
    }
  };
}

async function mockTado(page, responses) {
  await page.route('**/api/tado/**', async (route) => {
    const url = route.request().url();
    const id = decodeURIComponent(url.split('/').pop().split('?')[0]);
    const resp = responses[id];
    if (!resp) {
      await route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) });
      return;
    }
    await route.fulfill({
      status: resp.status || 200,
      contentType: 'application/json',
      body: JSON.stringify(resp.body || {})
    });
  });
}

function tadoData(overrides = {}) {
  return {
    kind: 'V3',
    presence: 'HOME',
    averageTemperature: 20.5,
    rooms: [],
    rateLimit: {
      used: 25, remaining: 75, limit: 100, windowSec: 86400,
      fetchedAt: new Date().toISOString(), source: 'header'
    },
    cached: false,
    stale: false,
    fetchedAt: new Date().toISOString(),
    ...overrides
  };
}

function room(name, overrides = {}) {
  return {
    id: Math.floor(Math.random() * 10000),
    name,
    currentTemp: 20,
    targetTemp: 21,
    humidity: 50,
    heating: false,
    powerOn: true,
    offline: false,
    windowOpen: false,
    batteryLow: false,
    ...overrides
  };
}

test.beforeEach(() => resetConfig());
test.afterAll(() => resetConfig());

// ── AC1: Tado-Slots erscheinen nur bei aktivem Tado ──────────────────────────

test('AC1: Wohnung ohne Tado zeigt keine Tado-Slots', async ({ page }) => {
  resetConfig({ apartments: [makeApt('no-tado', 'Ohne Tado', { enabled: false })] });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.apartment-card')).toHaveCount(1);
  await expect(page.locator('[data-slot="tado-ratelimit"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="tado-rooms"]')).toHaveCount(0);
});

test('AC1b: Wohnung mit Tado zeigt beide Tado-Slots', async ({ page }) => {
  resetConfig({ apartments: [makeApt('with-tado', 'Mit Tado')] });
  await mockTado(page, {
    'with-tado': { body: tadoData({ rooms: [room('WZ')] }) }
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="tado-ratelimit"]')).toBeVisible();
  await expect(page.locator('[data-slot="tado-rooms"]')).toBeVisible();
});

// ── AC2: Rate-Limit-Slot zeigt Verbrauch + Bar ──────────────────────────────

test('AC2: Rate-Limit-Slot zeigt "874 / 1000" wenn Tado RFC-9239 Header liefert', async ({ page }) => {
  resetConfig({ apartments: [makeApt('rl', 'RL Test')] });
  await mockTado(page, {
    'rl': { body: tadoData({ rateLimit: {
      used: 126, remaining: 874, limit: 1000, windowSec: 86400,
      fetchedAt: '2026-04-15T15:29:11.562Z', source: 'header'
    }}) }
  });
  await page.goto('http://localhost:3100/');

  const slot = page.locator('[data-slot="tado-ratelimit"]');
  await expect(slot).toContainText('Tado Requests');
  await expect(slot).toContainText('874');
  await expect(slot).toContainText('1000');
});

test('AC2b: Rate-Limit-Zahl wird rot bei >85% verbraucht', async ({ page }) => {
  resetConfig({ apartments: [makeApt('rl-high', 'RL Hoch')] });
  await mockTado(page, {
    'rl-high': { body: tadoData({ rateLimit: {
      used: 900, remaining: 100, limit: 1000, windowSec: 86400,
      fetchedAt: new Date().toISOString(), source: 'header'
    }}) }
  });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="tado-ratelimit"]');
  await expect(slot.locator('.text-danger')).toBeVisible();
});

test('AC2c: Rate-Limit-Zahl wird gelb bei 60-85% verbraucht', async ({ page }) => {
  resetConfig({ apartments: [makeApt('rl-mid', 'RL Mittel')] });
  await mockTado(page, {
    'rl-mid': { body: tadoData({ rateLimit: {
      used: 700, remaining: 300, limit: 1000, windowSec: 86400,
      fetchedAt: new Date().toISOString(), source: 'header'
    }}) }
  });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="tado-ratelimit"]');
  await expect(slot.locator('.text-warning')).toBeVisible();
});

test('AC2d: Ohne Header wird nur der lokale Counter gezeigt', async ({ page }) => {
  resetConfig({ apartments: [makeApt('rl-count', 'RL Count')] });
  await mockTado(page, {
    'rl-count': { body: tadoData({ rateLimit: {
      used: 5, remaining: null, limit: null, windowSec: 86400,
      fetchedAt: new Date().toISOString(), source: 'count'
    }}) }
  });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="tado-ratelimit"]');
  await expect(slot).toContainText('5');
  await expect(slot).toContainText('heute');
});

// ── AC3: Räume-Slot zeigt Ø-Temperatur und Presence ──────────────────────────

test('AC3: Räume-Slot zeigt Durchschnittstemperatur und HOME/AWAY', async ({ page }) => {
  resetConfig({ apartments: [makeApt('avg', 'Avg Test')] });
  await mockTado(page, {
    'avg': { body: tadoData({
      presence: 'HOME',
      averageTemperature: 21.3,
      rooms: [room('WZ'), room('Bad')]
    }) }
  });
  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="tado-rooms"]');
  await expect(slot).toContainText('21.3');
  await expect(slot).toContainText('HOME');
});

test('AC3b: Räume-Slot zeigt AWAY wenn presence=AWAY', async ({ page }) => {
  resetConfig({ apartments: [makeApt('away', 'Away')] });
  await mockTado(page, {
    'away': { body: tadoData({ presence: 'AWAY', rooms: [room('WZ')] }) }
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="tado-rooms"]')).toContainText('AWAY');
});

// ── AC4: Raumzeile zeigt alle Status-Indikatoren ────────────────────────────

test('AC4: Raumzeile zeigt Name, Ist-/Ziel-Temp und Feuchte', async ({ page }) => {
  resetConfig({ apartments: [makeApt('room', 'Raum Test')] });
  await mockTado(page, {
    'room': { body: tadoData({ rooms: [
      room('Wohnzimmer', { currentTemp: 20.5, targetTemp: 21, humidity: 48 })
    ]}) }
  });
  await page.goto('http://localhost:3100/');
  const row = page.locator('.room-row').first();
  await expect(row).toContainText('Wohnzimmer');
  await expect(row).toContainText('20.5°');
  await expect(row).toContainText('21°');
  await expect(row).toContainText('48%');
});

test('AC4b: Heizen-Indikator 🔥 erscheint bei heating=true', async ({ page }) => {
  resetConfig({ apartments: [makeApt('heat', 'Heizt')] });
  await mockTado(page, {
    'heat': { body: tadoData({ rooms: [room('Heizend', { heating: true })] }) }
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.room-row__icons').first()).toContainText('🔥');
});

test('AC4c: Fenster-Indikator 🪟 erscheint bei windowOpen=true', async ({ page }) => {
  resetConfig({ apartments: [makeApt('win', 'Fenster')] });
  await mockTado(page, {
    'win': { body: tadoData({ rooms: [room('Offen', { windowOpen: true })] }) }
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.room-row__icons').first()).toContainText('🪟');
});

test('AC4d: Offline-Indikator ⚠ und Dimming bei offline=true', async ({ page }) => {
  resetConfig({ apartments: [makeApt('off', 'Offline')] });
  await mockTado(page, {
    'off': { body: tadoData({ rooms: [room('Off', { offline: true })] }) }
  });
  await page.goto('http://localhost:3100/');
  const row = page.locator('.room-row').first();
  await expect(row).toHaveClass(/room-row--offline/);
});

test('AC4e: Batterie-Indikator 🔋 erscheint bei batteryLow=true', async ({ page }) => {
  resetConfig({ apartments: [makeApt('bat', 'Batterie')] });
  await mockTado(page, {
    'bat': { body: tadoData({ rooms: [room('Low', { batteryLow: true })] }) }
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.room-row__icons').first()).toContainText('🔋');
});

// ── AC5: Leere Raumliste ────────────────────────────────────────────────────

test('AC5: Leere Raumliste zeigt "Keine Raeume"', async ({ page }) => {
  resetConfig({ apartments: [makeApt('empty', 'Leer')] });
  await mockTado(page, {
    'empty': { body: tadoData({ rooms: [], averageTemperature: null }) }
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="tado-rooms"]')).toContainText('Keine Raeume');
});

// ── AC6: Fetch-Fehler ───────────────────────────────────────────────────────

test('AC6: Fehler ohne Cache zeigt Warnung in beiden Slots', async ({ page }) => {
  resetConfig({ apartments: [makeApt('err', 'Fehler')] });
  await mockTado(page, {
    'err': { status: 502, body: { error: 'Login fehlgeschlagen' } }
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="tado-ratelimit"]')).toContainText('Tado nicht erreichbar');
  await expect(page.locator('[data-slot="tado-rooms"]')).toContainText('Login fehlgeschlagen');
});

// ── AC7: Stale-Fallback ─────────────────────────────────────────────────────

test('AC7: Stale-Fallback zeigt "letzter Stand"', async ({ page }) => {
  resetConfig({ apartments: [makeApt('stale', 'Stale')] });
  await mockTado(page, {
    'stale': { body: tadoData({
      stale: true,
      error: 'Network down',
      rooms: [room('WZ')]
    }) }
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="tado-rooms"]')).toContainText('letzter Stand');
});

// ── AC8: Mehrere Wohnungen mit unterschiedlichen Zuständen ──────────────────

test('AC8: Mehrere Wohnungen laden unabhaengig (V3 + X gemischt)', async ({ page }) => {
  resetConfig({
    apartments: [
      makeApt('apt-v3', 'V3 Apt', { kind: 'V3' }),
      makeApt('apt-x',  'X Apt',  { kind: 'X' })
    ]
  });
  await mockTado(page, {
    'apt-v3': { body: tadoData({ kind: 'V3', rooms: [room('V3 Raum')] }) },
    'apt-x':  { body: tadoData({ kind: 'X',  rooms: [room('X Raum')] }) }
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.apartment-card')).toHaveCount(2);
  await expect(page.locator('[data-slot="tado-rooms"]').nth(0)).toContainText('V3 Raum');
  await expect(page.locator('[data-slot="tado-rooms"]').nth(1)).toContainText('X Raum');
});

// ── AC9: XSS in Raumnamen wird escaped ──────────────────────────────────────

test('AC9: XSS in Raumnamen wird escaped', async ({ page }) => {
  resetConfig({ apartments: [makeApt('xss', 'XSS')] });
  await mockTado(page, {
    'xss': { body: tadoData({ rooms: [
      room('<img src=x onerror="window.TADO_XSS=1">')
    ]}) }
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.room-row').first()).toContainText('<img src=x');
  const xss = await page.evaluate(() => window.TADO_XSS);
  expect(xss).toBeUndefined();
});

// ── AC10: Null-Werte werden korrekt als "—" angezeigt ───────────────────────

test('AC10: Raum ohne Temperatur zeigt "—" statt null', async ({ page }) => {
  resetConfig({ apartments: [makeApt('null', 'Null')] });
  await mockTado(page, {
    'null': { body: tadoData({
      averageTemperature: null,
      rooms: [room('Leer', { currentTemp: null, targetTemp: null, humidity: null })]
    }) }
  });
  await page.goto('http://localhost:3100/');
  const row = page.locator('.room-row').first();
  await expect(row).toContainText('—');
});
