// Service Worker: macht die App installierbar, hält die App-Hülle für den
// Offline-/Schnellstart vor und zeigt die Push-Mitteilungen des eigenen
// Cloudflare Workers an (Spielplanänderungen, neue/entfallene Spiele,
// Ergebnisse, Erinnerung vor Anpfiff - siehe worker/src/index.js).
//
// Den Abgleich mit nuLiga im Hintergrund übernimmt der Worker auf dem Server.
// Das ist zuverlässiger als "Periodic Background Sync" im Browser, das
// Chrome nur nach eigenem Ermessen und selten auslöst.

const CACHE_VERSION = "v4";
const CACHE_NAME = `handball-favoriten-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./src/config.js",
  "./src/push.js",
  "./src/sync.js",
  "./src/notifications.js",
  "./src/nuligaClient.js",
  "./src/teamNameUtils.js",
  "./src/calendar.js",
  "./src/shared/matchEvents.js",
  "./src/data/models.js",
  "./src/data/repository.js",
  "./src/data/storage.js",
  "./src/parsers/htmlTextUtils.js",
  "./src/parsers/nuligaUrlParser.js",
  "./src/parsers/teamPortraitParser.js",
  "./src/parsers/groupTableParser.js",
  "./src/parsers/playerStatsParser.js",
  "./src/parsers/teamStatsParser.js",
  "./src/parsers/clubParsers.js",
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

// Netzwerk zuerst (damit neue Versionen von GitHub Pages sofort ankommen),
// bei fehlender Verbindung die App-Hülle aus dem Cache. Anfragen an den
// Worker (Spieldaten) gehen immer direkt ans Netz.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || caches.match("./index.html"))
      )
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Handball Favoriten", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Handball Favoriten", {
      body: data.body || "",
      tag: data.tag,
      icon: "icons/icon192.png",
      badge: "icons/icon128.png",
      data: { teamId: data.teamId || null },
    })
  );
});

// Tippen auf eine Mitteilung öffnet die App (fokussiert ein offenes Fenster,
// falls vorhanden) und springt direkt zum betroffenen Team.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const teamId = event.notification.data && event.notification.data.teamId;
  const hash = teamId ? `#team/${encodeURIComponent(teamId)}` : "";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const target = allClients.find((c) => "focus" in c);
      if (target) {
        target.postMessage({ type: "navigate", hash, refresh: true });
        await target.focus();
      } else {
        await self.clients.openWindow(`./${hash}`);
      }
    })()
  );
});
