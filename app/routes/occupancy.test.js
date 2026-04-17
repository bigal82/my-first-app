import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import fs from 'fs'
import path from 'path'

const CONFIG_DIR = process.env.CONFIG_DIR
const CONFIG_PATH = path.join(CONFIG_DIR, 'apartments.json')

function resetConfig(data = { apartments: [] }) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

function makeApartment(id, { enabled = true, icalUrl = 'https://example.com/cal.ics' } = {}) {
  return {
    id, name: id, location: '', visible: true,
    occupancy: { enabled, icalUrl },
    integrations: {
      tado:  { enabled: false },
      minut: { enabled: false },
      nuki:  { enabled: false }
    }
  }
}

function makeApp() {
  const app = express()
  app.use(express.json())
  const router = require('./occupancy.js')
  app.use('/api/occupancy', router)
  return app
}

const emptyIcal = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR\r\n'

beforeEach(() => {
  resetConfig()
  // Cache leeren vor jedem Test
  const svc = require('../services/occupancy.js')
  svc._clearCache()
})

afterEach(() => {
  resetConfig()
  vi.restoreAllMocks()
})

describe('GET /api/occupancy/:apartmentId', () => {
  it('gibt 404 zurueck wenn Wohnung nicht existiert', async () => {
    const app = makeApp()
    const res = await request(app).get('/api/occupancy/gibts-nicht')
    expect(res.status).toBe(404)
  })

  it('gibt 400 zurueck wenn iCal-Integration deaktiviert ist', async () => {
    resetConfig({ apartments: [makeApartment('no-ical', { enabled: false })] })
    const app = makeApp()
    const res = await request(app).get('/api/occupancy/no-ical')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/nicht aktiv/i)
  })

  it('gibt 400 zurueck wenn iCal-URL leer ist', async () => {
    resetConfig({ apartments: [makeApartment('empty-url', { icalUrl: '' })] })
    const app = makeApp()
    const res = await request(app).get('/api/occupancy/empty-url')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/iCal-URL/i)
  })

  it('liefert "frei" bei leerem Kalender', async () => {
    resetConfig({ apartments: [makeApartment('free-apt')] })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => emptyIcal })

    const app = makeApp()
    const res = await request(app).get('/api/occupancy/free-apt')
    expect(res.status).toBe(200)
    expect(res.body.occupied).toBe(false)
    expect(res.body.statusLabel).toBe('Frei')
  })

  it('gibt 502 zurueck wenn iCal-Server nicht erreichbar und kein Cache', async () => {
    resetConfig({ apartments: [makeApartment('unreachable')] })
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const app = makeApp()
    const res = await request(app).get('/api/occupancy/unreachable')
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/iCal/i)
  })
})
