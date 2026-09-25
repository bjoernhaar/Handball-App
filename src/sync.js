// Gemeinsame Sync-Logik, aufrufbar sowohl vom Hauptfenster (app.js, beim
// Öffnen der App) als auch vom Service Worker (periodischer
// Hintergrund-Sync) - beide übergeben ihre ServiceWorkerRegistration, damit
// Benachrichtigungen unabhängig vom Aufrufer funktionieren.

import { refreshAllFavorites } from "./data/repository.js";
import { notifyResult, notifyUpcoming } from "./notifications.js";

/** @param {ServiceWorkerRegistration} registration */
export async function runSync(registration) {
  const outcomes = await refreshAllFavorites();
  for (const outcome of outcomes) {
    for (const match of outcome.newlyFinishedMatches) {
      await notifyResult(registration, outcome.team, match);
    }
    for (const match of outcome.soonStartingMatches) {
      await notifyUpcoming(registration, outcome.team, match);
    }
  }
  return outcomes;
}
