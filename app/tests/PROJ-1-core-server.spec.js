const { test, expect, request } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const { APARTMENTS: CONFIG_PATH } = require('./test-helpers')

function resetConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ apartments: [] }, null, 2), 'utf-8')
}

test.beforeEach(() => resetConfig())
test.afterAll(() => resetConfig())

// ── AC1: npm start startet den Server ────────────────────────────��───────────
test('AC1: Server antwortet auf Port 3100', async ({ request }) => {
  const res = await request.get('/')
  expect(res.ok()).toBeTruthy()
})

// ── AC2: GET / liefert index.html ────────────────────────────────────────────
test('AC2: GET / liefert Dashboard-HTML', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/FaecherLofts/i)
  await expect(page.locator('.app-header .logo')).toBeVisible()
  await expect(page.locator('#apartments-grid')).toBeVisible()
})

// ── AC3: GET /setup liefert setup.html ───────────────────────────────────────
test('AC3: GET /setup liefert Setup-HTML', async ({ page }) => {
  await page.goto('/setup')
  await expect(page).toHaveTitle(/Setup/i)
  await expect(page.locator('#setup-root')).toBeVisible()
})

// ── AC4: GET /api/apartments JSON ────────────────────────────────────────────
test('AC4: GET /api/apartments gibt JSON-Array zurueck', async ({ request }) => {
  const res = await request.get('/api/apartments')
  expect(res.ok()).toBeTruthy()
  expect(res.headers()['content-type']).toMatch(/application\/json/)
  const body = await res.json()
  expect(Array.isArray(body)).toBe(true)
})

// ── AC5: Vollstaendige Wohnungsstruktur ──────────────────────────────────────
test('AC5: POST /api/apartments erstellt Wohnung mit vollstaendiger Struktur', async ({ request }) => {
  const res = await request.post('/api/apartments', {
    data: { name: 'Black Forest 1', location: 'IK12C' }
  })
  expect(res.status()).toBe(201)
  const apt = await res.json()

  expect(apt.id).toBe('black-forest-1')
  expect(apt.name).toBe('Black Forest 1')
  expect(apt.location).toBe('IK12C')
  expect(apt.visible).toBe(true)
  expect(apt.occupancy).toMatchObject({ enabled: false, icalUrl: '' })
  expect(apt.integrations.tado).toMatchObject({ enabled: false, kind: 'V3' })
  expect(apt.integrations.minut).toMatchObject({ enabled: false, deviceId: '' })
  expect(apt.integrations.nuki).toMatchObject({ enabled: false, deviceIds: [] })
})

// ── AC6: ENV / Port-Config ───────────────────────────────────────────────────
test('AC6: .env.example existiert mit allen Pflicht-Variablen', async () => {
  const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf-8')
  expect(example).toMatch('PORT')
  expect(example).toMatch('MINUT_CLIENT_ID')
  expect(example).toMatch('MINUT_CLIENT_SECRET')
  expect(example).toMatch('NUKI_API_TOKEN')
})

// ── AC7: Projektstruktur ──────────────────────────────────────────────────────
test('AC7: Alle Pflichtverzeichnisse vorhanden', async () => {
  const base = path.join(__dirname, '..')
  const dirs = ['config', 'services', 'normalizers', 'routes', 'public']
  for (const dir of dirs) {
    expect(fs.existsSync(path.join(base, dir)), `${dir}/ fehlt`).toBe(true)
  }
})

// ── AC7b: Service-Dateien vorhanden ──────────────────────────────────────────
// Ab PROJ-5 ist tado ein Verzeichnis (tado/index.js) statt einer Datei.
test('AC7b: Alle Service-Dateien vorhanden', async () => {
  const base = path.join(__dirname, '..', 'services')
  for (const file of ['minut.js', 'nuki.js', 'occupancy.js']) {
    expect(fs.existsSync(path.join(base, file)), `services/${file} fehlt`).toBe(true)
  }
  expect(fs.existsSync(path.join(base, 'tado', 'index.js')), 'services/tado/index.js fehlt').toBe(true)
})

// ── AC8: Cross-Platform (Windows-Pfade) ──────────────────────────────────────
test('AC8: Server laeuft und antwortet auf Windows (forward-slash paths)', async ({ request }) => {
  const res = await request.get('/api/apartments')
  expect(res.ok()).toBeTruthy()
})

// ── AC9: Fehlerbehandlung Config ──────────────────────────────────────────────
test('AC9: Fehlende apartments.json liefert leeres Array (kein Crash)', async ({ request }) => {
  // Benennen statt loeschen, damit cleanup einfacher ist
  const backup = CONFIG_PATH + '.bak'
  fs.renameSync(CONFIG_PATH, backup)
  try {
    const res = await request.get('/api/apartments')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  } finally {
    fs.renameSync(backup, CONFIG_PATH)
  }
})

// ── Dashboard: Empty State ────────────────────────────────────────────────────
test('Dashboard zeigt Empty-State wenn keine Wohnungen konfiguriert', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.empty-state')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('.empty-state a[href="/setup"]')).toBeVisible()
})

// ── Dashboard: Wohnungskarten sichtbar ───────────────────────────────────────
test('Dashboard zeigt Wohnungskarte nach Anlegen einer Wohnung', async ({ request, page }) => {
  await request.post('/api/apartments', {
    data: { name: 'Anzeige Test', location: 'AT1', visible: true }
  })
  await page.goto('/')
  // At least one card visible (parallel tests may create > 1)
  await expect(page.locator('.apartment-card').first()).toBeVisible({ timeout: 3000 })
  await expect(page.locator('.apartment-card strong').first()).toContainText('Anzeige Test')
})

// ── Setup: Navigation ─────────────────────────────────────────────────────────
test('Navigation zwischen Dashboard und Setup funktioniert', async ({ page }) => {
  await page.goto('/')
  await page.click('nav a[href="/setup"]')
  await expect(page).toHaveURL('/setup')
  await page.click('nav a[href="/"]')
  await expect(page).toHaveURL('/')
})

// ── Responsive: Mobile ────────────────────────────────────────────────────────
test('Dashboard ist auf 375px Viewport nutzbar', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.locator('.app-header')).toBeVisible()
  await expect(page.locator('#apartments-grid')).toBeVisible()
})
