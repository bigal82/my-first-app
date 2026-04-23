# PROJ-17: Multi-Tenant SaaS-Umbau

## Status: Planned
**Created:** 2026-04-23
**Last Updated:** 2026-04-23

## Dependencies
- Requires: PROJ-1 bis PROJ-16 (alle Kern-Features müssen stabil laufen, da der Umbau unter ihnen durchgezogen wird)
- Requires: Phase-1 Backup (PROJ-17.1 siehe unten — bereits deployed am 2026-04-23)

## Vision
Der FaecherLofts Manager wird zum multi-mandantenfähigen SaaS. Mehrere unabhängige Betreiber von Ferienwohnungen (Tenants) nutzen dieselbe Instanz, haben aber vollständig isolierte Daten. Das bestehende FaecherLofts wird zum ersten produktiven Tenant.

Ziel: Die Plattform so vorbereiten, dass neue Mandanten per Self-Service oder Admin-Onboarding angelegt werden können, ohne dass der bestehende Tenant im laufenden Betrieb gestört wird.

## Target Users
- **Bestandskunde (Alex / FaecherLofts)**: läuft wie bisher weiter, produktiv mit echten Gästen. Umbau darf den Betrieb nicht unterbrechen.
- **Neue Tenants** (Zielgruppe: deutschsprachige SMB-Betreiber mit 3-30 Objekten): können nach Freischalt-Link ihren eigenen Mandanten einrichten.

## Non-Goals (in diesem Spec NICHT enthalten)
- Billing / Stripe-Integration — kommt in PROJ-18
- Self-Service-Signup ohne manuelle Freischaltung — kommt in PROJ-18
- Cross-Tenant-Analytics für Plattform-Admin — später
- Mobile Native Apps — Web bleibt
- Föderation / Agentur-User mit mehreren Tenants gleichzeitig — Schema ist vorbereitet, UI kommt später

## Architektur-Entscheidungen

### Tenancy-Modell: Shared DB + `tenant_id` + Row-Level Security
Alle tenant-spezifischen Tabellen bekommen eine Spalte `tenant_id UUID NOT NULL`. Postgres-RLS filtert jede Query automatisch nach `current_setting('app.tenant_id')`.

**Warum:** Standard-Pattern (Supabase, Stripe intern), Postgres enforced die Isolation auch bei Backend-Bugs, einfachere Migrationen als Schema-per-Tenant.

**Nicht gewählt:**
- Schema-per-Tenant → DB-Migrationen pro Tenant wären aufwendig
- DB-per-Tenant → Overkill für Zielgruppe, Container-Overhead

### Datenbank: Coolify-Postgres, keine externe Cloud
- Postgres 16 als Coolify-Service im selben Projekt
- Internes Docker-Netz, kein öffentlicher Port
- Coolify-Backups täglich, zusätzlich wöchentlich nach externem Storage

**Warum nicht Supabase hosted:** DSGVO-Argument (Gästedaten bleiben in Deutschland), keine externe Abhängigkeit, Kosten ~0, Verkaufsargument auf der Landingpage.

### Sensor-Historien bleiben JSONL
`tado-history.jsonl` und `minut-history.jsonl` bleiben als Dateien pro Tenant-Verzeichnis. Append-only Zeitreihen sind in normalen SQL-Tabellen ineffizient, TimescaleDB ist für die Daten-Menge Overkill. Struktur: `CONFIG_DIR/tenants/<tenant-slug>/*.jsonl`.

### Domain-Strategie
**Kurzfristig:** `manager.fächerlofts.de` läuft weiter und wird zum Tenant-Zugang für Tenant `faecherlofts`. Der Host-Header bestimmt den Tenant.

**Nach Domain-Kauf:**
- `app.<neue-domain>.de/login` → generischer Login
- Nach Login → Subdomain-Redirect auf `<tenant-slug>.<neue-domain>.de`
- Oder: Pfad-basiert `app.<neue-domain>.de/<tenant-slug>/...`

Entscheidung zwischen Subdomain und Pfad kommt mit Stufe E.

## Datenmodell (Kern-Tabellen)

```sql
-- Mandanten
CREATE TABLE tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE NOT NULL,              -- 'faecherlofts', URL-safe
  name         TEXT NOT NULL,                     -- 'FaecherLofts'
  plan         TEXT DEFAULT 'trial',              -- 'trial'|'basic'|'pro'
  timezone     TEXT DEFAULT 'Europe/Berlin',
  created_at   TIMESTAMPTZ DEFAULT now(),
  deleted_at   TIMESTAMPTZ                         -- Soft-Delete
);

-- Users (email-basiert, können zu mehreren Tenants gehören)
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Rolle pro (Tenant, User)
CREATE TABLE tenant_members (
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,                    -- 'owner'|'admin'|'cleaner'
  phone         TEXT,
  monthly_hours NUMERIC(6,2) DEFAULT 0,
  hourly_rate   NUMERIC(6,2) DEFAULT 15,
  cal_token     TEXT,                             -- iCal-Subscription
  notify_on_assignment BOOLEAN DEFAULT true,
  PRIMARY KEY (tenant_id, user_id)
);

-- Apartments
CREATE TABLE apartments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,                      -- 'b39'
  name        TEXT NOT NULL,
  location    TEXT,
  visible     BOOLEAN DEFAULT true,
  order_idx   INTEGER DEFAULT 0,
  config      JSONB NOT NULL,                     -- occupancy, integrations, cityTax, automation
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX apartments_tenant ON apartments(tenant_id);

-- Reinigungs-Events
CREATE TABLE cleaning_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  apartment_id   UUID NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  checkout_date  DATE NOT NULL,
  state          TEXT NOT NULL,                   -- 'open'|'assigned'|'done'|'cancelled'
  assigned_to    UUID REFERENCES users(id),
  data           JSONB NOT NULL,                  -- guest, tasks, nextGuest, persons, mailState
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, apartment_id, checkout_date)
);
CREATE INDEX cleaning_events_tenant_date ON cleaning_events(tenant_id, checkout_date);

-- Zeiterfassung
CREATE TABLE time_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cleaner_id    UUID NOT NULL REFERENCES users(id),
  date          DATE NOT NULL,
  clock_in      TIMESTAMPTZ,
  clock_out     TIMESTAMPTZ,
  status        TEXT NOT NULL,                    -- 'completed'|'active'|'paused'|'pending'|'rejected'
  total_minutes INTEGER DEFAULT 0,
  segments      JSONB,                            -- [{apartment_id, start, end, minutes}]
  breaks        JSONB,
  note          TEXT,
  submitted_at  TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ
);
CREATE INDEX time_entries_tenant_cleaner_date ON time_entries(tenant_id, cleaner_id, date);

-- Audit-Log fuer time_entries
CREATE TABLE time_entries_audit (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_id    UUID,
  actor_id    UUID,
  action      TEXT NOT NULL,                      -- 'create'|'update'|'delete'|'approve'|'reject'
  timestamp   TIMESTAMPTZ DEFAULT now(),
  details     JSONB
);

-- Abwesenheiten
CREATE TABLE absences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cleaner_id  UUID NOT NULL REFERENCES users(id),
  from_date   DATE NOT NULL,
  to_date     DATE NOT NULL,
  type        TEXT NOT NULL,                      -- 'vacation'|'unavailable'|'sick'
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Smoobu-Buchungs-Cache
CREATE TABLE bookings (
  id                TEXT PRIMARY KEY,             -- 'smoobu-12345'
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  apartment_id      UUID REFERENCES apartments(id),
  smoobu_apt_id     INTEGER,                      -- Fuer Lookup aus Smoobu-Response
  raw_id            INTEGER,
  guest             TEXT,
  arrival           DATE,
  departure         DATE,
  nights            INTEGER,
  price             NUMERIC(10,2),
  commission        NUMERIC(10,2),
  channel           TEXT,
  adults            INTEGER DEFAULT 0,
  children          INTEGER DEFAULT 0,
  is_blocked        BOOLEAN DEFAULT false,
  is_cancelled      BOOLEAN DEFAULT false,
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX bookings_tenant_arrival ON bookings(tenant_id, arrival);

-- Aktions-Log
CREATE TABLE action_log (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  timestamp       TIMESTAMPTZ DEFAULT now(),
  source          TEXT NOT NULL,                  -- 'automation'|'manual'
  apartment_id    UUID REFERENCES apartments(id),
  action          TEXT NOT NULL,
  action_label    TEXT,
  result          TEXT,
  message         TEXT,
  event_title     TEXT,
  actor_id        UUID REFERENCES users(id)
);
CREATE INDEX action_log_tenant_ts ON action_log(tenant_id, timestamp DESC);

-- Row-Level Security auf ALLEN tenant-Tabellen
ALTER TABLE apartments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members   ENABLE ROW LEVEL SECURITY;

-- Template-Policy
CREATE POLICY tenant_isolation ON apartments
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
-- Analog auf allen anderen Tabellen
```

### Token-Storage
Tado-OAuth-Tokens liegen pro Apartment — bleiben in `apartments.config->>'tadoTokens'` oder eigener `apartment_secrets`-Tabelle mit Verschlüsselung (später entscheiden). **Jetzt:** JSONB-Spalte, später evtl. Vault.

### Dateien pro Tenant
```
/data/faecherlofts-config/
  database-url-is-canonical/       # Postgres ist single source of truth fuer alle tenant-Daten
  tenants/
    faecherlofts/
      tado-history.jsonl           # Sensor-Langzeit
      minut-history.jsonl
      karlsruhe-citytax-form.pdf   # Falls Tenant-spezifische Templates
    <neuer-tenant>/
      ...
```

## Migrations-Strategie (6 Stufen, jederzeit Rollback)

### Stufe A — Vorbereitung (ohne Risiko)
- [x] **A1** Backup umfasst jetzt ALLE Daten (deployed 2026-04-23, siehe PROJ-17.1)
- [ ] **A2** Coolify-Postgres-Service anlegen, `DATABASE_URL` setzen
- [ ] **A3** `pg-node` oder `postgres.js` als Client installieren
- [ ] **A4** Schema-Migrations-Tool auswählen (empfohlen: `node-pg-migrate` — einfach, CLI, SQL-first)
- [ ] **A5** Schema-Migration V1 schreiben (alle obigen Tabellen + RLS-Policies)
- [ ] **A6** DB-Client-Wrapper `services/db.js` — akzeptiert `setTenant(id)` pro Request, stellt RLS-Context

### Stufe B — Initial-Daten-Migration (aus JSON)
- [ ] **B1** Migrations-Script `scripts/migrate-json-to-db.js`
- [ ] **B2** Legt Tenant `faecherlofts` an (slug, name, timezone)
- [ ] **B3** Liest `users.json` → insert in `users` + `tenant_members`
- [ ] **B4** Liest `apartments.json` → `apartments` (slug=alte ID, config=ganzes apt-Objekt)
- [ ] **B5** Liest `cleaning-events.json` → `cleaning_events`
- [ ] **B6** Liest `timetracking.json` + `timetracking-audit.json` → `time_entries` + `time_entries_audit`
- [ ] **B7** Liest `absences.json` → `absences`
- [ ] **B8** Liest `revenue-cache.json` → `bookings`
- [ ] **B9** Liest `automation-log.json` → `action_log`
- [ ] **B10** Admin-Endpoint `POST /api/admin/migrate-to-db` (idempotent — DELETE + INSERT, basierend auf Tenant-Slug)

### Stufe C — Dual-Write (produktives Schattentraining)
- [ ] **C1** Alle Writes: zusätzlich in Postgres schreiben (JSON bleibt Primärquelle)
- [ ] **C2** Feature-Flag `DB_DUAL_WRITE=true` in ENV
- [ ] **C3** Vergleichs-Endpoint `GET /api/admin/db-drift` zeigt Differenzen zwischen JSON und DB
- [ ] **C4** Produktiv laufen lassen, 1-2 Wochen beobachten

### Stufe D — Cutover (Reads aus DB)
- [ ] **D1** Feature-Flag `DB_READS=true` — Reads kommen aus Postgres
- [ ] **D2** JSON-Writes bleiben aktiv als Shadow-Backup (Stufe C-Modus umgekehrt)
- [ ] **D3** 1 Woche produktiv beobachten
- [ ] **D4** JSON-Writes deaktivieren (`DB_DUAL_WRITE=false`)
- [ ] **D5** JSON-Files werden zu `/snapshot-vor-cutover/` verschoben (nicht gelöscht!)

### Stufe E — Multi-Tenant aktivieren
- [ ] **E1** Login-Flow: Email statt Username, Password-Hash in `users`
- [ ] **E2** Session erhält `{userId, tenantId, role}`
- [ ] **E3** Middleware setzt `SET LOCAL app.tenant_id = ...` pro Request
- [ ] **E4** Tenant-Routing entscheiden (Subdomain vs. Pfad) und bauen
- [ ] **E5** Admin-UI für Tenant-CRUD (eigene Admin-Rolle, nicht in Tenant enthalten)
- [ ] **E6** Onboarding-Flow: neuer Tenant via Admin-Button → E-Mail-Einladung an Owner

### Stufe F — Landingpage + SaaS-Marketing (separate Spec)
- PROJ-18 deckt Billing, öffentliche Signup-Seite, Pricing-Page ab

## User Stories

### Für Alex (bestehender Tenant)
- Während des gesamten Umbaus bleibt die Anwendung nutzbar
- Keine Daten gehen verloren — Backup vor jeder Stufe
- Bei Problem in Stufe C/D: Feature-Flag zurück, alles läuft wie bisher
- Nach Cutover identisches Feature-Set, aber mandantenfähig unter der Haube

### Für neue Tenants (nach E)
- Owner bekommt Einladung per E-Mail mit Link
- Klickt → Password setzen → erstmaliger Login
- Leere Instanz: keine Wohnungen, keine Integrationen, Setup-Wizard führt durch die Erstkonfiguration

## Acceptance Criteria

### Stufe A
- [ ] Postgres läuft in Coolify, `psql $DATABASE_URL` funktioniert aus dem Manager-Container
- [ ] `npm run migrate` wendet Schema-V1 idempotent an
- [ ] Leere DB hat alle Tabellen mit RLS-Policies aktiv
- [ ] `db.js` wrapper testet Connection beim Server-Start, logt Version + aktiven Schema-Stand

### Stufe B
- [ ] Migrations-Script läuft auf lokalem JSON-Snapshot fehlerfrei durch
- [ ] Nach Lauf: Tenant `faecherlofts` hat alle Wohnungen, Users, Zeiten, Reinigungen, Bookings
- [ ] Anzahl Rows pro Tabelle matcht Anzahl Einträge in JSON-Files (Zähler-Report)
- [ ] Admin-Endpoint produktiv verfügbar, Rollback durch Re-Import aus JSON-Backup möglich

### Stufe C
- [ ] Alle produktiven Writes erzeugen synchron DB-Rows
- [ ] `/api/admin/db-drift` zeigt 0 Unterschiede nach 24h Betrieb
- [ ] Feature-Flag-Toggle in <30s wirksam (Env-Var + Neustart)

### Stufe D
- [ ] Alle API-Endpoints lesen aus DB
- [ ] Performance: P95 nicht schlechter als vor Cutover
- [ ] JSON-Schreiben weiterhin aktiv, 1 Woche produktiv beobachtet ohne Drift

### Stufe E
- [ ] Login mit Email funktioniert
- [ ] Tenant-Kontext wird korrekt gesetzt — bei künstlichem `SELECT * FROM apartments` im fremden Tenant kommt 0 Zeilen zurück
- [ ] Neuer Tenant kann angelegt werden, Owner kann sich einloggen, sieht leere Instanz

## Edge Cases

- **Tenant wird gelöscht**: Soft-Delete (deleted_at) + Daten-Export-Zeitraum (30 Tage) bevor CASCADE greift
- **User in mehreren Tenants**: Login listet Tenants auf, Auswahl beim Login-Screen
- **Smoobu-Apartments-Überschneidung**: Zwei Tenants haben beide Smoobu-Integration mit verschiedenen Keys — Check auf Request-Ebene, nicht DB
- **Zeitzone-Konflikte**: Tenant-Timezone gilt für ALLE Outputs dieses Tenants (PDFs, Mails, Dashboard-Zeiten). Docker bleibt UTC.
- **Tado-Token-Refresh** während Tenant-Switch: Refresh läuft im Hintergrund ohne Tenant-Context — braucht explizite `setTenant()` oder per-Apartment-Scope
- **Große Sensor-Historien**: Bei Skalierung über 10 Tenants mit je 5 Devices × 5 min = ~5 MB/Tenant/Jahr. Ab 50 Tenants = 250 MB/Jahr JSONL — in JSONL OK, in Postgres dann Hypertable via TimescaleDB erwägen

## Risiken & Mitigationen

| Risiko | Mitigation |
|---|---|
| Cutover-Bug legt Produktion lahm | Feature-Flag für Reads/Writes, jederzeit Rollback auf JSON |
| Migrations-Script hat Datenverlust | Idempotent + Dry-Run-Modus + JSON-Backup vor Start |
| RLS-Policy vergessen auf neuer Tabelle | Test-Suite prüft: cross-tenant query muss 0 Rows zurückgeben |
| Tenant-Slug-Kollision (URL) | UNIQUE-Constraint, Validierung bei Tenant-Create (nur `[a-z0-9-]`) |
| Secrets-Exposure (Tado-Token) über cross-tenant | RLS + Tokens über dedizierten Service laden, nie direkt in Response |
| Backup-Disaster: Coolify-Server offline | Externe Backup-Kopie (Hetzner Storage Box, S3) — separate Aufgabe |

## Tech Design Details (wird in Stufe A finalisiert)

### DB-Client
- **Library:** `postgres` (Porsager) — modern, async, typsicher, tree-shakable
- **Pool:** 10 Connections für Manager-Container, 1 dedicated für Scheduler
- **Query-Wrapper:** jede Request-Middleware setzt `SET LOCAL app.tenant_id = $1` bevor User-Land-Queries laufen

### Migrations
- **Library:** `node-pg-migrate` — simpel, CLI, SQL-first
- **Dateien:** `migrations/0001-initial-schema.sql`, `0002-...`
- **Deploy:** `npm run migrate` läuft im Dockerfile-Entrypoint vor Server-Start

### Test-Strategie
- Unit-Tests mit Testcontainers (eigener Postgres-Container pro Suite)
- Integration-Tests: jede Route auf cross-tenant Isolation prüfen
- Migration-Tests: auf Kopie der Production-JSON-Daten

## Offene Punkte (bei Stufe-A-Start entscheiden)

- [ ] Tenant-Routing: Subdomain (`faecherlofts.app.example.de`) oder Pfad (`app.example.de/faecherlofts/`)
- [ ] Email-Provider für Einladungen: Postfix lokal (wie bisher) vs. Transactional Service (Postmark/Resend)
- [ ] Verschlüsselung der Integrations-Secrets (Tado, Minut, Nuki, Smoobu API-Keys) — plain JSONB vs. pgcrypto
- [ ] Limit pro Tenant (max Wohnungen, max Users, max History-Retention) — für Tarif-Staffelung
