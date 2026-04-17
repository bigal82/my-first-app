import { describe, it, expect } from 'vitest'
const n = require('./tado.js')

// ── V3 Raum-Normalisierung ───────────────────────────────────────────────────

describe('normalizeV3Room', () => {
  it('normalisiert eine typische V3 Zone mit Sensor + Target', () => {
    const zone = {
      id: 1, name: 'Wohnzimmer',
      devices: [{ connectionState: { value: true }, batteryState: 'NORMAL' }],
      state: {
        setting: { power: 'ON', temperature: { celsius: 21.0 } },
        sensorDataPoints: {
          insideTemperature: { celsius: 20.34 },
          humidity: { percentage: 48.7 }
        },
        activityDataPoints: { heatingPower: { percentage: 35 } },
        openWindow: null
      }
    }
    const r = n.normalizeV3Room(zone)
    expect(r.id).toBe(1)
    expect(r.name).toBe('Wohnzimmer')
    expect(r.currentTemp).toBe(20.3)
    expect(r.targetTemp).toBe(21)
    expect(r.humidity).toBe(49)
    expect(r.heating).toBe(true)
    expect(r.powerOn).toBe(true)
    expect(r.offline).toBe(false)
    expect(r.windowOpen).toBe(false)
    expect(r.batteryLow).toBe(false)
  })

  it('windowOpen wird true wenn openWindow-Objekt existiert', () => {
    const zone = {
      id: 2, name: 'Bad',
      devices: [{ connectionState: { value: true } }],
      state: {
        setting: { power: 'ON', temperature: { celsius: 22 } },
        sensorDataPoints: { insideTemperature: { celsius: 19 } },
        activityDataPoints: { heatingPower: { percentage: 0 } },
        openWindow: { detectedTime: '2026-04-14T10:00:00Z' }
      }
    }
    expect(n.normalizeV3Room(zone).windowOpen).toBe(true)
  })

  it('batteryLow=true wenn mindestens ein Device LOW hat', () => {
    const zone = {
      id: 3, name: 'Test',
      devices: [
        { connectionState: { value: true }, batteryState: 'NORMAL' },
        { connectionState: { value: true }, batteryState: 'LOW' }
      ],
      state: { setting: { power: 'OFF' }, sensorDataPoints: {}, activityDataPoints: {} }
    }
    expect(n.normalizeV3Room(zone).batteryLow).toBe(true)
  })

  it('offline=true wenn alle Devices offline sind', () => {
    const zone = {
      id: 4, name: 'Offline',
      devices: [
        { connectionState: { value: false } },
        { connectionState: { value: false } }
      ],
      state: { setting: { power: 'ON' }, sensorDataPoints: {}, activityDataPoints: {} }
    }
    expect(n.normalizeV3Room(zone).offline).toBe(true)
  })

  it('powerOn=false wenn setting.power=OFF', () => {
    const zone = {
      id: 5, name: 'Aus',
      devices: [{ connectionState: { value: true } }],
      state: { setting: { power: 'OFF' }, sensorDataPoints: {}, activityDataPoints: {} }
    }
    const r = n.normalizeV3Room(zone)
    expect(r.powerOn).toBe(false)
    expect(r.targetTemp).toBeNull()
  })

  it('mode=schedule wenn kein overlay (V3)', () => {
    const zone = {
      id: 9, name: 'X',
      devices: [{ connectionState: { value: true } }],
      state: {
        setting: { power: 'ON', temperature: { celsius: 21 } },
        sensorDataPoints: {}, activityDataPoints: {},
        overlay: null
      }
    }
    expect(n.normalizeV3Room(zone).mode).toBe('schedule')
  })

  it('mode=manual wenn overlay mit power=ON (V3)', () => {
    const zone = {
      id: 10, name: 'X',
      devices: [{ connectionState: { value: true } }],
      state: {
        setting: { power: 'ON', temperature: { celsius: 21 } },
        sensorDataPoints: {}, activityDataPoints: {},
        overlay: { setting: { power: 'ON', temperature: { celsius: 18 } } }
      }
    }
    expect(n.normalizeV3Room(zone).mode).toBe('manual')
  })

  it('mode=off wenn overlay mit power=OFF (V3)', () => {
    const zone = {
      id: 11, name: 'X',
      devices: [{ connectionState: { value: true } }],
      state: {
        setting: { power: 'OFF' },
        sensorDataPoints: {}, activityDataPoints: {},
        overlay: { setting: { power: 'OFF' } }
      }
    }
    expect(n.normalizeV3Room(zone).mode).toBe('off')
  })

  it('Raum ohne Sensor: alle Null-Felder ohne Absturz', () => {
    const zone = {
      id: 6, name: 'Leer',
      devices: [],
      state: { setting: {}, sensorDataPoints: {}, activityDataPoints: {}, openWindow: null }
    }
    const r = n.normalizeV3Room(zone)
    expect(r.currentTemp).toBeNull()
    expect(r.targetTemp).toBeNull()
    expect(r.humidity).toBeNull()
    expect(r.windowOpen).toBe(false)
  })
})

// ── V3 Presence ──────────────────────────────────────────────────────────────

describe('normalizeV3Presence', () => {
  it('liefert HOME bei presence=HOME', () => {
    expect(n.normalizeV3Presence({ presence: 'HOME' })).toBe('HOME')
  })
  it('liefert AWAY bei presence=AWAY', () => {
    expect(n.normalizeV3Presence({ presence: 'AWAY' })).toBe('AWAY')
  })
  it('liefert null wenn presence fehlt', () => {
    expect(n.normalizeV3Presence({})).toBeNull()
  })
})

// ── X Raum-Normalisierung ────────────────────────────────────────────────────

describe('normalizeXRoom', () => {
  // Tado X (hops.tado.com) liefert temperaturen unter .value statt .celsius,
  // und heatingPower.percentage top-level statt heatingActive.
  it('normalisiert einen typischen X Raum (hops-API Schema)', () => {
    const room = {
      id: 11, name: 'Schlafzimmer',
      connection: { state: 'CONNECTED' },
      setting: { power: 'ON', temperature: { value: 19.5 } },
      sensorDataPoints: {
        insideTemperature: { value: 18.7 },
        humidity: { percentage: 52 }
      },
      heatingPower: { percentage: 40 },
      openWindow: null
    }
    const r = n.normalizeXRoom(room)
    expect(r.currentTemp).toBe(18.7)
    expect(r.targetTemp).toBe(19.5)
    expect(r.humidity).toBe(52)
    expect(r.heating).toBe(true)
    expect(r.powerOn).toBe(true)
    expect(r.windowOpen).toBe(false)
    expect(r.offline).toBe(false)
  })

  it('X mode=schedule wenn manualControlTermination null', () => {
    const room = {
      id: 20, name: 'X',
      connection: { state: 'CONNECTED' },
      setting: { power: 'ON', temperature: { value: 21 } },
      sensorDataPoints: {},
      heatingPower: { percentage: 0 },
      manualControlTermination: null
    }
    expect(n.normalizeXRoom(room).mode).toBe('schedule')
  })

  it('X mode=manual wenn manualControlTermination gesetzt + power=ON', () => {
    const room = {
      id: 21, name: 'X',
      connection: { state: 'CONNECTED' },
      setting: { power: 'ON', temperature: { value: 22 } },
      sensorDataPoints: {},
      heatingPower: { percentage: 100 },
      manualControlTermination: { type: 'TIMER' }
    }
    expect(n.normalizeXRoom(room).mode).toBe('manual')
  })

  it('X mode=off wenn manualControlTermination gesetzt + power=OFF', () => {
    const room = {
      id: 22, name: 'X',
      connection: { state: 'CONNECTED' },
      setting: { power: 'OFF' },
      sensorDataPoints: {},
      heatingPower: { percentage: 0 },
      manualControlTermination: { type: 'MANUAL' }
    }
    expect(n.normalizeXRoom(room).mode).toBe('off')
  })

  it('heatingPower=0 → heating=false', () => {
    const room = {
      id: 12, name: 'x',
      connection: { state: 'CONNECTED' },
      setting: {},
      sensorDataPoints: {},
      heatingPower: { percentage: 0 },
      openWindow: null
    }
    const r = n.normalizeXRoom(room)
    expect(r.heating).toBe(false)
    expect(r.windowOpen).toBe(false)
  })

  it('openWindow-Objekt → windowOpen=true', () => {
    const room = {
      id: 13, name: 'x',
      connection: { state: 'CONNECTED' },
      setting: {},
      sensorDataPoints: {},
      heatingPower: { percentage: 0 },
      openWindow: { detectedTime: '2026-04-15T10:00:00Z' }
    }
    expect(n.normalizeXRoom(room).windowOpen).toBe(true)
  })

  it('connection.state=DISCONNECTED → offline=true', () => {
    const room = {
      id: 14, name: 'x',
      connection: { state: 'DISCONNECTED' },
      setting: { power: 'ON' },
      sensorDataPoints: {},
      heatingPower: { percentage: 0 }
    }
    expect(n.normalizeXRoom(room).offline).toBe(true)
  })
})

// ── Aggregation ──────────────────────────────────────────────────────────────

describe('computeAverageTemperature', () => {
  it('berechnet Durchschnitt ueber alle Raeume mit currentTemp', () => {
    const rooms = [
      { currentTemp: 20 },
      { currentTemp: 22 },
      { currentTemp: null }
    ]
    expect(n.computeAverageTemperature(rooms)).toBe(21)
  })

  it('liefert null wenn kein Raum Temperatur hat', () => {
    expect(n.computeAverageTemperature([{ currentTemp: null }, { currentTemp: null }])).toBeNull()
    expect(n.computeAverageTemperature([])).toBeNull()
  })
})

// ── End-to-end normalize() ───────────────────────────────────────────────────

describe('normalize', () => {
  it('V3: baut komplette Shape mit Raeumen, presence, rateLimit', () => {
    const raw = {
      home: { presence: 'HOME' },
      zones: [
        {
          id: 1, name: 'WZ',
          devices: [{ connectionState: { value: true }, batteryState: 'NORMAL' }],
          state: {
            setting: { power: 'ON', temperature: { celsius: 21 } },
            sensorDataPoints: { insideTemperature: { celsius: 20 }, humidity: { percentage: 50 } },
            activityDataPoints: { heatingPower: { percentage: 50 } },
            openWindow: null
          }
        }
      ]
    }
    const rateLimit = { used: 5, limit: 100, windowHours: 24 }
    const result = n.normalize('V3', raw, rateLimit)

    expect(result.kind).toBe('V3')
    expect(result.presence).toBe('HOME')
    expect(result.averageTemperature).toBe(20)
    expect(result.rooms).toHaveLength(1)
    expect(result.rooms[0].name).toBe('WZ')
    expect(result.rateLimit).toEqual(rateLimit)
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('X: baut komplette Shape (hops-Schema)', () => {
    const raw = {
      home: { presence: 'AWAY' },
      rooms: [
        {
          id: 1, name: 'Bad',
          connection: { state: 'CONNECTED' },
          setting: { power: 'ON', temperature: { value: 22 } },
          sensorDataPoints: { insideTemperature: { value: 21.5 }, humidity: { percentage: 60 } },
          heatingPower: { percentage: 0 },
          openWindow: null
        }
      ]
    }
    const result = n.normalize('X', raw, { used: 1, limit: 100, windowHours: 24 })
    expect(result.kind).toBe('X')
    expect(result.presence).toBe('AWAY')
    expect(result.averageTemperature).toBe(21.5)
    expect(result.rooms[0].heating).toBe(false)
  })

  it('wirft Fehler bei unbekanntem kind', () => {
    expect(() => n.normalize('Y', {})).toThrow(/Unbekannt/)
  })

  it('leere Raumliste → keine Durchschnitts-Temperatur, kein Absturz', () => {
    const result = n.normalize('V3', { home: { presence: 'HOME' }, zones: [] })
    expect(result.rooms).toHaveLength(0)
    expect(result.averageTemperature).toBeNull()
  })
})
