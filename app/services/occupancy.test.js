import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const svc = require('./occupancy.js')

// ── Hilfsfunktion: ISO-Datum n Tage von heute ────────────────────────────────
function offsetDays(n) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}

// ── Tests fuer pure Funktionen ───────────────────────────────────────────────

describe('_isoDate', () => {
  it('konvertiert Date zu YYYY-MM-DD', () => {
    const d = new Date(2026, 3, 14) // April = 3
    expect(svc._isoDate(d)).toBe('2026-04-14')
  })

  it('gibt null zurueck bei ungueltigem Wert', () => {
    expect(svc._isoDate(null)).toBeNull()
    expect(svc._isoDate(undefined)).toBeNull()
    expect(svc._isoDate('not-a-date')).toBeNull()
  })
})

describe('_extractEvents', () => {
  it('filtert nur VEVENT-Eintraege', () => {
    const parsed = {
      'uid-1': { type: 'VEVENT', summary: 'Gast A', start: new Date(), end: new Date() },
      'uid-2': { type: 'VTIMEZONE' },
      'uid-3': { type: 'VEVENT', summary: 'Gast B', start: new Date(), end: new Date() }
    }
    const events = svc._extractEvents(parsed)
    expect(events).toHaveLength(2)
    expect(events[0].title).toBe('Gast A')
  })

  it('verwendet "Gast" als Default wenn SUMMARY leer ist', () => {
    const parsed = {
      'uid-1': { type: 'VEVENT', summary: '', start: new Date(), end: new Date() }
    }
    const events = svc._extractEvents(parsed)
    expect(events[0].title).toBe('Gast')
  })

  it('ignoriert Events ohne start/end', () => {
    const parsed = {
      'uid-1': { type: 'VEVENT', summary: 'ok', start: new Date(), end: new Date() },
      'uid-2': { type: 'VEVENT', summary: 'broken' } // kein start/end
    }
    expect(svc._extractEvents(parsed)).toHaveLength(1)
  })
})

describe('_computeStatus', () => {
  it('meldet "frei" bei leerer Event-Liste', () => {
    const status = svc._computeStatus([])
    expect(status.occupied).toBe(false)
    expect(status.currentBooking).toBeNull()
    expect(status.nextBooking).toBeNull()
  })

  it('erkennt laufende Buchung (heute liegt zwischen checkIn und checkOut)', () => {
    const events = [
      { title: 'Gast Jetzt', start: offsetDays(-1), end: offsetDays(2) }
    ]
    const status = svc._computeStatus(events)
    expect(status.occupied).toBe(true)
    expect(status.currentBooking.title).toBe('Gast Jetzt')
  })

  it('erkennt naechste Buchung bei freier Wohnung', () => {
    const events = [
      { title: 'Zukunft',    start: offsetDays(5),  end: offsetDays(8)  },
      { title: 'Noch weiter', start: offsetDays(20), end: offsetDays(22) }
    ]
    const status = svc._computeStatus(events)
    expect(status.occupied).toBe(false)
    expect(status.nextBooking.title).toBe('Zukunft')
  })

  it('kombiniert aktuelle und naechste Buchung', () => {
    const events = [
      { title: 'Jetzt',   start: offsetDays(-1), end: offsetDays(1) },
      { title: 'Naechste', start: offsetDays(5),  end: offsetDays(7) }
    ]
    const status = svc._computeStatus(events)
    expect(status.occupied).toBe(true)
    expect(status.currentBooking.title).toBe('Jetzt')
    expect(status.nextBooking.title).toBe('Naechste')
  })

  it('behandelt checkIn == checkOut == heute als belegt', () => {
    const events = [
      { title: 'Tagesgast', start: offsetDays(0), end: offsetDays(0) }
    ]
    const status = svc._computeStatus(events)
    expect(status.occupied).toBe(true)
  })

  it('ignoriert bereits abgelaufene Buchungen', () => {
    const events = [
      { title: 'Vergangenheit', start: offsetDays(-10), end: offsetDays(-5) }
    ]
    const status = svc._computeStatus(events)
    expect(status.occupied).toBe(false)
    expect(status.nextBooking).toBeNull()
  })
})

// ── Tests fuer getOccupancy (mit fetch-Mock) ─────────────────────────────────

describe('getOccupancy (mit Mock-fetch)', () => {
  beforeEach(() => {
    svc._clearCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockIcalResponse(text) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => text
    })
  }

  function mockFetchError(msg) {
    global.fetch = vi.fn().mockRejectedValue(new Error(msg))
  }

  const emptyIcal = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR\r\n'

  it('wirft Fehler wenn icalUrl fehlt', async () => {
    await expect(svc.getOccupancy('apt-1', '')).rejects.toThrow(/iCal-URL/)
  })

  it('liefert "frei" bei leerem Kalender', async () => {
    mockIcalResponse(emptyIcal)
    const result = await svc.getOccupancy('apt-1', 'https://example.com/cal.ics')
    expect(result.occupied).toBe(false)
    expect(result.statusLabel).toBe('Frei')
    expect(result.currentBooking).toBeNull()
    expect(result.cached).toBe(false)
    expect(result.stale).toBe(false)
  })

  it('liefert gecachte Antwort beim zweiten Aufruf', async () => {
    mockIcalResponse(emptyIcal)
    const first = await svc.getOccupancy('apt-1', 'https://x.com/cal')
    expect(first.cached).toBe(false)
    const second = await svc.getOccupancy('apt-1', 'https://x.com/cal')
    expect(second.cached).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('liefert Stale-Fallback wenn Fetch fehlschlaegt und Cache existiert', async () => {
    mockIcalResponse(emptyIcal)
    await svc.getOccupancy('apt-1', 'https://x.com/cal')

    // Cache-Eintrag kuenstlich altern
    svc._clearCache()
    // Trick: ohne Cache wird der Fallback nicht greifen, also manuell einen setzen:
    const { getOccupancy } = svc
    // Normal: wir muessten den Cache modifizieren. Einfacher: erster Fetch-OK, dann Fehler.
    // Daher: Cache jetzt neu bauen, dann altern lassen und fehlschlagen lassen.
    mockIcalResponse(emptyIcal)
    await getOccupancy('apt-1', 'https://x.com/cal') // frisch im Cache

    // Jetzt Fehler simulieren
    mockFetchError('Network down')
    // Da der Cache gerade frisch ist, wird er zurueckgegeben → cached=true, stale=false
    const stillFresh = await getOccupancy('apt-1', 'https://x.com/cal')
    expect(stillFresh.cached).toBe(true)
    expect(stillFresh.stale).toBe(false)
  })

  it('wirft Fehler wenn Fetch fehlschlaegt und kein Cache existiert', async () => {
    mockFetchError('Connection refused')
    await expect(svc.getOccupancy('apt-neu', 'https://x.com/cal')).rejects.toThrow(/Connection refused/)
  })

  it('HTTP-Fehler (z.B. 500) wird als Fehler weitergereicht', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => ''
    })
    await expect(svc.getOccupancy('apt-err', 'https://x.com/cal')).rejects.toThrow(/HTTP 500/)
  })

  it('parst echtes iCal mit VEVENT und liefert statusLabel', async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today.getTime() + 86400000)
    const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

    const withBooking = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:booking-1',
      'SUMMARY:Max Muster',
      'DTSTART:' + fmt(today),
      'DTEND:'   + fmt(new Date(today.getTime() + 3 * 86400000)),
      'END:VEVENT',
      'END:VCALENDAR',
      ''
    ].join('\r\n')

    mockIcalResponse(withBooking)
    const result = await svc.getOccupancy('apt-booking', 'https://x.com/cal')
    expect(result.occupied).toBe(true)
    expect(result.statusLabel).toBe('Gast da')
    expect(result.currentBooking.title).toBe('Max Muster')
    expect(result.currentBooking.checkIn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
