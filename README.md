# Handball Favoriten (PWA)

Installierbare Web-App für Lieblingsmannschaften aus dem **Handballverband Niedersachsen-Bremen**
(Datenbasis: [hvnb-handball.liga.nu](https://hvnb-handball.liga.nu/)). Läuft über GitHub Pages in
Chrome auf Android und lässt sich dort als App installieren. Frei nutzbar für beliebig viele Nutzer,
**ohne Werbung, ohne Tracker, ohne Konto**.

- **Mannschaftssuche**: Verein suchen → Mannschaft antippen → Favorit. Alternativ einen
  nuLiga-Link einfügen oder aus Chrome über „Teilen“ an die App schicken.
- **Spielplan** mit Ergebnissen, Hallenadresse und Routenplaner, Google-Kalender-Export,
  Hinweis „geändert“ bei verlegten Spielen.
- **Tabelle** der Staffel.
- **Statistiken der Spielklasse**: Mannschaftsvergleich (Tore, 7m-Quote, Zeitstrafen, Karten)
  sowie Spieler-Ranglisten (Tore, 7m-Tore, Zeitstrafen, Gelbe und Rote Karten).
- **Push-Mitteilungen**, auch wenn die App geschlossen ist: Spielplanänderung (Datum, Uhrzeit,
  Halle), neues oder entfallenes Spiel, neues Ergebnis, Erinnerung 2 Stunden vor Anpfiff.

## Aufbau

```
Handy (Chrome, installierte PWA)                GitHub Pages
  App + Service Worker  ── lädt App-Dateien ──▶  index.html, app.js, src/ …
        │  ▲
        │  └── Push-Mitteilungen ◀─────────────┐
        ▼                                      │
Cloudflare Worker (kostenlos, eigener)         │
  /proxy         reicht nuLiga-Seiten durch ───┼──▶ hvnb-handball.liga.nu
  /subscription  speichert Push-Abo + Favoriten│
  Cron 15 Min.   gleicht Spielpläne ab ────────┘
```

**Warum ein Worker?** nuLiga hat keine öffentliche API und sendet keine CORS-Header. Ein Browser
darf die Seiten von einer fremden Webseite aus deshalb nicht lesen. Öffentliche Gratis-Proxys
waren beim Test (28.09.2026) ausgefallen oder kostenpflichtig und kommen wegen Werbung und Tracking
ohnehin nicht in Frage. Außerdem kann nur ein Server zuverlässig im Hintergrund prüfen und
Mitteilungen schicken: Das „Periodic Background Sync“ von Chrome löst nur selten und nach eigenem
Ermessen aus.

**Datensparsamkeit:** Der Worker speichert je Gerät nur das anonyme Push-Abo des Browsers und die
IDs der Favoriten. Keine Namen, keine E-Mail-Adressen. Kontaktdaten und Namen von
Verantwortlichen, die auf nuLiga-Seiten stehen, übernimmt die App nicht. Der Proxy lässt nur Seiten
von `hvnb-handball.liga.nu` durch und nur Anfragen der eigenen App. Er ist also kein offener Proxy
für Dritte. Zur Entlastung von nuLiga werden Seiten 10 Minuten zwischengespeichert.

```
index.html, app.js, app.css   Oberfläche (Hash-Router: Übersicht, Suche, Verein, Team-Detail)
manifest.webmanifest          PWA-Manifest (Installation, Teilen-Ziel)
service-worker.js             Offline-Hülle, Push empfangen, Tippen auf Mitteilung
src/config.js                 Adresse des Workers
src/push.js                   Push-Abo anlegen/abmelden, Favoriten an den Worker melden
src/shared/matchEvents.js     Änderungserkennung + Mitteilungstexte (App UND Worker)
src/data/                     IndexedDB-Speicher, Lade-/Abgleichslogik
src/parsers/                  nuLiga-HTML-Parser (Mannschaft, Tabelle, Statistiken, Verein, Halle)
worker/                       Cloudflare Worker (Proxy, Push, Cron) + Tests
```

## Einrichtung (einmalig)

Voraussetzungen: [Node.js](https://nodejs.org) (LTS), Git, ein kostenloses
[Cloudflare-Konto](https://dash.cloudflare.com/sign-up) und ein GitHub-Konto.

### 1. Worker bei Cloudflare

```powershell
cd worker
npm install
npx wrangler login                       # öffnet den Browser, Zugriff erlauben
npx wrangler kv namespace create KV      # ausgegebene id in wrangler.toml bei [[kv_namespaces]] eintragen
npm run vapid                            # erzeugt Schlüssel: VAPID_PUBLIC_KEY in wrangler.toml eintragen
cmd /c "type vapid-private.json | npx wrangler secret put VAPID_PRIVATE_JWK"
```

Wichtig unter Windows: den Schlüssel **nicht** per PowerShell-Pipe (`Get-Content … | …`) übergeben.
PowerShell 5.1 setzt dabei unsichtbar ein BOM davor. Der Worker toleriert das inzwischen zwar, der
`cmd /c "type …"`-Weg überträgt die Datei aber byte-genau.

In `worker/wrangler.toml` die Adresse der GitHub-Pages-Seite eintragen:

```toml
ALLOWED_ORIGINS = "https://<github-name>.github.io,http://localhost:8080"
VAPID_SUBJECT = "https://<github-name>.github.io/<repo-name>/"
```

Dann `npx wrangler deploy`. Die angezeigte Adresse (`https://handball-favoriten.<…>.workers.dev`)
in `src/config.js` als `WORKER_URL` eintragen.

`vapid-private.json` nie committen (steht in `.gitignore`). Geht der Schlüssel verloren, einfach neu
erzeugen. Nutzer müssen Mitteilungen dann einmal aus- und wieder einschalten.

### 2. App auf GitHub Pages

Repository anlegen, Dateien pushen, dann unter **Settings → Pages → Source** „Deploy from a branch“
mit Branch `main` und Ordner `/ (root)` wählen. Nach 1–2 Minuten ist die App unter
`https://<github-name>.github.io/<repo-name>/` erreichbar. GitHub Pages liefert automatisch HTTPS,
das für Service Worker, Push und Installation Pflicht ist.

## Neue Version veröffentlichen

1. `APP_VERSION` in `src/version.js` erhöhen (z.B. `"1.1"`). Die Version erscheint unten in der
   Übersicht, und der Worker meldet sie unter `/` und `/config`.
2. `CACHE_VERSION` in `service-worker.js` und `version` in `worker/package.json` auf denselben Wert
   setzen und einen Eintrag in `CHANGELOG.md` ergänzen. `npm test` prüft, dass alles zusammenpasst.
3. Committen, pushen und taggen (`git tag -a v1.1 -m "Version 1.1"`, `git push --tags`). Wurde am
   Worker etwas geändert: `cd worker; npx wrangler deploy`.

Nutzer bekommen die neue Version automatisch beim nächsten Öffnen der App.

### Auf dem Android-Handy installieren

1. Die GitHub-Pages-Adresse in **Chrome** öffnen.
2. Drei-Punkte-Menü → **„App installieren“** (oder „Zum Startbildschirm hinzufügen“).
3. In der App auf **„Aktivieren“** tippen (oder auf die Glocke 🔕 oben) und Mitteilungen erlauben.

Nicht nötig, aber hilfreich: In den Android-Einstellungen für die App den Akku-Modus auf
„Nicht eingeschränkt“ stellen, damit Mitteilungen auch im Energiesparmodus sofort ankommen.

## Lokal entwickeln und testen

```powershell
cd worker; npx wrangler dev --port 8787     # Worker lokal (ALLOWED_ORIGINS enthält localhost:8080)
npx serve -l 8080 ..                        # App lokal (anderes Terminal)
npm test                                     # Tests (Parser, Push-Verschlüsselung, Cron-Abgleich)
```

Für den lokalen Test `WORKER_URL` in `src/config.js` vorübergehend auf `http://localhost:8787`
setzen und in der Content-Security-Policy in `index.html` bei `connect-src` ergänzen. Die
Parser-Tests nutzen echte nuLiga-Seiten unter `worker/test/fixtures/`. Diese sind wegen der darin
enthaltenen personenbezogenen Daten nicht im Repository und werden übersprungen, wenn sie fehlen.

## Grenzen des kostenlosen Cloudflare-Tarifs

Der Cron-Abgleich lädt pro Lauf bis zu 12 Mannschaften neu. Bei mehr beobachteten Mannschaften
(über alle Nutzer zusammen) wechselt er sich ab. Bei 24 Mannschaften ist jede alle 30 Minuten dran,
bei 48 jede Stunde. Erinnerungen vor Anpfiff kommen trotzdem pünktlich, weil sie aus dem
gespeicherten Spielplan berechnet werden. Für einen Verein oder Freundeskreis reicht das gut. Für
deutlich mehr Nutzer lohnt der bezahlte Workers-Tarif (5 $/Monat, dann `BATCH_SIZE` und
`MAX_SUBREQUESTS` in `worker/src/index.js` erhöhen).

## Bekannte Einschränkungen

- Nur HVNB (`hvnb-handball.liga.nu`).
- Die App liest nuLiga-HTML. Ändert nuLiga das Seitenlayout, müssen die Parser angepasst werden. Die
  Tests in `worker/test/` zeigen dann schnell, wo.
- Mitteilungen brauchen Chrome (bzw. einen Browser mit Web Push). Auf iPhones nur, wenn die App
  zum Home-Bildschirm hinzugefügt wurde (ab iOS 16.4).
