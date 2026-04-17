import { describe, it, expect, beforeEach, afterEach } from 'vitest'
const store = require('./integrationsStore.js')

beforeEach(() => store._clearAll())
afterEach(() => store._clearAll())

describe('integrationsStore', () => {
  it('getMinut liefert null-Werte wenn nichts gesetzt ist', () => {
    delete process.env.MINUT_CLIENT_ID
    delete process.env.MINUT_CLIENT_SECRET
    const c = store.getMinut()
    expect(c.clientId).toBeNull()
    expect(c.clientSecret).toBeNull()
  })

  it('setMinut + getMinut roundtrip', () => {
    store.setMinut({ clientId: 'id1', clientSecret: 'sec1' })
    const c = store.getMinut()
    expect(c.clientId).toBe('id1')
    expect(c.clientSecret).toBe('sec1')
  })

  it('Config-Datei hat Prioritaet vor ENV', () => {
    process.env.MINUT_CLIENT_ID = 'env-id'
    store.setMinut({ clientId: 'file-id', clientSecret: 'file-sec' })
    expect(store.getMinut().clientId).toBe('file-id')
    delete process.env.MINUT_CLIENT_ID
  })

  it('ENV-Fallback wenn Datei leer', () => {
    process.env.MINUT_CLIENT_ID = 'env-id'
    process.env.MINUT_CLIENT_SECRET = 'env-sec'
    const c = store.getMinut()
    expect(c.clientId).toBe('env-id')
    expect(c.clientSecret).toBe('env-sec')
    delete process.env.MINUT_CLIENT_ID
    delete process.env.MINUT_CLIENT_SECRET
  })

  it('getPublicStatus liefert nur boolean-Flags', () => {
    store.setMinut({ clientId: 'id', clientSecret: 'sec' })
    const s = store.getPublicStatus()
    expect(s.minut.clientIdSet).toBe(true)
    expect(s.minut.clientSecretSet).toBe(true)
    expect(s.minut.clientId).toBeUndefined() // keine Secrets!
    expect(s.minut.clientSecret).toBeUndefined()
  })

  it('getNuki liefert null wenn nichts gesetzt', () => {
    delete process.env.NUKI_API_TOKEN
    expect(store.getNuki().apiToken).toBeNull()
  })

  it('setNuki speichert apiToken', () => {
    store.setNuki({ apiToken: 'token123' })
    expect(store.getNuki().apiToken).toBe('token123')
  })
})
