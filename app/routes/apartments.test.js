import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import fs from 'fs'
import path from 'path'

// ── Test-Isolation: tests laufen in process.env.CONFIG_DIR (tmp) ────────────

const CONFIG_DIR = process.env.CONFIG_DIR
const ORIG_CONFIG = path.join(CONFIG_DIR, 'apartments.json')

// Patch the module to use the test config file.
// We stub the path by writing it to the config dir and resetting after.
function patchConfigPath(filePath) {
  // apartments.js uses __dirname to resolve the path.
  // Since we can't easily mock fs in CJS-loaded modules,
  // we swap the ACTUAL apartments.json with test content for each test.
  const original = fs.existsSync(ORIG_CONFIG)
    ? fs.readFileSync(ORIG_CONFIG, 'utf-8')
    : '{"apartments":[]}'
  fs.writeFileSync(ORIG_CONFIG, filePath)
  return () => fs.writeFileSync(ORIG_CONFIG, original)
}

// ── App factory (re-require to get fresh router) ─────────────────────────────
// We can't re-require in ESM easily, so we test via supertest on a real app
// and reset the config file contents before/after each test.

function makeApp() {
  // Fresh express app with the apartments router
  const app = express()
  app.use(express.json())
  // Dynamically require the router (CJS side-effect free)
  const router = require('./apartments.js')
  app.use('/api/apartments', router)
  return app
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resetConfig(data = { apartments: [] }) {
  fs.writeFileSync(ORIG_CONFIG, JSON.stringify(data, null, 2), 'utf-8')
}

let app

beforeEach(() => {
  resetConfig()
  app = makeApp()
})

afterEach(() => {
  resetConfig()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/apartments', () => {
  it('gibt leeres Array zurueck wenn keine Wohnungen konfiguriert sind', async () => {
    const res = await request(app).get('/api/apartments')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('gibt vorhandene Wohnungen zurueck', async () => {
    resetConfig({
      apartments: [
        { id: 'test-1', name: 'Test Eins', location: 'T1', visible: true,
          occupancy: { enabled: false, icalUrl: '' },
          integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
        }
      ]
    })
    const res = await request(app).get('/api/apartments')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('test-1')
  })
})

describe('POST /api/apartments', () => {
  it('legt eine neue Wohnung mit vollstaendiger Struktur an', async () => {
    const res = await request(app)
      .post('/api/apartments')
      .send({ name: 'Black Forest 1', location: 'IK12C' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe('black-forest-1')
    expect(res.body.name).toBe('Black Forest 1')
    expect(res.body.location).toBe('IK12C')
    expect(res.body.visible).toBe(true)
    expect(res.body.occupancy).toBeDefined()
    expect(res.body.integrations.tado).toBeDefined()
    expect(res.body.integrations.minut).toBeDefined()
    expect(res.body.integrations.nuki).toBeDefined()
  })

  it('gibt 400 zurueck wenn Name fehlt', async () => {
    const res = await request(app)
      .post('/api/apartments')
      .send({ location: 'T1' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Name/i)
  })

  it('gibt 400 zurueck wenn Name leer ist', async () => {
    const res = await request(app)
      .post('/api/apartments')
      .send({ name: '', location: 'T1' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Name/i)
  })

  it('gibt 400 zurueck wenn Name nur Leerzeichen ist', async () => {
    const res = await request(app)
      .post('/api/apartments')
      .send({ name: '   ' })

    expect(res.status).toBe(400)
  })

  it('generiert eindeutige ID bei doppeltem Namen', async () => {
    await request(app).post('/api/apartments').send({ name: 'Doppelt' })
    const res = await request(app).post('/api/apartments').send({ name: 'Doppelt' })

    expect(res.status).toBe(201)
    const allRes = await request(app).get('/api/apartments')
    const ids = allRes.body.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length) // alle IDs einzigartig
  })

  it('setzt visible=true als Standard', async () => {
    const res = await request(app)
      .post('/api/apartments')
      .send({ name: 'Wohnung' })

    expect(res.body.visible).toBe(true)
  })

  it('speichert die Wohnung in apartments.json', async () => {
    await request(app).post('/api/apartments').send({ name: 'Persistent' })

    const saved = JSON.parse(fs.readFileSync(ORIG_CONFIG, 'utf-8'))
    expect(saved.apartments).toHaveLength(1)
    expect(saved.apartments[0].name).toBe('Persistent')
  })
})

describe('PUT /api/apartments/:id', () => {
  beforeEach(async () => {
    await request(app).post('/api/apartments').send({ name: 'Update Test', location: 'UT1' })
  })

  it('aktualisiert ein vorhandenes Feld', async () => {
    const res = await request(app)
      .put('/api/apartments/update-test')
      .send({ visible: false })

    expect(res.status).toBe(200)
    expect(res.body.visible).toBe(false)
    expect(res.body.name).toBe('Update Test') // nicht ueberschrieben
  })

  it('bewahrt die ID unveraendert', async () => {
    const res = await request(app)
      .put('/api/apartments/update-test')
      .send({ id: 'manipulated-id', name: 'Geaendert' })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('update-test') // ID unveraendert
  })

  it('gibt 404 bei nicht-existenter ID', async () => {
    const res = await request(app)
      .put('/api/apartments/gibts-nicht')
      .send({ visible: false })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/apartments/:id', () => {
  beforeEach(async () => {
    await request(app).post('/api/apartments').send({ name: 'Zu Loeschen' })
  })

  it('loescht eine vorhandene Wohnung', async () => {
    const delRes = await request(app).delete('/api/apartments/zu-loeschen')
    expect(delRes.status).toBe(200)
    expect(delRes.body.success).toBe(true)

    const getRes = await request(app).get('/api/apartments')
    expect(getRes.body).toHaveLength(0)
  })

  it('gibt 404 bei nicht-existenter ID', async () => {
    const res = await request(app).delete('/api/apartments/gibts-nicht')
    expect(res.status).toBe(404)
  })
})

describe('ID-Generierung', () => {
  it('slugifiziert Umlaute und Sonderzeichen korrekt', async () => {
    const res = await request(app)
      .post('/api/apartments')
      .send({ name: 'München Mitte 1' })

    expect(res.status).toBe(201)
    // Umlaute werden entfernt/ersetzt, Spaces zu Bindestrichen
    expect(res.body.id).toMatch(/^[a-z0-9-]+$/)
  })

  it('erzeugt valide ID aus einfachem Namen', async () => {
    const res = await request(app)
      .post('/api/apartments')
      .send({ name: 'Black Forest 1' })

    expect(res.body.id).toBe('black-forest-1')
  })
})
