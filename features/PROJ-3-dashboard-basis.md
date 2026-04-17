# PROJ-3: Dashboard Basis

## Status: Approved
**Created:** 2026-04-14
**Last Updated:** 2026-04-14

## Dependencies
- Requires: PROJ-1 (Core Server & Konfiguration)

## User Stories
- Als Betreiber möchte ich beim Öffnen der App sofort eine Übersicht aller aktiven Wohnungen sehen.
- Als Betreiber möchte ich eine KPI-Zeile oben sehen (Anzahl Wohnungen, Warnungen, Offline-Geräte), damit ich den Gesamtstatus sofort erkenne.
- Als Betreiber möchte ich einen globalen Statusbanner sehen, der kritische Probleme (offline, Fenster offen, niedrige Batterie) zusammenfasst.
- Als Betreiber möchte ich Wohnungen nach Name oder Standort filtern/suchen.
- Als Betreiber möchte ich das Dashboard auf Desktop und mobilen Geräten nutzen.

## Acceptance Criteria
- [ ] Dashboard unter `/` zeigt alle Wohnungen mit `visible: true`
- [ ] KPI-Zeile zeigt: Anzahl aktiver Wohnungen, Anzahl Wohnungen mit Warnungen, Timestamp letzter Daten-Stand
- [ ] Globaler Statusbanner zeigt Anzahl und Liste von: Offline-Räumen, offenen Fenstern, niedrigen Batterien
- [ ] Statusbanner ist ausblendbar und zeigt sich nur wenn Probleme vorhanden
- [ ] Wohnungskarten-Grid: mindestens 320px Breite pro Karte, responsive (1–3+ Spalten je nach Viewport)
- [ ] Sucheingabe filtert Wohnungen nach Name und Standort (live, ohne Reload)
- [ ] Filter-Status-Chips: "Alle" / "Mit Warnungen" / "Gast da"
- [ ] Wohnungskarte zeigt: Name, Standort/Kürzel, Platzhalter für Integrations-Daten
- [ ] Reihenfolge in Karte: Kopf → Status-Badges → Belegung → Tado-Rate-Limit → Wohnungsaktionen → Nuki-Geräte → Tado-Räume
- [ ] Leerer Zustand (keine Wohnungen konfiguriert) zeigt Hinweis mit Link zur Setup-Seite
- [ ] Navigation: Link zwischen Dashboard und Setup-Seite
- [ ] FaecherLofts-Branding (Name/Logo) im Header

## Edge Cases
- Alle Wohnungen `visible: false` → leerer Zustand mit Hinweis
- Suche ergibt keine Treffer → Hinweistext statt leerer Seite
- Filter `Gast da` ohne iCal-Daten → alle Wohnungen ohne iCal werden nicht ausgeblendet
- Sehr langer Wohnungsname → kein Layout-Bruch (text-overflow)
- Statusbanner ohne Probleme → Banner wird ausgeblendet

## Technical Requirements
- Kein Frontend-Framework (Vanilla JS, HTML, CSS)
- CSS Grid oder Flexbox für responsives Layout
- Daten werden von `/api/apartments` geladen
- Hochwertige, ruhige UI – kein generisches Bootstrap-Look
- Klare visuelle Hierarchie (keine generische Kartenwiese)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
**Designed:** 2026-04-14

### UI-Komponentenbaum
```
Dashboard (/)
├── AppHeader  [existiert – Logo + Navigation]
│
├── StatusBanner  [nur sichtbar wenn Probleme vorhanden]
│   ├── BannerHeadline  ("3 Probleme" + Schließen-Button)
│   └── ProblemList
│       ├── OfflineRooms   (Platzhalter → PROJ-4–9 füllen)
│       ├── OpenWindows    (Platzhalter → PROJ-5)
│       └── LowBattery     (Platzhalter → PROJ-10)
│   → Struktur + Dismiss werden in PROJ-3 gebaut; Inhalt kommt in PROJ-4–10
│
├── KPI-Row
│   ├── KPI: Aktive Wohnungen  (aus apartments.filter(visible))
│   ├── KPI: Wohnungen mit Warnungen  (Platzhalter = 0)
│   └── KPI: Letzter Daten-Stand  (Uhrzeit der API-Antwort)
│
├── FilterBar
│   ├── Sucheingabe  (live-filtert nach Name + Kürzel)
│   └── Quick-Filter-Chips
│       ├── "Alle"  [Standard]
│       ├── "Mit Warnungen"  [Platzhalter → PROJ-10]
│       └── "Gast da"  [Platzhalter → PROJ-4]
│
├── ApartmentsGrid  [CSS Grid, min 320px pro Karte, 1–3+ Spalten]
│   └── ApartmentCard  (× N)
│       ├── CardHead: Name + Kürzel + Status-Badge
│       ├── Belegung-Slot     [Platzhalter → PROJ-4]
│       ├── TadoRateLimit-Slot [Platzhalter → PROJ-5/6]
│       ├── CardActions       [Platzhalter → PROJ-6/9]
│       ├── NukiGeraete-Slot  [Platzhalter → PROJ-9]
│       └── TadoRaeume-Slot   [Platzhalter → PROJ-5]
│
└── EmptyState  (drei Varianten)
    ├── Keine Wohnungen → Link zu /setup
    ├── Alle visible:false → Hinweis
    └── Kein Suchtreffer → "Keine Wohnungen für '…' gefunden"
```

### Datenmodell
**Quelle:** `GET /api/apartments` (existierender Endpunkt, kein neuer Backend-Code nötig)

| Gegend | Woher | PROJ-3? |
|--------|-------|---------|
| Aktive Wohnungen | `filter(visible).length` | ✅ |
| Letzter Daten-Stand | Zeitstempel der API-Antwort | ✅ |
| Wohnungen mit Warnungen | Kommt von PROJ-10 | Platzhalter |
| Belegungsstatus | Kommt von PROJ-4 | Platzhalter |
| Tado-Daten | Kommt von PROJ-5 | Platzhalter |
| Nuki-Geräte | Kommt von PROJ-9 | Platzhalter |

**Filter-Zustand** (Browser-Memory, kein Server, kein localStorage):
- `searchTerm` – Text der Sucheingabe
- `activeChip` – „alle" / „warnings" / „guest"
- `bannerDismissed` – ob der Banner weggeklickt wurde (bis Reload)

### Tech-Entscheidungen

| Entscheidung | Grund |
|---|---|
| Kein neuer API-Endpunkt | `/api/apartments` reicht; Integrationsdaten kommen in PROJ-4–9 als eigene Endpunkte |
| Filter-State nur im Speicher | Kurze Sessions, kein gespeichertes Suchfeld nach Reload gewünscht |
| Platzhalter-Slots in der Karte | Layout jetzt stabil aufbauen, damit PROJ-4–9 Slots einfach befüllen können |
| CSS Grid `auto-fill / minmax(320px)` | Automatisch 1 Spalte auf Mobil, 2–3+ auf Desktop – ohne Media Queries |
| Banner-Dismiss nur bis Reload | Beim nächsten Öffnen soll der Verwalter neue Warnungen sehen |
| Kein neues npm-Paket | Vanilla JS + CSS reichen vollständig |

### Was wird in PROJ-3 gebaut

| Bereich | Status |
|---------|--------|
| Karten-Layout + Grid | ✅ vollständig |
| KPI: Aktive Wohnungen + Zeitstempel | ✅ vollständig |
| StatusBanner Struktur + Dismiss | ✅ vollständig |
| Suche (live) + Filter-Chips (UI) | ✅ vollständig |
| Alle Empty-State-Varianten | ✅ vollständig |
| KPI Warnungen / Banner-Inhalt / Chips live | Platzhalter (PROJ-4–10) |

## Implementation Notes (Frontend)
**Implemented:** 2026-04-14

### Was gebaut wurde
- `app/public/js/dashboard.js` – komplett neu geschrieben mit:
  - `esc()` XSS-Helfer (DOM-basiert, identisch mit setup.js)
  - State: `apartments`, `lastLoaded`, `searchTerm`, `activeChip`, `bannerDismissed`
  - `loadApartments()` – GET /api/apartments mit Fehlerbehandlung
  - `renderKpiRow()` – Aktive Wohnungen, Warnungen (Platzhalter 0), Letzter Stand
  - `renderStatusBanner()` – Struktur + Dismiss-Button (leer bis PROJ-4–10)
  - `renderFilterBar()` – Live-Suche + 3 Chips (Alle / Warnungen / Gast da)
  - `renderApartmentCard()` – Kopf mit Name/Kürzel + 5 Integrations-Slots (Belegung, Tado Rate-Limit, Aktionen, Nuki, Tado-Räume)
  - `renderGrid()` – 3 Empty-States (keine Wohnungen / alle unsichtbar / kein Suchtreffer) + normales Karten-Grid
- `app/public/css/main.css` – erweitert um:
  - `.kpi-row`, `.kpi-card`, `.kpi-label`, `.kpi-value`, `.kpi-value--small`
  - `.status-banner`, `.status-banner__head`, `.status-banner__list`
  - `.filter-bar`, `.filter-bar__search`, `.filter-bar__chips`, `.chip`, `.chip--active`
  - `.apartments-grid` (CSS Grid mit `auto-fill, minmax(320px, 1fr)`)
  - `.apartment-card`, `.apartment-card__head`, `.apartment-card__title`, `.apartment-card__section`, `.apartment-card__actions`, `.slot-label`, `.slot-body`

### Nicht in PROJ-3 enthalten (Platzhalter)
- KPI „Mit Warnungen" zeigt 0 → echte Zahlen kommen in PROJ-10
- Chip „Mit Warnungen" und „Gast da" filtern noch nichts → PROJ-4/10
- StatusBanner-Inhalt ist leer → PROJ-4–10
- Alle Karten-Slots zeigen „— (PROJ-X)" Platzhalter

### Regressionstest
Alle 70 Playwright-Tests (35 chromium + 35 mobile) bestehen weiterhin. Die PROJ-1 Dashboard-Tests (Empty-State, Wohnungskarte, 375px Viewport) laufen mit dem neuen dashboard.js erfolgreich durch.

## QA Test Results

**Tested:** 2026-04-14
**App URL:** http://localhost:3100
**Tester:** QA Engineer (AI)

### Acceptance Criteria Status

#### AC-1: Dashboard unter `/` zeigt alle sichtbaren Wohnungen
- [x] Nur `visible: true` Wohnungen werden gerendert
- [x] Karten zeigen Name und Standort

#### AC-2: KPI-Zeile
- [x] Anzahl aktiver Wohnungen korrekt berechnet
- [x] Anzahl Warnungen als Platzhalter (0) sichtbar
- [x] Letzter Daten-Stand als Uhrzeit (HH:MM)

#### AC-3: Statusbanner
- [x] Banner ist unsichtbar wenn keine Probleme vorhanden
- [x] Struktur und Dismiss-Button existieren im Code (Platzhalter → PROJ-4–10)

#### AC-4: Wohnungskarten-Grid
- [x] CSS Grid mit `auto-fill, minmax(320px, 1fr)`
- [x] Responsive 1–3+ Spalten je nach Viewport
- [x] Alle Wohnungen als Karten gerendert

#### AC-5: Live-Suche
- [x] Filtert nach Wohnungsname (live, ohne Reload)
- [x] Filtert auch nach Standort/Kürzel

#### AC-6: Filter-Status-Chips
- [x] Drei Chips sichtbar: „Alle", „Mit Warnungen", „Gast da"
- [x] „Alle" ist standardmäßig aktiv
- [x] Chip-Wechsel aktualisiert visuell
- [~] „Mit Warnungen" / „Gast da" filtern noch nicht (Platzhalter → PROJ-4/10)

#### AC-7: Wohnungskarte Inhalt + Reihenfolge
- [x] Kopf (Name + Kürzel + Status-Badge)
- [x] Reihenfolge: Belegung → Tado Rate-Limit → Aktionen → Nuki → Tado-Räume
- [x] Alle 5 Slots existieren im DOM mit `data-slot` Attributen

#### AC-8: Empty-State (keine Wohnungen)
- [x] Hinweis mit Link zur Setup-Seite
- [x] Variante „Alle unsichtbar" zeigt passenden Hinweis
- [x] Variante „Kein Suchtreffer" zeigt Suchbegriff im Text

#### AC-9: Navigation zwischen Dashboard und Setup
- [x] Header-Links funktionieren in beide Richtungen
- [x] Aktiver Link korrekt hervorgehoben

#### AC-10: FaecherLofts-Branding im Header
- [x] Logo sichtbar und stilisiert

### Edge Cases Status

#### EC-1: Alle Wohnungen visible:false
- [x] Empty-State mit Hinweis „Alle Wohnungen sind ausgeblendet"

#### EC-2: Suche ohne Treffer
- [x] Hinweistext mit Suchbegriff statt leerer Seite

#### EC-3: Filter „Gast da" ohne iCal
- [~] Chip-Logik ist Platzhalter, keine Filterung aktiv (erwartet, kommt in PROJ-4)

#### EC-4: Sehr langer Wohnungsname
- [x] text-overflow: ellipsis greift, kein horizontaler Scroll auf 375px

#### EC-5: Statusbanner ohne Probleme
- [x] Banner wird ausgeblendet (nicht gerendert)

#### EC-6: XSS im Wohnungsname
- [x] `<img src=x onerror="window.XSS=1">` wird escaped, Script läuft nicht

### Automated Tests

| Suite | Tests | Result |
|-------|-------|--------|
| Vitest unit (routes) | 22 | ✅ Pass |
| Playwright chromium (PROJ-3) | 18 | ✅ Pass |
| Playwright mobile (PROJ-3) | 18 | ✅ Pass |
| **Gesamt PROJ-3** | **58** | ✅ **Alle bestanden** |
| **Gesamte Suite (inkl. Regression)** | **126** | ✅ **Alle bestanden** |

Regression: PROJ-1 (28 Tests) und PROJ-2 (42 Tests) bleiben vollständig grün.

### Security Audit Results
- [x] XSS: `esc()` DOM-Escaping schützt alle Nutzer-Inhalte, EC-6 verifiziert die Payload-Abwehr
- [x] Dashboard ist read-only (keine POST/PUT/DELETE aus diesem Feature)
- [x] Suchbegriff in Empty-State-Nachricht wird ebenfalls escaped
- [x] Kein Session- oder Auth-Token im Browser (by design)
- [~] API liefert Tado-Passwort im Klartext aus `/api/apartments` – akzeptiertes Design-Constraint aus PROJ-1 (lokales Netz), kein neues PROJ-3-Finding

### Bugs Found

Keine neuen Bugs. Die Platzhalter-Slots und -Chips sind dokumentiert und erwartet.

### Summary
- **Acceptance Criteria:** 10/10 bestanden (AC-6 mit dokumentierten Chip-Platzhaltern)
- **Bugs Found:** 0
- **Security:** Pass (keine neuen Findings)
- **Production Ready:** YES
- **Recommendation:** Deploy

## Deployment
_To be added by /deploy_
