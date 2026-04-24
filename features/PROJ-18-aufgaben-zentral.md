# PROJ-18: Aufgaben — zentrale Task-Ansicht pro Wohnung

## Status: Planned
**Created:** 2026-04-24

## Dependencies
- Requires: PROJ-10 (Battery- und Status-Logik — liefert Warnungen)
- Requires: PROJ-12 (Reinigungsplan + Tasks pro Event)
- Requires: PROJ-15 (User/Cleaner Merge — fuer assignee-Zuweisungen)
- Requires: PROJ-17 (Multi-Tenant Postgres — neue Tabelle liegt dort)

## Vision
Ein zentraler Anlaufpunkt fuer **alles was fuer eine Wohnung zu tun ist** — aus drei Quellen in einer Ansicht:

1. **System** erkennt automatisch Probleme (Batterie niedrig, Sensor offline)
2. **Manager** (Admin/Property-Manager) traegt Todos manuell ein
3. **Cleaner** meldet beim Reinigungs-Abschluss Dinge die er sieht (Verbrauchsmaterial leer, Glühbirne defekt, Schaden)

Dazu kommen die bestehenden **Reinigungs-Checklisten-Items** virtuell integriert (der Cleaner sieht seine konkreten Aufgaben fuer heute mit Datum und Uhrzeit).

## Target Users
- **Property-Manager / Admin**: Tagesuebersicht ueber alle offenen Aufgaben pro Objekt, planbar fuer den naechsten Besuch
- **Cleaner**: zentrale Sicht "was hab ich heute zu tun und was soll ich neu melden"

## Non-Goals (nicht in diesem Spec)
- Push-Notifications (kommt ggf. spaeter)
- Foto-Upload zu Reports (waere nice aber nicht MVP)
- Task-Templates / Vorlagen
- Zeitbudget-Schaetzung pro Task

## Datenmodell

### Neue Tabelle: `tasks`
```sql
CREATE TABLE tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  apartment_id          UUID REFERENCES apartments(id) ON DELETE CASCADE,  -- NULL = plattformweit
  source                TEXT NOT NULL CHECK (source IN ('system', 'manager', 'cleaner')),
  source_ref            TEXT,                                               -- Dedup-Key: 'battery:<apt>:<device>', 'offline:<apt>:<device>'
  category              TEXT,                                               -- 'battery', 'offline', 'supply', 'maintenance', 'damage', 'general'
  title                 TEXT NOT NULL,
  description           TEXT,
  priority              TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  assignee_id           UUID REFERENCES users(id),                          -- optional
  due_date              DATE,
  created_by            UUID REFERENCES users(id),                          -- NULL = system
  created_from_event_id UUID REFERENCES cleaning_events(id),                -- bei Cleaner-Reports
  completed_at          TIMESTAMPTZ,
  completed_by          UUID REFERENCES users(id),
  resolution_note       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotenz fuer System-Tasks: pro Tenant + source_ref max. EIN offener Task
CREATE UNIQUE INDEX tasks_system_open_idx ON tasks(tenant_id, source_ref)
  WHERE source = 'system' AND status = 'open';

CREATE INDEX tasks_tenant_apt_status_idx ON tasks(tenant_id, apartment_id, status);
CREATE INDEX tasks_assignee_idx ON tasks(assignee_id, status);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tasks USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);
```

### Virtuelle Tasks (nicht persistiert)

Die Aufgaben-Ansicht ergaenzt die `tasks`-Rows um **virtuell generierte Items** aus den bestehenden Reinigungs-Checklisten:

```js
// Fuer jeden offenen cleaning_event mit tasks-Array:
for (const event of cleaningEvents) {
  for (const t of (event.data.tasks || [])) {
    yield {
      id: `virt-cleaning-${event.id}-${t.id}`,    // virtuell, nicht in DB
      source: 'cleaning-checklist',
      apartmentId: event.apartmentId,
      category: 'cleaning',
      title: t.text,
      assigneeId: event.assignedTo,               // Cleaner der Reinigung
      dueDate: event.checkoutDate,
      status: t.done ? 'done' : 'open',
      linkedEventId: event.id
    };
  }
}
```

Keine Duplikation, keine Sync-Arbeit. Die virtuellen Tasks sind **read-only** in der Aufgaben-UI — zum Abhaken geht man in den Reinigungsplan.

## UI / UX

### Neuer Menüpunkt: "Aufgaben"
Nach "Reinigung" im Hauptmenü.

### Hauptansicht

```
┌─────────────────────────────────────────────────────────┐
│  Aufgaben                                               │
│  [Filter: Alle ▼] [Priorität ▼] [Nur offene ✓]         │
├─────────────────────────────────────────────────────────┤
│  KPI-Zeile:                                             │
│  🔴 3 urgent · 🟡 12 offen · ✓ 47 erledigt (30T)       │
├─────────────────────────────────────────────────────────┤
│  Plattformweit (ohne Wohnungsbezug)                     │
│  ┌──────────────────────────────────────────────┐       │
│  │ 🔧 Gas-Check Termin vereinbaren  · 30.04.26 │       │
│  │ 🔑 Backup-Schlüsseldienst recherchieren     │       │
│  └──────────────────────────────────────────────┘       │
├─────────────────────────────────────────────────────────┤
│  Wohnungen [Kachel-Grid]                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│  │ B39        │  │ Black Forst│  │ G15        │         │
│  │ 🔴 2  🟡 1│  │ 🟡 1       │  │ ✓ alles OK │         │
│  │            │  │            │  │            │         │
│  │ ⚡ Minut-  │  │ 🛒 Glas-   │  │            │         │
│  │   Batterie │  │   reiniger │  │            │         │
│  │ 💡 Lampe   │  │            │  │            │         │
│  │   Bad      │  │            │  │            │         │
│  │            │  │            │  │            │         │
│  │ [Öffnen →] │  │ [Öffnen →] │  │ [Öffnen →] │         │
│  └────────────┘  └────────────┘  └────────────┘         │
└─────────────────────────────────────────────────────────┘
```

### Wohnungs-Detail (Klick auf Kachel)

```
┌─────────────────────────────────────────────────────┐
│  ← Zurück    B39 — Aufgaben        [+ Neue Aufgabe] │
├─────────────────────────────────────────────────────┤
│  🔴 2 urgent · 🟡 1 offen                          │
├─────────────────────────────────────────────────────┤
│  System (1)                                         │
│  ┌──────────────────────────────────────────────┐   │
│  │ ⚡ Batterie Minut-Sensor 23%                │   │
│  │    Erkannt: 23.04.26 · Kategorie: Batterie │   │
│  │    [Ignorieren] [Als erledigt]              │   │
│  └──────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  Cleaner-Reports (1)                                │
│  ┌──────────────────────────────────────────────┐   │
│  │ 💡 Lampe im Badezimmer defekt               │   │
│  │    Von: Maria  · 22.04.26 · nach Reinigung  │   │
│  │    Kategorie: Instandhaltung                │   │
│  │    Prio: [Normal ▼]                         │   │
│  │    Notiz beim Abschluss: "Schon gestern,   │   │
│  │     Gast hat sich beschwert"                │   │
│  │    [Bearbeiten] [Als erledigt]              │   │
│  └──────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  Reinigungs-Checklisten — heute/naechste 7 Tage    │
│  ┌──────────────────────────────────────────────┐   │
│  │ ☐ Bettwäsche wechseln    · 25.04.26 Maria   │   │
│  │ ☐ Müll rausbringen       · 25.04.26 Maria   │   │
│  │ ☑ Handtücher auffüllen   · 25.04.26 Maria   │   │
│  └──────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  Erledigt (30T)  [Ausklappen]                       │
└─────────────────────────────────────────────────────┘
```

### Cleaner-Flow: Report beim Reinigungs-Abschluss

Im bestehenden Cleaner-UI beim Klick auf **"Reinigung abschliessen"** kommt JETZT ein Modal:

```
┌────────────────────────────────────────┐
│  Reinigung als erledigt markieren?     │
│                                        │
│  ⚠ Hast du etwas gefunden was der     │
│    Property Manager wissen sollte?    │
│    (optional)                          │
│                                        │
│  [+ Notiz hinzufügen]                  │
│                                        │
│   ── wenn geklickt ──                  │
│                                        │
│  Kategorie:                            │
│  ○ Verbrauchsmaterial leer             │
│  ○ Defekt / Reparatur                  │
│  ● Sonstiges                           │
│                                        │
│  Text:                                 │
│  ┌──────────────────────────────────┐  │
│  │ Glasreiniger ist leer            │  │
│  └──────────────────────────────────┘  │
│                                        │
│  [+ weitere Notiz]                     │
│                                        │
│  [Abbrechen]  [Reinigung abschliessen] │
└────────────────────────────────────────┘
```

Jede Notiz wird ein Task mit `source='cleaner'`, `created_by=cleaner.userId`, `created_from_event_id=event.id`, `priority='normal'`. Wenn der Cleaner nichts hinzufügt, wird die Reinigung ganz normal abgeschlossen.

### Cleaner-Eigene-Sicht (Optional Phase 2)

In `/my` — der Cleaner-Seite — kann ein kleines Widget "Meine offenen Aufgaben" ergaenzt werden (nur Tasks mit `assignee_id = self` oder aus seinen zugewiesenen Wohnungen). Erstmal nur die Checklisten-Items wie bisher, Manager-Tasks kommen in Phase 2.

## Automatische System-Tasks

Neuer Service `services/systemTasks.js` mit Scheduler (alle 15 Minuten):

```js
async function syncSystemTasks() {
  const status = await globalStatus.computeForAllApartments();
  
  for (const apt of status.apartments) {
    // Batterie-Warnungen
    for (const warn of apt.batteryWarnings || []) {
      await upsertSystemTask({
        apartmentId: apt.id,
        sourceRef: `battery:${apt.id}:${warn.device}`,
        category: 'battery',
        title: `Batterie ${warn.deviceLabel}: ${warn.value}%`,
        priority: warn.value < 15 ? 'urgent' : 'high'
      });
    }
    
    // Offline-Warnungen
    for (const off of apt.offlineDevices || []) {
      await upsertSystemTask({
        apartmentId: apt.id,
        sourceRef: `offline:${apt.id}:${off.device}`,
        category: 'offline',
        title: `${off.deviceLabel} offline seit ${off.since}`,
        priority: 'high'
      });
    }
  }
  
  // Auto-close: System-Tasks deren Bedingung nicht mehr erfuellt ist
  await autoCloseResolvedSystemTasks();
}
```

**Auto-Close-Logik**: Tasks mit `source='system'` und `status='open'` werden auf `done` gesetzt + `resolution_note='automatisch behoben'` wenn die zugehoerige Condition im aktuellen Status nicht mehr vorhanden ist.

## Email-Benachrichtigung (Optional Phase 4)

Pro Tenant konfigurierbar in Setup → Integrations:

- **Sofort**: Bei `source='cleaner'` neu → E-Mail an Admins mit "Name hat Notiz zu Wohnung X hinzugefuegt: …"
- **Taeglich** (mit Morgen-Report): Zusammenfassung aller offenen Tasks > 7 Tage

## API-Endpoints

### Admin-seitig
```
GET    /api/tasks                         # alle Tasks (optional: status, apartment, category, priority, source)
GET    /api/tasks/:id                     # einzeln
POST   /api/tasks                         # neue Manager-Task anlegen
PATCH  /api/tasks/:id                     # Prio, Assignee, due_date, Status etc. aendern
POST   /api/tasks/:id/complete            # als erledigt markieren (+ resolution_note)
POST   /api/tasks/:id/dismiss             # ignorieren (v.a. fuer System-Tasks)
DELETE /api/tasks/:id                     # nur fuer Manager-Tasks
```

### Cleaner-seitig
```
POST   /api/tasks/cleaner-report          # Body: { eventId, category, text, priority? }
GET    /api/tasks/for-me                  # offene Tasks die ich erledigen soll
```

### Aggregiert
```
GET    /api/tasks/summary                 # Kachel-Daten: pro Wohnung Count + Top-3
```

## Acceptance Criteria

### Phase 1 — Basis (MVP)
- [ ] Schema-Migration V5 legt `tasks`-Tabelle + Indizes + Policy an
- [ ] Neuer Menüpunkt "Aufgaben" erscheint nach "Reinigung"
- [ ] Hauptansicht zeigt KPI-Zeile + plattformweite Tasks + Wohnungs-Kacheln
- [ ] Wohnungs-Detail zeigt Tasks getrennt nach Quelle (System / Manager / Cleaner-Report / Checkliste)
- [ ] Admin kann Manager-Task via "+ Neue Aufgabe" anlegen (mit Titel, Kategorie, Prio, Due-Date, Wohnung)
- [ ] Admin kann Task abhaken + Notiz hinzufuegen
- [ ] Admin kann Task bearbeiten (Prio, Assignee, Due-Date)
- [ ] Admin kann System-Task dismissen (falls Falscheralarm)

### Phase 2 — Cleaner-Reports
- [ ] Modal beim Reinigungs-Abschluss mit Optional-Notiz-Feld
- [ ] Mehrfach-Notizen pro Reinigung moeglich
- [ ] Notizen erscheinen automatisch als `source='cleaner'` Tasks mit Link zur Reinigung
- [ ] Cleaner-User sieht die Notiz-Option NUR wenn er Reinigungen abschliesst
- [ ] Reinigungs-Checklisten-Items erscheinen virtuell im Aufgaben-Tab, sortiert nach Due-Date

### Phase 3 — System-Tasks
- [ ] Scheduler (15 min Intervall) synchronisiert Batterie + Offline-Warnungen als Tasks
- [ ] Idempotenz: pro `source_ref` max. ein offener Task
- [ ] Auto-Close wenn Bedingung nicht mehr erfuellt (mit `resolution_note`)
- [ ] Historie bleibt sichtbar (Option A, user confirmed)

### Phase 4 — E-Mail (optional)
- [ ] Sofortige E-Mail an Admin bei neuem Cleaner-Report
- [ ] Taegliche Zusammenfassung in Morgen-Report integriert

## Edge Cases

- **Multi-User-Zuweisung**: Aktuell nur ein assignee_id. Mehrere Personen → Broadcast-Task (assignee=null), jeder Admin sieht's.
- **Delete-Verhalten**: Manager-Task kann hart geloescht werden. System-Tasks NICHT loeschbar — nur dismiss. Cleaner-Reports nur von Admin schliessbar, nicht loeschbar (Audit-Trail).
- **Apartment wird geloescht**: `ON DELETE CASCADE` — alle Tasks zur Wohnung verschwinden mit.
- **Cleaning-Event wird gecancelled**: Offene virtuelle Checklisten-Items verschwinden (sind eh nur virtuell). Cleaner-Reports bleiben (source='cleaner', nur der Link zum Event wird gekappt via SET NULL wenn das Event hart weg ist).
- **System-Task wird vom Admin manuell geschlossen, Bedingung besteht aber weiter**: naechster Scheduler-Lauf öffnet einen NEUEN Task (neuer source_ref oder created_at-Unterschied). Akzeptabel.
- **Cleaner ohne User-Account**: Legacy-Cleaner ohne User-Zugang können keine Reports erstellen (weil kein Login). Nach Multi-Tenant-Stufe-E relevant; aktuell alle Cleaners haben User-Accounts via PROJ-15.

## Risiken & Mitigationen

| Risiko | Mitigation |
|---|---|
| Tasks-Flut durch ständige System-Warnungen | Debouncing: 15-min Scheduler upsertet idempotent pro `source_ref`. Keine neuen Tasks wenn Condition unveraendert. |
| Cleaner vergisst Notiz zu setzen und bemerkt's nach Abschluss | Nachtragen moeglich: Cleaner-UI zeigt "Letzte Reinigung: [x]. Notiz nachtragen?" fuer 24h nach Abschluss. (Phase 2.5) |
| Admin wird von Cleaner-Reports überflutet | Kategorien + Prio-Filter in UI. E-Mail nur bei `priority >= 'high'` oder taeglicher Digest. |
| Historie bläht DB auf | Tasks 30+ Tage alt im status=done koennen archiviert werden (separate Tabelle). Erst wenn >100k rows, nicht jetzt. |

## Implementierungsreihenfolge

1. **Commit 1** — Schema-Migration V5 (tasks-Tabelle, Indizes, Policy)
2. **Commit 2** — Backend: `services/tasksRepo.js`, Routes `/api/tasks/*` fuer Basis-CRUD
3. **Commit 3** — Frontend: neue Seite `tasks.html` + `public/js/tasks.js`, Menüpunkt + Kachel-Ansicht
4. **Commit 4** — Wohnungs-Detail + Manager-Task-Anlegen-Modal
5. **Commit 5** — Cleaner-Report-Modal beim Reinigungs-Abschluss
6. **Commit 6** — Virtuelle Checklisten-Items in Aufgaben-API einspeisen
7. **Commit 7** — System-Task-Scheduler + Auto-Close
8. **Commit 8** — Email-Benachrichtigung (optional, separat)

Jeder Commit einzeln testbar + deploybar. Feature-Flag nicht zwingend notwendig weil neuer Menüpunkt ohne Impact auf Bestandsfunktionen.
