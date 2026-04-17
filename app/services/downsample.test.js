import { describe, it, expect } from 'vitest'
const ds = require('./downsample.js')

describe('bucketAverage', () => {
  it('gibt die Serie unveraendert zurueck wenn kleiner als Ziel', () => {
    const series = [
      { timestamp: '2026-04-15T10:00:00Z', value: 20 },
      { timestamp: '2026-04-15T10:01:00Z', value: 21 }
    ]
    expect(ds.bucketAverage(series, 10)).toEqual(series)
  })

  it('reduziert auf Ziel-Punktzahl per Mittelwert', () => {
    const series = []
    for (let i = 0; i < 1000; i++) {
      series.push({ timestamp: new Date(Date.UTC(2026, 3, 15, 0, i)).toISOString(), value: i })
    }
    const result = ds.bucketAverage(series, 100)
    expect(result.length).toBe(100)
    // Erster Bucket sollte Durchschnitt der ersten 10 Werte sein (0..9 → 4.5)
    expect(result[0].value).toBeCloseTo(4.5, 1)
    // Letzter Bucket Durchschnitt der letzten 10 (990..999 → 994.5)
    expect(result[result.length - 1].value).toBeCloseTo(994.5, 1)
  })

  it('ignoriert null-Werte beim Mittelwert', () => {
    const series = [
      { timestamp: '2026-04-15T10:00:00Z', value: 10 },
      { timestamp: '2026-04-15T10:01:00Z', value: null },
      { timestamp: '2026-04-15T10:02:00Z', value: 20 },
      { timestamp: '2026-04-15T10:03:00Z', value: 30 }
    ]
    const result = ds.bucketAverage(series, 2)
    expect(result).toHaveLength(2)
    // Erster Bucket: 10 + null → 10
    expect(result[0].value).toBeCloseTo(10, 1)
    // Zweiter Bucket: 20 + 30 → 25
    expect(result[1].value).toBeCloseTo(25, 1)
  })

  it('gibt leeres Array bei null-Input', () => {
    expect(ds.bucketAverage(null, 100)).toEqual([])
  })
})

describe('targetPointsForRange', () => {
  it('24h → 144', () => {
    expect(ds.targetPointsForRange('24h')).toBe(144)
  })
  it('7d → 150', () => {
    expect(ds.targetPointsForRange('7d')).toBe(150)
  })
  it('30d → 200', () => {
    expect(ds.targetPointsForRange('30d')).toBe(200)
  })
})
