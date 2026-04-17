# Smoobu API Integration — Designdokument

## Ziel

iCal als Buchungsdatenquelle durch die Smoobu REST API ersetzen. Vorteile gegenüber iCal:

- **Exakte Check-in/Check-out Uhrzeiten** (nicht nur Datum)
- **Gastname** korrekt (kein Parsing aus der SUMMARY nötig)
- **Personenzahl** (Erwachsene + Kinder)
- **Buchungskanal** (Airbnb, Booking.com, direkt, etc.)
- **Stornierungen** erkennbar (statt nur "Event verschwunden")
- **Kein Wohnungsname im Gastname** (separate Felder)
- **Echtzeit-Updates** statt iCal-Polling mit Cache

## Grundprinzip

**Nur lesen. Niemals schreiben.** Wir verwenden ausschließlich GET-Endpoints.

---

## API-Referenz

### Authentifizierung

```
Header: Api-Key: <smoobu_api_key>
Base-URL: https://login.smoobu.com/api
```

API-Key wird im Smoobu-Dashboard unter Settings → API Keys generiert.

### Relevante Endpoints

#### 1. Wohnungen laden

```
GET /apartments
```

Response:
```json
{
  "apartments": [
    { "id": 123, "name": "Beach House" },
    { "id": 456, "name": "City Apartment" }
  ]
}
```

Wird benötigt um die Smoobu-Wohnungs-IDs den lokalen Wohnungen zuzuordnen.

#### 2. Buchungen laden

```
GET /reservations?apartmentId={id}&from={yyyy-mm-dd}&to={yyyy-mm-dd}&excludeBlocked=true&showCancellation=true
```

Response (gekürzt):
```json
{
  "bookings": [
    {
      "id": 9876,
      "type": "reservation",
      "arrival": "2026-06-01",
      "departure": "2026-06-07",
      "check-in": "15:00",
      "check-out": "11:00",
      "guest-name": "John Smith",
      "adults": 2,
      "children": 1,
      "channel": { "name": "Airbnb" },
      "is-blocked-booking": false,
      "apartment": { "id": 123, "name": "Beach House" }
    }
  ]
}
```

**Wichtige Felder:**

| Feld | Beschreibung | Ersetzt |
|------|-------------|---------|
| `arrival` + `check-in` | Exakte Anreise (Datum + Uhrzeit) | iCal DTSTART (nur Datum) |
| `departure` + `check-out` | Exakte Abreise (Datum + Uhrzeit) | iCal DTEND (nur Datum) |
| `guest-name` | Gastname (sauber, ohne Wohnungsname) | iCal SUMMARY + stripAptName() |
| `adults` + `children` | Personenzahl | nicht verfügbar in iCal |
| `channel.name` | Buchungskanal | nicht verfügbar in iCal |
| `is-blocked-booking` | Blocker-Erkennung | Heuristik über leeren Titel |

### Rate Limits

- **1.000 Requests/Minute** (großzügig)
- Header: `X-RateLimit-Remaining`
- HTTP 429 bei Überschreitung

---

## Architektur

### Setup-Flow

```
Setup → Integration-Zugangsdaten → Smoobu
├── API-Key eingeben
├── "Verbindung testen" → GET /me (verifiziert Key)
├── "Wohnungen laden" → GET /apartments
└── Pro lokale Wohnung: Dropdown "Smoobu-Wohnung zuordnen"
    └── Speichert smoobuApartmentId in apartments.json
```

### Datenmodell

**integrations.json** (neuer Abschnitt):
```json
{
  "smoobu": {
    "apiKey": "sk_live_..."
  }
}
```

**apartments.json** (pro Wohnung, neues Feld):
```json
{
  "id": "b39",
  "occupancy": {
    "enabled": true,
    "source": "smoobu",        // NEU: "smoobu" | "ical"
    "icalUrl": "https://...",   // bleibt als Fallback
    "smoobuApartmentId": 1983,  // NEU: Smoobu-ID
    "checkoutHour": 10,
    "checkinHour": 16
  }
}
```

Wenn `source === "smoobu"` und `smoobuApartmentId` gesetzt: Smoobu-API nutzen.  
Wenn `source === "ical"`: bisheriges Verhalten (iCal-Feed).  
Default bei bestehenden Wohnungen: `"ical"` (Abwärtskompatibel).

### Service-Schicht

**Neuer Service: `services/smoobu.js`**

```
smoobu.js
├── ensureApiKey()           → liest aus integrationsStore
├── listApartments()         → GET /apartments (cached 1h)
├── getBookings(aptId, from, to) → GET /reservations (cached 5 min)
├── normalizeBooking(raw)    → einheitliches Format
└── testConnection()         → GET /me
```

**Normalisiertes Booking-Format** (für alle Consumer einheitlich):
```json
{
  "id": "smoobu-9876",
  "guest": "John Smith",
  "adults": 2,
  "children": 1,
  "channel": "Airbnb",
  "checkIn": "2026-06-01T15:00:00",
  "checkOut": "2026-06-07T11:00:00",
  "isBlocked": false,
  "isCancelled": false,
  "source": "smoobu"
}
```

### Betroffene Consumer

Diese Services/Routes müssen Smoobu als Alternative zu iCal unterstützen:

| Consumer | Aktuell (iCal) | Änderung |
|----------|---------------|----------|
| `services/occupancy.js` | `fetchIcal()` + `extractEvents()` | Wenn source=smoobu → `smoobu.getBookings()` statt iCal |
| `services/automation.js` | iCal-Events parsen, Default-Zeiten anwenden | Smoobu liefert echte Uhrzeiten → keine Defaults nötig |
| `services/cleaningSync.js` | iCal-Events parsen, Blocker filtern | Smoobu: `is-blocked-booking` statt Titel-Heuristik |
| `routes/cleaning.js` | Timeline-Daten aus Events | Keine Änderung (liest aus cleaningSync) |
| Dashboard | Belegungsanzeige | Personenzahl + Kanal zusätzlich anzeigen |

### Migrationsstrategie

1. **Phase 1**: Smoobu-Service + Setup-UI (Key, Verbindungstest, Wohnungszuordnung)
2. **Phase 2**: `occupancy.js` erweitern — wenn `source=smoobu` → API statt iCal
3. **Phase 3**: `cleaningSync.js` erweitern — Buchungen aus Smoobu statt iCal
4. **Phase 4**: `automation.js` erweitern — echte Check-in/Check-out Zeiten nutzen
5. **Phase 5**: Dashboard — Personenzahl + Kanal anzeigen

Jede Phase ist unabhängig deploybar. iCal bleibt als Fallback erhalten.

### Caching

| Daten | TTL | Grund |
|-------|-----|-------|
| Smoobu Wohnungsliste | 1 Stunde | Ändert sich fast nie |
| Buchungen pro Wohnung | 5 Minuten | Balance zwischen Aktualität und Rate-Limit |
| Stale-Fallback | Ja | Bei API-Fehler letzte bekannte Daten anzeigen |

Bei 6 Wohnungen × 1 Request alle 5 min = 72 Requests/Stunde = weit unter dem 1000/min Limit.

### Vorteile gegenüber iCal

| Aspekt | iCal | Smoobu API |
|--------|------|-----------|
| Check-in/out Zeit | Nur Datum (Default 10/16) | Exakte Uhrzeit (`"15:00"`) |
| Gastname | In SUMMARY mit Wohnungsname gemischt | Eigenes Feld `guest-name` |
| Personenzahl | Nicht verfügbar | `adults` + `children` |
| Buchungskanal | Nicht verfügbar | `channel.name` |
| Stornierungen | Event verschwindet einfach | `showCancellation=true` |
| Blocker | Heuristik über Titel ("blocked", leer, etc.) | `is-blocked-booking` Flag |
| Update-Latenz | 30 min Cache + iCal-Server-Cache | 5 min Cache, API ist Echtzeit |
| Parsing-Aufwand | node-ical + Normalisierung + Marker-Filter | Strukturiertes JSON |

### Nicht-Ziele

- **Kein Schreib-Zugriff auf Smoobu** — nur GET-Endpoints
- **Kein Ersetzen von iCal** — beide Quellen bleiben parallel nutzbar
- **Keine Smoobu-Preisdaten** — nur Belegung + Gäste
- **Kein Channel-Management** — nur Lesen der Buchungsdaten
