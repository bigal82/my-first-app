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

function makeApt(id, { enabled = true, deviceIds = ['d1'] } = {}) {
  return {
    id, name: id, location: '', visible: true,
    occupancy: { enabled: false, icalUrl: '' },
    integrations: {
      tado: { enabled: false },
      minut: { enabled: false, deviceId: '' },
      nuki: { enabled, deviceIds }
    }
  }
}

function makeApp() {
  const app = express()
  app.use(express.json())
  const router = require('./nuki.js')
  app.use('/api/nuki', router)
  return app
}

beforeEach(() => {
  resetConfig()
  clearIntegrations()
  delete process.env.NUKI_API_TOKEN
  const nuki = require('../services/nuki.js')
  nuki._clearCaches()
})

afterEach(() => {
  resetConfig()
  clearIntegrations()
  vi.restoreAllMocks()
})

describe('GET /api/nuki/devices', () => {
  it('gibt 503 wenn kein Token konfiguriert', async () => {
    const res = await request(makeApp()).get('/api/nuki/devices')
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/Nuki/i)
  })

  it('liefert Geraete-Liste bei Erfolg', async () => {
    setIntegrations({ nuki: { apiToken: 'token123' } })
    const apiList = [
      { smartlockId: 'l1', name: 'Haustür', type: 0, state: { state: 1, batteryChargeState: 80 }, serverState: 0 },
      { smartlockId: 'o1', name: 'Hof', type: 2, state: { state: 1 } }
    ]
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiList, text: async () => '',
      headers: { get: () => null }
    })
    const res = await request(makeApp()).get('/api/nuki/devices')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].type).toBe('Lock')
    expect(res.body[1].type).toBe('Opener')
  })
})

describe('GET /api/nuki/:apartmentId', () => {
  it('gibt 404 bei unbekannter Wohnung', async () => {
    const res = await request(makeApp()).get('/api/nuki/nope')
    expect(res.status).toBe(404)
  })

  it('gibt 400 wenn Nuki deaktiviert', async () => {
    resetConfig({ apartments: [makeApt('a', { enabled: false })] })
    const res = await request(makeApp()).get('/api/nuki/a')
    expect(res.status).toBe(400)
  })

  it('gibt 400 wenn keine Device-IDs zugeordnet', async () => {
    resetConfig({ apartments: [makeApt('a', { deviceIds: [] })] })
    const res = await request(makeApp()).get('/api/nuki/a')
    expect(res.status).toBe(400)
  })

  it('gibt 503 wenn kein Token konfiguriert', async () => {
    resetConfig({ apartments: [makeApt('a', { deviceIds: ['d1'] })] })
    const res = await request(makeApp()).get('/api/nuki/a')
    expect(res.status).toBe(503)
  })

  it('filtert auf zugeordnete deviceIds und liefert normalisierte Daten', async () => {
    resetConfig({ apartments: [makeApt('a', { deviceIds: ['l1'] })] })
    setIntegrations({ nuki: { apiToken: 'token123' } })
    const apiList = [
      { smartlockId: 'l1', name: 'Haustür', type: 0, state: { state: 1, batteryChargeState: 80 }, serverState: 0 },
      { smartlockId: 'o1', name: 'Hof',     type: 2, state: { state: 1 } }
    ]
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => apiList, text: async () => '',
      headers: { get: () => null }
    })

    const res = await request(makeApp()).get('/api/nuki/a')
    expect(res.status).toBe(200)
    expect(res.body.devices).toHaveLength(1)
    expect(res.body.devices[0].id).toBe('l1')
    expect(res.body.devices[0].name).toBe('Haustür')
    expect(res.body.devices[0].batteryPercent).toBe(80)
  })
})
