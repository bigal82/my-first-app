import { describe, it, expect, beforeEach } from 'vitest'
const store = require('./tokenStore.js')

beforeEach(() => store._clearAll())

describe('tokenStore', () => {
  it('makeKey ist deterministisch fuer gleiche Inputs', () => {
    const a = store.makeKey('test@example.com', 12345)
    const b = store.makeKey('test@example.com', 12345)
    expect(a).toBe(b)
  })

  it('makeKey unterscheidet sich bei unterschiedlichen Credentials', () => {
    const a = store.makeKey('a@example.com', 1)
    const b = store.makeKey('b@example.com', 1)
    expect(a).not.toBe(b)
  })

  it('set speichert Token mit berechneter Ablaufzeit', () => {
    store.set('key1', { accessToken: 'AT', refreshToken: 'RT', expiresIn: 3600 })
    const got = store.get('key1')
    expect(got.accessToken).toBe('AT')
    expect(got.refreshToken).toBe('RT')
    expect(got.expiresAt).toBeGreaterThan(Date.now())
  })

  it('isFresh liefert true wenn Token noch lange gueltig ist', () => {
    store.set('k', { accessToken: 'AT', refreshToken: 'RT', expiresIn: 3600 })
    expect(store.isFresh(store.get('k'))).toBe(true)
  })

  it('isFresh liefert false wenn Token bereits abgelaufen', () => {
    store.set('k', { accessToken: 'AT', refreshToken: 'RT', expiresIn: 0 })
    // expiresIn: 0 → expiresAt ist jetzt → innerhalb der Refresh-Window-Zeit
    expect(store.isFresh(store.get('k'))).toBe(false)
  })

  it('isFresh liefert false fuer null', () => {
    expect(store.isFresh(null)).toBe(false)
  })

  it('remove loescht den Eintrag', () => {
    store.set('k', { accessToken: 'AT', expiresIn: 3600 })
    store.remove('k')
    expect(store.get('k')).toBeNull()
  })
})
