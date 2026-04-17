import { describe, it, expect } from 'vitest'
const n = require('./minut.js')

describe('normalizeDevice', () => {
  it('normalisiert typische Minut-Antwort', () => {
    const raw = {
      device_id: 'abc123',
      description: 'Wohnzimmer-Sensor',
      device_type: 'point',
      battery: { percent: 85 },
      last_heard_from_at: new Date().toISOString()
    }
    const r = n.normalizeDevice(raw)
    expect(r.deviceId).toBe('abc123')
    expect(r.deviceName).toBe('Wohnzimmer-Sensor')
    expect(r.batteryPercent).toBe(85)
    expect(r.batteryLow).toBe(false)
    expect(r.offline).toBe(false)
  })

  it('batteryLow=true bei < 30%', () => {
    const raw = { device_id: 'x', battery: { percent: 25 } }
    expect(n.normalizeDevice(raw).batteryLow).toBe(true)
  })

  it('batteryPercent=null wird durchgereicht, batteryLow=false', () => {
    const raw = { device_id: 'x' }
    const r = n.normalizeDevice(raw)
    expect(r.batteryPercent).toBeNull()
    expect(r.batteryLow).toBe(false)
  })

  it('offline=true bei last_heard_from_at > 24h', () => {
    const old = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
    const r = n.normalizeDevice({ device_id: 'x', last_heard_from_at: old })
    expect(r.offline).toBe(true)
  })

  it('wirft bei leerer Antwort', () => {
    expect(() => n.normalizeDevice(null)).toThrow(/ungueltig|leer/i)
  })

  it('akzeptiert device-Feld als Wrapper', () => {
    const raw = {
      device: {
        device_id: 'y',
        device_name: 'Bad',
        battery: { percent: 50 }
      }
    }
    const r = n.normalizeDevice(raw)
    expect(r.deviceId).toBe('y')
    expect(r.deviceName).toBe('Bad')
  })
})

describe('normalizeTimeSeries', () => {
  it('verarbeitet Tupel [timestamp, value]', () => {
    const ts = Math.floor(Date.now() / 1000)
    const r = n.normalizeTimeSeries([[ts, 21.5]])
    expect(r).toHaveLength(1)
    expect(r[0].value).toBe(21.5)
    expect(r[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('verarbeitet Objekt-Form', () => {
    const r = n.normalizeTimeSeries([{ timestamp: '2026-04-15T12:00:00Z', value: 42 }])
    expect(r[0].value).toBe(42)
  })

  it('liefert leeres Array bei null', () => {
    expect(n.normalizeTimeSeries(null)).toEqual([])
  })
})
