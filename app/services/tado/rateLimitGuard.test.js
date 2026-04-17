import { describe, it, expect, beforeEach } from 'vitest'
const guard = require('./rateLimitGuard.js')

beforeEach(() => guard._clearAll())

describe('rateLimitGuard.checkAction', () => {
  it('erlaubt Aktion wenn viel Puffer da ist', () => {
    const rl = { source: 'header', remaining: 800, limit: 1000, used: 200 }
    const r = guard.checkAction(rl, 'k1')
    expect(r.allowed).toBe(true)
    expect(r.warning).toBeUndefined()
  })

  it('erlaubt Aktion mit Warnung bei <= BUFFER', () => {
    const rl = { source: 'header', remaining: 15, limit: 1000, used: 985 }
    const r = guard.checkAction(rl, 'k2')
    expect(r.allowed).toBe(true)
    expect(r.warning).toContain('15')
  })

  it('lehnt Aktion ab bei remaining=0', () => {
    const rl = { source: 'header', remaining: 0, limit: 1000, used: 1000 }
    const r = guard.checkAction(rl, 'k3')
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/Limit erreicht/i)
  })

  it('lehnt ab wenn Account als exhausted markiert wurde', () => {
    guard.markExhausted('k4', 60)
    const rl = { source: 'header', remaining: 500, limit: 1000, used: 500 }
    const r = guard.checkAction(rl, 'k4')
    expect(r.allowed).toBe(false)
  })

  it('Fallback: count-Modus mit vollem Puffer', () => {
    const rl = { source: 'count', used: 5 }
    const r = guard.checkAction(rl, 'k5')
    expect(r.allowed).toBe(true)
  })

  it('Fallback: count-Modus lehnt ab bei hohem Counter', () => {
    const rl = { source: 'count', used: 100 }
    const r = guard.checkAction(rl, 'k6')
    expect(r.allowed).toBe(false)
  })

  it('handleTado429 markiert Account als erschoepft', () => {
    guard.handleTado429('k7', 60)
    expect(guard.isExhausted('k7')).toBe(true)
  })
})
