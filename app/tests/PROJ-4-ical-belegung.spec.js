/**
 * PROJ-4: iCal / Belegungsintegration – E2E-Tests
 *
 * Die /api/occupancy/:id-Route wird via page.route() gemockt, um die verschiedenen
 * Zustände (belegt, frei, Fehler, stale) unabhängig von einem echten iCal-Server zu testen.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { APARTMENTS: CONFIG_PATH } = require('./test-helpers');

function resetConfig(data = { apartments: [] }) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function makeApartment(id, name, { enabled = true, icalUrl = 'https://example.com/cal.ics', location = '' } = {}) {
  return {
    id, name, location, visible: true,
    occupancy: { enabled, icalUrl },
    integrations: {
      tado:  { enabled: false, kind: 'V3', email: '', password: '', homeId: null },
      minut: { enabled: false, deviceId: '' },
      nuki:  { enabled: false, deviceIds: [] }
    }
  };
}

// ── Helper: Mock /api/occupancy/:id responses ──────────────────────────────

async function mockOccupancy(page, responses) {
  await page.route('**/api/occupancy/**', async (route) => {
    const url = route.request().url();
    const id = url.split('/').pop();
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

test.beforeEach(() => resetConfig());
test.afterAll(() => resetConfig());

// ── AC1: Belegungs-Slot erscheint nur bei aktivem iCal ──────────────────────

test('AC1: Wohnung ohne iCal zeigt keinen Belegungs-Slot', async ({ page }) => {
  resetConfig({
    apartments: [makeApartment('no-ical', 'Ohne iCal', { enabled: false })]
  });
  await page.goto('http://localhost:3100/');
  await expect(page.locator('.apartment-card')).toHaveCount(1);
  await expect(page.locator('[data-slot="belegung"]')).toHaveCount(0);
});

test('AC1b: Wohnung mit iCal zeigt Belegungs-Slot', async ({ page }) => {
  resetConfig({
    apartments: [makeApartment('with-ical', 'Mit iCal')]
  });

  await mockOccupancy(page, {
    'with-ical': {
      status: 200,
      body: {
        occupied: false,
        statusLabel: 'Frei',
        currentBooking: null,
        nextBooking: null,
        cached: false,
        stale: false,
        fetchedAt: new Date().toISOString()
      }
    }
  });

  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="belegung"]')).toBeVisible();
});

// ── AC2: Variante A – belegt, Gastname + bis-Datum ──────────────────────────

test('AC2: Belegte Wohnung zeigt Gastname und Check-out-Datum', async ({ page }) => {
  resetConfig({
    apartments: [makeApartment('occupied', 'Belegt')]
  });

  await mockOccupancy(page, {
    'occupied': {
      body: {
        occupied: true,
        statusLabel: 'Gast da',
        currentBooking: { title: 'Max Muster', checkIn: '2026-04-14', checkOut: '2026-04-18' },
        nextBooking: null,
        cached: false,
        stale: false,
        fetchedAt: new Date().toISOString()
      }
    }
  });

  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="belegung"]');
  await expect(slot).toContainText('Max Muster');
  await expect(slot).toContainText('bis 18.04.');
});

test('AC2b: Belegte Wohnung zeigt Status-Badge "Gast da"', async ({ page }) => {
  resetConfig({
    apartments: [makeApartment('occupied', 'Belegt')]
  });

  await mockOccupancy(page, {
    'occupied': {
      body: {
        occupied: true,
        statusLabel: 'Gast da',
        currentBooking: { title: 'Anna', checkIn: '2026-04-10', checkOut: '2026-04-20' },
        nextBooking: null,
        cached: false, stale: false,
        fetchedAt: new Date().toISOString()
      }
    }
  });

  await page.goto('http://localhost:3100/');
  const badge = page.locator('.apartment-card__head .badge');
  await expect(badge).toContainText('Gast da');
});

// ── AC3: Variante B – frei mit nächster Buchung ─────────────────────────────

test('AC3: Freie Wohnung mit kommender Buchung zeigt "Naechste: ... ab DATUM"', async ({ page }) => {
  resetConfig({ apartments: [makeApartment('free-next', 'Frei+Next')] });

  await mockOccupancy(page, {
    'free-next': {
      body: {
        occupied: false,
        statusLabel: 'Frei',
        currentBooking: null,
        nextBooking: { title: 'Lisa Beispiel', checkIn: '2026-04-25', checkOut: '2026-04-28' },
        cached: false, stale: false,
        fetchedAt: new Date().toISOString()
      }
    }
  });

  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="belegung"]');
  await expect(slot).toContainText('Naechste');
  await expect(slot).toContainText('Lisa Beispiel');
  await expect(slot).toContainText('ab 25.04.');

  const badge = page.locator('.apartment-card__head .badge');
  await expect(badge).toContainText('Frei');
});

// ── AC4: Variante C – frei, keine Buchung ───────────────────────────────────

test('AC4: Freie Wohnung ohne Buchung zeigt "Keine Buchung"', async ({ page }) => {
  resetConfig({ apartments: [makeApartment('empty-cal', 'Leer')] });

  await mockOccupancy(page, {
    'empty-cal': {
      body: {
        occupied: false,
        statusLabel: 'Frei',
        currentBooking: null,
        nextBooking: null,
        cached: false, stale: false,
        fetchedAt: new Date().toISOString()
      }
    }
  });

  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="belegung"]')).toContainText('Keine Buchung');
});

// ── AC5: Variante D – Fehler ohne Cache ─────────────────────────────────────

test('AC5: Fetch-Fehler ohne Cache zeigt Warn-Text "iCal nicht erreichbar"', async ({ page }) => {
  resetConfig({ apartments: [makeApartment('err-no-cache', 'Fehler')] });

  await mockOccupancy(page, {
    'err-no-cache': {
      status: 502,
      body: { error: 'iCal konnte nicht abgerufen werden.' }
    }
  });

  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="belegung"]')).toContainText('iCal nicht erreichbar');
});

test('AC5b: Fetch-Fehler zeigt "?"-Badge im Kartenkopf', async ({ page }) => {
  resetConfig({ apartments: [makeApartment('err-badge', 'Fehler Badge')] });

  await mockOccupancy(page, {
    'err-badge': { status: 502, body: { error: 'x' } }
  });

  await page.goto('http://localhost:3100/');
  const badge = page.locator('.apartment-card__head .badge');
  await expect(badge).toContainText('?');
});

// ── AC6: Stale-Fallback zeigt "letzter Stand" Markierung ────────────────────

test('AC6: Stale-Fallback zeigt letzten bekannten Stand mit Markierung', async ({ page }) => {
  resetConfig({ apartments: [makeApartment('stale', 'Stale Test')] });

  await mockOccupancy(page, {
    'stale': {
      body: {
        occupied: true,
        statusLabel: 'Gast da',
        currentBooking: { title: 'Carl Stale', checkIn: '2026-04-10', checkOut: '2026-04-17' },
        nextBooking: null,
        cached: true,
        stale: true,
        error: 'Network down',
        fetchedAt: new Date().toISOString()
      }
    }
  });

  await page.goto('http://localhost:3100/');
  const slot = page.locator('[data-slot="belegung"]');
  await expect(slot).toContainText('Carl Stale');
  await expect(slot).toContainText('letzter Stand');
});

// ── AC7: Chip "Gast da" filtert Wohnungen ───────────────────────────────────

test('AC7: Chip "Gast da" filtert nur belegte Wohnungen', async ({ page }) => {
  resetConfig({
    apartments: [
      makeApartment('apt-1', 'Belegt 1'),
      makeApartment('apt-2', 'Frei 1'),
      makeApartment('apt-3', 'Belegt 2')
    ]
  });

  await mockOccupancy(page, {
    'apt-1': {
      body: {
        occupied: true, statusLabel: 'Gast da',
        currentBooking: { title: 'A', checkIn: '2026-04-14', checkOut: '2026-04-20' },
        nextBooking: null, cached: false, stale: false, fetchedAt: new Date().toISOString()
      }
    },
    'apt-2': {
      body: {
        occupied: false, statusLabel: 'Frei',
        currentBooking: null, nextBooking: null, cached: false, stale: false, fetchedAt: new Date().toISOString()
      }
    },
    'apt-3': {
      body: {
        occupied: true, statusLabel: 'Gast da',
        currentBooking: { title: 'C', checkIn: '2026-04-12', checkOut: '2026-04-19' },
        nextBooking: null, cached: false, stale: false, fetchedAt: new Date().toISOString()
      }
    }
  });

  await page.goto('http://localhost:3100/');
  // Warten bis alle Occupancy-Antworten eingetroffen sind
  await expect(page.locator('.apartment-card')).toHaveCount(3);
  await expect(page.locator('.badge', { hasText: 'Gast da' })).toHaveCount(2);

  // Filter aktivieren
  await page.locator('.chip', { hasText: 'Gast da' }).click();

  // Nur 2 belegte Wohnungen sichtbar
  await expect(page.locator('.apartment-card')).toHaveCount(2);
  await expect(page.locator('.apartment-card')).toContainText(['Belegt 1', 'Belegt 2']);
});

test('AC7b: Chip "Gast da" ohne Treffer zeigt Empty-State', async ({ page }) => {
  resetConfig({
    apartments: [makeApartment('only-free', 'Nur Frei')]
  });

  await mockOccupancy(page, {
    'only-free': {
      body: {
        occupied: false, statusLabel: 'Frei',
        currentBooking: null, nextBooking: null, cached: false, stale: false, fetchedAt: new Date().toISOString()
      }
    }
  });

  await page.goto('http://localhost:3100/');
  // Warten bis Occupancy geladen
  await expect(page.locator('[data-slot="belegung"]')).toContainText('Keine Buchung');

  await page.locator('.chip', { hasText: 'Gast da' }).click();
  await expect(page.locator('.empty-state')).toContainText('Keine Wohnung hat aktuell einen Gast');
});

// ── AC8: XSS in Gastname wird escaped ───────────────────────────────────────

test('AC8: XSS in Gastname wird escaped und nicht ausgefuehrt', async ({ page }) => {
  resetConfig({ apartments: [makeApartment('xss', 'XSS Test')] });

  await mockOccupancy(page, {
    'xss': {
      body: {
        occupied: true, statusLabel: 'Gast da',
        currentBooking: {
          title: '<img src=x onerror="window.XSS=1">',
          checkIn: '2026-04-14', checkOut: '2026-04-18'
        },
        nextBooking: null, cached: false, stale: false, fetchedAt: new Date().toISOString()
      }
    }
  });

  await page.goto('http://localhost:3100/');
  await expect(page.locator('[data-slot="belegung"]')).toContainText('<img src=x');
  const xss = await page.evaluate(() => window.XSS);
  expect(xss).toBeUndefined();
});
