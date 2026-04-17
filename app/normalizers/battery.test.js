import { describe, it, expect } from 'vitest'
const b = require('./battery.js')

describe('isLowBattery', () => {
  describe('Tado', () => {
    it('batteryLow=true → true', () => {
      expect(b.isLowBattery({ batteryLow: true }, 'tado')).toBe(true)
    })
    it('batteryLow=false → false', () => {
      expect(b.isLowBattery({ batteryLow: false }, 'tado')).toBe(false)
    })
    it('fehlt → false', () => {
      expect(b.isLowBattery({}, 'tado')).toBe(false)
    })
  })

  describe('Minut', () => {
    it('batteryPercent=25 → true', () => {
      expect(b.isLowBattery({ batteryPercent: 25 }, 'minut')).toBe(true)
    })
    it('batteryPercent=30 → false (Grenze exklusiv)', () => {
      expect(b.isLowBattery({ batteryPercent: 30 }, 'minut')).toBe(false)
    })
    it('batteryPercent=0 (echter Wert) → true', () => {
      expect(b.isLowBattery({ batteryPercent: 0 }, 'minut')).toBe(true)
    })
    it('batteryPercent=null → false', () => {
      expect(b.isLowBattery({ batteryPercent: null }, 'minut')).toBe(false)
    })
    it('batteryPercent=undefined → false', () => {
      expect(b.isLowBattery({}, 'minut')).toBe(false)
    })
  })

  describe('Nuki Lock', () => {
    it('batteryPercent=25 → true', () => {
      expect(b.isLowBattery({ batteryPercent: 25 }, 'nuki-lock')).toBe(true)
    })
    it('batteryCritical=true, batteryPercent=null → true', () => {
      expect(b.isLowBattery({ batteryPercent: null, batteryCritical: true }, 'nuki-lock')).toBe(true)
    })
    it('batteryPercent=80, batteryCritical=false → false', () => {
      expect(b.isLowBattery({ batteryPercent: 80, batteryCritical: false }, 'nuki-lock')).toBe(false)
    })
    it('batteryPercent=null, batteryCritical=false → false', () => {
      expect(b.isLowBattery({ batteryPercent: null, batteryCritical: false }, 'nuki-lock')).toBe(false)
    })
  })

  describe('Nuki Opener', () => {
    it('batteryCritical=true → true', () => {
      expect(b.isLowBattery({ batteryCritical: true }, 'nuki-opener')).toBe(true)
    })
    it('batteryLow=true → true', () => {
      expect(b.isLowBattery({ batteryLow: true }, 'nuki-opener')).toBe(true)
    })
    it('keine Flags → false', () => {
      expect(b.isLowBattery({ batteryCritical: false, batteryLow: false }, 'nuki-opener')).toBe(false)
    })
    it('batteryPercent wird NICHT zum Vergleich herangezogen (Opener hat keinen)', () => {
      expect(b.isLowBattery({ batteryPercent: 20, batteryCritical: false, batteryLow: false }, 'nuki-opener')).toBe(false)
    })
  })

  it('null-device → false', () => {
    expect(b.isLowBattery(null, 'tado')).toBe(false)
  })
})

describe('formatBatteryValue', () => {
  it('Prozent-Wert wird formatiert', () => {
    expect(b.formatBatteryValue({ batteryPercent: 45 }, 'minut')).toBe('45%')
  })
  it('Opener kritisch', () => {
    expect(b.formatBatteryValue({ batteryCritical: true }, 'nuki-opener')).toBe('kritisch')
  })
  it('Opener niedrig (ohne critical)', () => {
    expect(b.formatBatteryValue({ batteryCritical: false }, 'nuki-opener')).toBe('niedrig')
  })
  it('Tado niedrig ohne Prozent', () => {
    expect(b.formatBatteryValue({ batteryLow: true }, 'tado')).toBe('niedrig')
  })
  it('Nichts bekannt → "—"', () => {
    expect(b.formatBatteryValue({}, 'minut')).toBe('—')
  })
})
