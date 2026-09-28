// Abgleich aller Favoriten beim Öffnen der App.
//
// Besteht ein Push-Abo, erkennt der Worker Änderungen ohnehin im Hintergrund
// und verschickt die Mitteilungen - dann hier keine zweite, lokale Mitteilung.
// Ohne Push-Abo (z.B. Browser ohne Push-Unterstützung) meldet die App
// Änderungen wenigstens beim Öffnen selbst.

import { refreshAllFavorites } from "./data/repository.js";
import { notifyEvent } from "./notifications.js";

/** @param {ServiceWorkerRegistration|null} registration */
export async function runSync(registration) {
  const outcomes = await refreshAllFavorites();
  const pushActive =
    registration && registration.pushManager && (await registration.pushManager.getSubscription().catch(() => null));
  if (!pushActive) {
    for (const outcome of outcomes) {
      for (const event of outcome.events) {
        await notifyEvent(registration, outcome.team, event);
      }
    }
  }
  return outcomes;
}
