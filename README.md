# Handball Favoriten (PWA)

Die Web-App-Version von [Handball Favoriten](../HandballFavoriten) als **installierbare Progressive
Web App (PWA)** – kein Chrome-Extension-Rahmen, keine Android-Studio-Installation nötig. Einfach als
Webseite hosten (z.B. GitHub Pages) und auf dem Handy in Chrome öffnen und "installieren".

Funktionsumfang identisch zu den anderen beiden Varianten: Favoriten-Mannschaften des HVNB per
nuLiga-Link hinzufügen, Spielplan/Ergebnisse, Tabelle, Spielerstatistiken, Spielorte mit
Routenplaner, Ein-Klick-Kalender-Export, Hintergrund-Sync + Benachrichtigungen.

## Warum eine dritte Variante?

- **Native Android-App**: volle Kontrolle, aber du musst Android Studio installieren und die App
  selbst bauen/übertragen.
- **Chrome-Erweiterung**: funktioniert super auf dem **Desktop**, aber **Chrome auf Android
  unterstützt gar keine Erweiterungen** – sie lässt sich auf dem Handy also nicht nutzen.
- **Diese PWA**: läuft überall, wo es einen Browser gibt, inkl. Chrome auf Android. Über die
  "App installieren"-Funktion von Chrome landet sie wie eine normale App auf dem Startbildschirm
  deines Pixel 10 Pro – kein Play Store nötig.

## Wichtig: CORS-Proxy

nuLiga sendet keine `Access-Control-Allow-Origin`-Header. Ein Browser lässt JavaScript auf einer
normalen Webseite (anders als bei einer Chrome-Erweiterung mit `host_permissions`) deshalb nicht
direkt auf `hvnb-handball.liga.nu` zugreifen ("CORS-Fehler"). Diese App leitet Anfragen deshalb
über den kostenlosen, öffentlichen Proxy **[allorigins.win](https://allorigins.win)** um (einzige
Stelle: `src/nuligaClient.js`).

Das ist ein Fremd-Dienst, den ich nicht kontrolliere – für ein privates Hobbyprojekt ist das ein
üblicher, praktikabler Kompromiss, aber falls er mal down oder zu langsam ist, öffnet die App
Fehlermeldungen statt Daten. Beheben:

1. Anderen öffentlichen Proxy eintragen, z.B. `https://corsproxy.io/?url=` (Antwortformat prüfen,
   ggf. `fetchDocument` in `src/nuligaClient.js` leicht anpassen).
2. Robuster (empfohlen bei ernsthafter Nutzung): einen eigenen, kostenlosen
   [Cloudflare Worker](https://developers.cloudflare.com/workers/) als Proxy deployen (wenige
   Zeilen Code) und dessen URL eintragen – dann hängt nichts mehr an einem fremden Dienst.

## Lokal testen

Kein Build-Schritt nötig, aber ein lokaler HTTP-Server ist Pflicht (Service Worker und
`fetch()` funktionieren nicht über `file://`):

```bash
npx serve .
# oder: python3 -m http.server 8080
```

Dann `http://localhost:PORT` im Browser öffnen.

## Auf GitHub veröffentlichen (GitHub Pages)

1. Neues Repository auf GitHub anlegen (oder VS Code/Android Studios "Auf GitHub freigeben"
   nutzen) und den Inhalt dieses Ordners hochladen (`git init`, `git add .`, `git commit`,
   `git push`, oder per VS-Code-Quellcode-Verwaltung → "Publish to GitHub").
2. Im Repository: **Settings → Pages → Source** auf "Deploy from a branch" stellen, Branch `main`
   und Ordner `/ (root)` wählen, speichern.
3. Nach ein bis zwei Minuten ist die App unter `https://<dein-github-name>.github.io/<repo-name>/`
   erreichbar (GitHub zeigt den Link direkt auf der Pages-Einstellungsseite an).

**Wichtig:** GitHub Pages liefert automatisch HTTPS aus – das ist zwingend nötig, Service Worker
und "App installieren" funktionieren nur über HTTPS (oder `localhost`).

## Als App auf dem Pixel 10 Pro installieren

1. Die GitHub-Pages-Adresse (siehe oben) in **Chrome** auf dem Pixel 10 Pro öffnen.
2. Rechts oben aufs Drei-Punkte-Menü tippen → **"App installieren"** (bzw. "Zum Startbildschirm
   hinzufügen", je nach Chrome-Version). Falls die App die Installierbarkeits-Kriterien erfüllt
   (Manifest + Service Worker + HTTPS, hier alles vorhanden), erscheint der Punkt meist auch
   automatisch als Vorschlag/Banner.
3. Bestätigen – die App landet mit eigenem Icon auf dem Startbildschirm und startet ohne
   Adressleiste, wie eine "echte" App.
4. Optional: Beim ersten Start das Banner "Benachrichtigungen aktivieren" bestätigen, um
   Push-artige lokale Benachrichtigungen bei neuen Ergebnissen zu erhalten.

### Spiel-Link direkt aus Chrome teilen

Ist die App installiert, taucht sie in Androids "Teilen"-Menü auf: auf einer
nuLiga-Mannschaftsseite in Chrome auf Teilen tippen → "Handball Favoriten" auswählen → Link wird
automatisch ins Hinzufügen-Formular übernommen (Pendant zur Teilen-Funktion der Android-App).

## Hintergrund-Sync & Benachrichtigungen – Einschränkungen

Anders als bei einer nativen App kann eine Web-App das Betriebssystem nicht zuverlässig zwingen,
sie regelmäßig im Hintergrund aufzuwecken:

- **Periodic Background Sync** (automatischer Sync alle paar Stunden, auch wenn die App nicht
  offen ist) funktioniert nur in Chrome/Edge auf Android, nur für installierte Apps, und nur wenn
  Chrome die Seite anhand deiner Nutzung als "oft verwendet" einstuft – ein Wert, den weder du
  noch die App direkt erzwingen können.
- **Zuverlässiger Fallback, der immer funktioniert**: Die App synchronisiert automatisch beim
  Öffnen, wenn der letzte Abgleich länger als 4 Stunden her ist. Wer die App also regelmäßig
  öffnet, bekommt trotzdem aktuelle Daten.

Für garantiert zuverlässigen Hintergrund-Sync unabhängig vom Nutzungsverhalten bleibt die native
Android-App (Ordner `HandballFavoriten`) die robustere Wahl.

## Architektur

```
index.html         App-Hülle (Topbar, Toast, Benachrichtigungs-Banner)
app.js              Hash-Router + komplette UI (Favoriten/Hinzufügen/Team-Detail)
app.css             Styling
manifest.webmanifest   PWA-Manifest (Icons, Name, share_target, Startverhalten)
service-worker.js   Cache der App-Hülle, periodischer Sync, Benachrichtigungs-Klicks
src/
  nuligaClient.js    fetch() über den CORS-Proxy (siehe oben)
  sync.js            gemeinsame Sync-Logik (App-Vordergrund + Service Worker)
  notifications.js   registration.showNotification()-Wrapper
  calendar.js         Google-Kalender-Links (unverändert von der Erweiterungs-Version)
  teamNameUtils.js    (unverändert)
  data/
    models.js          Datentypen + Statistik-Definitionen (unverändert)
    storage.js          IndexedDB-Speicher (Ersatz für chrome.storage.local)
    repository.js       Lade-/Abgleichslogik (unverändert bis auf storage.js-Import)
  parsers/             alle 6 nuLiga-HTML-Parser (unverändert von der Erweiterungs-Version)
```

Die Parser, Modelle und die Kalender-Logik sind **byte-identisch** mit der bereits gegen echte
nuLiga-Seiten verifizierten und automatisiert getesteten Chrome-Erweiterungs-Version (26 Tests).
Für den Wechsel auf IndexedDB wurde zusätzlich eine eigene Integrationstest-Suite (6 Tests, u.a.
gegen eine simulierte IndexedDB und einen simulierten CORS-Proxy) erstellt und erfolgreich
durchlaufen.

## Bekannte Einschränkungen

- **Scope**: wie die anderen Varianten fest auf den Handballverband Niedersachsen-Bremen
  (`hvnb-handball.liga.nu`) zugeschnitten.
- **CORS-Proxy-Abhängigkeit**: siehe oben – der einzige Punkt, an dem diese Variante von einem
  externen Dienst abhängt.
- **Kein Kontextmenü** wie bei der Chrome-Erweiterung (Rechtsklick auf einen Link → Hinzufügen) –
  dafür aber die Web-Share-Funktion (siehe oben), die auf Android ohnehin die natürlichere
  Bedienung ist.
- Hintergrund-Sync ist best-effort (siehe oben), nicht garantiert wie bei der nativen App.
