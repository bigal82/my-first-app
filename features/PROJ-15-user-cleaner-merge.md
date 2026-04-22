# PROJ-15: User/Cleaner Merge (Unified Data Model)

## Status: Deployed
**Created:** 2026-04-18
**Retro-Spec:** 2026-04-22

## Dependencies
- Requires: PROJ-13 (Zeiterfassung — referenziert Cleaner-IDs)

## Purpose
Historisch gab es zwei separate Datenmodelle: **users** (Login: admin + cleaner) und **cleaners** (Reinigungsmitarbeiter mit Stammdaten). Das erzeugte Doppelpflege, fehlerhafte Verknüpfungen und unklare "wer gehört zu wem"-Logik. Konsolidiert: Cleaner sind jetzt Users mit `role='cleaner'`, Legacy-Cleaner bleiben rückwärtskompatibel verknüpft.

## Key Acceptance Criteria
- User mit `role='cleaner'` bekommen Stammdaten-Felder: `phone`, `email`, `monthlyHours`, `hourlyRate`, `apartments[]`, `calToken`, `notifyOnAssignment`
- Admin-Users können auch Reinigung erhalten (via `cleanerId`-Verknüpfung zu einem legacy-Cleaner-Datensatz)
- Migration beim Start: `userStore.migrateCleanersIntoUsers()` übernimmt bestehende cleaners.json-Einträge in users.json
- Setup: Benutzer-Sektion zeigt Admins und Cleaner gemeinsam (Rollen-Badge), Cleaner-Sektion bleibt für Legacy-Cases

## Technical Notes
- Service: [app/services/userStore.js](../app/services/userStore.js) — Single-Source-of-Truth für Logins + Cleaner-Daten
- Migration: `migrateCleanersIntoUsers()` läuft beim Serverstart, idempotent
- Legacy-Cleaners: [app/services/integrationsStore.js](../app/services/integrationsStore.js) hält historische cleaners-Liste für Nicht-Login-Mitarbeiter
- Frontend: [app/public/js/setup/users.js](../app/public/js/setup/users.js) — unified UI für Users + Cleaners-Management
- Cal-Token: Bevorzugt cleanerId-verknüpft (sonst user.calToken als Fallback) — siehe renderMyCalendar

## Edge Cases
- Legacy-Cleaner ohne User → bleibt im integrationsStore, wird in Cleaners-Sektion gepflegt
- User mit `cleanerId` verlinkt → erbt Stammdaten vom verknüpften Cleaner (Zeiterfassung/Kalender)
- Admin wird zu Cleaner degradiert → Login bleibt, Cleaner-Felder werden editierbar
