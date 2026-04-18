# Revenue Dashboard v2 — Design Spec

## Ziel
Erweiterte finanzielle Auswertung aller Ferienwohnungen mit lokal gecachten Smoobu-Buchungsdaten, Drill-down pro Wohnung, Auslastungs-/RevPAR-Berechnung, Saisonvergleich und Vorbereitung fuer Fixkosten-Tracking.

## 1. Lokaler Buchungs-Cache

### Datei
`CONFIG_DIR/revenue-cache.json`

### Struktur
```json
{
  "lastSync": "2026-04-18T10:00:00Z",
  "bookings": [
    {
      "id": "smoobu-131193315",
      "apartmentId": 1983521,
      "apartmentName": "B39 DG",
      "guest": "Mona Wiederroth",
      "arrival": "2026-04-12",
      "departure": "2026-05-08",
      "nights": 26,
      "price": 3177.11,
      "commission": 0,
      "channel": "Direct booking",
      "adults": 2,
      "children": 0
    }
  ]
}
```

### Sync-Strategie
- **Erster Start**: Komplett-Sync ab 2020-01-01 (alles was Smoobu hat)
- **Folgende Starts**: Wenn Cache aelter als 6 Stunden → inkrementeller Sync (nur Buchungen mit `modifiedAt` nach `lastSync`)
- **Hintergrund**: Alle 6 Stunden automatischer Sync per setInterval
- **Manuell**: Sync-Button im Revenue Dashboard (POST /api/revenue/sync)
- **Merge-Logik**: Bestehende Buchungen per ID updaten, neue hinzufuegen, stornierte markieren

### Service
`services/revenueCache.js` — eigenstaendiges Modul:
- `loadCache()` — JSON lesen
- `saveCache()` — JSON schreiben
- `syncFromSmoobu()` — Komplett- oder inkrementeller Sync
- `getBookings(from, to)` — gefilterte Buchungen aus Cache
- `start()` — Hintergrund-Scheduler (6h)

## 2. Datumspicker

### Modus-Buttons
`[Monat] [Quartal] [Jahr] [Alles]` — aktiver Modus hervorgehoben

### Navigation
`← [Label] →` — Pfeile zum Vor-/Zurueckblaettern

| Modus | Label-Format | Beispiel |
|-------|-------------|----------|
| Monat | MMMM YYYY | April 2026 |
| Quartal | Q# YYYY | Q2 2026 |
| Jahr | YYYY | 2026 |
| Alles | Von – Bis | 2024 – 2026 |

### Verhalten
- Klick auf Modus wechselt und zeigt aktuellen Zeitraum
- Pfeile navigieren im gewaehlten Modus
- "Alles" hat keine Pfeile
- Zeitraum-Wechsel laedt Revenue-Daten neu (aus lokalem Cache, kein API-Call)

## 3. KPIs (Uebersicht)

| KPI | Formel | Position |
|-----|--------|----------|
| Gesamtumsatz | Summe `price` aller Buchungen im Zeitraum | KPI-Karte 1 |
| Buchungen | Anzahl valider Buchungen | KPI-Karte 2 |
| Uebernachtungen | Summe `nights` | KPI-Karte 3 |
| ⌀ pro Nacht | Umsatz / Uebernachtungen | KPI-Karte 4 |
| Auslastung | Belegte Naechte / (Wohnungen x Tage im Zeitraum) x 100 | KPI-Karte 5 |
| RevPAR | Umsatz / (Wohnungen x Tage im Zeitraum) | KPI-Karte 6 |

## 4. Uebersichts-Ansicht

### Monatlicher Umsatz (Chart.js Balkendiagramm)
- Blaue Balken pro Monat
- Tooltip mit Euro-Betrag

### Umsatz pro Wohnung (Balken + Klickbar)
- Horizontale Balken sortiert nach Umsatz
- Rechts: Umsatz, Buchungen, Naechte, ⌀/Nacht
- Klick oeffnet Drill-down

### Buchungskanaele (Farbiger Stacked-Bar)
- Anteil pro Kanal mit Prozent + Euro
- Legende mit farbigen Punkten

### Jahresvergleich (nur bei Modus "Alles")
- Karten pro Jahr nebeneinander

## 5. Wohnungs-Drill-Down

Klick auf eine Wohnung in der Uebersicht oeffnet ein Detail-Panel unterhalb.

### Kennzahlen-Karten
- **Umsatz**: Gesamt im Zeitraum
- **Auslastung**: Belegte Naechte / Verfuegbare Tage in % — Donut-Visualisierung
- **RevPAR**: Umsatz / Verfuegbare Tage
- **⌀ pro Nacht**: Umsatz / Belegte Naechte
- **⌀ Aufenthaltsdauer**: Durchschnittliche Naechte pro Buchung

### Saisonvergleich
Gleicher Monat ueber verschiedene Jahre als gruppierte Balken:
```
         Jan    Feb    Mrz    ...
2024:    ████   ████   ████
2025:    ██████ ████   ████████
2026:    ████   ██████ 
```

### Kanalverteilung (fuer diese Wohnung)
Donut oder Stacked-Bar mit Anteilen

### Buchungsliste
Tabelle: Gast, Anreise, Abreise, Naechte, Preis, ⌀/Nacht, Kanal

## 6. Fixkosten-Vorbereitung

### Neue Felder pro Wohnung (apartments.json)
```json
{
  "monthlyFixCosts": 850,
  "platformFeePercent": 15,
  "cleaningCostPerTurn": 80
}
```

### Setup-UI
Drei neue Felder im Wohnungs-Edit-Panel:
- **Monatliche Fixkosten** (EUR) — Miete, Nebenkosten, Versicherung
- **Plattform-Gebuehr** (%) — Airbnb/Booking Kommission
- **Reinigungskosten/Wechsel** (EUR) — pro Gaestwechsel

### Phase 1 (jetzt)
Felder im Setup speicherbar, werden in `apartments.json` persistiert.
Keine Verrechnung im Revenue Dashboard.

### Phase 2 (spaeter)
Netto-Gewinn-Berechnung:
```
Netto = Brutto - (Brutto * platformFeePercent/100) - monthlyFixCosts - (cleaningCostPerTurn * Wechsel)
```

## 7. API-Endpunkte

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | /api/revenue?from=&to= | Aggregierte Revenue-Daten (aus Cache) |
| GET | /api/revenue/apartment/:id?from=&to= | Drill-down fuer eine Wohnung |
| POST | /api/revenue/sync | Manueller Cache-Sync von Smoobu |
| GET | /api/revenue/status | Cache-Status (lastSync, Anzahl Buchungen) |

## 8. Nicht im Scope (YAGNI)
- CSV/Excel-Export
- Prognosen / Forecasting
- Automatische Preisanpassung
- Multi-Tenant (kommt spaeter als separates Projekt)
- Netto-Gewinn-Berechnung (Phase 2)
