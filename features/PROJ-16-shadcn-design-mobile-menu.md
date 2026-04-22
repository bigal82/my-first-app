# PROJ-16: shadcn/ui Design + Mobile Hamburger Menu

## Status: Deployed
**Created:** 2026-04-18
**Retro-Spec:** 2026-04-22

## Purpose
Upgrade des UI-Looks zu shadcn/ui-inspiriertem Design (CSS-Variablen-Palette, gemeinsame Card/Button/Badge-Klassen). Mobile-first-Navigation: Hamburger-Menü statt horizontaler Nav-Leiste, mit Slide-in-Overlay wie moderne Webseiten (Inspiration: stablr.nailforge.io).

## Key Acceptance Criteria
- Dark-Theme mit konsistenten CSS-Variablen: `--color-accent`, `--color-success`, `--color-warning`, `--color-danger`, `--color-surface`, `--color-surface-2`, `--color-border`, `--color-text`, `--color-text-muted`, `--radius-sm`
- Komponenten: `.card`, `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--sm`, `.badge`, `.badge--free`, `.badge--offline`, `.integration-card`, `.kpi-card`, `.field`, `.field-row`
- Mobile (<768px): Hamburger-Icon oben, tippt Slide-in von links mit abgedunkeltem Overlay
- Desktop (>=768px): Horizontale Nav wie bisher

## Technical Notes
- CSS: [app/public/css/main.css](../app/public/css/main.css) — alle Variablen und Komponenten-Klassen
- Header-Markup identisch über alle Seiten (HTML-Duplikation akzeptiert, kein Template-System)
- Hamburger-Logik: [app/public/js/theme.js](../app/public/js/theme.js) (oder inline je HTML-Seite)
- Theme-Toggle (Dark/Light) via `theme.js`, persistiert in localStorage

## Edge Cases
- iOS Safari: 100vh bug beim Overlay → verwende `height: 100%` + `position: fixed`
- Menü offen beim Resize zu Desktop → automatisch schließen
- Back-Button während Overlay offen → Overlay schließt (pushState-Pattern)
- Touch-Geräte: Tap auf Overlay schließt Menü
