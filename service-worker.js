// Service Worker: macht die App installierbar, cached die App-Hülle fürs
// Offline-/Schnellstart-Verhalten, und übernimmt den periodischen
// Hintergrund-Sync + Benachrichtigungen (Pendant zu WorkManager+
// Notification-Channel der Android-Version bzw. chrome.alarms+
// chrome.notifications der Erweiterungs-Version).
//
// WICHTIGER HINWEIS zum Hintergrund-Sync: Die Periodic Background Sync API
// funktioniert nur in Chrome/Edge auf Android, nur für installierte
// (zum Startbildschirm hinzugefügte) PWAs, und nur wenn Chrome die Seite
// als "oft genutzt" einstuft (kein Wert, den die App selbst erzwingen
// kann - siehe README). Als zuverlässiger Fallback, der auf jeder
// Plattform funktioniert, synchronisiert app.js zusätzlich jedes Mal beim
// Öffnen der App, wenn der letzte Sync länger als 4 Stunden her ist.

import { runSync } from "./src/sync.js";

const CACHE_VERSION = "v1";
const CACHE_NAME = `handball-favoriten-${CACHE_VERSION}`;
const SYNC_TAG = "handball-sync";
// Hinweis: SYNC_TAG muss mit dem Tag übereinstimmen, das app.js beim
// Registrieren von periodicSync verwendet (siehe dort).

const APP_SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./src/sync.js",
  "./src/notifications.js",
  "./src/nuligaClient.js",
  "./src/teamNameUtils.js",
  "./src/calendar.js",
  "./src/data/models.js",
  "./src/data/repository.js",
  "./src/data/storage.js",
  "./src/parsers/htmlTextUtils.js",
  "./src/parsers/nuligaUrlParser.js",
  "./src/parsers/teamPortraitParser.js",
  "./src/parsers/groupTableParser.js",
  "./src/parsers/playerStatsParser.js",
  "./src/parsers/venueParser.js",
  "./icons/icon128.png",
  "./icons/icon192.png",
  "./icons/icon192-maskable.png",
  "./icons/icon512.png",
  "./icons/icon512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Cache-first für die App-Hülle (eigene Origin); alles andere (v.a. der
// CORS-Proxy zu nuLiga) geht direkt ans Netz - dynamische Spieldaten
// sollen nie veraltet aus dem Cache kommen.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
    )
  );
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(runGuardedSync());
  }
});

// Manche Browser unterstützen nur "sync" (einmaliger Nachhol-Sync bei
// Wiederherstellung der Internetverbindung), nicht "periodicsync" - wird
// mitgenommen, falls verfügbar, schadet aber nicht.
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(runGuardedSync());
  }
});

async function runGuardedSync() {
  try {
    await runSync(self.registration);
  } catch (err) {
    console.error("Hintergrund-Sync fehlgeschlagen:", err);
  }
}

// Tippen auf eine Benachrichtigung öffnet die App (fokussiert einen
// bestehenden Tab, falls vorhanden) und springt direkt zum betroffenen Team.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const teamId = event.notification.data && event.notification.data.teamId;
  const hash = teamId ? `#team/${encodeURIComponent(teamId)}` : "";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const target = allClients.find((c) => "focus" in c);
      if (target) {
        target.postMessage({ type: "navigate", hash });
        await target.focus();
      } else {
        await self.clients.openWindow(`./${hash}`);
      }
    })()
  );
});
