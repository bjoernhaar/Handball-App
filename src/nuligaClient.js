// Lädt nuLiga-Seiten und parst sie mit dem eingebauten DOMParser.
//
// WICHTIGER UNTERSCHIED zur Chrome-Erweiterungs-Version: Diese PWA läuft in
// einem ganz normalen Webseiten-Kontext (GitHub Pages), nicht in einer
// Erweiterung mit host_permissions. Ein direkter fetch() auf
// hvnb-handball.liga.nu würde daher an CORS scheitern, weil nuLiga keine
// Access-Control-Allow-Origin-Header sendet - der Browser blockiert dann
// das Auslesen der Antwort im JavaScript, obwohl der Request selbst
// durchgeht. Deshalb läuft der Abruf hier über einen kostenlosen
// CORS-Proxy (api.allorigins.win), der die Antwort im eigenen Namen
// weiterreicht (inkl. finaler URL nach evtl. nuLiga-Redirects, in
// payload.status.url).
//
// Das ist die einzige Stelle im Projekt, an der ein Fremd-Dienst beteiligt
// ist. Fällt der Proxy aus oder wird er zu langsam/unzuverlässig, reicht
// es, PROXY_URL unten gegen einen anderen Proxy auszutauschen (siehe
// README, Abschnitt "CORS-Proxy austauschen") - der Rest der App bleibt
// unverändert.

const PROXY_URL = (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;

/**
 * Lädt eine URL (über den CORS-Proxy) und liefert das geparste Document
 * zusammen mit der tatsächlich geladenen (nach Redirects aufgelösten) URL.
 * @param {string} url
 * @returns {Promise<{doc: Document, url: string}>}
 */
export async function fetchDocument(url) {
  let response;
  try {
    response = await fetch(PROXY_URL(url));
  } catch (err) {
    throw new Error(
      `CORS-Proxy nicht erreichbar (${err.message}). Prüfe deine Internetverbindung, oder der Proxy ist gerade down - siehe README.`
    );
  }
  if (!response.ok) {
    throw new Error(`CORS-Proxy antwortete mit HTTP ${response.status}.`);
  }

  const payload = await response.json();
  const httpCode = payload && payload.status && payload.status.http_code;
  if (httpCode && httpCode >= 400) {
    throw new Error(`nuLiga antwortete mit HTTP ${httpCode} für ${url}`);
  }

  const html = payload && payload.contents;
  if (!html) {
    throw new Error(`Leere Antwort von ${url}`);
  }

  const resolvedUrl = (payload.status && payload.status.url) || url;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { doc, url: resolvedUrl };
}
