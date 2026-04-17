import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import fs from 'fs'
import path from 'path'

const CONFIG_DIR = process.env.CONFIG_DIR
const CONFIG_PATH = path.join(CONFIG_DIR, 'apartments.json')
const TOKENS_PATH = path.join(CONFIG_DIR, 'tado-tokens.json')

function resetConfig(data = { apartments: [] }) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

function resetTokens(data = {}) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

function clearTokens() {
  if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH)
}

function makeApt(id, { kind = 'V3', enabled = true } = {}) {
  return {
    id, name: id, location: '', visible: true,
    occupancy: { enabled: false, icalUrl: '' },
    integrations: {
      tado:  { enabled, kind, email: '', password: '', homeId: null },
      minut: { enabled: false },
      nuki:  { enabled: false }
    }
  }
}

function makeApp() {
  const app = express()
  app.use(express.json())
  const router = require('./tado.js')
  app.use('/api/tado', router)
  return app
}

// Mock-Headers mit der get()-API
function mockHeaders(extra = {}) {
  const map = new Map(Object.entries(extra))
  return {
    get: (k) => map.get(String(k).toLowerCase()) ?? null
  }
}

function mockJson(body, extra = {}) {
  return {
    ok: true, status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: mockHeaders(extra)
  }
}

// V3-Datenfluss mocken (optimiert): /me → /homes/:id/state → /homes/:id/zones → /homes/:id/zoneStates
function mockV3FetchSequence() {
  const me = { homes: [{ id: 1234567, name: 'TestHome' }] }
  const state = { presence: 'HOME' }
  const zones = [{ id: 1, name: 'WZ', devices: [{ connectionState: { value: true } }] }]
  const zoneStateBody = {
    setting: { power: 'ON', temperature: { celsius: 21 } },
    sensorDataPoints: { insideTemperature: { celsius: 20 }, humidity: { percentage: 50 } },
    activityDataPoints: { heatingPower: { percentage: 40 } },
    openWindow: null
  }
  const zoneStatesBulk = { zoneStates: { 1: zoneStateBody } }

  const responses = [
    // 1. Refresh-Token → Access-Token (POST)
    mockJson({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    // 2. GET /me
    mockJson(me),
    // 3. GET /homes/:id/state
    mockJson(state),
    // 4. GET /homes/:id/zones
    mockJson(zones),
    // 5. GET /homes/:id/zoneStates (bulk, ersetzt per-zone state calls)
    mockJson(zoneStatesBulk)
  ]
  let idx = 0
  global.fetch = vi.fn().mockImplementation(() => {
    const r = responses[idx++] || { ok: false, status: 500, text: async () => '', headers: mockHeaders() }
    return Promise.resolve(r)
  })
}

beforeEach(() => {
  resetConfig()
  clearTokens()
  const tokenStore = require('../services/tado/tokenStore.js')
  const dataCache = require('../services/tado/dataCache.js')
  const v3 = require('../services/tado/v3Client.js')
  const x = require('../services/tado/xClient.js')
  const guard = require('../services/tado/rateLimitGuard.js')
  const lock = require('../services/tado/actionLock.js')
  tokenStore._clearAll()
  dataCache._clearAll()
  v3._clearRateLimits()
  x._clearRateLimits()
  guard._clearAll()
  lock._clearAll()
})

afterEach(() => {
  resetConfig()
  clearTokens()
  vi.restoreAllMocks()
})

// ── Route-Tests ──────────────────────────────────────────────────────────────

describe('GET /api/tado/:apartmentId', () => {
  it('gibt 404 bei unbekannter Wohnung', async () => {
    const res = await request(makeApp()).get('/api/tado/gibts-nicht')
    expect(res.status).toBe(404)
  })

  it('gibt 400 wenn Tado-Integration deaktiviert ist', async () => {
    resetConfig({ apartments: [makeApt('a', { enabled: false })] })
    const res = await request(makeApp()).get('/api/tado/a')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/nicht aktiv/i)
  })

  it('gibt 400 wenn kein Refresh-Token gespeichert ist', async () => {
    resetConfig({ apartments: [makeApt('a')] })
    const res = await request(makeApp()).get('/api/tado/a')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('NOT_AUTHORIZED')
  })

  it('V3: liefert normalisierte Daten bei Erfolg (mit Refresh-Token)', async () => {
    resetConfig({ apartments: [makeApt('v3-apt', { kind: 'V3' })] })
    resetTokens({ 'v3-apt': { refreshToken: 'RT-stored', fetchedAt: new Date().toISOString() } })
    mockV3FetchSequence()

    const res = await request(makeApp()).get('/api/tado/v3-apt')
    expect(res.status).toBe(200)
    expect(res.body.kind).toBe('V3')
    expect(res.body.presence).toBe('HOME')
    expect(Array.isArray(res.body.rooms)).toBe(true)
    expect(res.body.rooms[0].name).toBe('WZ')
    expect(res.body.rateLimit).toBeDefined()
    expect(res.body.rateLimit.source).toBeDefined()
    // Bei Mock-fetch werden keine echten Header geliefert → source='count'
    expect(['count', 'header']).toContain(res.body.rateLimit.source)
  })

  it('V3: zweiter Aufruf kommt aus dem Cache (cached=true)', async () => {
    resetConfig({ apartments: [makeApt('v3-cached', { kind: 'V3' })] })
    resetTokens({ 'v3-cached': { refreshToken: 'RT-stored', fetchedAt: new Date().toISOString() } })
    mockV3FetchSequence()

    const first = await request(makeApp()).get('/api/tado/v3-cached')
    expect(first.status).toBe(200)
    expect(first.body.cached).toBe(false)

    const second = await request(makeApp()).get('/api/tado/v3-cached')
    expect(second.status).toBe(200)
    expect(second.body.cached).toBe(true)
  })

  it('gibt 502 bei Tado-Fehler (und keinem Cache)', async () => {
    resetConfig({ apartments: [makeApt('err', { kind: 'V3' })] })
    resetTokens({ 'err': { refreshToken: 'RT-stored', fetchedAt: new Date().toISOString() } })
    // Refresh klappt, aber alle folgenden Calls scheitern
    let callNo = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callNo++
      if (callNo === 1) {
        return Promise.resolve(mockJson({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }))
      }
      return Promise.resolve({ ok: false, status: 500, text: async () => 'server down', json: async () => ({}), headers: mockHeaders() })
    })

    const res = await request(makeApp()).get('/api/tado/err')
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/Tado/i)
  })
})

// ── Auth-Routen ──────────────────────────────────────────────────────────────

describe('Auth-Routen', () => {
  it('GET /auth/status liefert authorized=false ohne Token', async () => {
    resetConfig({ apartments: [makeApt('a')] })
    const res = await request(makeApp()).get('/api/tado/a/auth/status')
    expect(res.status).toBe(200)
    expect(res.body.authorized).toBe(false)
  })

  it('GET /auth/status liefert authorized=true mit Token', async () => {
    resetConfig({ apartments: [makeApt('a')] })
    resetTokens({ 'a': { refreshToken: 'RT', fetchedAt: new Date().toISOString() } })
    const res = await request(makeApp()).get('/api/tado/a/auth/status')
    expect(res.body.authorized).toBe(true)
  })

  it('DELETE /auth entfernt den Refresh-Token', async () => {
    resetConfig({ apartments: [makeApt('a')] })
    resetTokens({ 'a': { refreshToken: 'RT', fetchedAt: new Date().toISOString() } })
    const res = await request(makeApp()).delete('/api/tado/a/auth')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const statusRes = await request(makeApp()).get('/api/tado/a/auth/status')
    expect(statusRes.body.authorized).toBe(false)
  })

  it('POST /auth/poll ohne gestarteten Flow liefert not_started', async () => {
    resetConfig({ apartments: [makeApt('a')] })
    const res = await request(makeApp()).post('/api/tado/a/auth/poll')
    expect(res.body.status).toBe('not_started')
  })
})

// ── Action-Routen (PROJ-6) ──────────────────────────────────────────────────

describe('Schreib-Aktionen', () => {
  it('POST /rooms/:id/off liefert 404 bei unbekannter Wohnung', async () => {
    const res = await request(makeApp()).post('/api/tado/gibts-nicht/rooms/1/off')
    expect(res.status).toBe(404)
  })

  it('POST /rooms/:id/off liefert 500 ohne Auth (Dispatcher wirft 401)', async () => {
    resetConfig({ apartments: [makeApt('a', { enabled: true })] })
    const res = await request(makeApp()).post('/api/tado/a/rooms/1/off')
    expect([401, 500]).toContain(res.status) // dispatcher wirft {status:401}
  })

  it('GET /ratelimit liefert 404 wenn noch kein Cache', async () => {
    resetConfig({ apartments: [makeApt('a')] })
    const res = await request(makeApp()).get('/api/tado/a/ratelimit')
    expect(res.status).toBe(404)
  })

  it('POST /all-off liefert 404 bei unbekannter Wohnung', async () => {
    const res = await request(makeApp()).post('/api/tado/nope/all-off')
    expect(res.status).toBe(404)
  })

  it('POST /home liefert 404 bei unbekannter Wohnung', async () => {
    const res = await request(makeApp()).post('/api/tado/nope/home')
    expect(res.status).toBe(404)
  })

  it('POST /away liefert 404 bei unbekannter Wohnung', async () => {
    const res = await request(makeApp()).post('/api/tado/nope/away')
    expect(res.status).toBe(404)
  })
})
