# PROJ-13: Zeiterfassung — Wohnungssegmente

## Status: Deployed
**Created:** 2026-04-18
**Retro-Spec:** 2026-04-22

## Dependencies
- Requires: PROJ-12 (Reinigungsplan)

## Purpose
Reinigungskräfte können ihre Arbeitszeit nicht nur pauschal pro Tag, sondern **pro Wohnung als Segment** erfassen. Start + Stopp pro Wohnung → genaue Zeit-Attribution für Lohnabrechnung und Performance-Analyse.

## Key Acceptance Criteria
- Cleaner sieht Liste seiner heutigen Reinigungen, kann pro Wohnung Start/Stopp drücken
- Segmente werden pro Cleaner + Wohnung + Tag gespeichert
- Admin sieht auf Zeiten-Seite: Gesamt pro Cleaner/Tag + Breakdown pro Wohnung
- Mehrere Segmente pro Wohnung pro Tag möglich (wenn zwischendurch unterbrochen wird)
- Manuelles Nachtragen/Korrigieren möglich

## Technical Notes
- Service: [app/services/timeTracking.js](../app/services/timeTracking.js) (~430 Zeilen)
- Route: [app/routes/timetracking.js](../app/routes/timetracking.js) (~444 Zeilen)
- Frontend Cleaner: [app/public/js/my.js](../app/public/js/my.js) (Start/Stopp pro Segment)
- Frontend Admin: [app/public/js/timetracking.js](../app/public/js/timetracking.js)
- Storage: `CONFIG_DIR/time-tracking.json` — Segmente als `{ cleanerId, apartmentId, date, startMs, endMs }`
- Zeitzone-Handling via `services/timezone.js` (Docker = UTC, Anzeige in Europe/Berlin)

## Edge Cases
- Cleaner vergisst Stop → offener Segment bleibt bis nächster Start oder manueller Stop
- Mehrfach-Start ohne Stop → erster bleibt offen, Warnung im UI
- Zeiterfassung über Mitternacht → Segment endet um 23:59:59, neues startet 00:00:00 (automatisch)
