# PROJ-4: iCal / Belegungsintegration

## Status: Approved
**Created:** 2026-04-14
**Last Updated:** 2026-04-14

## Dependencies
- Requires: PROJ-1 (Core Server & Konfiguration)
- Requires: PROJ-3 (Dashboard Basis)

## User Stories
- Als Betreiber möchte ich auf einen Blick sehen, ob gerade ein Gast in einer Wohnung ist.
- Als Betreiber möchte ich den aktuellen Gastnamen und Check-out-Datum sehen.
- Als Betreiber möchte ich die nächste Buchung mit Gastname und Check-in-Datum sehen.
- Als Betreiber möchte ich schnell filtern können: Welche Wohnungen sind gerade belegt?

## Acceptance Criteria
- [ ] `GET /api/occupancy/:apartmentId` liefert: `occupied`, `statusLabel`, `currentBooking`, `nextBooking`
- [ ] `currentBooking` enthält: `title` (Gastname), `checkIn`, `checkOut`
- [ ] `nextBooking` enthält: `title` (Gastname), `checkIn`, `checkOut`
- [ ] Wohnungskarte zeigt Badge: `Gast da` (belegt) oder `Frei` (leer)
- [ ] Bei belegter Wohnung: Gastname + `bis [Datum]` anzeigen
- [ ] Bei freier Wohnung: nächste Buchung + `ab [Datum]` anzeigen (falls vorhanden)
- [ ] iCal-URL wird serverseitig abgerufen (kein direkter Browser-Fetch)
- [ ] Daten werden gecacht (30 Minuten), nicht bei jedem Dashboard-Load neu abgerufen
- [ ] Wohnung ohne iCal-Integration (`enabled: false`): Belegungszeile wird nicht angezeigt
- [ ] Filter-Chip `Gast da` im Dashboard funktioniert korrekt

## Edge Cases
- iCal-URL nicht erreichbar → letzter gültiger Stand bleibt angezeigt, Fehlerindikator im Badge
- iCal liefert leeren Kalender → Status `Frei`, keine nächste Buchung
- Buchung ohne Titel → Gastname als "Gast" oder leer anzeigen (kein Absturz)
- Buchung beginnt und endet am selben Tag → korrekt als `checkIn = checkOut` behandeln
- Timezone-Probleme in iCal-Daten → lokal normalisiert anzeigen
- Sehr lange Gastnamen → kein Layout-Bruch

## Technical Requirements
- `node-ical` oder equivalente Bibliothek für iCal-Parsing
- Serverseitiger Fetch (kein CORS-Problem)
- 30-Minuten-Cache pro Wohnung
- Datum-Normalisierung in ISO-Format vor Weitergabe ans Frontend

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
**Designed:** 2026-04-14

### UI-Änderungen im Dashboard
```
Dashboard (PROJ-3)
├── StatusBanner                     [unverändert]
├── KPI-Row                          [unverändert]
├── FilterBar
│   └── Chip "Gast da"               [jetzt aktiv, filtert nach occupied]
│
└── ApartmentsGrid
    └── ApartmentCard
        ├── CardHead
        │   └── StatusBadge          [dynamisch: "Gast da" oder "Frei"]
        │
        ├── Belegung-Slot            [← jetzt gefüllt]
        │   ├── Variante A (belegt):  "Max Muster · bis 18.04."
        │   ├── Variante B (frei):    "Nächste: Anna Beispiel · ab 25.04."
        │   ├── Variante C (frei, keine Buchung): "Keine Buchung"
        │   ├── Variante D (Fehler + Cache): "⚠ iCal nicht erreichbar · letzter Stand HH:MM"
        │   ├── Variante E (lädt):    Spinner „Belegung lädt…"
        │   └── Variante F (iCal off): Zeile nicht gerendert
        │
        └── Andere Slots              [Platzhalter für PROJ-5/6/9]
```

### Datenfluss
1. Browser lädt `/` → `GET /api/apartments` (wie bisher)
2. Dashboard rendert Karten sofort; Belegungs-Slot zeigt Loading-Spinner
3. Parallele `GET /api/occupancy/:id`-Requests für alle Wohnungen mit `occupancy.enabled=true`
4. Server prüft In-Memory-Cache (30 min TTL) → frisch: direkt zurück; abgelaufen: fetch/parse/cache/zurück
5. Browser aktualisiert pro Karte den Belegungs-Slot und das Status-Badge, sobald die Antwort da ist

### Neuer API-Endpunkt: `GET /api/occupancy/:apartmentId`

| Feld | Bedeutung |
|------|-----------|
| `occupied` | `true` wenn heute ein Gast da ist |
| `statusLabel` | „Gast da" oder „Frei" |
| `currentBooking` | Laufende Buchung `{ title, checkIn, checkOut }` oder `null` |
| `nextBooking` | Kommende Buchung `{ title, checkIn, checkOut }` oder `null` |
| `cached` | `true` wenn aus 30-min-Cache |
| `stale` | `true` wenn iCal-Server nicht erreichbar war, letzter Stand |
| `error` | Fehlertext (nur wenn `stale=true`) |
| `fetchedAt` | Zeitstempel des letzten erfolgreichen Abrufs |

Buchungs-Objekt: `title` (Gastname aus SUMMARY), `checkIn` (ISO YYYY-MM-DD), `checkOut` (ISO YYYY-MM-DD).

### Cache-Strategie
- **Ort:** In-Memory `Map`, keyed by `apartmentId`
- **TTL:** 30 Minuten (PRD-Vorgabe)
- **Stale Fallback:** Bei Fetch-Fehler wird der letzte erfolgreiche Stand mit `stale=true` + Fehlertext zurückgegeben
- **Reset bei Server-Neustart:** akzeptabel, Cache füllt sich beim ersten Dashboard-Load
- **In-Flight-Deduplication:** Bei parallelen Requests auf denselben abgelaufenen Apartment-Cache wird nur ein iCal-Fetch ausgelöst

### Tech-Entscheidungen

| Entscheidung | Grund |
|---|---|
| Library `node-ical` | Reif, kennt RRULE, Timezones, All-Day-Events – eigene Implementierung wäre Wochenarbeit |
| Serverseitiger Fetch | CORS-frei, URLs/Tokens serverseitig, zentraler Cache |
| In-Memory Cache | Einfach, schnell, kein Datei-IO, 30-min-TTL reicht für lokale Betriebszeit |
| Stale Fallback | Bei Plattform-Ausfall bleibt Dashboard nutzbar, Verwalter sieht letzte Belegung mit Warn-Icon |
| Parallele Fetches | Eine langsame Plattform blockiert nicht die anderen Wohnungen |
| Loading-Spinner im Slot | Verwalter sieht sofort, dass Daten kommen – kein springendes Layout |
| Chip „Gast da" filtert jetzt | Erster Chip mit echter Filterlogik |

### Neue Abhängigkeit
| Paket | Zweck |
|-------|-------|
| `node-ical` | Parst iCal/ICS-Feeds, unterstützt RRULE, Timezones, All-Day-Events |

### Was wird in PROJ-4 gebaut

| Bereich | Status |
|---------|--------|
| Neue API-Route `GET /api/occupancy/:id` | ✅ |
| `app/services/occupancy.js` vollständig (Fetch, Parse, Normalisieren) | ✅ |
| 30-min Cache mit stale Fallback + In-Flight-Dedup | ✅ |
| Dashboard: Belegungs-Slot mit 6 Varianten | ✅ |
| Dashboard: Status-Badge dynamisch (Gast da / Frei) | ✅ |
| Dashboard: Chip „Gast da" filtert echt | ✅ |
| Wohnung ohne iCal → kein Belegungs-Slot | ✅ |

## Implementation Notes (Backend + Frontend)
**Implemented:** 2026-04-14

### Was gebaut wurde
**Backend:**
- `app/services/occupancy.js` – vollständig implementiert:
  - Fetch mit `AbortController` + 10 s Timeout
  - Parsing via `node-ical` (`ical.sync.parseICS`)
  - `extractEvents()` filtert VEVENT, normalisiert Titel (`'Gast'` als Fallback)
  - `computeStatus()` findet laufende und kommende Buchung relativ zu heute
  - `isoDate()` → `YYYY-MM-DD` Format
  - In-Memory-Cache `Map<apartmentId, {data, fetchedAt}>` mit 30 min TTL
  - In-Flight-Deduplication: parallele Aufrufe auf denselben Key teilen sich einen Fetch
  - Stale-Fallback: bei Fehler wird letzter erfolgreicher Stand mit `stale=true` + `error` geliefert
- `app/routes/occupancy.js` – `GET /api/occupancy/:apartmentId`:
  - 404 bei unbekannter Apartment-ID
  - 400 wenn `occupancy.enabled=false` oder `icalUrl` leer
  - 502 wenn Fetch fehlschlägt und kein Cache existiert
  - 200 mit normalisiertem Status bei Erfolg
- `app/routes/index.js` – occupancy-Router eingebunden
- `vitest.config.js` – `pool: 'forks', singleFork: true` ergänzt (serielle Ausführung wegen geteilter `apartments.json`)
- Neue Dependency: `node-ical ^0.26.0`

**Frontend:**
- `app/public/js/dashboard.js`:
  - `occupancyMap` State für Belegungsdaten pro Apartment-ID
  - `loadOccupancy(id)` + `loadAllOccupancies()` – paralleler Hintergrund-Fetch nach initialem Render
  - `formatDateDE(iso)` – `YYYY-MM-DD` → `DD.MM.`
  - `renderStatusBadge(apt)` – dynamisch: „Gast da" / „Frei" / „…" (lädt) / „?" (Fehler) / „—" (kein iCal)
  - `renderBelegungSlot(apt)` – 6 Varianten (belegt, frei+next, frei leer, Fehler, lädt, kein iCal)
  - `filteredApartments()` – Chip „Gast da" filtert jetzt nach `occupied === true`
  - Empty-State bei leerem Guest-Filter angepasst („Keine Wohnung hat aktuell einen Gast.")

### Tests
- `app/services/occupancy.test.js` – 18 Unit-Tests (isoDate, extractEvents, computeStatus, getOccupancy inkl. Cache/Stale-Fallback/Fetch-Error)
- `app/routes/occupancy.test.js` – 5 Integration-Tests (404, 400 für disabled/leer, 200 mit Mock-iCal, 502 ohne Cache)
- E2E-Regression: alle PROJ-3-Tests grün (AC6 angepasst – Belegungs-Slot erscheint jetzt nur bei aktivem iCal)

### Getestete Acceptance Criteria (Backend)
- ✅ `GET /api/occupancy/:id` liefert `occupied`, `statusLabel`, `currentBooking`, `nextBooking`
- ✅ Buchungs-Objekte enthalten `title`, `checkIn`, `checkOut` (ISO YYYY-MM-DD)
- ✅ iCal wird serverseitig gefetcht (kein Browser-Fetch)
- ✅ 30-min Cache aktiv
- ✅ Stale-Fallback bei Fetch-Fehler (wenn Cache existiert)
- ✅ In-Flight-Deduplication
- ✅ Timeout nach 10s verhindert Hängen
- ✅ 404 bei unbekannter Apartment-ID, 400 bei disabled/leerer iCal-URL, 502 ohne Cache

### Offene Punkte (Frontend UI-Tests)
- Vollständige E2E-Tests für Dashboard-Integration (Loading-Spinner, 6 Varianten, Chip-Filter) → werden in `/qa` geschrieben

## QA Test Results

**Tested:** 2026-04-14
**App URL:** http://localhost:3100
**Tester:** QA Engineer (AI)

### Acceptance Criteria Status

#### AC-1: `GET /api/occupancy/:apartmentId`
- [x] 200 mit `occupied`, `statusLabel`, `currentBooking`, `nextBooking`
- [x] 404 bei unbekannter Apartment-ID
- [x] 400 wenn `occupancy.enabled=false` oder `icalUrl` leer
- [x] 502 bei Fetch-Fehler ohne Cache

#### AC-2: Buchungs-Objekte
- [x] `currentBooking` enthält `title`, `checkIn`, `checkOut` (ISO YYYY-MM-DD)
- [x] `nextBooking` enthält `title`, `checkIn`, `checkOut`

#### AC-3: Wohnungskarte Status-Badge
- [x] `Gast da` bei `occupied=true`
- [x] `Frei` bei `occupied=false`
- [x] `…` während Ladevorgang
- [x] `?` bei Fetch-Fehler
- [x] `—` wenn iCal-Integration nicht aktiv

#### AC-4: Belegte Wohnung – Anzeige
- [x] Gastname + `bis [DD.MM.]`

#### AC-5: Freie Wohnung – Anzeige
- [x] `Naechste: [Gastname] · ab [DD.MM.]` wenn nextBooking vorhanden
- [x] `Keine Buchung` wenn nextBooking leer

#### AC-6: Serverseitiger Fetch
- [x] iCal-URL wird vom Server (`node-ical`) geladen, nicht vom Browser

#### AC-7: 30-Minuten-Cache
- [x] Zweiter Aufruf innerhalb 30 min liefert `cached=true` ohne erneuten Fetch
- [x] Unit-Test verifiziert, dass `fetch` nur einmal aufgerufen wird

#### AC-8: Wohnung ohne iCal-Integration
- [x] Belegungszeile nicht gerendert (Variante F)
- [x] Status-Badge zeigt `—`

#### AC-9: Filter-Chip „Gast da"
- [x] Klick auf den Chip filtert nur belegte Wohnungen
- [x] Empty-State mit „Keine Wohnung hat aktuell einen Gast" bei leerem Ergebnis

### Edge Cases Status

#### EC-1: iCal-URL nicht erreichbar (Stale-Fallback)
- [x] Cached Stand wird mit „(letzter Stand)" angezeigt
- [x] Ohne Cache: Warn-Text „⚠ iCal nicht erreichbar"

#### EC-2: Leerer Kalender
- [x] Status „Frei", keine Current/Next-Buchung (Unit-Test + E2E)

#### EC-3: Buchung ohne Titel
- [x] Fallback auf `'Gast'` (Unit-Test `_extractEvents`)

#### EC-4: Buchung beginnt und endet am selben Tag
- [x] Heute als belegt behandelt (Unit-Test `_computeStatus`)

#### EC-5: Abgelaufene Buchungen
- [x] Ignoriert, kein Einfluss auf `occupied` oder `nextBooking`

#### EC-6: Sehr lange Gastnamen
- [x] Kein Layout-Bruch – CSS `text-overflow` auf Card-Head, Slot verwendet flexibles Layout

#### EC-7: XSS in Gastname
- [x] `esc()` escaped `<img src=x onerror=…>` – E2E AC-8 validiert, dass `window.XSS` undefined bleibt

### Automated Tests

| Suite | Tests | Result |
|-------|-------|--------|
| Vitest unit (`occupancy.test.js`) | 18 | ✅ |
| Vitest integration (`routes/occupancy.test.js`) | 5 | ✅ |
| Vitest (restliche Routen, Regression) | 22 | ✅ |
| Playwright chromium PROJ-4 | 12 | ✅ |
| Playwright mobile PROJ-4 | 12 | ✅ |
| Playwright chromium PROJ-1/2/3 (Regression) | 52 | ✅ |
| Playwright mobile PROJ-1/2/3 (Regression) | 52 | ✅ |
| **Gesamt** | **173** | ✅ **Alle bestanden** |

### Security Audit Results
- [x] **XSS:** Gastname wird via `esc()` escaped, AC-8 verifiziert die Payload-Abwehr
- [x] **Timeout:** 10s `AbortController` verhindert hängende Requests
- [x] **In-Flight-Dedup:** Parallele Aufrufe auf denselben Key teilen einen Fetch – verhindert Thundering Herd
- [~] **SSRF (Low):** `occupancy.icalUrl` wird vom Server ohne Scheme-/Host-Allowlist gefetcht. Ein lokaler Operator könnte `http://localhost:3100/api/...` oder interne IPs angeben. Akzeptiert für lokales Tool (kein Multi-Tenant, Operator konfiguriert eigene URLs)
- [~] **DoS via Large Response (Low):** Kein Max-Größe-Limit auf iCal-Response. Theoretisch Memory-Exhaustion bei bösartigem iCal-Server
- [~] **Cache-Wachstum (Low):** In-Memory `Map` ohne Size-Limit und ohne Cleanup bei Apartment-Löschung. Kleiner Memory-Leak, wird bei Server-Neustart zurückgesetzt

### Bugs Found

Keine Critical oder High Bugs. Drei Low-Severity-Findings (oben dokumentiert) – alle akzeptabel für ein lokales Tool.

#### BUG-1: Cache-Eintrag bleibt nach Apartment-Löschung
- **Severity:** Low
- **Steps to Reproduce:**
  1. Wohnung mit iCal anlegen, Dashboard lädt Belegung
  2. Wohnung in Setup löschen
  3. Cache-Eintrag für diese ID bleibt bis zum Server-Neustart im Speicher
- **Impact:** Memory leak minimal (kleine Datenstrukturen, nur bei häufigem Anlegen/Löschen relevant)
- **Priority:** Nice to have

#### BUG-2: Keine Scheme-Allowlist auf iCal-URL
- **Severity:** Low
- **Steps to Reproduce:**
  1. In Setup als iCal-URL `http://localhost:3100/api/apartments` eintragen
  2. Dashboard ruft eigenen API-Endpoint ab (harmlos, aber zeigt fehlende Validierung)
- **Impact:** SSRF-Vektor theoretisch vorhanden; in lokalem Single-User-Setup kein Angriffsszenario
- **Priority:** Nice to have (Scheme-Check auf `https://` wäre die einfache Abhilfe)

#### BUG-3: Keine Response-Size-Begrenzung für iCal-Fetch
- **Severity:** Low
- **Steps to Reproduce:**
  1. iCal-URL zu einem Endpoint setzen, der 100 MB Response liefert
  2. Node lädt alles in den Speicher
- **Impact:** Theoretisch Memory-Exhaustion
- **Priority:** Nice to have

### Summary
- **Acceptance Criteria:** 9/9 bestanden (inkl. aller 9 AC-Haupt-Punkte und 7 Edge-Cases)
- **Bugs Found:** 3 (0 critical, 0 high, 0 medium, 3 low)
- **Security:** Pass (3 Low-Findings, alle akzeptiert für lokales Tool)
- **Production Ready:** YES
- **Recommendation:** Deploy

## Deployment
_To be added by /deploy_
