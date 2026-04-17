import { describe, it, expect, beforeEach } from 'vitest'
const lock = require('./actionLock.js')

beforeEach(() => lock._clearAll())

describe('actionLock', () => {
  it('erster acquire liefert true', () => {
    expect(lock.acquire('a')).toBe(true)
  })

  it('zweiter acquire derselben Key liefert false', () => {
    lock.acquire('b')
    expect(lock.acquire('b')).toBe(false)
  })

  it('nach release kann wieder acquired werden', () => {
    lock.acquire('c')
    lock.release('c')
    expect(lock.acquire('c')).toBe(true)
  })

  it('unterschiedliche Keys sind unabhaengig', () => {
    lock.acquire('x')
    expect(lock.acquire('y')).toBe(true)
  })

  it('isLocked spiegelt den Zustand', () => {
    expect(lock.isLocked('z')).toBe(false)
    lock.acquire('z')
    expect(lock.isLocked('z')).toBe(true)
    lock.release('z')
    expect(lock.isLocked('z')).toBe(false)
  })
})
