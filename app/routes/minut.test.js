import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import fs from 'fs'
import path from 'path'

const CONFIG_DIR = process.env.CONFIG_DIR
const CONFIG_PATH = path.join(CONFIG_DIR, 'apartments.json')
const INTEGRATIONS_PATH = path.join(CONFIG_DIR, 'integrations.json')

function resetConfig(data = { apartments: [] }) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8')
}
function clearIntegrations() {
  if (fs.existsSync(INTEGRATIONS_PATH)) fs.unlinkSync(INTEGRATIONS_PATH)
}
function setIntegrations(data) {
  fs.writeFileSync(INTEGRATIONS_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

function makeApp() {
  const app = express()
  app.use(express.json())
  const router = require('./minut.js')
  app.use('/api/minut', router)
  return app
}

function mockHeaders() {
  return { get: () => null }
}

const origClientId = process.env.MINUT_CLIENT_ID
const origClientSecret = process.env.MINUT_CLIENT_SECRET

beforeEach(() => {
  resetConfig()
  clearIntegrations()
  delete process.env.MINUT_CLIENT_ID
  delete process.env.MINUT_CLIENT_SECRET
  const minut = require('../services/minut.js')
  minut._clearCaches()
})

afterEach(() => {
  resetConfig()
  clearIntegrations()
  if (origClientId === undefined) delete process.env.MINUT_CLIENT_ID
  else process.env.MINUT_CLIENT_ID = origClientId
  if (origClientSecret === undefined) delete process.env.MINUT_CLIENT_SECRET
  else process.env.MINUT_CLIENT_SECRET = origClientSecret
  vi.restoreAllMocks()
})

describe('GET /api/minut/devices', () => {
  it('gibt 503 mit Fehlermeldung zurueck wenn keine Credentials', async () => {
    const res = await request(makeApp()).get('/api/minut/devices')
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/Minut/i)
    expect(Array.isArray(res.body.devices)).toBe(true)
  })

  it('gibt 503 wenn nur clientId gesetzt', async () => {
    setIntegrations({ minut: { clientId: 'id', clientSecret: '' } })
    const res = await request(makeApp()).get('/api/minut/devices')
    expect(res.status).toBe(503)
  })

  it('liefert Geraete wenn Credentials gesetzt und fetch erfolgreich', async () => {
    setIntegrations({ minut: { clientId: 'id', clientSecret: 'sec' } })
    const token = { access_token: 'AT', expires_in: 3600 }
    const homes = { homes: [{ home_id: 'h1', name: 'Schwarzwald' }] }
    const devices = { devices: [{ device_id: 'd1', description: 'Sensor A', device_type: 'point', home_id: 'h1' }] }

    // 1. Token-Call (POST), 2./3. parallel: /homes + /devices
    global.fetch = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/oauth/token')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => token, text: async () => '', headers: mockHeaders() })
      }
      if (String(url).endsWith('/homes')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => homes, text: async () => '', headers: mockHeaders() })
      }
      if (String(url).endsWith('/devices')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => devices, text: async () => '', headers: mockHeaders() })
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}), headers: mockHeaders() })
    })

    const res = await request(makeApp()).get('/api/minut/devices')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('d1')
    // Label enthaelt Home-Name und Device-Name
    expect(res.body[0].name).toContain('Schwarzwald')
    expect(res.body[0].name).toContain('Sensor A')
  })
})

describe('GET /api/minut/:apartmentId', () => {
  it('gibt 404 bei unbekannter Wohnung', async () => {
    const res = await request(makeApp()).get('/api/minut/gibts-nicht')
    expect(res.status).toBe(404)
  })

  it('gibt 400 wenn Minut-Integration deaktiviert', async () => {
    resetConfig({
      apartments: [{
        id: 'a', name: 'A', location: '', visible: true,
        occupancy: { enabled: false, icalUrl: '' },
        integrations: {
          tado: { enabled: false },
          minut: { enabled: false, deviceId: '' },
          nuki: { enabled: false }
        }
      }]
    })
    const res = await request(makeApp()).get('/api/minut/a')
    expect(res.status).toBe(400)
  })

  it('gibt 400 wenn kein Geraet zugeordnet', async () => {
    resetConfig({
      apartments: [{
        id: 'a', name: 'A', location: '', visible: true,
        occupancy: { enabled: false, icalUrl: '' },
        integrations: {
          tado: { enabled: false },
          minut: { enabled: true, deviceId: '' },
          nuki: { enabled: false }
        }
      }]
    })
    const res = await request(makeApp()).get('/api/minut/a')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Geraet/i)
  })

  it('gibt 503 wenn keine Credentials gesetzt', async () => {
    resetConfig({
      apartments: [{
        id: 'a', name: 'A', location: '', visible: true,
        occupancy: { enabled: false, icalUrl: '' },
        integrations: {
          tado: { enabled: false },
          minut: { enabled: true, deviceId: 'd1' },
          nuki: { enabled: false }
        }
      }]
    })
    const res = await request(makeApp()).get('/api/minut/a')
    expect(res.status).toBe(503)
  })

  it('liefert normalisierte Device-Daten bei Erfolg', async () => {
    resetConfig({
      apartments: [{
        id: 'a', name: 'A', location: '', visible: true,
        occupancy: { enabled: false, icalUrl: '' },
        integrations: {
          tado: { enabled: false },
          minut: { enabled: true, deviceId: 'd1' },
          nuki: { enabled: false }
        }
      }]
    })
    setIntegrations({ minut: { clientId: 'id', clientSecret: 'sec' } })

    const token = { access_token: 'AT', expires_in: 3600 }
    const device = {
      device_id: 'd1',
      description: 'Wohnzimmer',
      battery: { percent: 77 },
      last_heard_from_at: new Date().toISOString()
    }
    let call = 0
    global.fetch = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) return Promise.resolve({ ok: true, status: 200, json: async () => token, text: async () => '', headers: mockHeaders() })
      return Promise.resolve({ ok: true, status: 200, json: async () => device, text: async () => '', headers: mockHeaders() })
    })

    const res = await request(makeApp()).get('/api/minut/a')
    expect(res.status).toBe(200)
    expect(res.body.deviceName).toBe('Wohnzimmer')
    expect(res.body.batteryPercent).toBe(77)
    expect(res.body.batteryLow).toBe(false)
    expect(res.body.offline).toBe(false)
  })
})

// ── PROJ-8: History + Noise-Profile ─────────────────────────────────────────

describe('GET /api/minut/:id/history', () => {
  function setupApartmentWithMinut() {
    resetConfig({
      apartments: [{
        id: 'a', name: 'A', location: '', visible: true,
        occupancy: { enabled: false, icalUrl: '' },
        integrations: {
          tado: { enabled: false },
          minut: { enabled: true, deviceId: 'd1' },
          nuki: { enabled: false }
        }
      }]
    })
    setIntegrations({ minut: { clientId: 'id', clientSecret: 'sec' } })
  }

  it('gibt 404 bei unbekannter Wohnung', async () => {
    const res = await request(makeApp()).get('/api/minut/nope/history?range=24h')
    expect(res.status).toBe(404)
  })

  it('gibt 400 wenn Minut deaktiviert', async () => {
    resetConfig({
      apartments: [{
        id: 'a', name: 'A', location: '', visible: true,
        occupancy: { enabled: false, icalUrl: '' },
        integrations: { tado: { enabled: false }, minut: { enabled: false }, nuki: { enabled: false } }
      }]
    })
    const res = await request(makeApp()).get('/api/minut/a/history')
    expect(res.status).toBe(400)
  })

  it('liefert History-Struktur bei Erfolg', async () => {
    setupApartmentWithMinut()
    const token = { access_token: 'AT', expires_in: 3600 }
    const emptySeries = { values: [] }
    global.fetch = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/oauth/token')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => token, text: async () => '', headers: mockHeaders() })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => emptySeries, text: async () => '', headers: mockHeaders() })
    })

    const res = await request(makeApp()).get('/api/minut/a/history?range=24h')
    expect(res.status).toBe(200)
    expect(res.body.range).toBe('24h')
    expect(Array.isArray(res.body.temperature)).toBe(true)
    expect(Array.isArray(res.body.humidity)).toBe(true)
    expect(Array.isArray(res.body.noise)).toBe(true)
    expect(Array.isArray(res.body.motion)).toBe(true)
  })

  it('akzeptiert nur gueltige Range-Werte, fallback auf 24h', async () => {
    setupApartmentWithMinut()
    const token = { access_token: 'AT', expires_in: 3600 }
    global.fetch = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/oauth/token')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => token, text: async () => '', headers: mockHeaders() })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ values: [] }), text: async () => '', headers: mockHeaders() })
    })
    const res = await request(makeApp()).get('/api/minut/a/history?range=invalid')
    expect(res.body.range).toBe('24h')
  })
})

describe('GET /api/minut/:id/noise-profile', () => {
  it('gibt 404 bei unbekannter Wohnung', async () => {
    const res = await request(makeApp()).get('/api/minut/nope/noise-profile')
    expect(res.status).toBe(404)
  })
})
