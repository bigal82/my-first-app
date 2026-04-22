# PROJ-11: Smoobu API Integration

## Status: Deployed
**Created:** 2026-04-17
**Retro-Spec:** 2026-04-22 (rekonstruiert aus Code + Commits)

## Dependencies
- Requires: PROJ-4 (iCal/Belegung — Smoobu löst iCal als Datenquelle ab)

## Purpose
Direkte Smoobu-REST-API-Anbindung als Alternative zu iCal. Liefert exaktere Daten (Uhrzeiten, Gastname sauber, Personenzahl, Buchungskanal, Stornierungen). Ersetzt iCal-Parsing pro Wohnung auf Wunsch.

## Key Acceptance Criteria
- Global Smoobu-API-Key in Setup → Integrations → Smoobu
- Pro Wohnung wählbar: `occupancy.source = 'ical' | 'smoobu'` + `occupancy.smoobuApartmentId`
- `/api/occupancy/:aptId` liefert bei `source=smoobu` Daten direkt aus Smoobu-API
- Stundenaufenthalt statt Tagesgranularität (Check-in/out echte Uhrzeiten)
- Stornierungen werden abgefragt via `showCancellation=true` (getBookings) bzw. `false` (getAllBookings für Revenue)

## Technical Notes
- Service: [app/services/smoobu.js](../app/services/smoobu.js) — OAuth via API-Key, 5-min-Cache pro Wohnung, 1h-Cache für Apartments-Liste
- Normalizer: `normalizeBooking()` in smoobu.js, Felder `raw.adults ?? raw['adults-number']` defensive
- Revenue-Cache: [app/services/revenueCache.js](../app/services/revenueCache.js) — persistent JSONL, stündlicher Voll-Sync
- Setup-UI: Integrations-Card → "Wohnungen laden" fetcht Smoobu-Apartments, Dropdown pro lokaler Wohnung

## Edge Cases
- Stornierte Buchung in Smoobu → `getAllBookings` (excludeBlocked=true, showCancellation=false) liefert sie nicht mehr; lokaler Cache hält sie ggf. als aktiv. Bekannte Limitation.
- Smoobu-API-Key ungültig → 401, stale-Fallback im Wohnungs-Cache
- Rate-Limit (1000/min) → 429-Handling, Error bubbling
