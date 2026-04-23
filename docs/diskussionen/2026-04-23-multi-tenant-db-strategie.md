# Diskussion: Datenbank-Strategie für einen Multi-Tenant-SaaS

**Datum:** 2026-04-23
**Kontext:** Umbau eines bestehenden Operations-Dashboards für Ferienwohnungsverwaltung (aktuell 1 Betreiber, 8 Objekte, Node.js + JSON-Dateien als Storage) zu einer mandantenfähigen SaaS-Plattform. Ziel: ~200 Mandanten mit je 5-20 Objekten in 2-3 Jahren.

Diese Notiz fasst die Architekturentscheidungen zusammen, die ich mit einem Entwicklungspartner diskutiert habe. Zweck: zweite Meinung einholen, bevor wir investieren.

---

## 1. Ausgangslage

Das bestehende System ("Manager") läuft seit ~1 Jahr produktiv:

- **Stack:** Node.js + Express, Vanilla JS Frontend, Docker-Container bei Coolify auf einem Hetzner-Server in Falkenstein.
- **Persistenz:** Flat Files im Container-Volume — JSON für strukturierte Daten (Wohnungen, Buchungen, Zeiterfassung, User), JSONL (Append-only) für Zeitreihen (Tado-Heizungsdaten alle 15 Min, Minut-Sensoren alle 5 Min).
- **Integrationen:** Smoobu (Buchungen), Tado (Heizung V3+X), Minut (Sensoren), Nuki (Schlösser), iCal-Feeds als Fallback.
- **Nutzer:** Ein Betreiber mit Admin-Account + mehrere Reinigungskräfte. Auth via klassischer Session (bcrypt, httpOnly-Cookie).

Die Plattform soll jetzt als SaaS für weitere Betreiber geöffnet werden. Dafür steht u.a. die Frage im Raum, ob wir weiter bei JSON-Files bleiben oder auf eine echte Datenbank migrieren — und wenn ja, auf welche.

## 2. Datenvolumen — das reale Bild bei 200 Mandanten

Bevor man Technologie wählt, sollte man das Volumen ehrlich ausrechnen. Annahme pro Mandant: 8 Wohnungen, 3 Tado-Räume/Wohnung, 1 Minut-Sensor/Wohnung, 3 Reinigungskräfte.

| Datentyp | Einträge/Jahr bei 200 Mandanten | Rohgröße |
|---|---|---|
| Buchungen (Smoobu-Cache) | ~240.000 | ~50 MB |
| Reinigungs-Events | ~320.000 | ~80 MB |
| Zeiterfassung | ~150.000 | ~30 MB |
| Aktions-Log | ~5-10 M | ~500 MB |
| **Tado-Historie** (15 min/Raum) | ~170 M | **~30 GB** |
| **Minut-Historie** (5 min/Device) | ~170 M | **~30 GB** |
| **Summe/Jahr** | ~350 M Rows | **~60 GB** |

**Zentrale Beobachtung:** Die Business-Daten (Buchungen, Reinigungen, Zeiterfassung, Logs) machen selbst bei 200 Mandanten **< 1 GB pro Jahr** aus. Der Flaschenhals liegt bei den Sensor-Historien. Das verändert die Technologiewahl erheblich — für reine Business-Daten reicht jede moderne DB problemlos, aber Zeitreihen sind eine andere Klasse.

## 3. Tenancy-Modell

Drei Klassiker, ich bewerte für unseren Fall:

| Modell | Isolation | Komplexität | Empfehlung |
|---|---|---|---|
| **Shared DB + `tenant_id` + Row-Level Security** | Postgres enforced Filter auf jeder Query | mittel | **Ja** |
| Schema-per-Tenant | stärker, aber DB-Migrationen ×N | hoch | nein |
| DB-per-Tenant | Maximum, Container-Overhead | sehr hoch | nein — Overkill |

**Shared + RLS** ist SaaS-Standard (Supabase, Stripe intern, viele andere). Jede Request-Middleware setzt `SET LOCAL app.tenant_id = $1`, und Postgres filtert jede Query automatisch. Selbst bei Backend-Bugs (z.B. `WHERE`-Klausel vergessen) ist Cross-Tenant-Zugriff strukturell unmöglich.

Wichtig: Die Spalte `tenant_id UUID NOT NULL` steht auf **jeder** mandantenspezifischen Tabelle. Users und tenants selbst sind tenantübergreifend (ein User kann zu mehreren Mandanten gehören — für spätere Agentur-Nutzer).

## 4. Die drei realistischen Technologie-Optionen

### Option A — Coolify-Postgres (self-hosted im selben Hetzner-Server)

**Dafür:**
- Zero-Latency, identische Docker-Netz-Verbindung
- Daten bleiben physikalisch auf einem deutschen Server, DSGVO trivial zu argumentieren
- Kosten ~0 €/Monat (selber Server)
- Kein Vendor-Lock-in — plain Postgres, morgen zu jedem Hoster transportierbar
- Coolify macht automatische tägliche Backups

**Dagegen:**
- Single Point of Failure — fällt der Server aus, ist alles weg
- Man ist der DBA (Upgrades, Tuning, Monitoring)
- Bei sehr hoher Last müsste man manuell skalieren

### Option B — Hetzner Managed Postgres (neu seit 2024/25)

**Dafür:**
- Hetzner hostet, verwaltet, patcht, backupt
- Gleiches Rechenzentrum, gleiche DSGVO-Argumentation
- Point-in-Time-Recovery (PITR) inklusive
- Trennung App-Server / DB-Server → kein gemeinsamer Ausfall
- ~15-30 €/Monat je nach Instanz-Größe
- Plain Postgres, null Lock-in

**Dagegen:**
- Feste monatliche Kosten, nicht 0
- Etwas weniger Performance als gleicher Server wegen Netzwerk (aber im selben DC, also <1ms)

### Option C — Supabase (hosted bei supabase.com)

**Dafür — was objektiv gut ist:**
- **Auth ist fertig**: Email/Password, OAuth, Magic Links, MFA (TOTP + Backup-Codes, SMS via Twilio optional) — spart ca. 1 Woche Entwicklung
- **RLS als First-Class-Feature**: Dashboard zeigt pro Tabelle welche Rows ein bestimmter User sieht, Policies editierbar mit Preview
- **PostgREST Auto-API**: CRUD-Endpoints werden automatisch aus den Tabellen generiert
- **Realtime**: Postgres-Changes als WebSocket-Stream, Dashboard könnte live updaten
- **Storage**: S3-kompatible Buckets für Dokumente
- **Developer Experience**: SQL-Editor, Table-Editor, Log-Viewer deutlich komfortabler als `psql`
- **Open Source Core**: Im Notfall auf eigener Infrastruktur betreibbar
- **Free Tier großzügig**: 500 MB DB + 50k MAUs — reicht für die ersten ~20 zahlenden Mandanten

**Dagegen — was konkret weh tut:**

1. **DSGVO ist eine Grauzone**. Supabase Inc. ist US-Firma, die EU-Region läuft auf AWS Frankfurt. Unter dem US **CLOUD Act** können US-Behörden theoretisch auf Daten zugreifen, auch wenn sie physisch in der EU liegen. In der Praxis verwenden viele deutsche SaaS Supabase mit DPA/AVV. Aber: das Marketing-Argument "100% DSGVO, Server in Deutschland, keine US-Cloud" gibt man auf der Landingpage weg. Für den deutschen SMB-Zielmarkt ist das ein messbarer Verlust.

2. **Kostenkurve knickt nach oben**:

   | Mandanten | Plan | Monat |
   |---|---|---|
   | 1-20 | Free | 0 $ |
   | 20-50 | Pro | 25 $ |
   | 50-200 | Pro + Compute-Add-Ons | 50-100 $ |
   | 200+ | Team | ab 599 $ |

   Zum Vergleich: Coolify 0 €, Hetzner Managed ~20 €.

3. **PostgREST als Lock-in-Trap**: Klingt verlockend ("kein Backend-Code für CRUD"), aber wir haben viel Business-Logik die nicht CRUD ist: Rate-Limiting, externe API-Syncs, Aggregationen, PDF-Generierung, Timezone-Handling. Dafür brauchen wir weiterhin einen Express-Server. Wer PostgREST für "einfache" Queries nimmt und Express für komplexe, hat zwei API-Welten nebeneinander. Das wird auf Dauer unübersichtlich.

4. **Auth-Migration ist Einbahnstraße**: RLS-Policies migrieren sauber weg (Standard-Postgres), aber die Auth-Layer von Supabase nicht — Passwort-Hashes sind in deren eigenem Format, Sessions sind deren JWTs. Ein späterer Wechsel = alle Nutzer müssen Passwort zurücksetzen.

5. **Realtime + Storage brauchen wir jetzt nicht**. Man zahlt für Features die man nicht nutzt. 80 % des Supabase-Value-Propositions sind Auth + Realtime + Storage. Von uns gebraucht: aktuell nur Auth — und das haben wir zu 80 % schon selbst gebaut.

### MFA-Frage speziell

Wenn MFA der Grund für Supabase wäre: **Das wäre ein schwaches Argument.** MFA ist ein Weekend-Projekt.

**Self-built TOTP-MFA mit unserem bestehenden Auth:**
- Libraries: `otplib` / `speakeasy` (TOTP), `qrcode` (Enrollment)
- Aufwand: ~2-3 Tage für Backend + UI
- Funktioniert mit denselben Apps wie Supabase (Google Authenticator, Authy, 1Password)
- UX für Endnutzer identisch — TOTP ist ein offener Standard (RFC 6238)

**Realistische MFA-Priorität für diesen Fall:**

| Rolle | MFA nötig? |
|---|---|
| Mitarbeiter (z.B. Reinigungskräfte) | Nein — oft ältere Zielgruppe, MFA frustriert |
| Mandanten-Admin (Betreiber) | Optional anbieten |
| Plattform-Admin (Betreiber der SaaS) | Ja, mandatory |

MFA braucht man zuerst für sich selbst, nicht für Kunden. Das rechtfertigt keine Supabase-Abhängigkeit.

## 5. Bewertungsmatrix

| Kriterium | Gewicht | Coolify-Postgres | Hetzner Managed | Supabase |
|---|---|---|---|---|
| Datensouveränität (EU-Only) | hoch | 10 | 10 | 5 |
| Developer Experience | mittel | 6 | 6 | 10 |
| Skalierung auf 200 Mandanten | hoch | 7 | 9 | 8 |
| Kosten im ersten Jahr | hoch | 10 | 8 | 6 |
| Ops-Aufwand | hoch | 6 | 9 | 10 |
| Lock-in-Risiko | mittel | 10 | 10 | 5 |
| DSGVO-Verkaufsargument | hoch | 10 | 10 | 5 |
| **Gesamt gewichtet** | | **8/10** | **9/10** | **7/10** |

## 6. Sensor-Historien — der eigentliche Knackpunkt

Business-Daten sind unkritisch. Aber die Zeitreihen brauchen einen Plan.

**Drei realistische Wege:**

1. **JSONL pro Mandant weiterführen** — funktioniert bis ~20-30 Mandanten. Danach Queries auf Plattform-Ebene (z.B. Durchschnitts-Analytics über alle Mandanten) werden langsam bzw. nur via File-Walk möglich.

2. **TimescaleDB (Postgres-Extension)** — genau für diesen Case gebaut. Hypertables partitionieren automatisch nach Zeit, Native Compression reduziert die Rohgröße **10-20×**. Unsere 60 GB/Jahr → realistisch 3-5 GB komprimiert. Installation: `CREATE EXTENSION timescaledb;` — gleiche DB, gleicher Container, zero-downtime. Community-Lizenz kostenfrei.

3. **Externe Time-Series-DB** (InfluxDB Cloud, Timescale Cloud) — Overkill in dieser Größenordnung, weitere Abhängigkeit, weitere DSGVO-Diskussion.

## 7. Backup-Strategie — was wirklich sicher ist

Egal welche DB: Eine einzelne Backup-Quelle reicht nicht für produktive Kundendaten.

**Empfohlene Pipeline:**

1. **Täglich automatisch:** `pg_dump` → komprimiert → verschlüsselt → **Hetzner Storage Box** (100 GB = ~4 €/Monat, separates Rechenzentrum, DSGVO-konform).
2. **Wöchentlich:** Zusätzliche Kopie nach **rsync.net** oder **Backblaze B2** (geo-redundant, andere Firma, anderes Land — wichtig falls Hetzner als Ganzes ein Problem hat).
3. **Restore-Drill monatlich:** Automatisches Einspielen auf Test-Instance — ein ungetestetes Backup ist keins.
4. **Sensor-JSONL oder TimescaleDB:** Läuft in derselben Pipeline. Bei TimescaleDB: `pg_dump` deckt alles mit ab.

Für Managed DBs (Hetzner, Supabase, AWS RDS) ist PITR (Point-in-Time-Recovery) meistens inkludiert — deckt den täglichen Teil ab. Die geo-redundante Zweitkopie sollte man trotzdem zusätzlich bauen.

## 8. Die Empfehlung — in drei Phasen

Die Kernlogik: **Nie mehr bezahlen als nötig, aber auch nie später mit Technical-Debt-Migration kämpfen.** Jede Phase ist technisch trivial, der Code-Pfad bleibt derselbe (Standard-Postgres).

```
Phase 1 (jetzt – 30 zahlende Mandanten)
────────────────────────────────────────
  • Coolify-Postgres auf dem bestehenden Server
  • JSONL für Sensor-Historien (pro-Mandant-Ordner)
  • Backup: täglich nach Hetzner Storage Box (~4 €/mo)
  • Kosten: ~4 €/Monat total

Phase 2 (30 – 100 zahlende Mandanten)
────────────────────────────────────────
  • TimescaleDB-Extension aktivieren: 1 SQL-Befehl
  • Sensor-Historien werden Hypertables, Compression ein
  • Kein Code-Change, nur Schema-Erweiterung
  • Kosten: weiterhin ~4 €/Monat

Phase 3 (100+ zahlende Mandanten oder wenn Ops nervt)
────────────────────────────────────────
  • Migration zu Hetzner Managed Postgres
  • Connection-String tauschen, pg_dump/restore, fertig
  • PITR automatisch inkludiert
  • App-Code unverändert
  • Kosten: ~25-40 €/Monat
```

**Supabase würde Sinn machen wenn...**
- Man bei Null anfinge ohne bestehende Infrastruktur
- Man Realtime + Storage + Auth wirklich alle bräuchte
- Der Zielmarkt US/international wäre und DSGVO-Argument keine Rolle spielt
- Man bereit wäre, die Auth-Lock-in-Kosten später in Kauf zu nehmen

In diesem Fall trifft keins davon zu. Der pragmatische Weg gewinnt.

## 9. Migrations-Vorgehen (Stufenplan, jederzeit Rollback)

Damit der bestehende Mandant **produktiv** mit echten Gästen weiterläuft während der Umbau passiert:

- **A) Vorbereitung:** Postgres-Service anlegen, Schema + RLS migrieren, Client-Code dazu — App läuft unverändert weiter, DB wird noch nicht genutzt
- **B) Initial-Daten-Migration:** Einmaliger Admin-Klick, JSON-Files werden nach Postgres kopiert, JSON bleibt unberührt als Backup
- **C) Dual-Write:** Alle Writes gehen in beide Quellen (JSON primär, Postgres sekundär) — 1-2 Wochen produktiv beobachten, Drift-Vergleich per Endpoint
- **D) Cutover:** Feature-Flag auf DB-Reads umschalten, JSON weiter als Shadow-Backup, 1 Woche beobachten
- **E) Multi-Tenant aktivieren:** Email-Login, Tenant-Routing (Subdomain oder Pfad), Admin-UI für neue Mandanten
- **F) Landingpage + Billing:** Separater Schritt (Stripe-Integration, Self-Service-Signup)

In jeder Stufe ist Rollback möglich, bis Stufe D ist kein Daten-Verlustrisiko.

## 10. Offene Punkte zum Diskutieren

1. **Tenant-Routing:** Subdomain (`firma.app.domain`) oder Pfad (`app.domain/firma/`)? Subdomain cleaner, aber SSL-Wildcard-Zertifikat nötig. Pfad einfacher, weniger elegant.
2. **Verschlüsselung der Integrations-Secrets** (API-Keys zu Drittsystemen): Plain JSONB in Postgres vs. pgcrypto. Tendenz Plain erstmal, weil Server-Verschlüsselung ohnehin auf Container-Ebene möglich.
3. **Email-Provider für Einladungen:** Postfix lokal (wie bisher) vs. transactional Service (Postmark, Resend). Transactional kostet wenig, hat aber auch externe Abhängigkeit. Für den Anfang Postfix.
4. **Limits pro Mandant:** max. Objekte, max. User, max. History-Retention — für Tarifstaffelung. Entscheide nach Phase E wenn Billing-Model klarer wird.
5. **Platform-Admin-Rolle:** Separate User-Rolle "platform_admin" die tenant-übergreifend sieht (für Support, Debugging). Muss sauber von regulären Tenant-Admins getrennt werden.

---

## TL;DR

**Für einen deutschen SaaS in der Wachstumsphase mit bestehender Hetzner/Coolify-Infrastruktur ist die Antwort nicht Supabase, sondern Coolify-Postgres als Einstieg, Hetzner Managed als nächste Stufe.** TimescaleDB dazwischen wenn die Sensor-Daten explodieren. DSGVO-Argument als Verkaufsfeature nicht unterschätzen. Auth und MFA sind selbst gebaut trivial genug, um dafür keine Cloud-Abhängigkeit aufzubauen.

Die 1 Woche, die Supabase beim Auth sparen würde, wird durch die Abhängigkeit, Lock-in-Risiken, monatliche Kosten und die schwächere DSGVO-Story über das Jahr mehr als zurückgezahlt.
