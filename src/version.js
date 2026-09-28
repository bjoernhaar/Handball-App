// Versionsnummer der App - die EINZIGE Stelle, an der sie gepflegt wird.
// Wird in der Übersicht angezeigt und vom Worker (worker/src/index.js)
// mitgeliefert. Bei jeder Änderung:
//   1. hier erhöhen (z.B. "1.1"),
//   2. CACHE_VERSION in service-worker.js auf denselben Wert setzen
//      (Test worker/test/version.test.mjs prüft das),
//   3. Eintrag in CHANGELOG.md ergänzen.
export const APP_VERSION = "1.0";
