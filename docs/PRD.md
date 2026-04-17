# Product Requirements Document

## Vision
FaecherLofts Manager ist ein lokales Operations-Dashboard für die Verwaltung mehrerer Ferienwohnungen. Es bietet eine zentrale Übersicht über Belegung, Heizung (Tado), Sensoren (Minut) und Schlösser (Nuki) aller Objekte – ohne zwischen mehreren Apps wechseln zu müssen.

Die App läuft lokal im Netzwerk und ist auf Desktop und Mobilgeräten nutzbar. Kein Login, kein Cloud-Hosting – einfach starten und nutzen.

## Target Users
**Verwalter von Ferienwohnungen** (1–10 Objekte), die täglich den Status mehrerer Wohnungen im Blick behalten müssen.

Schmerzpunkte:
- Statuswechsel zwischen Tado-App, Minut-App, Nuki-App und Buchungsplattform kostet Zeit
- Batteriewarnungen, offene Fenster und Offline-Geräte werden zu spät bemerkt
- Kein Überblick über aktuelle Gäste und kommende Buchungen ohne Plattform-Login
- Heizungssteuerung bei Leerstand (Home/Away, Alle aus) erfordert App-Wechsel

## Core Features (Roadmap)

| Priority | Feature | Status |
|----------|---------|--------|
| P0 (MVP) | Core Server & Konfiguration | Planned |
| P0 (MVP) | Setup-Seite (Wohnungen & Integrationen verwalten) | Planned |
| P0 (MVP) | Dashboard Basis (KPI, Filter, Statusbanner, Karten) | Planned |
| P0 (MVP) | iCal / Belegungsintegration | Planned |
| P0 (MVP) | Tado Integration – Datenabruf (V3 + X) | Planned |
| P0 (MVP) | Tado Integration – Aktionen & Rate-Limit-Handling | Planned |
| P0 (MVP) | Minut Integration – Dashboard-Widget | Planned |
| P0 (MVP) | Minut Detailseite (Charts, Zeitbereich, Noise-Limit) | Planned |
| P0 (MVP) | Nuki Integration | Planned |
| P0 (MVP) | Globale Batterie- & Statuslogik | Planned |

## Success Metrics
- Ein einziger Blick auf das Dashboard genügt, um den Status aller Wohnungen zu kennen
- Batteriewarnungen, offene Fenster und Offline-Geräte werden sofort sichtbar
- Heizung lässt sich direkt im Dashboard steuern (kein App-Wechsel nötig)
- App startet lokal mit einem einzigen Befehl (`npm start` o.ä.)

## Constraints
- Läuft lokal im Netzwerk (kein Cloud-Hosting)
- Kein User-Login, kein Multi-User-Auth
- Node.js Backend + statisches Frontend (kein Frontend-Framework)
- Konfiguration über JSON-Datei, ENV-Variablen für API-Zugangsdaten
- Tado Rate Limit: 100 Requests/Tag (ohne AI Assist), muss strikt eingehalten werden
- 30-Minuten-Cache für alle externen API-Calls

## Non-Goals
- Kein Cloud-Hosting, kein öffentlicher Zugriff
- Keine Buchungsverwaltung (kein Erstellen/Ändern von Buchungen)
- Kein eigenes Benachrichtigungssystem (keine Push-Nachrichten, keine E-Mails)
- Kein Mehrbenutzer-System mit Rollen und Rechten
- Keine nativen Apps (iOS/Android)
- Kein Demo-Modus mit Fake-Daten
