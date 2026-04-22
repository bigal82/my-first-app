# PROJ-12: Reinigungsplan — Gastinfos & Personenzahl

## Status: Deployed
**Created:** 2026-04-17
**Retro-Spec:** 2026-04-22

## Dependencies
- Requires: PROJ-11 (Smoobu — liefert Personenzahl)
- Requires: PROJ-4 (iCal/Belegung)

## Purpose
Der Reinigungsplan (cleaning.html) zeigt pro Reinigungstag nicht nur "wer putzt wo", sondern auch Gast-Kontext: wer reist an, wie viele Personen, kommt am selben Tag ein neuer Gast rein. So kann der Reinigungsaufwand realistisch eingeschätzt werden.

## Key Acceptance Criteria
- Pro Reinigungsevent sichtbar: Gastname (falls verfügbar), Personenzahl (Erw+Kinder), Uhrzeit Check-in des nächsten Gasts
- Dashboard-Timeline zeigt Tages-Progression: aktueller Gast → Checkout → Reinigung → nächster Gast
- Standard-Belegung pro Wohnung konfigurierbar (wenn kein Gast sofort folgt, wird Default-Personenzahl verwendet)
- Personen-Icons zur schnellen visuellen Erkennung

## Technical Notes
- Frontend: [app/public/js/cleaning.js](../app/public/js/cleaning.js), [app/public/js/dashboard.js](../app/public/js/dashboard.js) (Timeline-View)
- Standard-Belegung in Setup pro Wohnung: `apt.defaultOccupancy` (Zahl)
- Route: `/api/cleaning/events` liefert angereicherte Events inkl. `nextGuest`, `currentGuest`, `persons`
- Badge-Priorität: guest.occupied > cleaning.active > free (siehe [renderStatusBadge in dashboard.js](../app/public/js/dashboard.js))

## Edge Cases
- Gast reist erst später am Tag an → Check-in-Uhrzeit zählt (tz.localToUtcMs)
- Keine Smoobu-Buchung (Blocker/Direktbuchung) → fallback auf defaultOccupancy
- Overbooking (alter Gast noch da) → Timeline zeigt Warnung
