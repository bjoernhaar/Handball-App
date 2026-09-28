// Erkennt und baut nuLiga-URLs für den Handballverband Niedersachsen-Bremen.
// Bewusst auf HVNB beschränkt (siehe README) - der Host wird zwar aus dem
// eingefügten Link übernommen, courtInfo-Abrufe nutzen aber fest federation=HVNB.

export const HVNB_HOST = "hvnb-handball.liga.nu";

/**
 * Extrahiert die erste http(s)-URL aus einem beliebigen eingefügten Text
 * (z.B. wenn jemand eine ganze Nachricht mit Link reinkopiert).
 */
function extractUrl(rawInput) {
  const match = rawInput.match(/https?:\/\/\S+/);
  return match ? match[0] : rawInput.trim();
}

/**
 * Parst einen teamPortrait-Link und liefert die für addFavoriteFromUrl
 * nötigen Identifikatoren, oder null wenn der Text keine gültige
 * teamPortrait-URL enthält.
 */
export function parseTeamPortraitLink(rawInput) {
  if (!rawInput || !rawInput.trim()) return null;
  const candidate = extractUrl(rawInput);

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (!/teamPortrait/i.test(url.pathname)) return null;

  const teamtable = url.searchParams.get("teamtable");
  const championship = url.searchParams.get("championship");
  const group = url.searchParams.get("group");
  if (!teamtable || !championship || !group) return null;

  return {
    host: url.hostname,
    teamtable,
    championship,
    group,
    pageState: url.searchParams.get("pageState") || undefined,
    normalizedUrl: buildTeamPortraitUrl(url.hostname, teamtable, championship, group),
  };
}

function base(host) {
  return `https://${host}/cgi-bin/WebObjects/nuLigaHBDE.woa/wa/`;
}

export function buildTeamPortraitUrl(host, teamtable, championship, group, pageState) {
  const params = new URLSearchParams({ teamtable, championship, group });
  if (pageState) params.set("pageState", pageState);
  return `${base(host)}teamPortrait?${params.toString()}`;
}

export function buildGroupPageUrl(host, championship, group) {
  const params = new URLSearchParams({ championship, group });
  return `${base(host)}groupPage?${params.toString()}`;
}

export function buildPlayerStatsUrl(host, championship, group, displayType) {
  const params = new URLSearchParams({ displayType, championship, group });
  return `${base(host)}groupMeetingStatistics?${params.toString()}`;
}

export function buildClubSearchUrl(query) {
  const params = new URLSearchParams({ federation: "HVNB", federations: "HVNB", searchFor: query });
  return `${base(HVNB_HOST)}clubSearch?${params.toString()}`;
}

export function buildClubTeamsUrl(clubId) {
  return `${base(HVNB_HOST)}clubTeams?${new URLSearchParams({ club: clubId }).toString()}`;
}

/** federation ist bewusst fest auf HVNB gesetzt (siehe README, "Nur HVNB"-Scope). */
export function buildCourtInfoUrl(host, locationId) {
  const params = new URLSearchParams({ federation: "HVNB", location: locationId });
  return `${base(host)}courtInfo?${params.toString()}`;
}
