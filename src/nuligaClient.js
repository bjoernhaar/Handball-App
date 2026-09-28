// Lädt nuLiga-Seiten und parst sie mit dem eingebauten DOMParser.
//
// nuLiga sendet keine Access-Control-Allow-Origin-Header - ein Browser darf
// die Seiten von einer fremden Webseite (GitHub Pages) aus deshalb nicht
// direkt lesen. Der Abruf läuft daher über den eigenen Cloudflare Worker
// (worker/src/index.js, Endpunkt /proxy): werbefrei, ohne Fremddienst, nur
// für Seiten von hvnb-handball.liga.nu. Die nach Redirects tatsächlich
// geladene URL kommt im Header X-Final-Url zurück.

import { WORKER_URL } from "./config.js";

/**
 * @param {string} url - nuLiga-Seite
 * @returns {Promise<{doc: Document, url: string}>}
 */
export async function fetchDocument(url) {
  let response;
  try {
    response = await fetch(`${WORKER_URL}/proxy?url=${encodeURIComponent(url)}`);
  } catch (err) {
    throw new Error(`Keine Verbindung zum Server (${err.message}). Bist du online?`);
  }
  if (!response.ok) {
    let message = null;
    try {
      message = (await response.json()).error;
    } catch {
      // keine JSON-Fehlermeldung
    }
    throw new Error(message || `Server antwortete mit HTTP ${response.status}.`);
  }

  const html = await response.text();
  if (!html) throw new Error(`Leere Antwort von ${url}`);
  const resolvedUrl = response.headers.get("X-Final-Url") || url;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { doc, url: resolvedUrl };
}
