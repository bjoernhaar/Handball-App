// Zeigt lokale Benachrichtigungen über registration.showNotification()
// (statt chrome.notifications.create). Nimmt die ServiceWorkerRegistration
// als Parameter entgegen, damit dieselbe Funktion sowohl aus dem
// Hauptfenster (nach einem Sync beim Öffnen der App) als auch direkt aus
// dem Service Worker (periodischer Hintergrund-Sync) aufgerufen werden
// kann - beide teilen sich dieselbe Registration. Pendant zu
// Notifications.kt / chrome.notifications der anderen Varianten.
//
// Trennzeichen zwischen den Teilen des "tag" ist bewusst "::" (nicht ":"),
// weil team.id selbst schon einzelne Doppelpunkte enthält (Format
// "host:teamtable:championship:group").

function matchTitle(match) {
  return `${match.homeTeam} - ${match.awayTeam}`;
}

/** @param {ServiceWorkerRegistration} registration */
export async function notifyResult(registration, team, match) {
  if (!registration || Notification.permission !== "granted") return;
  const tag = `result::${team.id}::${match.matchNumber}`;
  await registration.showNotification(`Neues Ergebnis: ${team.displayName}`, {
    tag,
    body: `${matchTitle(match)}  ${match.homeScore}:${match.awayScore}`,
    icon: "icons/icon192.png",
    badge: "icons/icon128.png",
    data: { teamId: team.id },
  });
}

/** @param {ServiceWorkerRegistration} registration */
export async function notifyUpcoming(registration, team, match) {
  if (!registration || Notification.permission !== "granted") return;
  const tag = `upcoming::${team.id}::${match.matchNumber}`;
  const when = match.time ? `um ${match.time} Uhr` : "in Kürze";
  await registration.showNotification(`Bald: ${team.displayName}`, {
    tag,
    body: `${matchTitle(match)} beginnt ${when}${match.venueName ? " in " + match.venueName : ""}.`,
    icon: "icons/icon192.png",
    badge: "icons/icon128.png",
    data: { teamId: team.id },
  });
}
