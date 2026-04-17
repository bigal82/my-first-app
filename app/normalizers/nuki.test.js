import { describe, it, expect } from 'vitest'
const n = require('./nuki.js')

describe('typeLabel', () => {
  it('0 → Lock', () => expect(n.typeLabel(0)).toBe('Lock'))
  it('2 → Opener', () => expect(n.typeLabel(2)).toBe('Opener'))
  it('3 → Lock (Smart Lock 3.0)', () => expect(n.typeLabel(3)).toBe('Lock'))
  it('4 → Lock (Smart Door)', () => expect(n.typeLabel(4)).toBe('Lock'))
  it('unbekannt → Geraet', () => expect(n.typeLabel(99)).toBe('Geraet'))
})

describe('lockStateLabel', () => {
  it('1 → locked', () => expect(n.lockStateLabel(1)).toBe('locked'))
  it('3 → unlocked', () => expect(n.lockStateLabel(3)).toBe('unlocked'))
  it('254 → motor_blocked', () => expect(n.lockStateLabel(254)).toBe('motor_blocked'))
  it('unbekannt → unknown', () => expect(n.lockStateLabel(999)).toBe('unknown'))
})

describe('openerStateLabel', () => {
  it('1 → ready', () => expect(n.openerStateLabel(1)).toBe('ready'))
  it('2 → rto_active', () => expect(n.openerStateLabel(2)).toBe('rto_active'))
})

describe('normalizeDevice', () => {
  it('normalisiert ein Lock mit Batterie', () => {
    const raw = {
      smartlockId: 'lock-1',
      name: 'Haustür',
      type: 0,
      serverState: 0,
      state: { state: 1, batteryChargeState: 82, batteryCritical: false }
    }
    const r = n.normalizeDevice(raw)
    expect(r.id).toBe('lock-1')
    expect(r.name).toBe('Haustür')
    expect(r.type).toBe('Lock')
    expect(r.online).toBe(true)
    expect(r.stateLabel).toBe('locked')
    expect(r.batteryPercent).toBe(82)
    expect(r.batteryLow).toBe(false)
  })

  it('batteryPercent=null bleibt null (niemals 0 inferieren)', () => {
    const raw = {
      smartlockId: 'opener-1',
      name: 'Hofeingang',
      type: 2,
      state: { state: 1, batteryCritical: false }
    }
    const r = n.normalizeDevice(raw)
    expect(r.batteryPercent).toBeNull()
    expect(r.batteryLow).toBe(false)
  })

  it('batteryCritical=true setzt batteryLow', () => {
    const raw = {
      smartlockId: 'x',
      name: 'y',
      type: 2,
      state: { state: 1, batteryCritical: true }
    }
    const r = n.normalizeDevice(raw)
    expect(r.batteryCritical).toBe(true)
    expect(r.batteryLow).toBe(true)
  })

  it('batteryPercent < 30 setzt batteryLow=true', () => {
    const raw = {
      smartlockId: 'x',
      name: 'y',
      type: 0,
      serverState: 0,
      state: { state: 1, batteryChargeState: 20 }
    }
    expect(n.normalizeDevice(raw).batteryLow).toBe(true)
  })

  it('Opener bekommt openerStateLabel statt lockStateLabel', () => {
    const raw = {
      smartlockId: 'x', name: 'y', type: 2,
      state: { state: 2 }
    }
    expect(n.normalizeDevice(raw).stateLabel).toBe('rto_active')
  })

  it('wirft bei null-Input', () => {
    expect(() => n.normalizeDevice(null)).toThrow(/ungueltig/i)
  })
})

describe('normalizeDeviceList', () => {
  it('verarbeitet Array direkt', () => {
    const list = n.normalizeDeviceList([
      { smartlockId: 'a', name: 'A', type: 0, state: { state: 1 } },
      { smartlockId: 'b', name: 'B', type: 2, state: { state: 1 } }
    ])
    expect(list).toHaveLength(2)
    expect(list[0].type).toBe('Lock')
    expect(list[1].type).toBe('Opener')
  })

  it('liefert leeres Array bei ungueltigem Input', () => {
    expect(n.normalizeDeviceList(null)).toEqual([])
  })
})

describe('filterByIds', () => {
  const list = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' }
  ]

  it('filtert nur angefragte IDs', () => {
    const result = n.filterByIds(list, ['a', 'c'])
    expect(result).toHaveLength(2)
    expect(result.map(d => d.id)).toEqual(['a', 'c'])
  })

  it('leere IDs → leer', () => {
    expect(n.filterByIds(list, [])).toEqual([])
  })

  it('string/number coercion', () => {
    const numList = [{ id: 1 }, { id: 2 }]
    expect(n.filterByIds(numList, ['1'])).toHaveLength(1)
  })
})
