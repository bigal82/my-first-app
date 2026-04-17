/**
 * Route-Registry — wird nicht mehr aktiv genutzt da server.js die Routes
 * einzeln mit Rollen-Middleware registriert. Behalten fuer Abwaertskompatibilitaet
 * und als Uebersicht welche Routes existieren.
 */

function registerRoutes(app) {
  // Routes werden in server.js direkt mit sessionAuth.requireRole() registriert.
  // Diese Funktion ist ein No-op.
}

module.exports = registerRoutes;
