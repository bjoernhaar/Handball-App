// Zeigt lokale Mitteilungen über registration.showNotification(). Wird nur
// genutzt, wenn KEIN Push-Abo besteht (sonst verschickt der Worker dieselben
// Mitteilungen - siehe sync.js). Texte und "tag" kommen aus
// src/shared/matchEvents.js und sind damit identisch zu den Push-Mitteilungen.

import { describeEvent } from "./shared/matchEvents.js";

/** @param {ServiceWorkerRegistration} registration */
export async function notifyEvent(registration, team, event) {
  if (!registration || !("Notification" in self) || Notification.permission !== "granted") return;
  const { title, body, tag } = describeEvent(event, team.id, team.displayName);
  await registration.showNotification(title, {
    tag,
    body,
    icon: "icons/icon192.png",
    badge: "icons/icon128.png",
    data: { teamId: team.id },
  });
}
