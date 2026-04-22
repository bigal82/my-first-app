# PROJ-14: Reinigungsstatistik & Performance-Analytics

## Status: Deployed
**Created:** 2026-04-18
**Retro-Spec:** 2026-04-22

## Dependencies
- Requires: PROJ-13 (Zeiterfassung-Segmente — Datenquelle)

## Purpose
Auf der Zeiten-Seite: Performance-KPIs pro Cleaner sichtbar machen. Vertragsstunden vs. tatsächlich gearbeitet, Überstunden, Durchschnittliche Reinigungsdauer pro Wohnung, Trend über Monate.

## Key Acceptance Criteria
- Pro Cleaner-Card: Vertragsstunden/Monat, Bruttostundenlohn (€/h)
- Aktueller Monat: Ist-Stunden, Differenz zum Vertrag, Gesamtzahlung (Vertragsteil + Überstunden-Lohn)
- Durchschnittliche Reinigungsdauer pro Wohnung pro Cleaner (für Zeiten-Kalkulation)
- Monatlicher Trend-Verlauf (mehrere Monate)

## Technical Notes
- Aggregation: [app/services/timeTracking.js](../app/services/timeTracking.js) — `getCleanerStats(cleanerId, from, to)`
- Frontend: [app/public/js/timetracking.js](../app/public/js/timetracking.js) Cleaner-Cards mit Überstunden-Banner
- Lohnmodell: Vertrag = monatliche Pauschale (cleaner.monthlyHours × cleaner.hourlyRate), Überstunden zusätzlich
- Display-Logik: Wenn Überstunden > 0 → Cleaner-Card zeigt `{Vertragsteil € + Überstunden € = Gesamt €}`

## Edge Cases
- Cleaner ohne Vertrag (monthlyHours = 0) → alles Überstunden, reiner Stundenlohn
- Monatsübergreifende Segmente → werden anteilig auf beide Monate verteilt (nach ist-Datum der Segmente)
- Cleaner ohne Segmente im Monat → 0 Ist-Stunden, Vertragsstunden werden trotzdem angezeigt (offener Rest)
