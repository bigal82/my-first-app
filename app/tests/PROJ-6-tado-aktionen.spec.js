/**
 * PROJ-6: Tado Aktionen & Rate-Limit-Handling – E2E-Tests
 *
 * Wir mocken alle /api/tado/*-Endpoints via page.route(), damit keine echte
 * Heizung geschaltet wird. Getestet wird die Dashboard-UI:
 *   - Button-Verhalten (Lock, Re-Render, Fehlermeldung)
 *   - Confirm-Dialog bei "Alles aus"
 *   - Teilerfolg-Reporting
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { APARTMENTS: CONFIG_PATH } = require('./test-helpers');

function resetConfig(data = { apartments: [] }) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function makeApt(id, name) {
  return {
    id, name, location: '', visible: true,
    occupancy: { enabled: false, icalUrl: '' },
    integrations: {
      tado: { enabled: true, kind: 'V3', email: '', password: '', homeId: null },
      minut: { enabled: false, deviceId: '' },
      nuki: { enabled: false, deviceIds: [] }
    }
  };
}

function tadoData(overrides = {}) {
  return {
    kind: 'V3',
    homeId: 123456,
    presence: 'HOME',
    averageTemperature: 21,
    rooms: [
      { id: 1, name: 'Wohnzimmer', currentTemp: 21, targetTemp: 21, humidity: 45,
        heating: false, powerOn: true, offline: false, windowOpen: false, batteryLow: false },
      { id: 2, name: 'Bad', currentTemp: 22, targetTemp: 24, humidity: 60,
        heating: true, powerOn: true, offline: false, windowOpen: false, batteryLow: false }
    ],
    rateLimit: {
      used: 10, remaining: 990, limit: 1000, windowSec: 86400,
      fetchedAt: new Date().toISOString(), source: 'header'
    },
    cached: false,
    stale: false,
    fetchedAt: new Date().toISOString(),
    ...overrides
  };
}

async function mockTadoRoute(page, { getData = tadoData(), actionResponse = { success: true, message: 'ok', updatedAt: new Date().toISOString() }, actionStatus = 200 } = {}) {
  const actionLog = [];
  await page.route('**/api/tado/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // GET /api/tado/:id → Daten
    if (method === 'GET' && url.match(/\/api\/tado\/[^/]+$/)) {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(getData)
      });
      return;
    }

    // POST-Aktion
    if (method === 'POST') {
      actionLog.push({ url, method });
      await route.fulfill({
        status: actionStatus,
        contentType: 'application/json',
        body: JSON.stringify(actionResponse)
      });
      return;
    }

    // Fallback
    await route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) });
  });
  return actionLog;
}

test.beforeEach(() => resetConfig());
test.afterAll(() => resetConfig());

// ── AC1: Action-Slots werden nur bei aktivem Tado gerendert ─────────────────

test('AC1: Wohnung ohne Tado zeigt disabled Placeholder-Aktion', async ({ page }) => {
  resetConfig({
    apartments: [{
      id: 'notado', name: 'Ohne Tado', location: '', visible: true,
      occupancy: { enabled: false, icalUrl: '' },
      integrations: {
        tado: { enabled: false, kind: 'V3' },
        minut: { enabled: false },
        nuki: { enabled: false }
      }
    }]
  });
  await page.goto('http://localhost:3100/');
  const actions = page.locator('[data-slot="actions"]');
  await expect(actions).toBeVisible();
  // Keine Tado-Aktion-Buttons
  await expect(page.locator('.js-tado-all-off')).toHaveCount(0);
});

test('AC1b: Wohnung mit Tado zeigt alle 4 Karten-Aktions-Buttons', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  await mockTadoRoute(page);
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.js-tado-all-off')).toBeVisible();
  await expect(page.locator('.js-tado-resume-all')).toBeVisible();
  await expect(page.locator('.js-tado-home')).toBeVisible();
  await expect(page.locator('.js-tado-away')).toBeVisible();
});

// ── AC2: Aktuelle Presence visuell markiert ─────────────────────────────────

test('AC2: HOME-Button ist aktiv bei presence=HOME', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  await mockTadoRoute(page, { getData: tadoData({ presence: 'HOME' }) });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.js-tado-home')).toHaveClass(/btn--primary/);
  await expect(page.locator('.js-tado-away')).toHaveClass(/btn--ghost/);
});

test('AC2b: AWAY-Button ist aktiv bei presence=AWAY', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  await mockTadoRoute(page, { getData: tadoData({ presence: 'AWAY' }) });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.js-tado-away')).toHaveClass(/btn--primary/);
  await expect(page.locator('.js-tado-home')).toHaveClass(/btn--ghost/);
});

// ── AC3: Raumzeilen haben Aus/Plan Buttons ─────────────────────────────────

test('AC3: Jede Raumzeile hat [Aus]- und [Plan]-Button', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  await mockTadoRoute(page);
  await page.goto('http://localhost:3100/');
  const rooms = page.locator('.room-row');
  await expect(rooms).toHaveCount(2);
  await expect(page.locator('.js-tado-room-off')).toHaveCount(2);
  await expect(page.locator('.js-tado-room-resume')).toHaveCount(2);
});

// ── AC4: Klick auf "Aus" ruft richtige Route auf ────────────────────────────

test('AC4: Klick auf Raum-Aus triggert POST /rooms/:id/off', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  const actionLog = await mockTadoRoute(page);
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.js-tado-room-off').first()).toBeVisible();

  await page.locator('.js-tado-room-off').first().click();

  await expect.poll(() => actionLog.some(e => e.url.includes('/rooms/1/off'))).toBe(true);
});

test('AC4b: Klick auf Raum-Plan triggert POST /rooms/:id/resume', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  const actionLog = await mockTadoRoute(page);
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.js-tado-room-resume').first()).toBeVisible();

  await page.locator('.js-tado-room-resume').first().click();

  await expect.poll(() => actionLog.some(e => e.url.includes('/rooms/1/resume'))).toBe(true);
});

// ── AC5: "Alles aus" zeigt Confirm-Dialog ──────────────────────────────────

test('AC5: Klick auf "Alles aus" zeigt Bestaetigungsdialog', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  const actionLog = await mockTadoRoute(page);
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.js-tado-all-off')).toBeVisible();

  // Dialog ablehnen → kein POST
  page.once('dialog', d => d.dismiss());
  await page.locator('.js-tado-all-off').click();
  await page.waitForTimeout(300);
  expect(actionLog.some(e => e.url.includes('/all-off'))).toBe(false);

  // Dialog annehmen → POST
  page.once('dialog', d => d.accept());
  await page.locator('.js-tado-all-off').click();
  await expect.poll(() => actionLog.some(e => e.url.includes('/all-off'))).toBe(true);
});

// ── AC6: HOME/AWAY-Aktionen ────────────────────────────────────────────────

test('AC6: Klick auf HOME triggert POST /home', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  const actionLog = await mockTadoRoute(page, { getData: tadoData({ presence: 'AWAY' }) });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.js-tado-home')).toBeVisible();

  await page.locator('.js-tado-home').click();
  await expect.poll(() => actionLog.some(e => e.url.endsWith('/home'))).toBe(true);
});

test('AC6b: Klick auf AWAY triggert POST /away', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  const actionLog = await mockTadoRoute(page);
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.js-tado-away')).toBeVisible();

  await page.locator('.js-tado-away').click();
  await expect.poll(() => actionLog.some(e => e.url.endsWith('/away'))).toBe(true);
});

// ── AC7: Fehlerhandling ────────────────────────────────────────────────────

test('AC7: Fehlerhafte Aktion zeigt Alert', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  await mockTadoRoute(page, {
    actionStatus: 429,
    actionResponse: { success: false, error: 'Rate-Limit erschoepft', code: 'RATE_LIMIT' }
  });

  const dialogPromise = new Promise(resolve => {
    page.once('dialog', d => {
      resolve(d.message());
      d.accept();
    });
  });

  await page.goto('http://localhost:3100/');
  await expect(page.locator('.js-tado-home')).toBeVisible();
  await page.locator('.js-tado-home').click();

  const message = await dialogPromise;
  expect(message).toMatch(/Rate-Limit|fehlgeschlagen/i);
});

// ── AC8: Button-Lock waehrend Aktion ───────────────────────────────────────

test('AC8: Button ist während laufender Aktion disabled', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });

  // Action-Mock mit kuenstlicher Verzoegerung
  await page.route('**/api/tado/**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'GET' && url.match(/\/api\/tado\/[^/]+$/)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tadoData()) });
      return;
    }
    if (method === 'POST') {
      await new Promise(r => setTimeout(r, 500));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'ok', updatedAt: new Date().toISOString() }) });
      return;
    }
    await route.fulfill({ status: 404, body: '{}' });
  });

  await page.goto('http://localhost:3100/');
  const btn = page.locator('.js-tado-home');
  await expect(btn).toBeVisible();

  await btn.click();
  // Waehrend des Calls sollte der Button disabled sein
  await expect(btn).toBeDisabled();
  // Danach wieder aktiv
  await expect(btn).toBeEnabled({ timeout: 3000 });
});

// ── AC9: XSS in action response ────────────────────────────────────────────

test('AC9: XSS in Fehler-Message wird nicht ausgefuehrt', async ({ page }) => {
  resetConfig({ apartments: [makeApt('a', 'A')] });
  await mockTadoRoute(page, {
    actionStatus: 500,
    actionResponse: { success: false, error: '<img src=x onerror="window.ACT_XSS=1">' }
  });

  page.once('dialog', d => d.accept());
  await page.goto('http://localhost:3100/');
  await page.locator('.js-tado-home').click();
  await page.waitForTimeout(300);

  const xss = await page.evaluate(() => window.ACT_XSS);
  expect(xss).toBeUndefined();
});
