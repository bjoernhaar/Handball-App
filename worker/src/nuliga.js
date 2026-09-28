// Abruf von nuLiga-Seiten aus dem Worker heraus. Wird sowohl vom Proxy-
// Endpunkt (für die App im Browser) als auch vom Cron-Abgleich genutzt.
//
// Bewusst KEIN offener Proxy: Es werden nur Seiten des HVNB-nuLiga und nur
// die von der App benötigten Seitentypen weitergereicht.

export const NULIGA_HOST = "hvnb-handball.liga.nu";
const PATH_PREFIX = "/cgi-bin/WebObjects/nuLigaHBDE.woa/wa/";
const ALLOWED_ACTIONS = new Set([
  "teamPortrait",
  "groupPage",
  "groupMeetingStatistics",
  "courtInfo",
  "clubSearch",
  "clubInfoDisplay",
  "clubTeams",
  "leaguePage",
]);

/** nuLiga selbst cached 15 Minuten (Cache-Control: max-age=900) - wir bleiben darunter. */
const CACHE_TTL_SECONDS = 600;

const USER_AGENT = "HandballFavoritenPWA (privates, werbefreies Hobbyprojekt)";

/** @returns {URL|null} die URL, wenn sie auf eine erlaubte nuLiga-Seite zeigt */
export function validateNuligaUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== NULIGA_HOST) return null;
  if (!url.pathname.startsWith(PATH_PREFIX)) return null;
  const action = url.pathname.slice(PATH_PREFIX.length);
  if (!ALLOWED_ACTIONS.has(action)) return null;
  return url;
}

/**
 * Lädt eine (bereits validierte) nuLiga-Seite, über den Cloudflare-Cache.
 * @returns {Promise<{status: number, html: string, finalUrl: string}>}
 */
export async function fetchNuliga(url) {
  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "de-DE,de;q=0.9" },
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    redirect: "follow",
  });
  const html = await response.text();
  return { status: response.status, html, finalUrl: response.url || url.toString() };
}

export function teamPortraitUrl({ teamtable, championship, group }) {
  const params = new URLSearchParams({ teamtable, championship, group });
  return new URL(`https://${NULIGA_HOST}${PATH_PREFIX}teamPortrait?${params.toString()}`);
}
