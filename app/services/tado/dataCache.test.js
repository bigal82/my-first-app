import { describe, it, expect, beforeEach, vi } from 'vitest'
const cache = require('./dataCache.js')

beforeEach(() => cache._clearAll())

describe('dataCache', () => {
  it('ruft fetchFn beim ersten Aufruf auf', async () => {
    const fn = vi.fn().mockResolvedValue({ a: 1 })
    const res = await cache.getOrFetch('apt-1', fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(res.a).toBe(1)
    expect(res.cached).toBe(false)
    expect(res.stale).toBe(false)
  })

  it('liefert zweiten Aufruf aus dem Cache (cached=true)', async () => {
    const fn = vi.fn().mockResolvedValue({ a: 1 })
    await cache.getOrFetch('apt-1', fn)
    const second = await cache.getOrFetch('apt-1', fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(second.cached).toBe(true)
    expect(second.stale).toBe(false)
  })

  it('liefert stale-Fallback wenn Fetch fehlschlaegt und Cache existiert', async () => {
    const ok = vi.fn().mockResolvedValue({ a: 1 })
    await cache.getOrFetch('apt-2', ok)

    // Cache-Eintrag manuell altern, damit der naechste Aufruf neu fetcht
    const entry = cache.getEntry('apt-2')
    entry.fetchedAt = Date.now() - 31 * 60 * 1000 // 31 min alt

    const fail = vi.fn().mockRejectedValue(new Error('boom'))
    const res = await cache.getOrFetch('apt-2', fail)
    expect(res.a).toBe(1)
    expect(res.stale).toBe(true)
    expect(res.error).toBe('boom')
  })

  it('wirft Fehler wenn Fetch fehlschlaegt und kein Cache existiert', async () => {
    const fail = vi.fn().mockRejectedValue(new Error('down'))
    await expect(cache.getOrFetch('apt-3', fail)).rejects.toThrow('down')
  })

  it('In-Flight-Deduplication: parallele Aufrufe teilen einen Fetch', async () => {
    let resolveIt
    const fn = vi.fn().mockImplementation(() => new Promise(r => { resolveIt = r }))
    const [p1, p2] = [cache.getOrFetch('apt-4', fn), cache.getOrFetch('apt-4', fn)]
    resolveIt({ value: 42 })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(r1.value).toBe(42)
    expect(r2.value).toBe(42)
  })
})
